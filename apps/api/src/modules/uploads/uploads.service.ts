import { z } from 'zod';
import { prisma, type Prisma } from '@skillwright/db';
import type { Actor, Subject, UploadPurpose } from '@skillwright/shared';
import { baseLogger } from '../../lib/logger.js';
import { notFound, payloadTooLarge, validationFailed } from '../../lib/errors.js';
import {
  BUCKET,
  buildObjectKey,
  copyObject,
  deleteObject,
  headObject,
  presignPut,
  stagingKeyFor,
  PURPOSE_FOLDER,
} from '../../lib/storage.js';
import type { PresignUploadInput, PresignUploadResponse, UploadDto } from './uploads.schema.js';

const log = baseLogger.child({ module: 'uploads' });

/**
 * Exactly the columns `toUploadDto` reads, as one select every query spreads.
 *
 * `as const` matters for the same reason it does in resources.service.ts:43-51: Prisma
 * derives the payload type from the literal shape, and without it the type widens to
 * `boolean` and the mapper stops being checked against the columns it reads.
 *
 * A `select` rather than the default full row, even though `Upload` has no columns
 * beyond these today. The habit is what keeps a future credential-ish column off the
 * wire by default rather than by remembering.
 */
const UPLOAD_SELECT = {
  id: true,
  key: true,
  bucket: true,
  contentType: true,
  sizeBytes: true,
  originalName: true,
  status: true,
  ownerId: true,
  createdAt: true,
  committedAt: true,
} as const;

type UploadRow = Prisma.UploadGetPayload<{ select: typeof UPLOAD_SELECT }>;

/**
 * How much of the bucket one account, and everyone together, may claim.
 *
 * These three numbers ARE the product decision this phase was asked to make visible,
 * so they are written here rather than buried in a default, and the reasoning is the
 * point rather than the values:
 *
 *  - `UPLOAD_USER_MAX_BYTES` — 2 GiB. The largest single permitted upload is a 512 MB
 *    RESOURCE video (`UPLOAD_LIMITS` in packages/shared/src/schema/upload.ts), so a
 *    teacher can still file four of them. A full course library of documents and
 *    images is tens of megabytes; 2 GiB is roughly forty times that, which means the
 *    number a legitimate user hits is not one they will hit by accident. Below it, one
 *    account could park a meaningful share of a small bucket on its own.
 *  - `UPLOAD_USER_MAX_FILES` — 500. Bytes alone do not stop a row flood: 2,000 avatar
 *    uploads of 2 KB each is 4 MB and 2,000 `Upload` rows, four of which are unique-key
 *    constrained and the rest of which the sweeper has to walk. Rows are cheap to make
 *    and expensive to garbage-collect, so they get their own ceiling.
 *  - `UPLOAD_BUCKET_MAX_BYTES` — 50 GiB. This is a STORAGE BUDGET, not a fairness rule:
 *    it exists so the answer to "the disk is full" is a 413 naming the cause rather
 *    than a write error from the object store that nobody can act on. 50 GiB is a
 *    number to change on day one of a real deployment and it is wrong here; it is
 *    wrong in a DIRECTION, because the alternative is no ceiling at all.
 *
 * 0 disables a ceiling, which is the only way to turn one off. That is worth saying
 * because it is the opposite of `UPLOAD_SWEEP_MAX_AGE_MS`, where 0 would mean "sweep
 * everything now" and is rejected by the schema.
 *
 * Parsed HERE rather than in `env.ts`, which is not this phase's file. `z.coerce`
 * rather than a bare `Number()`, so a typo is a named boot failure instead of `NaN`
 * comparisons that quietly allow everything.
 */
const quotaConfig = z
  .object({
    UPLOAD_USER_MAX_BYTES: z.coerce.number().int().min(0).default(2_147_483_648),
    UPLOAD_USER_MAX_FILES: z.coerce.number().int().min(0).default(500),
    UPLOAD_BUCKET_MAX_BYTES: z.coerce.number().int().min(0).default(53_687_091_200),
  })
  .parse(process.env);

