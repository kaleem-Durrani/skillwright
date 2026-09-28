import { randomBytes } from 'node:crypto';
import { prisma, type Prisma } from '@skillwright/db';
import { API_BASE_PATH, type Actor, type Subject } from '@skillwright/shared';
import { env } from '../../env.js';
import { USER_SUMMARY_SELECT, toUserSummary } from '../../lib/dto.js';
import { conflict, notFound, validationFailed } from '../../lib/errors.js';
import {
  BUCKET,
  buildObjectKey,
  presignGet,
  presignPut,
  stagingKeyFor,
} from '../../lib/storage.js';
import { notify } from '../notifications/notifications.service.js';
import { commit } from '../uploads/uploads.service.js';
import { renderCertificatePdf } from './certificate.pdf.js';
import type {
  CertificateDto,
  CertificateList,
  CreateQualificationInput,
  IssueCertificateInput,
  ListCertificatesQuery,
  QualificationDto,
  QualificationList,
  RevokeCertificateInput,
  VerifyResult,
} from './certificates.schema.js';

// ---------------------------------------------------------------------------
// The reference
// ---------------------------------------------------------------------------

/**
 * Crockford base32: the 32 symbols a person can transcribe off a printout without
 * producing a different valid one. I, L, O and U are omitted because they collide with
 * 1, 1, 0 and V — which is the reason the certificate prints its reference in Courier
 * rather than in the proportional face above it.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * 26 characters over 16 CSPRNG bytes: 128 bits of entropy.
 *
 * The arithmetic is the whole security argument of the one unauthenticated route this
 * system has, so it is worth being exact. 16 bytes is 128 bits and 26 base-32
 * characters carry 130, so the last character encodes only 3 bits and is drawn from
 * `CROCKFORD.slice(0, 8)`. Emitting a full alphabet character there would throw two
 * bits away and make the reference look more random than it is.
 *
 * Three layers state the same rule from their own sides, which is what stops it rotting:
 * this function emits it, `referenceSchema` validates it (`…{25}[0-7]$`), and migration
 * 0013's CHECK holds the length floor in the database. A generator that drifted from
 * either of the others would fail a test rather than mint a reference the verifier
 * refuses.
 *
 * `randomBytes` from `node:crypto`, never `Math.random`: this value is the only thing
 * between "a certificate exists" and "somebody typed a certificate into the verifier".
 */
export function generateReference(): string {
  const bytes = randomBytes(16);
  let out = '';
  let bitBuffer = 0;
  let bitsHeld = 0;
  let index = 0;
  for (let produced = 0; produced < 26; produced += 1) {
    while (bitsHeld < 5) {
      bitBuffer = (bitBuffer << 8) | (bytes[index] as number);
      bitsHeld += 8;
      index += 1;
    }
    const value = (bitBuffer >> (bitsHeld - 5)) & 0b11111;
    bitsHeld -= 5;
    out += produced === 25 ? CROCKFORD[value & 0b111] : CROCKFORD[value];
  }
  return out;
}

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

/**
 * `as const` for the reason it is on every other include in this repository
 * (resources.service.ts): Prisma derives the payload type from the literal shape, and
 * without it the mapper stops being checked against the columns it reads.
 *
 * `student` is here ONLY for the PDF and the verify route's name; no DTO field carries
 * it, which is what keeps the holder's account id off every response this module
 * produces.
 */
const CERTIFICATE_INCLUDE = {
  qualification: true,
  issuedBy: { select: USER_SUMMARY_SELECT },
  revokedBy: { select: USER_SUMMARY_SELECT },
  artifactUpload: { select: { id: true, originalName: true, contentType: true, sizeBytes: true } },
  student: { select: { name: true } },
} as const;

type CertificateRow = Prisma.StudentQualificationGetPayload<{
  include: typeof CERTIFICATE_INCLUDE;
}>;

