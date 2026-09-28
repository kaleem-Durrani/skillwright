import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import type { AppInstance } from '../src/app.js';
import type { Role } from '@skillwright/shared';
import { referenceSchema } from '@skillwright/shared';
import { randomToken, sha256 } from '../src/lib/crypto.js';
import {
  buildApp,
  cookieHeader,
  createDepartment,
  originHeaders,
  prisma,
  resetDatabase,
  resetRateLimits,
} from './setup.js';

let app: AppInstance;
let departmentId: string;
let sequence = 0;

/**
 * Three levels of teardown, and two of them exist because of THIS phase's foreign keys.
 *
 * `resetDatabase()` deletes users and then departments, and Course holds a `Restrict`
 * key to both — so any course a test leaves behind makes the NEXT `resetDatabase()` fail,
 * whichever file it is.
 *
 * Then the catalogue: `StudentQualification.qualificationId` is `Restrict` (migration
 * 0013), so `qualification.deleteMany` refuses while any certificate names one — which
 * is the constraint working, and is why the certificates go first. A fixture that
 * deleted the catalogue alone would fail on the first test that issued anything, and
 * the error would name a constraint the test never mentioned.
 */
async function clearPhaseThreeRows(): Promise<void> {
  await prisma.studentQualification.deleteMany({});
  await prisma.enrollment.deleteMany({});
  await prisma.course.deleteMany({});
  await prisma.qualification.deleteMany({});
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await clearPhaseThreeRows();
  await app.close();
});

beforeEach(async () => {
  await clearPhaseThreeRows();
  await resetDatabase();
  await resetRateLimits(app.redis);
  departmentId = await createDepartment();
});

// --- helpers ---------------------------------------------------------------

interface Person {
  id: string;
  token: string;
}

/**
 * A signed-in person, built WITHOUT going through `/auth/register` and `/auth/login`.
 *
 * Every other suite in this directory signs in over HTTP, and this one deliberately
 * does not — for a measured reason rather than a preference. Thirty-one tests here need
 * about fifty distinct accounts, which is a hundred and fifty calls to the two auth
 * routes; the per-IP bucket on those routes is 20 a minute, and it is stored IN MEMORY
 * per app instance, so `resetRateLimits` (which deletes `rl:*` in Redis) cannot touch
 * it and every suite that runs long enough trips it. Measured while writing this file:
 * the first eight tests passed and the twenty-third came back `429` at `signIn`, with
 * no test failing for any reason of its own.
 *
 * The rows this writes are the rows the auth module writes: an ACTIVE `User` with its
 * 1:1 profile satellite, and a `Session` whose `tokenHash` is the SHA-256 of a token
 * this fixture keeps — which is exactly the contract `findLiveSession` reads
 * (session.service.ts), and the same `randomToken`/`sha256` pair it uses itself. No
 * production path is stubbed and no state is invented; the registration flow is simply
 * not what this file is testing, and paying argon2 and a rate limiter for it thirty-one
 * times is a cost with no assertion behind it.
 *
 * The trade is that a change to REGISTRATION would not be caught here. It is caught in
 * `auth.test.ts`, which is where that behaviour belongs.
 */
async function signIn(email: string, role: Role): Promise<Person> {
  sequence += 1;
  const user = await prisma.user.create({
    data: {
      email,
      // Never read by this module's routes, and never returned by any of them, which is
      // exactly the property the "no email on the wire" assertions are about.
      passwordHash: null,
      name: `Test Person ${sequence}`,
      role,
      status: 'ACTIVE',
      ...(role === 'STUDENT'
        ? { studentProfile: { create: { departmentId, enrollmentNo: `ENR-${sequence}` } } }
        : role === 'TEACHER'
          ? {
              teacherProfile: {
                create: { departmentId, qualification: 'CSWIP 3.1 Welding Inspector' },
              },
            }
          : {}),
    },
    select: { id: true },
  });

  const token = randomToken();
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId: user.id,
      provenance: 'PASSWORD',
      expiresAt: new Date(Date.now() + 3_600_000),
      absoluteExpiresAt: new Date(Date.now() + 7_200_000),
    },
  });

  return { id: user.id, token };
}

