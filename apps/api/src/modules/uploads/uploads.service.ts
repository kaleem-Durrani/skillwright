import { prisma, type Prisma } from '@skillwright/db';
import type { Actor, Subject, UploadPurpose } from '@skillwright/shared';
import { notFound, validationFailed } from '../../lib/errors.js';
import {
  BUCKET,
  buildObjectKey,
  headObject,
  PURPOSE_FOLDER,
  presignPut,
} from '../../lib/storage.js';
import type { PresignUploadInput, PresignUploadResponse, UploadDto } from './uploads.schema.js';

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
 * (schema.prisma:423) is the index that job reads; it exists for exactly this and has no
 * other caller.
 *
 * `ownerId` is the ACTOR and never the body: `presignUploadSchema` has no owner field
 * (upload.ts:46-53), and accepting one would let a caller mint an upload in someone
 * else's name and then have `isSelf` refuse THEM at commit — an upload nobody can
 * finish, planted by anyone.
 *
 * No manual audit row: `Upload` is not in AUDITED_MODELS (packages/db/src/audit.ts:51-59),
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

  // `sizeBytes` goes into the SIGNATURE, not just the row: without it the store accepts
  // a body of any length at this key and `UPLOAD_LIMITS` is enforced only by the zod
  // check above. See the measurement table on `presignPut`.
  const signed = await presignPut({
    key,
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

  const stored = await headObject(upload.key);
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

  const committed = await prisma.upload.update({
    where: { id: uploadId },
    data: { status: 'COMMITTED', committedAt: new Date() },
    select: UPLOAD_SELECT,
  });

  return toUploadDto(committed);
}

/**
 * "May this actor attach this upload to something, right now?"
 *
 * Lives here because the Upload row is this module's, and because three callers need
 * the identical answer: `resource:create` (resources.service.ts), a course syllabus
 * (courses.service.ts), and an avatar (users.service.ts). Until this existed, resources
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
 *   unclaimed       - `Resource.uploadId`, `Course.syllabusUploadId` and
 *                     `User.avatarUploadId` are each `@unique`, so a second claim is a
 *                     P2002 the caller cannot read. Checked here, it names the field.
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

  if (upload.resource !== null || upload.courseSyllabus !== null || upload.userAvatar !== null) {
    throw validationFailed([{ path, message: 'That upload is already attached to something' }]);
  }
}