function toCertificateDto(row: CertificateRow): CertificateDto {
  return {
    id: row.id,
    reference: row.reference,
    issuedAt: row.issuedAt.toISOString(),
    issuedBy: row.issuedBy === null ? null : toUserSummary(row.issuedBy),
    qualification: {
      id: row.qualification.id,
      code: row.qualification.code,
      name: row.qualification.name,
      level: row.qualification.level,
      awardingBody: row.qualification.awardingBody,
    },
    enrollmentId: row.enrollmentId,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedBy: row.revokedBy === null ? null : toUserSummary(row.revokedBy),
    revokedReason: row.revokedReason,
    artifact:
      row.artifactUpload === null
        ? null
        : {
            id: row.artifactUpload.id,
            originalName: row.artifactUpload.originalName,
            contentType: row.artifactUpload.contentType,
            sizeBytes: row.artifactUpload.sizeBytes,
          },
  };
}

// ---------------------------------------------------------------------------
// Subject loaders — the only database access authorization performs
// ---------------------------------------------------------------------------

/**
 * Subject for `certificate:read` and the download that rides it.
 *
 * Every field is NAMED, never spread (LESSONS-LEARNED #18: TypeScript does not
 * excess-property-check a spread, so a misspelled key is a silent refusal rather than a
 * compile error):
 *
 *   studentId       -> isEnrolledStudent   the holder's entire access
 *   courseTeacherId -> ownsCourse          reached through the seat it was issued on
 *   authorId        -> isAuthor            THIS IS `issuedById`, deliberately
 *
 * The last line is the one to read twice. `isAuthor` is a shared rule that reads
 * `subject.authorId`, and this loader puts `StudentQualification.issuedById` on that
 * exact key. It is a documented mapping rather than a rename — the policy cell it feeds
 * is `TEACHER: or(ownsCourse, isAuthor)` — and a key left off a subject DENIES rather
 * than opens, so if the mapping is ever dropped a teacher silently loses sight of the
 * certificates they personally signed. That is the failure mode this repository has
 * now paid for three times (LESSONS-LEARNED #31).
 *
 * `undefined` for a row that does not exist, so the policy denies rather than this
 * loader throwing a 404 before the gate has run.
 */
export async function loadCertificateSubject(id: string): Promise<Subject | undefined> {
  const certificate = await prisma.studentQualification.findFirst({
    // NOT filtered on the catalogue's `deletedAt`, deliberately, and the same is true
    // of `visibilityWhere` below. Retiring a standard stops it being AWARDED — which is
    // what `issue`'s lookup and `GET /qualifications` decide — and must not stop the
    // certificates that already name it from being read, downloaded or verified. A
    // holder whose qualification was retired would otherwise watch their record vanish
    // from the one tab that exists to show it, while the public verify route went on
    // confirming it: two answers to the same question.
    where: { id },
    select: {
      id: true,
      studentId: true,
      issuedById: true,
      // The course is reached through the seat. A certificate whose `enrollmentId` has
      // been nulled — the intake was hard-deleted, which soft delete makes rare but not
      // impossible — has no course left to teach, and its teacher's only remaining
      // claim to it is having signed it.
      enrollment: {
        select: { offering: { select: { course: { select: { teacherId: true } } } } },
      },
    },
  });
  if (!certificate) return undefined;

  return {
    id: certificate.id,
    studentId: certificate.studentId,
    // Spread-or-omit rather than `?? undefined`, because this project compiles with
    // `exactOptionalPropertyTypes`: a key PRESENT with the value `undefined` is not an
    // optional property, it is a property typed `string` holding `undefined`. Both of
    // these can legitimately be missing (a certificate whose seat is gone has no
    // course; one issued by a since-deleted account has no issuer) and both must
    // DENY rather than throw, which is what leaving the key off achieves.
    ...(certificate.enrollment
      ? { courseTeacherId: certificate.enrollment.offering.course.teacherId }
      : {}),
    ...(certificate.issuedById ? { authorId: certificate.issuedById } : {}),
  };
}