/**
 * Refuse a presign that would push an account, or the whole bucket, past its ceiling.
 *
 * AT PRESIGN, and that placement is the design. By the time `commit` runs the bytes are
 * already in the object store — the browser PUTs straight to it, with the API nowhere
 * in the path — so a quota checked there is a quota checked after the disk filled. A
 * ceiling that arrives late is a monitoring signal, not a limit.
 *
 * PENDING rows are counted, and that is the subtle part. A PENDING row's bytes may not
 * exist yet, but the row RESERVES them: it carries the declared `sizeBytes` and it is
 * about to be filled by a PUT that is already signed. Counting only COMMITTED rows
 * would let a caller mint 500 signatures for the same 512 MB in a second and the quota
 * would never notice, because nothing has been committed. The sweeper reclaims the
 * abandoned ones (`UPLOAD_SWEEP_MAX_AGE_MS`), so a caller who signs and walks away
 * frees the reservation on a timer rather than holding it forever.
 *
 * Two aggregates, run concurrently. The per-owner one is served by `@@index([ownerId])`
 * on `Upload`; the whole-bucket one is a sequential scan of a single small integer
 * column, which is the honest cost of a global ceiling and is the reason the ceiling
 * is a number an operator can raise rather than something to compute per request.
 */
async function assertWithinUploadQuota(actor: Actor, requestedBytes: number): Promise<void> {
  if (
    quotaConfig.UPLOAD_USER_MAX_BYTES === 0 &&
    quotaConfig.UPLOAD_USER_MAX_FILES === 0 &&
    quotaConfig.UPLOAD_BUCKET_MAX_BYTES === 0
  ) {
    return;
  }

  const [mine, everyone] = await Promise.all([
    prisma.upload.aggregate({
      where: { ownerId: actor.id },
      _sum: { sizeBytes: true },
      _count: { _all: true },
    }),
    prisma.upload.aggregate({ _sum: { sizeBytes: true } }),
  ]);

  const heldBytes = mine._sum.sizeBytes ?? 0;
  const heldFiles = mine._count._all;

  if (
    quotaConfig.UPLOAD_USER_MAX_BYTES > 0 &&
    heldBytes + requestedBytes > quotaConfig.UPLOAD_USER_MAX_BYTES
  ) {
    log.warn(
      {
        userId: actor.id,
        limit: 'upload:user-bytes',
        heldBytes,
        requestedBytes,
        maxBytes: quotaConfig.UPLOAD_USER_MAX_BYTES,
      },
      'upload refused by the per-user quota',
    );
    throw payloadTooLarge(
      `This account already holds ${heldBytes} bytes of uploads, which is the per-user limit. Delete something, or ask an administrator to raise UPLOAD_USER_MAX_BYTES.`,
    );
  }

  if (quotaConfig.UPLOAD_USER_MAX_FILES > 0 && heldFiles + 1 > quotaConfig.UPLOAD_USER_MAX_FILES) {
    log.warn(
      {
        userId: actor.id,
        limit: 'upload:user-files',
        heldFiles,
        maxFiles: quotaConfig.UPLOAD_USER_MAX_FILES,
      },
      'upload refused by the per-user file-count quota',
    );
    throw payloadTooLarge(
      `This account already holds ${heldFiles} uploads, which is the per-user limit.`,
    );
  }

  const bucketBytes = everyone._sum.sizeBytes ?? 0;
  if (
    quotaConfig.UPLOAD_BUCKET_MAX_BYTES > 0 &&
    bucketBytes + requestedBytes > quotaConfig.UPLOAD_BUCKET_MAX_BYTES
  ) {
    log.warn(
      {
        limit: 'upload:bucket-bytes',
        bucketBytes,
        requestedBytes,
        maxBytes: quotaConfig.UPLOAD_BUCKET_MAX_BYTES,
      },
      'upload refused by the whole-bucket quota',
    );
    throw payloadTooLarge(
      `The upload store is at its configured ceiling (${quotaConfig.UPLOAD_BUCKET_MAX_BYTES} bytes). This is an administrator's limit, not yours.`,
    );
  }
}

/**
 * The ONLY shape an upload is serialised as.
 *
 * The return type is the shared schema's inferred type (upload.ts:93-105), not a
 * hand-written mirror, so a renamed field in `@skillwright/shared` is a compile error
 * here rather than a response-validation 500 at runtime.
 *
 * `key` and `bucket` ARE on the wire, because `uploadSchema` puts them there. That is
 * safe on its own terms — the bucket is private and has no anonymous door, so a key is
 * a name and not an access grant — and it is what lets the SPA correlate a row with the
 * PUT it just performed.
 */