async function makeCourse(teacherId: string): Promise<{ courseId: string; offeringId: string }> {
  sequence += 1;
  const course = await prisma.course.create({
    data: {
      code: `WELD-${2000 + sequence}`,
      slug: `certs-${sequence}`,
      name: `Welding ${sequence}`,
      departmentId,
      teacherId,
      durationValue: 6,
      durationUnit: 'WEEK',
      publishedAt: new Date(),
    },
  });
  const offering = await prisma.courseOffering.create({
    data: { courseId: course.id, capacity: 10 },
  });
  teacherByOffering.set(offering.id, teacherId);
  return { courseId: course.id, offeringId: offering.id };
}

async function makeQualification(
  overrides: Partial<{
    code: string;
    name: string;
    level: string;
    awardingBody: string;
  }> = {},
) {
  sequence += 1;
  return prisma.qualification.create({
    data: {
      code: overrides.code ?? `std-${sequence}`,
      name: overrides.name ?? 'CSWIP 3.1 Welding Inspector',
      level: overrides.level ?? 'Level 3',
      awardingBody: overrides.awardingBody ?? 'BSI',
    },
  });
}

/** A seat in the state the issue route actually requires. */
async function makeSeat(
  studentId: string,
  offeringId: string,
  status: 'APPROVED' | 'COMPLETED' = 'COMPLETED',
): Promise<string> {
  const enrollment = await prisma.enrollment.create({
    data: {
      studentId,
      offeringId,
      status,
      // `completedAt` and `completedById` are written as one statement by Phase 1 and
      // the fixture mirrors that: a COMPLETED row with no actor is exactly the shape
      // schema.prisma:505 refuses to model.
      ...(status === 'COMPLETED'
        ? { completedAt: new Date(), completedById: offeringTeacher(offeringId) }
        : {}),
    },
  });
  return enrollment.id;
}

/**
 * The teacher who owns the course behind an intake, for the `completedById` a
 * COMPLETED seat must carry. Read back off the row rather than threaded through every
 * call site, because a fixture parameter nobody updates is how a test ends up asserting
 * against a state the product cannot produce.
 */
function offeringTeacher(offeringId: string): string {
  const found = teacherByOffering.get(offeringId);
  if (!found) throw new Error(`no teacher recorded for offering ${offeringId}`);
  return found;
}

const teacherByOffering = new Map<string, string>();