/**
 * Subject for `certificate:issue`: the SEAT named in the body.
 *
 * There is no certificate row yet, which is exactly why this is `ownsCourse` for a
 * teacher rather than a lookup of the student's existing qualifications — the same
 * reasoning `resource:create` and `assignment:create` give. It is what stops a teacher
 * certifying a colleague's student by guessing an `enrollmentId`.
 *
 * `undefined` for a request that carried no body at all. This loader runs inside the
 * policy `preHandler`, which is deliberately BEFORE the body is parsed (so a malformed
 * body cannot pre-empt a 403 the policy owed the caller), which means it has to survive
 * a request with nothing in it. Returning `undefined` makes the subject empty, every
 * role rule that reads a field denies, and the caller gets the 403 — where throwing here
 * would be a 500 on a request they had no business making.
 */
export async function loadEnrollmentSubject(
  enrollmentId: string | undefined,
): Promise<Subject | undefined> {
  if (enrollmentId === undefined) return undefined;
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, offering: { deletedAt: null, course: { deletedAt: null } } },
    select: {
      id: true,
      studentId: true,
      offering: { select: { courseId: true, course: { select: { teacherId: true } } } },
    },
  });
  if (!enrollment) return undefined;

  return {
    id: enrollment.id,
    studentId: enrollment.studentId,
    courseId: enrollment.offering.courseId,
    courseTeacherId: enrollment.offering.course.teacherId,
  };
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/**
 * The `certificate:read` rows, expressed as a WHERE clause, because a LIST has no
 * single subject (LESSONS-LEARNED #15 — a gate asked with an empty subject denies every
 * caller including admins, and that mistake has shipped six times in this repository).
 *
 *   STUDENT -> isEnrolledStudent        (policy.ts)
 *   TEACHER -> or(ownsCourse, isAuthor) (policy.ts)
 *   ADMIN   -> allow                    (policy.ts)
 *
 * Reading `actor.role` here is choosing which WHERE mirrors which policy row — the one
 * legitimate role read named by CONTRIBUTING.md. It is NOT a permission check: IF THIS
 * FUNCTION AND policy.ts DISAGREE, THIS FUNCTION IS THE BUG.
 *
 * The teacher's two branches are the same disjunction the rule is, and the second is
 * not a fudge: a certificate issued out of a seat on a course this teacher owns is
 * reached through `enrollment`, and one whose seat is gone is reached through
 * `issuedById`. Mirroring only the first would drop the second from the list while the
 * policy still granted read on the row — the class of divergence lesson 28 cost the
 * dashboard a counter.
 *
 * There is deliberately NO `deletedAt` clause on the qualification. A retired standard
 * stops being awardable and stops appearing in `GET /qualifications`; it does not stop
 * the certificates already naming it from existing, which is the same line migration
 * 0013 draws when it makes the catalogue soft-deletable.
 */