function toUploadDto(upload: UploadRow): UploadDto {
  return {
    id: upload.id,
    key: upload.key,
    bucket: upload.bucket,
    contentType: upload.contentType,
    sizeBytes: upload.sizeBytes,
    originalName: upload.originalName,
    status: upload.status,
    ownerId: upload.ownerId,
    createdAt: upload.createdAt.toISOString(),
    committedAt: upload.committedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Subject loaders — the only database access authorization performs
// ---------------------------------------------------------------------------

/**
 * Subject for `upload:commit`, whose every role cell is `isSelf` (policy.ts:385-392).
 *
 * `isSelf` matches on `subject.userId` and denies when it is absent (combinators.ts:46-49),
 * so the owner is spelled onto that exact key. `ownerId` would be a SILENT 403 that no
 * type error and no log line would ever show you — every `Subject` field is optional
 * (actor.ts:49-51) — which is the failure resources.service.ts:138-140 warns about for
 * `courseTeacherId`.
 *
 * `undefined` for a missing row so the policy denies, rather than this loader throwing a
 * bare 404 before the gate has run. Unlike `resource:read` there is no ADMIN `allow` cell
 * to fall through it: an admin committing a stranger's upload is denied by `isSelf` too,
 * deliberately, because committing is an assertion that YOU uploaded these bytes.
 */
export async function loadUploadSubject(uploadId: string): Promise<Subject | undefined> {
  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    select: { id: true, ownerId: true },
  });
  if (!upload) return undefined;

  return { id: upload.id, userId: upload.ownerId };
}

// ---------------------------------------------------------------------------
// Presign
// ---------------------------------------------------------------------------

/**
 * Mint the Upload row and the signed PUT that fills it.
 *
 * The row is written BEFORE the bytes exist, and that ordering is the point rather than
 * an accident: `commit` needs somewhere to record what was declared, and the client needs
 * an id to send back. A PENDING row therefore asserts nothing about the bucket — it
 * records a claim, and only `commit` turns that claim into a verified fact. Which is why
 * `GET /resources/:id/download` refuses to sign a PENDING upload rather than trusting the
 * `contentType` and `sizeBytes` stored here.
 *
 * A PENDING row left behind by a user who asked for a signature and then closed the dialog
 * is reclaimed by the scheduled sweeper (uploads.sweeper.ts), which deletes rows still
 * PENDING past a configurable age — object first, then row. `@@index([status, createdAt])`
 * (on `model Upload`) is the index that job reads; it exists for exactly this and has no
 * other caller.
 *
 * `ownerId` is the ACTOR and never the body: `presignUploadSchema` has no owner field
 * (upload.ts:46-53), and accepting one would let a caller mint an upload in someone
 * else's name and then have `isSelf` refuse THEM at commit — an upload nobody can
 * finish, planted by anyone.
 *
 * No manual audit row: `Upload` is not in `AUDITED_MODELS` (packages/db/src/audit.ts),
 * because an object-store bookkeeping row is not a governance event. The `Resource` that
 * eventually attaches it IS audited, which is the event a reader actually wants.
 */