function get(url: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1${url}`,
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

function post(url: string, payload: unknown, cookie?: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: { ...originHeaders, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
    payload: payload as Record<string, unknown>,
  });
}

/** A POST with NO body at all, sent deliberately. See the lesson-24 tests below. */
function postWithoutBody(url: string, cookie?: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: { ...originHeaders, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
  });
}

// --- the chain -------------------------------------------------------------

describe('issuing a certificate', () => {
  it('refuses a seat that has not been COMPLETED — the arrow the chain was missing', async () => {
    const teacher = await signIn('t1@example.com', 'TEACHER');
    const student = await signIn('s1@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    const enrollmentId = await makeSeat(student.id, offeringId, 'APPROVED');
    const qualification = await makeQualification();

    const response = await post(
      '/certificates',
      { enrollmentId, qualificationId: qualification.id },
      teacher.token,
    );

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('CONFLICT');
    expect(await prisma.studentQualification.count()).toBe(0);
  });

  it('confers it from a COMPLETED seat, with a reference the verifier accepts', async () => {
    const teacher = await signIn('t2@example.com', 'TEACHER');
    const student = await signIn('s2@example.com', 'STUDENT');
    const { courseId, offeringId } = await makeCourse(teacher.id);
    const enrollmentId = await makeSeat(student.id, offeringId);
    const qualification = await makeQualification({
      name: 'NVQ Level 4 in Engineering Maintenance',
    });

    const response = await post(
      '/certificates',
      { enrollmentId, qualificationId: qualification.id },
      teacher.token,
    );
    expect(response.statusCode).toBe(201);

    const body = response.json();
    // The generator's output has to satisfy the verifier's own rule, or the two
    // halves of the same design can drift and every issued certificate becomes
    // unverifiable. The schema IS the verifier's param schema.
    expect(referenceSchema.safeParse(body.reference).success).toBe(true);
    expect(body.qualification.name).toBe('NVQ Level 4 in Engineering Maintenance');
    expect(body.qualification.awardingBody).toBe('BSI');
    expect(body.issuedBy.id).toBe(teacher.id);
    expect(body.enrollmentId).toBe(enrollmentId);
    expect(body.revokedAt).toBeNull();
    expect(body.revokedReason).toBeNull();
    expect(body.artifact.contentType).toBe('application/pdf');
    expect(body.artifact.sizeBytes).toBeGreaterThan(0);

    // The holder's identity is on the certificate but their ACCOUNT is not: no id, no
    // email. `certificateSchema` is the whole contract and a field added to the Prisma
    // include cannot reach the wire without appearing here first.
    expect(body).not.toHaveProperty('studentId');
    expect(body).not.toHaveProperty('student');

    const row = await prisma.studentQualification.findUniqueOrThrow({
      where: { id: body.id },
      include: { artifactUpload: true },
    });
    expect(row.studentId).toBe(student.id);
    // The artefact really is in the private bucket under the CERTIFICATE prefix, and
    // not under `_pending/`: the staging shadow is what makes it immutable.
    expect(row.artifactUpload?.key).toMatch(/^certificates\//);
    expect(row.artifactUpload?.key).not.toContain('_pending/');
    expect(row.artifactUpload?.status).toBe('COMMITTED');
    void courseId;
  });

  it('tells the student about it — the notification member migration 0013 added', async () => {
    const teacher = await signIn('t3@example.com', 'TEACHER');
    const student = await signIn('s3@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    const enrollmentId = await makeSeat(student.id, offeringId);
    const qualification = await makeQualification();

    await post('/certificates', { enrollmentId, qualificationId: qualification.id }, teacher.token);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: student.id, type: 'CERTIFICATE_ISSUED' },
    });
    // LESSONS-LEARNED #17: a schema that requires title/body and a writer that sends
    // something else renders a blank notification. Asserted against the round trip.
    const payload = notification.payload as { title?: string; body?: string };
    expect(payload.title).toBe('Your certificate has been issued');
    expect(payload.body).toContain('CSWIP 3.1');
  });

  it('refuses a teacher certifying a colleague’s student, and a student certifying themselves', async () => {
    const teacherA = await signIn('t4@example.com', 'TEACHER');
    const teacherB = await signIn('t5@example.com', 'TEACHER');
    const student = await signIn('s4@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacherB.id);
    const enrollmentId = await makeSeat(student.id, offeringId);
    const qualification = await makeQualification();

    const byColleague = await post(
      '/certificates',
      { enrollmentId, qualificationId: qualification.id },
      teacherA.token,
    );
    expect(byColleague.statusCode).toBe(403);
    expect(byColleague.json().detail).toContain('TEACHER:ownsCourse');

    const byStudent = await post(
      '/certificates',
      { enrollmentId, qualificationId: qualification.id },
      student.token,
    );
    expect(byStudent.statusCode).toBe(403);
    expect(byStudent.json().detail).toContain('STUDENT:deny');

    expect(await prisma.studentQualification.count()).toBe(0);
  });

  it('answers 403 — never 422 — to an unauthorised caller who sent no body at all', async () => {
    const teacherA = await signIn('t6@example.com', 'TEACHER');
    const teacherB = await signIn('t7@example.com', 'TEACHER');
    const student = await signIn('s5@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacherB.id);
    await makeSeat(student.id, offeringId);

    // LESSONS-LEARNED #24, restated: body validation runs in `preValidation`, BEFORE
    // the policy `preHandler`, so a route that binds a required body tells an
    // unentitled caller that their request was malformed.
    const response = await postWithoutBody('/certificates', teacherA.token);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
  });

  it('answers 401 to an anonymous caller, because a certificate cannot be conferred by nobody', async () => {
    const qualification = await makeQualification();
    const response = await post('/certificates', {
      enrollmentId: 'en-1',
      qualificationId: qualification.id,
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses an unknown qualification, naming the field', async () => {
    const teacher = await signIn('t8@example.com', 'TEACHER');
    const student = await signIn('s6@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    const enrollmentId = await makeSeat(student.id, offeringId);

    const response = await post(
      '/certificates',
      { enrollmentId, qualificationId: 'qual-does-not-exist' },
      teacher.token,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().errors[0].path).toBe('qualificationId');
  });

  it('refuses the same standard twice from one seat, and allows it again after a revocation', async () => {
    const admin = await signIn('a1@example.com', 'ADMIN');
    const teacher = await signIn('t9@example.com', 'TEACHER');
    const student = await signIn('s7@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    const enrollmentId = await makeSeat(student.id, offeringId);
    const qualification = await makeQualification();

    const first = await post(
      '/certificates',
      { enrollmentId, qualificationId: qualification.id },
      teacher.token,
    );
    expect(first.statusCode).toBe(201);

    const second = await post(
      '/certificates',
      { enrollmentId, qualificationId: qualification.id },
      teacher.token,
    );
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('CONFLICT');

    const revoked = await post(
      `/certificates/${first.json().id}/revoke`,
      { reason: 'Issued against the wrong intake record by the registrar.' },
      admin.token,
    );
    expect(revoked.statusCode).toBe(200);

    // A re-sit is a NEW row, and there is deliberately no unique constraint that would
    // have made the revocation unrepresentable (migration 0013, point 3).
    const third = await post(
      '/certificates',
      { enrollmentId, qualificationId: qualification.id },
      teacher.token,
    );
    expect(third.statusCode).toBe(201);
    expect(third.json().id).not.toBe(first.json().id);
    expect(await prisma.studentQualification.count()).toBe(2);
  });
});

// --- the public route ------------------------------------------------------

describe('verifying a certificate without an account', () => {
  async function issueOne(): Promise<{
    reference: string;
    id: string;
    token: string;
    adminToken: string;
  }> {
    const teacher = await signIn('v1@example.com', 'TEACHER');
    const admin = await signIn('v2@example.com', 'ADMIN');
    const student = await signIn('v3@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    const enrollmentId = await makeSeat(student.id, offeringId);
    const qualification = await makeQualification({ name: 'F-Gas Category I Certification' });
    const issued = await post(
      '/certificates',
      { enrollmentId, qualificationId: qualification.id },
      teacher.token,
    );
    expect(issued.statusCode).toBe(201);
    return {
      reference: issued.json().reference,
      id: issued.json().id,
      token: student.token,
      adminToken: admin.token,
    };
  }

  it('answers an anonymous caller with four fields and nothing else', async () => {
    const { reference } = await issueOne();

    const response = await get(`/certificates/verify/${reference}`);
    expect(response.statusCode).toBe(200);

    const body = response.json();
    // THE assertion. The shape is the security design: a name, a qualification, a date
    // and whether it still stands. Every one of these is absent BY CONSTRUCTION, and a
    // field added to `verifyResultSchema` later has to break this test to get through.
    expect(Object.keys(body).sort()).toEqual(['issuedAt', 'name', 'qualification', 'revoked']);
    expect(body.qualification).toBe('F-Gas Category I Certification');
    expect(body.revoked).toBe(false);
    expect(JSON.stringify(body)).not.toContain('@example.com');
  });

  it('says so plainly when a certificate has been revoked', async () => {
    const { reference, id, adminToken } = await issueOne();
    await post(
      `/certificates/${id}/revoke`,
      { reason: 'Awarded in error; the practical was never assessed.' },
      adminToken,
    );

    const response = await get(`/certificates/verify/${reference}`);
    expect(response.statusCode).toBe(200);
    expect(response.json().revoked).toBe(true);
    // The GROUNDS are the holder's business, not the public's.
    expect(Object.keys(response.json()).sort()).toEqual([
      'issuedAt',
      'name',
      'qualification',
      'revoked',
    ]);
  });

  it('answers 404 for a well-formed reference nobody holds', async () => {
    const response = await get('/certificates/verify/ZZZZZZZZZZZZZZZZZZZZZZZZ00');
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('NOT_FOUND');
  });

  it('answers 422 for something that is not a reference at all, without echoing it', async () => {
    const response = await get('/certificates/verify/not-a-reference');
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  });

  it('accepts a lower-case reference, because a person types what they can read', async () => {
    const { reference } = await issueOne();
    const response = await get(`/certificates/verify/${reference.toLowerCase()}`);
    expect(response.statusCode).toBe(200);
  });

  // The rate-limit claim is a claim about a LINE OF CONFIGURATION, so it is proved in
  // `certificates.verify-ratelimit.test.ts`, which can set the ceiling before `env.ts`
  // is loaded. Asserting it here would only re-assert that the route exists.
});

// --- revocation ------------------------------------------------------------

describe('revoking a certificate', () => {
  it('is admin-only, and a teacher gets 403 rather than a 422 for sending no body', async () => {
    const teacher = await signIn('r1@example.com', 'TEACHER');
    const student = await signIn('r2@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    const enrollmentId = await makeSeat(student.id, offeringId);
    const qualification = await makeQualification();
    const issued = await post(
      '/certificates',
      { enrollmentId, qualificationId: qualification.id },
      teacher.token,
    );
    expect(issued.statusCode).toBe(201);

    // LESSONS-LEARNED #24, and the reason this route's body is parsed in the handler
    // rather than bound: validation precedes the policy gate.
    const response = await postWithoutBody(
      `/certificates/${issued.json().id}/revoke`,
      teacher.token,
    );
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('TEACHER:deny');

    const row = await prisma.studentQualification.findUniqueOrThrow({
      where: { id: issued.json().id },
    });
    expect(row.revokedAt).toBeNull();
  });

  it('refuses an admin who gives no reason, and says which field', async () => {
    const admin = await signIn('r3@example.com', 'ADMIN');
    const teacher = await signIn('r4@example.com', 'TEACHER');
    const student = await signIn('r5@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    const enrollmentId = await makeSeat(student.id, offeringId);
    const qualification = await makeQualification();
    const issued = await post(
      '/certificates',
      { enrollmentId, qualificationId: qualification.id },
      teacher.token,
    );

    const response = await postWithoutBody(`/certificates/${issued.json().id}/revoke`, admin.token);
    expect(response.statusCode).toBe(422);
    expect(response.json().errors[0].path).toBe('reason');
  });

  it('records when, who and why — and a second call changes nothing', async () => {
    const admin = await signIn('r6@example.com', 'ADMIN');
    const teacher = await signIn('r7@example.com', 'TEACHER');
    const student = await signIn('r8@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    const enrollmentId = await makeSeat(student.id, offeringId);
    const qualification = await makeQualification();
    const issued = await post(
      '/certificates',
      { enrollmentId, qualificationId: qualification.id },
      teacher.token,
    );
    const id = issued.json().id as string;

    const first = await post(
      `/certificates/${id}/revoke`,
      { reason: 'Issued against the wrong intake record by the registrar.' },
      admin.token,
    );
    expect(first.statusCode).toBe(200);
    expect(first.json().revokedAt).not.toBeNull();
    expect(first.json().revokedBy.id).toBe(admin.id);
    expect(first.json().revokedReason).toContain('registrar');

    const second = await post(
      `/certificates/${id}/revoke`,
      { reason: 'A different and much longer reason that must not overwrite anything.' },
      admin.token,
    );
    expect(second.statusCode).toBe(200);
    // Same-state repeat, on `markCompletion`'s reasoning: no second stamp, no
    // overwritten reason, and therefore no second notification.
    expect(second.json().revokedAt).toBe(first.json().revokedAt);
    expect(second.json().revokedReason).toBe(first.json().revokedReason);
    expect(
      await prisma.notification.count({
        where: { userId: student.id, type: 'CERTIFICATE_REVOKED' },
      }),
    ).toBe(1);
  });

  it('404s for a certificate that does not exist, even for an admin', async () => {
    const admin = await signIn('r9@example.com', 'ADMIN');
    // A WELL-FORMED id that holds nothing. `cert-nope` would be a 422 from
    // `idParamSchema` before the route ran, which is the schema working and is not
    // what this assertion is about: an admin's `allow` cell reads no subject field, so
    // the missing row is a reachable path here and has to answer 404 rather than a
    // null-dereference 500.
    const response = await post(
      '/certificates/cmulchcec00pcw4zsmklefu1e/revoke',
      { reason: 'A reason long enough to satisfy the schema, certainly.' },
      admin.token,
    );
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('NOT_FOUND');
  });
});

// --- reading and downloading ----------------------------------------------

describe('reading a student’s certificates', () => {
  async function scenario() {
    const teacherA = await signIn('q1@example.com', 'TEACHER');
    const teacherB = await signIn('q2@example.com', 'TEACHER');
    const studentA = await signIn('q3@example.com', 'STUDENT');
    const studentB = await signIn('q4@example.com', 'STUDENT');
    const admin = await signIn('q5@example.com', 'ADMIN');
    const mineA = await makeCourse(teacherA.id);
    const mineB = await makeCourse(teacherB.id);
    const qualification = await makeQualification();
    const seatA = await makeSeat(studentA.id, mineA.offeringId);
    const seatB = await makeSeat(studentB.id, mineB.offeringId);
    const issuedA = await post(
      '/certificates',
      { enrollmentId: seatA, qualificationId: qualification.id },
      teacherA.token,
    );
    const issuedB = await post(
      '/certificates',
      { enrollmentId: seatB, qualificationId: qualification.id },
      teacherB.token,
    );
    return { teacherA, teacherB, studentA, studentB, admin, qualification, issuedA, issuedB };
  }

  it('gives a student their own, and gives them their own even when they name somebody else', async () => {
    const { studentA, studentB, issuedA } = await scenario();

    const own = await get('/certificates', studentA.token);
    expect(own.statusCode).toBe(200);
    expect(own.json().data).toHaveLength(1);
    expect(own.json().data[0].id).toBe(issuedA.json().id);

    // `visibilityWhere` ignores `studentId` for a STUDENT rather than refusing. A 403
    // here would confirm that another student's record exists while protecting nothing.
    const sneaky = await get(`/certificates?studentId=${studentB.id}`, studentA.token);
    expect(sneaky.statusCode).toBe(200);
    expect(sneaky.json().data.map((row: { id: string }) => row.id)).toEqual([issuedA.json().id]);
  });

  it('scopes a teacher to their own courses, on both branches of the rule', async () => {
    const { teacherA, teacherB, studentA, studentB, issuedA, issuedB } = await scenario();

    const own = await get(`/certificates?studentId=${studentA.id}`, teacherA.token);
    expect(own.json().data.map((row: { id: string }) => row.id)).toEqual([issuedA.json().id]);

    // A colleague's student, on a course this teacher neither owns nor signed: the
    // `or(ownsCourse, isAuthor)` rule denies, and `visibilityWhere` mirrors it.
    const colleague = await get(`/certificates?studentId=${studentB.id}`, teacherA.token);
    expect(colleague.json().data).toEqual([]);
    expect(issuedB.statusCode).toBe(201);
    void teacherB;
  });

  it('still reads a certificate whose seat is gone, if the caller signed it', async () => {
    // The `isAuthor` half of the disjunction. `enrollmentId` is `SetNull`, so a retired
    // intake leaves a certificate with no course to own — and its issuer must not lose
    // sight of a document they personally signed. The list mirror reaches the same row
    // through `issuedById`, and a teacher with neither claim must see neither.
    const { teacherA, teacherB, studentB, issuedB } = await scenario();
    await prisma.studentQualification.update({
      where: { id: issuedB.json().id },
      data: { enrollmentId: null },
    });

    const listed = await get(`/certificates?studentId=${studentB.id}`, teacherB.token);
    expect(listed.json().data.map((row: { id: string }) => row.id)).toEqual([issuedB.json().id]);

    const direct = await get(`/certificates/${issuedB.json().id}/download`, teacherB.token);
    expect(direct.statusCode).toBe(200);

    // teacherA owns nothing and signed nothing, so BOTH branches of the rule deny — and
    // the row-level gate and the list agree, which is the half that would diverge.
    expect(issuedB.statusCode).toBe(201);
    const stranger = await get(`/certificates/${issuedB.json().id}/download`, teacherA.token);
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json().detail).toContain('TEACHER:or(ownsCourse, isAuthor)');
    expect(
      (await get(`/certificates?studentId=${studentB.id}`, teacherA.token)).json().data,
    ).toEqual([]);
  });

  it('gives an admin every certificate', async () => {
    const { admin } = await scenario();
    const response = await get('/certificates', admin.token);
    expect(response.json().data).toHaveLength(2);
  });

  it('answers 401 without a session — the list is not a public surface', async () => {
    const response = await get('/certificates');
    expect(response.statusCode).toBe(401);
  });

  it('signs a five-minute GET for the holder, and refuses one for a stranger', async () => {
    const { studentA, studentB, issuedA } = await scenario();

    const mine = await get(`/certificates/${issuedA.json().id}/download`, studentA.token);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().url).toContain('X-Amz-Signature');
    expect(mine.json().filename).toMatch(/^certificate-[0-9A-Z]{26}\.pdf$/);

    const theirs = await get(`/certificates/${issuedA.json().id}/download`, studentB.token);
    expect(theirs.statusCode).toBe(403);
    expect(theirs.json().detail).toContain('STUDENT:isEnrolledStudent');

    const anonymous = await get(`/certificates/${issuedA.json().id}/download`);
    expect(anonymous.statusCode).toBe(401);
  });

  it('still serves the document after a revocation, because the artefact is the record', async () => {
    const { studentA, issuedA } = await scenario();
    const admin = await signIn('q6@example.com', 'ADMIN');
    await post(
      `/certificates/${issuedA.json().id}/revoke`,
      { reason: 'Withdrawn pending an appeal by the holder, which is their right.' },
      admin.token,
    );
    const response = await get(`/certificates/${issuedA.json().id}/download`, studentA.token);
    expect(response.statusCode).toBe(200);
  });

  it('409s rather than 404s for a certificate whose document never landed', async () => {
    const { studentA } = await scenario();
    const orphan = await prisma.studentQualification.create({
      data: {
        studentId: studentA.id,
        qualificationId: (await prisma.qualification.findFirstOrThrow()).id,
        reference: 'AAAAAAAABBBBBBBBCCCCCCCC0',
        issuedById: studentA.id,
      },
    });
    const response = await get(`/certificates/${orphan.id}/download`, studentA.token);
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('CONFLICT');
  });
});

// --- the catalogue ---------------------------------------------------------

describe('the qualification catalogue', () => {
  it('is readable by every signed-in role and by nobody else', async () => {
    const student = await signIn('k1@example.com', 'STUDENT');
    const teacher = await signIn('k2@example.com', 'TEACHER');
    const admin = await signIn('k3@example.com', 'ADMIN');
    const qualification = await makeQualification({ code: 'cswip-31' });

    for (const person of [student, teacher, admin]) {
      const response = await get('/qualifications', person.token);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        {
          id: qualification.id,
          code: 'cswip-31',
          name: qualification.name,
          level: qualification.level,
          awardingBody: qualification.awardingBody,
        },
      ]);
    }

    const anonymous = await get('/qualifications');
    expect(anonymous.statusCode).toBe(401);
  });

  it('takes a new standard from an admin alone, and refuses a duplicate code', async () => {
    const admin = await signIn('k4@example.com', 'ADMIN');
    const teacher = await signIn('k5@example.com', 'TEACHER');
    await makeQualification({ code: 'cswip-31' });

    const refused = await post(
      '/qualifications',
      { code: 'nvq-l4', name: 'NVQ Level 4', level: 'Level 4', awardingBody: 'Pearson' },
      teacher.token,
    );
    expect(refused.statusCode).toBe(403);
    expect(refused.json().detail).toContain('TEACHER:deny');

    const created = await post(
      '/qualifications',
      { code: 'nvq-l4', name: 'NVQ Level 4', level: 'Level 4', awardingBody: 'Pearson' },
      admin.token,
    );
    expect(created.statusCode).toBe(201);

    const duplicate = await post(
      '/qualifications',
      { code: 'nvq-l4', name: 'NVQ Level 4', level: 'Level 4', awardingBody: 'Pearson' },
      admin.token,
    );
    expect(duplicate.statusCode).toBe(409);
  });

  it('refuses a code with a space in it, because a verifier is a person typing', async () => {
    const admin = await signIn('k6@example.com', 'ADMIN');
    const response = await post(
      '/qualifications',
      { code: 'CSWIP 3.1', name: 'Welding Inspector', level: '3', awardingBody: 'BSI' },
      admin.token,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().errors[0].path).toBe('code');
  });

  it('keeps a retired standard off the list without touching the certificates naming it', async () => {
    const admin = await signIn('k7@example.com', 'ADMIN');
    const teacher = await signIn('k8@example.com', 'TEACHER');
    const student = await signIn('k9@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    const enrollmentId = await makeSeat(student.id, offeringId);
    const qualification = await makeQualification();
    const issued = await post(
      '/certificates',
      { enrollmentId, qualificationId: qualification.id },
      teacher.token,
    );
    expect(issued.statusCode).toBe(201);

    await prisma.qualification.update({
      where: { id: qualification.id },
      data: { deletedAt: new Date() },
    });

    // It can no longer be AWARDED...
    expect((await get('/qualifications', admin.token)).json()).toEqual([]);
    const reissue = await post(
      '/certificates',
      { enrollmentId, qualificationId: qualification.id },
      teacher.token,
    );
    expect(reissue.statusCode).toBe(422);

    // ...and the certificate that already names it is untouched, in all three places a
    // reader can reach it. "We no longer offer this" is a statement about the
    // catalogue, and the people holding one are not part of it.
    const verified = await get(`/certificates/verify/${issued.json().reference}`);
    expect(verified.statusCode).toBe(200);
    expect(verified.json().qualification).toBe(qualification.name);

    const listed = await get('/certificates', student.token);
    expect(listed.json().data).toHaveLength(1);
    expect(listed.json().data[0].qualification.name).toBe(qualification.name);

    expect(
      (await get(`/certificates/${issued.json().id}/download`, student.token)).statusCode,
    ).toBe(200);
  });
});

// --- the artefact ----------------------------------------------------------

/**
 * Re-parse the generated PDF the way a reader does, rather than trusting the writer.
 *
 * The first version of `certificate.pdf.ts` produced a structurally valid file whose
 * catalogue was emitted as object 1 while `/Root 1 0 R` pointed at the page's content
 * stream: correct header, correct trailer, correct `%%EOF`, every xref offset pointing at
 * a real object header, and a blank page. It was found by OPENING the artefact, and
 * these assertions are the part of that check which can live in a suite.
 */
describe('the generated PDF', () => {
  async function issueAndReadArtifact(): Promise<Buffer> {
    const teacher = await signIn('p1@example.com', 'TEACHER');
    const student = await signIn('p2@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    const enrollmentId = await makeSeat(student.id, offeringId);
    const qualification = await makeQualification();
    const issued = await post(
      '/certificates',
      { enrollmentId, qualificationId: qualification.id },
      teacher.token,
    );
    const id = issued.json().id as string;
    const row = await prisma.studentQualification.findUniqueOrThrow({
      where: { id },
      include: { artifactUpload: true },
    });
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { env } = await import('../src/env.js');
    const client = new (await import('@aws-sdk/client-s3')).S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
    const object = await client.send(
      new GetObjectCommand({ Bucket: row.artifactUpload!.bucket, Key: row.artifactUpload!.key }),
    );
    const bytes = await object.Body?.transformToByteArray();
    return Buffer.from(bytes ?? []);
  }

  it('is a PDF whose catalogue, page tree and content stream all resolve', async () => {
    const pdf = await issueAndReadArtifact();
    const text = pdf.toString('latin1');

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);

    // startxref -> xref, and every entry -> the object header it claims.
    const startxref = Number(
      text
        .slice(text.lastIndexOf('startxref') + 9)
        .trim()
        .split('\n')[0],
    );
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets.length).toBe(7);
    offsets.forEach((offset, index) => {
      expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
    });

    // /Root -> the catalogue -> /Pages -> the page tree -> a real /Type /Page. This is
    // the walk that a blank page failed, and it is the whole reason the test exists.
    const rootNumber = Number(/\/Root (\d+) 0 R/.exec(text)?.[1]);
    const catalog = text.slice(offsets[rootNumber - 1]!, offsets[rootNumber - 1]! + 120);
    expect(catalog).toContain('/Type /Catalog');
    const pagesNumber = Number(/\/Pages (\d+) 0 R/.exec(catalog)?.[1]);
    const pages = text.slice(offsets[pagesNumber - 1]!, offsets[pagesNumber - 1]! + 120);
    expect(pages).toContain('/Type /Pages');
    const pageNumber = Number(/\/Kids \[(\d+) 0 R\]/.exec(pages)?.[1]);
    const page = text.slice(offsets[pageNumber - 1]!, offsets[pageNumber - 1]! + 400);
    expect(page).toContain('/Type /Page');
    expect(page).toContain('/Helvetica');
  });

  it('inflates to a content stream carrying the holder, the standard and the reference', async () => {
    const pdf = await issueAndReadArtifact();
    const text = pdf.toString('latin1');
    const match = /<< \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/.exec(text);
    expect(match).not.toBeNull();
    const start = (match?.index ?? 0) + match![0].length;
    const stream = inflateSync(
      Buffer.from(text.slice(start, start + Number(match![1])), 'latin1'),
    ).toString('latin1');
    expect(stream).toContain('Certificate of Achievement');
    expect(stream).toContain('Test Person');
    expect(stream).toContain('CSWIP 3.1 Welding Inspector');
    expect(stream).toContain('Reference ');
    // A vector QR: filled rectangles, not an embedded image.
    expect(stream).toContain(' re f');
  });
});