export function visibilityWhere(
  actor: Actor,
  studentId: string | null | undefined,
): Prisma.StudentQualificationWhereInput {
  const filter: Prisma.StudentQualificationWhereInput[] = [];

  if (actor.role === 'STUDENT') {
    /*
     * The caller's own rows, and the `studentId` filter is IGNORED for them rather than
     * refused. A student who names somebody else gets their OWN certificates back, and
     * that is the better of two answers that both look wrong: the row filter IS the
     * authorization, and a 403 would confirm that another student's record exists while
     * protecting nothing.
     */
    filter.push({ studentId: actor.id });
  } else {
    if (studentId) filter.push({ studentId });
    if (actor.role === 'TEACHER') {
      filter.push({
        OR: [
          {
            enrollment: {
              is: {
                offering: { deletedAt: null, course: { teacherId: actor.id, deletedAt: null } },
              },
            },
          },
          { issuedById: actor.id },
        ],
      });
    }
  }

  return { AND: filter };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * `GET /certificates` — the caller's own list, or one student's for staff.
 *
 * Not paginated and not gated on a subject, on the arguments `GET /enrollments` and
 * `GET /assignments/mine` make: the rows are the caller's own, `visibilityWhere` is the
 * only thing between a student and somebody else's qualifications, and a page
 * parameter would need a second response shape for a list a phone renders whole. The
 * cap is the one the assignments module uses, for its reason: an unbounded `findMany`
 * on a table a school can write to is a shape nobody should ship on the strength of
 * "it will not happen".
 */
const MINE_LIMIT = 200;

export async function list(actor: Actor, query: ListCertificatesQuery): Promise<CertificateList> {
  const rows = await prisma.studentQualification.findMany({
    where: visibilityWhere(actor, query.studentId),
    orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
    take: MINE_LIMIT,
    include: CERTIFICATE_INCLUDE,
  });
  return { data: rows.map(toCertificateDto) };
}

/**
 * `GET /certificates/verify/:reference` — the one unauthenticated route, and the answer
 * it gives.
 *
 * WHAT IT RETURNS IS THE SECURITY DESIGN, and the omissions are deliberate rather than
 * an oversight: no row id, no email, no `studentId`, no enrolment, no issuer, and no
 * revocation grounds. Four fields — the holder's name, the qualification, the date, and
 * whether it still stands — because that is what "is this certificate genuine" means
 * and nothing else is. A verification endpoint that returned an id would be an
 * invitation to try it against an authenticated route; one that returned an email would
 * turn a printout into a harvesting tool.
 *
 * WHY A 404 RATHER THAN A 200 SAYING "NOT FOUND". The endpoint's contract in the
 * feature plan is "404 for unknown, 200 for known", so the status code is
 * distinguishable by design. What is NOT done is the part that would make
 * distinguishability useful. The reference is 128 bits of CSPRNG output
 * (`generateReference`), so there is nothing to walk even given a perfect oracle for
 * "does this reference exist" — the space is 2^128, and at a million guesses a second
 * that is longer than the age of the universe. The response says nothing about why a
 * lookup failed, and the query is ONE indexed read on `@unique(reference)` either way,
 * so the known and unknown answers differ by the row fetch and not by a second round
 * trip. If status-code indistinguishability is wanted, that is a change to the response
 * CONTRACT and belongs in the plan rather than in a service.
 *
 * The name comes from the row rather than from a joined `StudentProfile`, so a
 * certificate survives the profile it was issued against and this route keeps answering
 * for it — the one thing a revoked, long-departed holder's certificate must still be
 * able to do.
 */
export async function verify(reference: string): Promise<VerifyResult | null> {
  const row = await prisma.studentQualification.findUnique({
    where: { reference },
    select: {
      issuedAt: true,
      revokedAt: true,
      qualification: { select: { name: true } },
      student: { select: { name: true } },
    },
  });
  if (!row) return null;

  return {
    name: row.student.name,
    qualification: row.qualification.name,
    issuedAt: row.issuedAt.toISOString(),
    revoked: row.revokedAt !== null,
  };
}

// ---------------------------------------------------------------------------
// The artefact
// ---------------------------------------------------------------------------

/**
 * `GET /certificates/:id/download` — a five-minute signed GET against the private
 * bucket, minted exactly as `GET /resources/:id/download` mints one.
 *
 * Gated on `certificate:read` rather than on a separate `certificate:download`, and the
 * reason is the comment on `resource:download`: that verb exists because a logged-out
 * visitor may SEE a public resource and may not pull its bytes, so the two answers
 * genuinely differ. Here `certificate:read` is `deny` for anonymous in every branch, so
 * the answers are the same answer, and a second verb would be a fifth place for the two
 * to drift apart.
 *
 * A 409 rather than a 404 when the artefact is missing. The certificate EXISTS and the
 * caller is entitled to see that; the only thing absent is the file, which can happen if
 * the object store refused the generated PDF after the row was written. Pretending the
 * certificate was never issued would be a worse lie.
 */
export async function downloadUrlFor(
  id: string,
): Promise<{ url: string; expiresAt: string; filename: string }> {
  const certificate = await prisma.studentQualification.findFirst({
    where: { id },
    select: { artifactUpload: { select: { key: true, originalName: true } } },
  });
  if (!certificate) throw notFound('Certificate');

  const artifact = certificate.artifactUpload;
  if (artifact === null) throw conflict('This certificate has no downloadable document.');

  const signed = await presignGet({ key: artifact.key, filename: artifact.originalName });
  return {
    url: signed.url,
    expiresAt: signed.expiresAt.toISOString(),
    filename: artifact.originalName,
  };
}

/**
 * Where the QR code on the PDF points.
 *
 * The first configured origin, which is the SPA's own origin in every deployment shape
 * this repository has: ADR 0004 puts the SPA on the API's origin in production, and
 * development runs Vite on :5173 with that value in `.env`. It is read here rather than
 * from a new `PUBLIC_ORIGIN` setting because adding configuration is a decision about
 * deployments, and this phase does not get to make one. What the QR encodes is the API
 * route, which answers JSON — a machine-readable verification, which is what a scanner
 * is for. A human-facing verify PAGE is a route in the SPA and belongs to whoever adds
 * public routes; there is none today, and pretending otherwise in a QR code would send
 * an employer to a 404.
 */
function verifyUrlFor(reference: string): string {
  const origin = env.ALLOWED_ORIGINS[0] ?? 'http://localhost:5173';
  return `${origin}${API_BASE_PATH}/certificates/verify/${reference}`;
}

/**
 * Render the PDF and put it in the bucket through the SAME presign -> PUT -> commit path
 * every browser upload takes.
 *
 * NOT a bespoke `putObject` behind a private S3 client, and the reuse is worth more
 * than the round trip it costs. That path carries four properties this module would
 * otherwise re-implement and would eventually get one of them wrong:
 *
 *   1. the PENDING/COMMITTED row, so the abandoned-upload sweeper reclaims a
 *      certificate generated for a request that died halfway;
 *   2. the `_pending/` staging shadow, so the published artefact has NO valid write URL
 *      at any point in its life (`stagingKeyFor`);
 *   3. the HeadObject verification inside `commit` — which for a generated file is a
 *      check that the bytes the store kept are the bytes we measured, and a 422 rather
 *      than a silently wrong document if they are not;
 *   4. the copy onto the final key, after which the artefact is immutable.
 *
 * The Upload row is written here rather than through `uploads.presign`, which takes an
 * Actor to own the row and mints a URL for a BROWSER to use. Same columns, same
 * `buildObjectKey` convention, one fewer hop through a function whose contract is about
 * a human picking a file.
 *
 * The PUT is a `fetch` with a `Buffer` body so Node computes `Content-Length` itself,
 * which matters because `content-length` is inside the signature (measured against
 * MinIO in the comment on `presignPut`) and a request that sent a different one is
 * refused with `SignatureDoesNotMatch`.
 */
async function storeCertificateArtifact(
  actor: Actor,
  document: Parameters<typeof renderCertificatePdf>[0],
): Promise<string> {
  const bytes = renderCertificatePdf(document);
  const originalName = `certificate-${document.reference}.pdf`;
  const key = buildObjectKey('CERTIFICATE', originalName);

  const upload = await prisma.upload.create({
    data: {
      key,
      bucket: BUCKET,
      contentType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      originalName,
      status: 'PENDING',
      ownerId: actor.id,
    },
    select: { id: true },
  });

  const signed = await presignPut({
    key: stagingKeyFor(key),
    contentType: 'application/pdf',
    sizeBytes: bytes.byteLength,
  });

  const response = await fetch(signed.url, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf' },
    body: new Uint8Array(bytes),
  });
  if (!response.ok) {
    throw new Error(`object store refused the generated certificate (HTTP ${response.status})`);
  }

  // The checkpoint: HeadObject, the copy onto the final key, then the promotion to
  // COMMITTED. If this throws the row stays PENDING and the sweeper reclaims it.
  await commit(upload.id);
  return upload.id;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

interface CompletedSeat {
  id: string;
  studentId: string;
  studentName: string;
  courseId: string;
  courseName: string;
  /** Standards already awarded from THIS seat and never revoked. */
  heldQualificationIds: readonly string[];
}

/**
 * The seat a certificate may be issued against.
 *
 * THIS IS THE WHOLE POINT OF THE PHASE, and the refusal is a 409 rather than a 403
 * because it is a fact about the data rather than about the caller: they may issue
 * certificates, and this particular seat has not been completed. A school can seat a
 * student, mark them present, collect their work and then stop — the chain the feature
 * plan opened is `seat -> attend -> submit -> be assessed -> complete -> qualify ->
 * verify`, and this is the arrow that had no implementation. Anything letting a
 * certificate exist without a COMPLETED row behind it makes the whole sequence
 * decorative.
 *
 * The live qualifications already issued from this seat ride along in the same SELECT.
 * That is not tidiness: it is the double-issue guard, and loading it here rather than
 * in a second query keeps `issue` at three round trips whatever the number of standards
 * a student has collected on one intake.
 *
 * `completedAt` is deliberately NOT re-derived from `status`. Phase 1 writes the pair as
 * one statement, so they cannot be half-present, and re-deriving a date the writer
 * already holds atomically would be a second source for an invariant this module does
 * not own.
 */
async function completedSeat(enrollmentId: string): Promise<CompletedSeat> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, offering: { deletedAt: null, course: { deletedAt: null } } },
    select: {
      id: true,
      studentId: true,
      status: true,
      student: { select: { name: true } },
      offering: { select: { courseId: true, course: { select: { name: true } } } },
      qualifications: {
        where: { revokedAt: null },
        select: { qualificationId: true },
      },
    },
  });
  if (!enrollment) throw notFound('Enrollment');

  if (enrollment.status !== 'COMPLETED') {
    throw conflict('This enrolment has not been completed, so there is nothing to certify.');
  }

  return {
    id: enrollment.id,
    studentId: enrollment.studentId,
    studentName: enrollment.student.name,
    courseId: enrollment.offering.courseId,
    courseName: enrollment.offering.course.name,
    heldQualificationIds: enrollment.qualifications.map((row) => row.qualificationId),
  };
}