export async function presign(
  actor: Actor,
  input: PresignUploadInput,
): Promise<PresignUploadResponse> {
  // Server-generated, and derived from `purpose` rather than from the filename the
  // client sent (storage.ts:85-103). The purpose is spent here: `presignUploadSchema`
  // has already applied its size and MIME limits (upload.ts:54-70), and the only trace
  // it leaves afterwards is the key prefix.
  const key = buildObjectKey(input.purpose, input.originalName);

  // Before the row and before the signature. A 413 raised after either exists is a
  // refusal the caller can see and a `Upload` row nobody will ever fill.
  await assertWithinUploadQuota(actor, input.sizeBytes);

  const upload = await prisma.upload.create({
    data: {
      key,
      bucket: BUCKET,
      // What the client DECLARED. `commit` compares both against HeadObject before this
      // row is allowed to mean anything.
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      originalName: input.originalName,
      status: 'PENDING',
      ownerId: actor.id,
    },
    select: { id: true },
  });

  /*
   * The PUT is signed for the STAGING shadow of `key` (storage.ts `stagingKeyFor`), not
   * for `key` itself — that gap IS the immutability guarantee. While the row is PENDING
   * its bytes live under `_pending/`; only `commit` verifies them there and copies them
   * onto the final key. A replayed PUT after commit can at worst re-create a file in
   * the staging prefix, where no reader ever looks; it can never touch the verified
   * object. The row stores the FINAL key throughout, so the wire shape, the
   * purpose-prefix evidence `assertUploadClaimable` reads, and the sweeper's
   * row-key-to-object mapping all stay one function away from the truth.
   */
  const signed = await presignPut({
    key: stagingKeyFor(key),
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });

  return {
    uploadId: upload.id,
    url: signed.url,
    method: 'PUT',
    // The signed content-type header, which the browser MUST replay verbatim
    // (storage.ts:123-140). Returned rather than assumed so the SPA has nothing to guess.
    headers: signed.headers,
    key,
    expiresAt: signed.expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

/**
 * `image/png` and `IMAGE/PNG; charset=binary` are the same media type.
 *
 * The parameters are dropped and the type is lowercased before the comparison below,
 * per RFC 9110 §8.3.1 — the type and subtype are case-insensitive and a parameter is not
 * part of the identity. In practice MinIO echoes back exactly what was signed, so this
 * normalisation almost never changes an answer; it exists so that the day a store
 * appends `; charset=utf-8` to a `text/markdown` PUT, a truthful upload is not refused
 * with a mismatch the user cannot act on.
 */
function normaliseMediaType(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() ?? '';
}

/**
 * The checkpoint: confirm with the object store that the bytes match the declaration,
 * then promote the row.
 *
 * This is the whole reason `commit` is an endpoint rather than something the presign
 * response implies. The browser PUTs DIRECTLY to the bucket with the API nowhere in the
 * path, so the API's only evidence about those bytes is HeadObject. Without this step a
 * client could declare a 2 KB PDF, upload a 400 MB video, and the `Resource` built on top
 * would advertise `sizeBytes: 2048` to every student who ever saw it — `resourceSchema`
 * flattens these two columns onto the resource (resources.service.ts:46-48), so a lie
 * here is a lie on every course page.
 *
 * The three failures are 422s at a field path rather than a 409 or a 500, because each
 * one names something the CLIENT sent and can resend correctly:
 *   no object   -> `uploadId`     the PUT never happened, or went to a different key
 *   wrong type  -> `contentType`  the declaration and the stored object disagree
 *   wrong size  -> `sizeBytes`    ditto
 *
 * Already-COMMITTED returns the row unchanged rather than re-heading the object or
 * moving `committedAt`. A double-submitted form and a retried request are the same
 * request, exactly as enrollments.service.ts:389-398 treats a second approve — and
 * unlike that one there is not even a counter at stake, only an idempotent answer.
 *
 * No `actor` parameter: nothing here is actor-scoped. `upload:commit` is `isSelf` for
 * every role and was already decided against this row's owner at the gate
 * (uploads.routes.ts), so a second ownership test in the service would be a second
 * source of truth for one rule.
 */
export async function commit(uploadId: string): Promise<UploadDto> {
  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    select: UPLOAD_SELECT,
  });
  // Reachable in a race — the gate's loader read the row a moment ago — and it must be a
  // truthful 404 rather than a null-dereference 500.
  if (!upload) throw notFound('Upload');

  if (upload.status === 'COMMITTED') return toUploadDto(upload);

  /*
   * The bytes are verified where the PUT put them: the staging shadow of the row's
   * final key (storage.ts `stagingKeyFor`).
   */
  const stagedKey = stagingKeyFor(upload.key);
  const stored = await headObject(stagedKey);
  if (stored === null) {
    throw validationFailed([
      {
        path: 'uploadId',
        message: 'No file has been uploaded for this id yet. Complete the PUT, then commit.',
      },
    ]);
  }

  if (normaliseMediaType(stored.contentType) !== normaliseMediaType(upload.contentType)) {
    throw validationFailed([
      {
        path: 'contentType',
        message: `The stored file is ${stored.contentType}, not the ${upload.contentType} that was declared.`,
      },
    ]);
  }

  if (stored.sizeBytes !== upload.sizeBytes) {
    throw validationFailed([
      {
        path: 'sizeBytes',
        message: `The stored file is ${stored.sizeBytes} bytes, not the ${upload.sizeBytes} that were declared.`,
      },
    ]);
  }

  /*
   * Copy-to-final-key — the immutability fix, and this commit's whole point beyond
   * verification. WHY THE COPY and not an ETag re-check on download: a replayed PUT
   * after verification physically REPLACES a same-key object; recording its ETag would
   * let downloads REFUSE the replacement but never prevent it, leaving verified bytes
   * mutable in place and every reader one bug away from serving them. The copy puts
   * the published object beyond every write URL's reach instead. It also beats the
   * alternative honestly: it costs one store-side CopyObject per upload — bytes never
   * cross this process — and no HeadObject tax on any download.
   *
   * Ordering survives crashes in the safe direction. COPY first (a crash here leaves
   * the row PENDING with both copies present; the retry re-heads the staged object,
   * still there, and repeats the copy idempotently); UPDATE second (the row goes
   * COMMITTED only when the final key provably holds verified bytes); DELETE last,
   * best-effort like notify() — its failure is logged and nothing else, because the
   * row is already correct and the leftover staging file is bookkeeping, not truth.
   */
  await copyObject({ fromKey: stagedKey, toKey: upload.key });

  const committed = await prisma.upload.update({
    where: { id: uploadId },
    data: { status: 'COMMITTED', committedAt: new Date() },
    select: UPLOAD_SELECT,
  });

  try {
    await deleteObject(stagedKey);
  } catch (error) {
    log.warn(
      { err: error, uploadId, stagedKey },
      'committed upload staged copy could not be deleted; ignoring',
    );
  }

  return toUploadDto(committed);
}