/**
 * Issue a certificate.
 *
 * ORDER MATTERS, and it is the reverse of the obvious one. The PDF is rendered and
 * stored BEFORE the row is written, so a failure at any point leaves no certificate at
 * all rather than a certificate with a null `artifactUploadId` that the holder can see
 * and cannot download. The price is a COMMITTED upload no row points at if the insert
 * then fails — bounded to one per failed request, and vastly less bad than the
 * alternative, which is a visible certificate whose download 409s forever.
 *
 * A re-sit after a revocation is a NEW row and is allowed: there is deliberately no
 * `@@unique([studentId, qualificationId])` on the table (migration 0013, point 3). What
 * IS refused is awarding the same standard twice from the SAME seat, which is a
 * double-click and not a re-sit — a 409, because it is a data fact and the SPA renders
 * errors by `code` and never by `detail` (LESSONS-LEARNED #25).
 */
export async function issue(actor: Actor, input: IssueCertificateInput): Promise<CertificateDto> {
  const seat = await completedSeat(input.enrollmentId);

  const qualification = await prisma.qualification.findFirst({
    where: { id: input.qualificationId, deletedAt: null },
    select: { id: true, name: true, level: true, awardingBody: true },
  });
  if (!qualification) {
    throw validationFailed([{ path: 'qualificationId', message: 'Unknown qualification' }]);
  }

  if (seat.heldQualificationIds.includes(qualification.id)) {
    throw conflict(`This seat has already been awarded ${qualification.name}.`);
  }

  const reference = generateReference();

  /*
   * The signatory's name, for the PDF. `Actor` carries an id, a role and two states and
   * deliberately no display name — the policy must not need a database round trip of its
   * own — so the one row this needs is fetched here. It is not on the `CertificateDto`
   * for the same reason: the DTO's `issuedBy` comes from the relation the insert already
   * returns, and reading the name twice from two places is how a certificate ends up
   * signed by a different person than the one the audit row names.
   */
  const issuer = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { name: true },
  });

  const artifactUploadId = await storeCertificateArtifact(actor, {
    reference,
    studentName: seat.studentName,
    qualificationName: qualification.name,
    level: qualification.level,
    awardingBody: qualification.awardingBody,
    issuedAt: new Date(),
    issuedByName: issuer?.name ?? null,
    verifyUrl: verifyUrlFor(reference),
  });

  const row = await prisma.studentQualification.create({
    data: {
      studentId: seat.studentId,
      qualificationId: qualification.id,
      enrollmentId: seat.id,
      // The session, never the body. `issueCertificateSchema` carries no issuedBy field,
      // and accepting one would let a caller forge attribution for the certificate they
      // had just issued themselves.
      issuedById: actor.id,
      reference,
      artifactUploadId,
    },
    include: CERTIFICATE_INCLUDE,
  });

  /*
   * After the write and best-effort: `notify()` never throws
   * (notifications.service.ts), and a failed notification must not undo a certificate
   * somebody has already been issued. This is the `CERTIFICATE_ISSUED` member migration
   * 0013 added, and it is the end of the chain in the only sense a student experiences:
   * nothing else in the sequence tells them anything happened.
   */
  await notify({
    userIds: [seat.studentId],
    type: 'CERTIFICATE_ISSUED',
    title: 'Your certificate has been issued',
    body: `You have been awarded ${qualification.name} for ${seat.courseName}.`,
    linkPath: `/courses/${seat.courseId}`,
  });

  return toCertificateDto(row);
}