/**
 * "May this actor attach this upload to something, right now?"
 *
 * Lives here because the Upload row is this module's, and because four callers need
 * the identical answer: `resource:create` (resources.service.ts), a course syllabus
 * (courses.service.ts), an avatar (users.service.ts) and a hand-in
 * (assignments.service.ts). Until this existed, resources
 * had a private copy and courses had NOTHING — `syllabusUploadId` went from the request
 * body straight into the row, so a teacher could bind a colleague's private file to their
 * own course by guessing an id. That is the upload-shaped version of the hole
 * `ownsCourse` closes on policy.ts's `resource:create`.
 *
 * Four questions, one query:
 *
 *   exists          - a 422 rather than a foreign-key 500 from Postgres
 *   owned by actor  - ADMIN exempt, for the same reason ADMIN is `allow` everywhere
 *   COMMITTED       - a PENDING row is a signature that was issued and never used; the
 *                     bytes may not be in the bucket at all, and attaching one produces
 *                     a resource whose download answers 409 forever
 *   unclaimed       - every `@unique` claim column the schema declares, which is now
 *                     FOUR of them: `Resource.uploadId`, `Course.syllabusUploadId`,
 *                     `User.avatarUploadId` and `Submission.uploadId`. Each is unique
 *                     because one file backs one thing, so a second claim is a P2002
 *                     the caller cannot read. Checked here, it names the field.
 *
 * The fourth of those arrived after the other three, and it is the case that shows why
 * the clause has to be written as "every claim column" rather than as a list of three.
 * `Submission.uploadId` carries the same `@unique` and the same `onDelete: Restrict`
 * that `Resource.uploadId` does, because the bytes ARE the hand-in exactly as they are
 * the resource — and a hand-in already in place left this read out of the `unclaimed`
 * clause, so re-submitting the same file to a second task produced a pathless 409 from
 * the error plugin's P2002 branch. Nothing threw, nothing logged, and the student was
 * told they had conflicted with themselves by an endpoint whose whole job is to accept
 * their work. A list of the columns already known to be unique is a list that is wrong
 * the moment a model is added; the sentence that does not go stale is the one naming
 * the property being enforced.
 *
 * A fifth question is opt-in via `purpose`: when given, the key prefix must be the
 * folder that purpose mints (PURPOSE_FOLDER). The prefix is the only record of a
 * purpose — `Upload` has no `purpose` column (storage.ts:56-70) — so this is the whole
 * check, not part of one. Only avatars ask for it today: an avatar pointing at an
 * upload presigned as a RESOURCE would serve a 512 MB video through an <img> tag and
 * bypass the avatar limits entirely, where resources and syllabi are both attached by
 * privileged course staff. Resources/syllabi callers omit it and behave exactly as
 * before.
 *
 * There is no `upload:attach` action to express any of this in the policy table
 * (policy.ts stops at `upload:presign` and `upload:commit`), so the service owns it.
 * A race past this check still collides on the unique index and is a 409, deliberately.
 */
export async function assertUploadClaimable(
  uploadId: string,
  actor: Actor,
  path: string,
  purpose?: UploadPurpose,
): Promise<void> {
  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      key: true,
      ownerId: true,
      status: true,
      resource: { select: { id: true } },
      courseSyllabus: { select: { id: true } },
      userAvatar: { select: { id: true } },
      submission: { select: { id: true } },
    },
  });

  if (!upload) throw validationFailed([{ path, message: 'Unknown upload' }]);

  if (actor.role !== 'ADMIN' && upload.ownerId !== actor.id) {
    throw validationFailed([{ path, message: 'That upload belongs to someone else' }]);
  }

  if (upload.status !== 'COMMITTED') {
    throw validationFailed([
      { path, message: 'That upload has not been confirmed yet. Commit it before attaching it.' },
    ]);
  }

  if (purpose !== undefined && !upload.key.startsWith(`${PURPOSE_FOLDER[purpose]}/`)) {
    throw validationFailed([
      {
        path,
        message: `That upload was not made as a ${purpose.toLowerCase()} upload.`,
      },
    ]);
  }

  if (
    upload.resource !== null ||
    upload.courseSyllabus !== null ||
    upload.userAvatar !== null ||
    upload.submission !== null
  ) {
    throw validationFailed([{ path, message: 'That upload is already attached to something' }]);
  }
}