/**
 * Withdraw a certificate.
 *
 * Idempotent, on the reasoning `markCompletion` and `approve` give: a double-clicked
 * Revoke must not write a second audit row, re-stamp the date, or overwrite the reason
 * somebody gave the first time. The row comes back untouched.
 *
 * There is no `un-revoke` verb and no deletion. The row is the record that a credential
 * WAS issued and WAS withdrawn, and the public verify route has to be able to say so —
 * a revocation that could be erased would leave that route able to report a withdrawn
 * certificate as valid, which is the single failure this endpoint exists to prevent.
 */
export async function revoke(
  actor: Actor,
  id: string,
  input: RevokeCertificateInput,
): Promise<CertificateDto> {
  const current = await prisma.studentQualification.findFirst({
    where: { id },
    select: { id: true, revokedAt: true },
  });
  if (!current) throw notFound('Certificate');

  const row =
    current.revokedAt === null
      ? await prisma.studentQualification.update({
          where: { id },
          data: { revokedAt: new Date(), revokedById: actor.id, revokedReason: input.reason },
          include: CERTIFICATE_INCLUDE,
        })
      : await prisma.studentQualification.findUniqueOrThrow({
          where: { id },
          include: CERTIFICATE_INCLUDE,
        });

  if (current.revokedAt === null) {
    await notify({
      userIds: [row.studentId],
      type: 'CERTIFICATE_REVOKED',
      title: 'A certificate has been withdrawn',
      body: `${row.qualification.name} is no longer valid. Open the course to read why.`,
      linkPath: '/courses',
    });
  }

  return toCertificateDto(row);
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

const CATALOGUE_LIMIT = 500;

/**
 * `GET /qualifications` — the whole catalogue, one array, capped.
 *
 * Soft-deleted entries are filtered here rather than by the schema, because the ORM
 * enforces neither level of anything. A retired standard stays on every certificate
 * naming it (migration 0013) and disappears from the list a NEW certificate can be
 * issued against, which are two different questions and this route answers the second.
 */
export async function listQualifications(): Promise<QualificationList> {
  return prisma.qualification.findMany({
    where: { deletedAt: null },
    orderBy: [{ awardingBody: 'asc' }, { level: 'asc' }, { name: 'asc' }],
    take: CATALOGUE_LIMIT,
    select: { id: true, code: true, name: true, level: true, awardingBody: true },
  });
}

/**
 * `POST /qualifications` — admin-only, and the reason `qualification:create` exists at
 * all: without it the catalogue can only be written by this module's own migration, and
 * a school cannot add the standard it is about to teach.
 *
 * `createQualificationSchema.code` is slug-shaped, so the P2002 a duplicate raises
 * becomes a 409 ("a record with these unique values already exists") — which is the
 * right sentence for a catalogue whose key is its code.
 */
export async function createQualification(
  input: CreateQualificationInput,
): Promise<QualificationDto> {
  return prisma.qualification.create({
    data: {
      code: input.code,
      name: input.name,
      level: input.level,
      awardingBody: input.awardingBody,
    },
    select: { id: true, code: true, name: true, level: true, awardingBody: true },
  });
}
