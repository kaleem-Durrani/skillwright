import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// app.ts: "Anything that holds an instance built here — main.ts, the integration
// tests — should name this type." Plain FastifyInstance is a type error, not a widening.
import type { AppInstance } from '../src/app.js';
import { Prisma } from '@skillwright/db';
import type { Role } from '@skillwright/shared';
import {
  buildApp,
  cookieHeader,
  createDepartment,
  originHeaders,
  prisma,
  resetDatabase,
  resetRateLimits,
  sessionCookie,
  testOutbox,
} from './setup.js';

const PASSWORD = 'correct-horse-battery-staple';

const IN_THE_FUTURE = '2030-03-14T09:00:00.000Z';
const IN_THE_PAST = '2020-03-14T09:00:00.000Z';

let app: AppInstance;
let departmentId: string;
let sequence = 0;

/**
 * Same discipline as attendance.test.ts: Course holds Restrict foreign keys to User
 * and Department, so any academic row left behind breaks the next suite's
 * resetDatabase().
 *
 * Assignment and Submission need no sweep of their own and that is a consequence of
 * the schema, not an oversight: an assignment cascades from its OFFERING, which
 * cascades from the course, and a submission cascades from both its assignment and
 * its enrollment. Deleting the enrollments and then the courses — the order below,
 * which resetDatabase() also uses — takes both with it.
 */
async function clearAcademicRows(): Promise<void> {
  await prisma.enrollment.deleteMany({});
  await prisma.course.deleteMany({});
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await clearAcademicRows();
  await app.close();
});

beforeEach(async () => {
  await clearAcademicRows();
  await resetDatabase();
  await resetRateLimits(app.redis);
  departmentId = await createDepartment();
});

// --- helpers ---------------------------------------------------------------

interface Person {
  id: string;
  token: string;
}

function authPost(url: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/auth${url}`,
    headers: { ...originHeaders },
    payload: payload as Record<string, unknown>,
  });
}

/**
 * Registration always produces a STUDENT — auth.service.ts — so privileged fixtures
 * are promoted directly on the row, exactly as attendance.test.ts does.
 */
async function signIn(email: string, role: Role): Promise<Person> {
  expect(
    (await authPost('/register', { email, password: PASSWORD, name: 'Test Person', departmentId }))
      .statusCode,
  ).toBe(202);

  const code = testOutbox.lastCodeFor(email);
  expect((await authPost('/verify-email', { email, code })).statusCode).toBe(200);

  const user = await prisma.user.update({ where: { email }, data: { role } });

  const login = await authPost('/login', { email, password: PASSWORD });
  expect(login.statusCode).toBe(200);
  const token = sessionCookie(login);
  expect(token).toBeTruthy();

  return { id: user.id, token: token as string };
}

async function makeCourse(
  teacherId: string,
  options: { published?: boolean; secondIntake?: boolean } = {},
): Promise<{ courseId: string; offeringId: string; otherOfferingId: string }> {
  sequence += 1;
  const course = await prisma.course.create({
    data: {
      code: `ASG-${1000 + sequence}`,
      slug: `assignments-${sequence}`,
      name: `Assignments ${sequence}`,
      departmentId,
      teacherId,
      durationValue: 6,
      durationUnit: 'WEEK',
      ...(options.published === false ? {} : { publishedAt: new Date() }),
    },
  });
  const offering = await prisma.courseOffering.create({
    data: { courseId: course.id, capacity: 10 },
  });
  const other = await prisma.courseOffering.create({
    data: { courseId: course.id, capacity: 10 },
  });
  return { courseId: course.id, offeringId: offering.id, otherOfferingId: other.id };
}

async function enroll(
  student: Person,
  offeringId: string,
  status: 'PENDING' | 'APPROVED' = 'APPROVED',
): Promise<string> {
  const enrollment = await prisma.enrollment.create({
    data: { studentId: student.id, offeringId, status },
  });
  // Keep the denormalised counter honest so unrelated assertions stay meaningful.
  if (status === 'APPROVED') {
    await prisma.courseOffering.update({
      where: { id: offeringId },
      data: { approvedCount: { increment: 1 } },
    });
  }
  return enrollment.id;
}

async function makeAssignment(
  offeringId: string,
  overrides: Partial<{
    title: string;
    brief: string;
    dueAt: string;
    maxScore: number;
  }> = {},
): Promise<string> {
  const assignment = await prisma.assignment.create({
    data: {
      offeringId,
      title: overrides.title ?? 'Weld the fillet',
      brief: overrides.brief ?? 'Two runs of a 6mm fillet, all round.',
      dueAt: new Date(overrides.dueAt ?? IN_THE_FUTURE),
      maxScore: new Prisma.Decimal(overrides.maxScore ?? 100),
    },
  });
  return assignment.id;
}

/**
 * A COMMITTED upload row, written straight through Prisma.
 *
 * NOT through the presign → PUT → commit path, and the reason is that the path under
 * test is not the object store's: `assertUploadClaimable` reads the row's owner,
 * status and attachment state and nothing else, and driving real MinIO would make
 * this suite depend on a container for a fact the row already states. The upload
 * client's own three steps are exercised by uploads.test.ts against the real store.
 */
async function committedUpload(owner: Person, name = 'fillet-weld.pdf'): Promise<string> {
  sequence += 1;
  const upload = await prisma.upload.create({
    data: {
      key: `resource/01JGXDFAM0K2Z1GYCSNM5F5${String(sequence).padStart(2, '0')}.pdf`,
      bucket: 'skillwright-uploads',
      contentType: 'application/pdf',
      sizeBytes: 4096,
      originalName: name,
      status: 'COMMITTED',
      ownerId: owner.id,
      committedAt: new Date(),
    },
  });
  return upload.id;
}

function get(url: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url,
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

/** Every mutation carries `originHeaders`, or csrf.plugin.ts refuses it first. */
function post(url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: 'POST',
    url,
    headers: { ...originHeaders, cookie: cookieHeader(cookie) },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

function patch(url: string, cookie: string, payload: unknown) {
  return app.inject({
    method: 'PATCH',
    url,
    headers: { ...originHeaders, cookie: cookieHeader(cookie) },
    payload: payload as Record<string, unknown>,
  });
}

function del(url: string, cookie: string) {
  return app.inject({
    method: 'DELETE',
    url,
    headers: { ...originHeaders, cookie: cookieHeader(cookie) },
  });
}

const listUrl = (offeringId: string) => `/api/v1/offerings/${offeringId}/assignments`;
const handInUrl = (assignmentId: string) => `/api/v1/assignments/${assignmentId}/submissions`;
const classUrl = (assignmentId: string) => `/api/v1/assignments/${assignmentId}/submissions`;

function createAssignmentBody(offeringId: string, extra: Record<string, unknown> = {}) {
  return {
    offeringId,
    title: 'Weld the fillet',
    brief: 'Two runs of a 6mm fillet, all round.',
    dueAt: IN_THE_FUTURE,
    maxScore: 100,
    ...extra,
  };
}

// --- tests -----------------------------------------------------------------

describe('listing the tasks on an intake', () => {
  it('refuses an anonymous caller', async () => {
    const teacher = await signIn('as-anon-t@example.com', 'TEACHER');
    const { offeringId } = await makeCourse(teacher.id);

    expect((await get(listUrl(offeringId))).statusCode).toBe(401);
  });

  it('serves an approved student the intake they hold a seat on', async () => {
    const teacher = await signIn('as-t1@example.com', 'TEACHER');
    const alice = await signIn('as-s1@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId);

    const response = await get(listUrl(offeringId), alice.token);
    expect(response.statusCode).toBe(200);
    const body = response.json() as Array<{ id: string; title: string }>;
    expect(body.map((row) => row.id)).toEqual([assignmentId]);
  });

  it('serves a student nothing while their seat request is still pending', async () => {
    const teacher = await signIn('as-t2@example.com', 'TEACHER');
    const bob = await signIn('as-s2@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(bob, offeringId, 'PENDING');
    await makeAssignment(offeringId);

    const response = await get(listUrl(offeringId), bob.token);
    expect(response.statusCode).toBe(200);
    // An EMPTY list, not a 403: a list is narrowed by a WHERE clause and the caller is
    // entitled to the (empty) answer. This is `visibilityWhere`'s `enrolledApproved`
    // branch, and the matrix already proved the PENDING seat refuses the same rule.
    expect(response.json()).toEqual([]);
  });

  it("serves a teacher their own intake and a colleague's nothing", async () => {
    const teacher = await signIn('as-t3@example.com', 'TEACHER');
    const other = await signIn('as-t4@example.com', 'TEACHER');
    const { offeringId } = await makeCourse(teacher.id);
    await makeAssignment(offeringId);

    expect((await get(listUrl(offeringId), teacher.token)).json()).toHaveLength(1);
    expect((await get(listUrl(offeringId), other.token)).json()).toEqual([]);
  });

  it('orders by deadline, and sends maxScore as a NUMBER', async () => {
    const teacher = await signIn('as-t5@example.com', 'TEACHER');
    const { offeringId } = await makeCourse(teacher.id);
    const later = await makeAssignment(offeringId, { title: 'Later', dueAt: IN_THE_FUTURE });
    const sooner = await makeAssignment(offeringId, {
      title: 'Sooner',
      dueAt: '2030-01-01T00:00:00.000Z',
    });
    const middle = await makeAssignment(offeringId, {
      title: 'Middle',
      dueAt: '2030-02-01T00:00:00.000Z',
      maxScore: 62.5,
    });

    const body = (await get(listUrl(offeringId), teacher.token)).json() as Array<{
      id: string;
      maxScore: unknown;
    }>;
    // Deadline order, which is the only order a teacher reads a task list in and the
    // order `@@index([offeringId, dueAt])` exists to serve. Asserted as three named
    // ids because sorting cuids would pass for the wrong reason.
    expect(body.map((row) => row.id)).toEqual([sooner, middle, later]);

    // Prisma's `Decimal` serialises to JSON as a STRING. Handing it straight to a
    // `z.number()` response schema would 500 on EVERY row carrying a mark, with a
    // validation error naming `maxScore` and nothing to suggest a decimal was
    // involved. This assertion is the regression test for that trap.
    for (const row of body) expect(typeof row.maxScore).toBe('number');
    expect(body.find((row) => row.id === later)?.maxScore).toBe(100);
  });
});

describe('setting work', () => {
  it('refuses a student, and says which rule', async () => {
    const teacher = await signIn('as-t6@example.com', 'TEACHER');
    const alice = await signIn('as-s3@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);

    const response = await post(listUrl(offeringId), alice.token, createAssignmentBody(offeringId));
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('STUDENT:deny');
  });

  it("refuses a teacher planting a task on another teacher's intake", async () => {
    const teacher = await signIn('as-t7@example.com', 'TEACHER');
    const other = await signIn('as-t8@example.com', 'TEACHER');
    const { offeringId } = await makeCourse(teacher.id);

    const response = await post(listUrl(offeringId), other.token, createAssignmentBody(offeringId));
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('TEACHER:ownsCourse');
  });

  it('accepts the owning teacher and an admin', async () => {
    const teacher = await signIn('as-t9@example.com', 'TEACHER');
    const admin = await signIn('as-a1@example.com', 'ADMIN');
    const { offeringId } = await makeCourse(teacher.id);

    const own = await post(listUrl(offeringId), teacher.token, createAssignmentBody(offeringId));
    expect(own.statusCode).toBe(201);
    expect(own.json()).toMatchObject({ title: 'Weld the fillet', maxScore: 100 });

    const byAdmin = await post(
      listUrl(offeringId),
      admin.token,
      createAssignmentBody(offeringId, { title: 'Admin task' }),
    );
    expect(byAdmin.statusCode).toBe(201);
  });

  it('refuses a body naming an intake that does not exist, with a field path', async () => {
    const teacher = await signIn('as-t10@example.com', 'TEACHER');
    const { courseId } = await makeCourse(teacher.id);
    await prisma.courseOffering.deleteMany({ where: { courseId } });
    // A task must hang off a LIVE intake; the gate is decided against the offering, so
    // the gate itself is what refuses a deleted one.
    const response = await post(
      `/api/v1/offerings/${courseId}/assignments`,
      teacher.token,
      createAssignmentBody(courseId),
    );
    expect([403, 404]).toContain(response.statusCode);
  });
});

describe('correcting and withdrawing work', () => {
  it('rides assignment:create, which is what PATCH and DELETE are gated on', async () => {
    const teacher = await signIn('as-t11@example.com', 'TEACHER');
    const other = await signIn('as-t12@example.com', 'TEACHER');
    const admin = await signIn('as-a2@example.com', 'ADMIN');
    const { offeringId } = await makeCourse(teacher.id);
    const assignmentId = await makeAssignment(offeringId);

    // A colleague may neither correct nor withdraw it, with the owning rule named.
    const byOther = await patch(`/api/v1/assignments/${assignmentId}`, other.token, {
      title: 'Hijacked',
    });
    expect(byOther.statusCode).toBe(403);
    expect(byOther.json().detail).toContain('TEACHER:ownsCourse');

    const removed = await del(`/api/v1/assignments/${assignmentId}`, other.token);
    expect(removed.statusCode).toBe(403);

    // The owner may.
    const edited = await patch(`/api/v1/assignments/${assignmentId}`, teacher.token, {
      title: 'Weld the fillet again',
      maxScore: 50,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ title: 'Weld the fillet again', maxScore: 50 });
    // The columns the caller never mentioned survive the patch.
    expect(edited.json().brief).toBe('Two runs of a 6mm fillet, all round.');

    // And so may an admin.
    expect((await del(`/api/v1/assignments/${assignmentId}`, admin.token)).statusCode).toBe(204);
  });

  it('soft-deletes: the task disappears, and the hand-ins and their marks survive', async () => {
    const teacher = await signIn('as-t13@example.com', 'TEACHER');
    const alice = await signIn('as-s4@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId);
    const uploadId = await committedUpload(alice);

    expect((await post(handInUrl(assignmentId), alice.token, { uploadId })).statusCode).toBe(201);
    expect((await del(`/api/v1/assignments/${assignmentId}`, teacher.token)).statusCode).toBe(204);

    // Gone from the intake's list...
    expect((await get(listUrl(offeringId), teacher.token)).json()).toEqual([]);
    // ...and the hand-in row is still there, because a class's graded work outlives the
    // task that collected it and a certificate will divide a total by `maxScore`.
    const surviving = await prisma.submission.findMany({ where: { assignmentId } });
    expect(surviving).toHaveLength(1);
  });

  it('refuses an empty PATCH rather than silently doing nothing', async () => {
    const teacher = await signIn('as-t14@example.com', 'TEACHER');
    const { offeringId } = await makeCourse(teacher.id);
    const assignmentId = await makeAssignment(offeringId);

    const response = await patch(`/api/v1/assignments/${assignmentId}`, teacher.token, {});
    expect(response.statusCode).toBe(422);
  });
});

describe('the whole-class read', () => {
  /*
   * The #15 pin. `GET /assignments/:id/submissions` is gated on `submission:read` with
   * the ASSIGNMENT's subject, which carries no `studentId` — so a student's own
   * `isEnrolledStudent` cell reads an absent field and refuses, even for a student who
   * is seated in that very course and is reading their own work.
   *
   * A class list is not assembled one personal row at a time, and the field that would
   * let it be is exactly the field a subject without one lacks. This is the same shape
   * the attendance register uses for a whole register, and it is here because a
   * regression would be a LEAK rather than an outage: widening this gate to make a UI
   * work is LESSONS-LEARNED #15 pointed the dangerous way.
   */
  it('refuses a seated student, with the rule named', async () => {
    const teacher = await signIn('as-t15@example.com', 'TEACHER');
    const alice = await signIn('as-s5@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId);

    const response = await get(classUrl(assignmentId), alice.token);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('STUDENT:isEnrolledStudent');
  });

  it('serves the owning teacher and an admin the whole class', async () => {
    const teacher = await signIn('as-t16@example.com', 'TEACHER');
    const admin = await signIn('as-a3@example.com', 'ADMIN');
    const other = await signIn('as-t17@example.com', 'TEACHER');
    const alice = await signIn('as-s6@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId);
    const uploadId = await committedUpload(alice);
    await post(handInUrl(assignmentId), alice.token, { uploadId });

    const forTeacher = await get(classUrl(assignmentId), teacher.token);
    expect(forTeacher.statusCode).toBe(200);
    const rows = forTeacher.json().data as Array<{ student: { name: string }; offeringId: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.student.name).toBe('Test Person');
    expect(rows[0]?.offeringId).toBe(offeringId);

    expect((await get(classUrl(assignmentId), admin.token)).statusCode).toBe(200);
    const byOther = await get(classUrl(assignmentId), other.token);
    expect(byOther.statusCode).toBe(403);
    expect(byOther.json().detail).toContain('TEACHER:ownsCourse');
  });
});

describe('handing work in', () => {
  it('accepts a hand-in from a student holding an APPROVED seat on THAT intake', async () => {
    const teacher = await signIn('as-t18@example.com', 'TEACHER');
    const alice = await signIn('as-s7@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId);
    const uploadId = await committedUpload(alice);

    const response = await post(handInUrl(assignmentId), alice.token, { uploadId });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      assignmentId,
      status: 'SUBMITTED',
      attempt: 1,
      score: null,
      gradedBy: null,
      upload: { id: uploadId, originalName: 'fillet-weld.pdf' },
    });
  });

  it('refuses a student whose seat request is still pending, and one who never asked', async () => {
    const teacher = await signIn('as-t19@example.com', 'TEACHER');
    const bob = await signIn('as-s8@example.com', 'STUDENT');
    const carol = await signIn('as-s9@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(bob, offeringId, 'PENDING');
    const assignmentId = await makeAssignment(offeringId);

    const pending = await post(handInUrl(assignmentId), bob.token, {
      uploadId: await committedUpload(bob),
    });
    expect(pending.statusCode).toBe(403);
    expect(pending.json().detail).toContain('STUDENT:enrolledApproved');

    const stranger = await post(handInUrl(assignmentId), carol.token, {
      uploadId: await committedUpload(carol),
    });
    expect(stranger.statusCode).toBe(403);
  });

  it('refuses a hand-in against a DIFFERENT intake of the same course', async () => {
    const teacher = await signIn('as-t20@example.com', 'TEACHER');
    const alice = await signIn('as-s10@example.com', 'STUDENT');
    const { offeringId, otherOfferingId } = await makeCourse(teacher.id, { secondIntake: true });
    await enroll(alice, otherOfferingId);
    const assignmentId = await makeAssignment(offeringId);

    // The gate is `assignment:read`, whose `enrolledApproved` is a COURSE-level answer,
    // so it passes; the SEAT is the thing that refuses, and the seat is per-intake.
    // Inventing one would put coursework in the register of a cohort the student was
    // never admitted to.
    const response = await post(handInUrl(assignmentId), alice.token, {
      uploadId: await committedUpload(alice),
    });
    expect(response.statusCode).toBe(409);
  });

  it('refuses a teacher handing in, because they hold no seat on their own intake', async () => {
    const teacher = await signIn('as-t21@example.com', 'TEACHER');
    const { offeringId } = await makeCourse(teacher.id);
    const assignmentId = await makeAssignment(offeringId);

    // `ownsCourse` passes the gate — a teacher may READ their own tasks — and the
    // service refuses the write, because a hand-in is made against a seat and a
    // teacher holds none. That is a data fact rather than a permission, which is why
    // it is a 409 here and not a fifth policy action.
    const response = await post(handInUrl(assignmentId), teacher.token, {
      uploadId: await committedUpload(teacher),
    });
    expect(response.statusCode).toBe(409);
  });

  it('refuses a hand-in backed by somebody else’s file', async () => {
    const teacher = await signIn('as-t22@example.com', 'TEACHER');
    const alice = await signIn('as-s11@example.com', 'STUDENT');
    const mallory = await signIn('as-s12@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId);

    const response = await post(handInUrl(assignmentId), alice.token, {
      uploadId: await committedUpload(mallory),
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().errors[0].path).toBe('uploadId');
  });

  it('refuses a hand-in reusing a file that already backs another one', async () => {
    const teacher = await signIn('as-t24@example.com', 'TEACHER');
    const alice = await signIn('as-s14@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const firstAssignment = await makeAssignment(offeringId, { title: 'First task' });
    const secondAssignment = await makeAssignment(offeringId, { title: 'Second task' });
    const uploadId = await committedUpload(alice, 'shared.pdf');

    const first = await post(handInUrl(firstAssignment), alice.token, { uploadId });
    expect(first.statusCode).toBe(201);

    /*
     * THE FOURTH `@unique` CLAIM POINT. `Submission.uploadId` is unique for the same
     * reason `Resource.uploadId` is — one upload backs exactly one hand-in, and the file
     * IS the hand-in — and `assertUploadClaimable` read the first three of them
     * (resource, courseSyllabus, userAvatar) to turn the collision into a 422 naming
     * `uploadId`. Left out of that read, this one is the database's problem instead of
     * the service's: a P2002 becomes a pathless 409 (errors.plugin.ts's P2002 branch),
     * which the SPA cannot render against a form field and which does not tell the
     * student what they did. The student did nothing wrong that they can name: they
     * picked a file, twice, on two tasks that legitimately both want it.
     */
    const second = await post(handInUrl(secondAssignment), alice.token, { uploadId });

    expect(second.statusCode).toBe(422);
    expect(second.json().code).toBe('VALIDATION_FAILED');
    expect(second.json().errors[0].path).toBe('uploadId');
    expect(second.json().errors[0].message).toContain('already attached');

    // And nothing was written on the refused attempt. `@@unique([assignmentId,
    // enrollmentId, attempt])` would have made the second row attempt 2 on the SECOND
    // assignment, which is legal — so the only thing standing between this and a
    // hand-in that exists and a file that backs two things is the check above.
    const rows = await prisma.submission.findMany({ where: { uploadId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.assignmentId).toBe(firstAssignment);
  });

  it('records a resubmission as a NEW row, and keeps the first', async () => {
    const teacher = await signIn('as-t23@example.com', 'TEACHER');
    const alice = await signIn('as-s13@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId);

    const first = await post(handInUrl(assignmentId), alice.token, {
      uploadId: await committedUpload(alice, 'first.pdf'),
    });
    expect(first.statusCode).toBe(201);

    const second = await post(handInUrl(assignmentId), alice.token, {
      uploadId: await committedUpload(alice, 'second.pdf'),
    });
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ attempt: 2 });

    // The history survives. Overwriting the first hand-in would destroy the only record
    // of what the student turned in before their teacher read it.
    const rows = await prisma.submission.findMany({
      where: { assignmentId },
      orderBy: { attempt: 'asc' },
    });
    expect(rows.map((row) => row.attempt)).toEqual([1, 2]);
  });
});

describe('grading', () => {
  it('records the mark, the grader and the moment, and names them in the response', async () => {
    const teacher = await signIn('as-t24@example.com', 'TEACHER');
    const alice = await signIn('as-s14@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId);
    await post(handInUrl(assignmentId), alice.token, {
      uploadId: await committedUpload(alice),
    });
    const submissionId = (await prisma.submission.findFirstOrThrow()).id;

    const response = await post(`/api/v1/submissions/${submissionId}/grade`, teacher.token, {
      score: 62.5,
      feedback: 'Good root, a little proud on the third leg.',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('GRADED');
    // A Decimal again — a mark of 62.5 is exactly the value an integer column would
    // have made a teacher round in their head before writing it down.
    expect(body.score).toBe(62.5);
    expect(typeof body.score).toBe('number');
    expect(body.gradedBy.name).toBe('Test Person');
    expect(body.gradedAt).not.toBeNull();
  });

  it('refuses a mark above the task’s own maximum, with a field path', async () => {
    const teacher = await signIn('as-t25@example.com', 'TEACHER');
    const alice = await signIn('as-s15@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId, { maxScore: 50 });
    await post(handInUrl(assignmentId), alice.token, {
      uploadId: await committedUpload(alice),
    });
    const submissionId = (await prisma.submission.findFirstOrThrow()).id;

    const response = await post(`/api/v1/submissions/${submissionId}/grade`, teacher.token, {
      score: 80,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().errors[0].path).toBe('score');
  });

  it('refuses a student grading their own work, and a teacher in another course', async () => {
    const teacher = await signIn('as-t26@example.com', 'TEACHER');
    const other = await signIn('as-t27@example.com', 'TEACHER');
    const alice = await signIn('as-s16@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId);
    await post(handInUrl(assignmentId), alice.token, {
      uploadId: await committedUpload(alice),
    });
    const submissionId = (await prisma.submission.findFirstOrThrow()).id;

    const byStudent = await post(`/api/v1/submissions/${submissionId}/grade`, alice.token, {
      score: 100,
    });
    expect(byStudent.statusCode).toBe(403);
    expect(byStudent.json().detail).toContain('STUDENT:deny');

    const byOther = await post(`/api/v1/submissions/${submissionId}/grade`, other.token, {
      score: 100,
    });
    expect(byOther.statusCode).toBe(403);
    expect(byOther.json().detail).toContain('TEACHER:ownsCourse');
  });

  it('re-grading corrects the row rather than refusing it', async () => {
    const teacher = await signIn('as-t28@example.com', 'TEACHER');
    const alice = await signIn('as-s17@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId);
    await post(handInUrl(assignmentId), alice.token, {
      uploadId: await committedUpload(alice),
    });
    const submissionId = (await prisma.submission.findFirstOrThrow()).id;

    await post(`/api/v1/submissions/${submissionId}/grade`, teacher.token, { score: 40 });
    const corrected = await post(`/api/v1/submissions/${submissionId}/grade`, teacher.token, {
      score: 55,
      feedback: 'Re-read against the rubric; 55 is right.',
    });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json().score).toBe(55);
    expect(await prisma.submission.count({ where: { assignmentId } })).toBe(1);
  });

  it('answers 404 to an admin grading a hand-in that is not there', async () => {
    const admin = await signIn('as-a4@example.com', 'ADMIN');

    // An ADMIN's cell is `allow`, which reads no subject field, so they pass the gate
    // on an id that was never there. The service owes them a truthful 404 rather than a
    // null-dereference 500.
    const response = await post(
      '/api/v1/submissions/01JGXDFAM0K2Z1GYCSNM5F5RCX/grade',
      admin.token,
      { score: 10 },
    );
    expect(response.statusCode).toBe(404);
  });
});

describe('returning work', () => {
  it('asks for another attempt, with a mandatory reason and no mark', async () => {
    const teacher = await signIn('as-t29@example.com', 'TEACHER');
    const alice = await signIn('as-s18@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId);
    await post(handInUrl(assignmentId), alice.token, {
      uploadId: await committedUpload(alice),
    });
    const submissionId = (await prisma.submission.findFirstOrThrow()).id;

    const refused = await post(`/api/v1/submissions/${submissionId}/return`, teacher.token, {
      feedback: '   ',
    });
    expect(refused.statusCode).toBe(422);

    const returned = await post(`/api/v1/submissions/${submissionId}/return`, teacher.token, {
      feedback: 'Undercut on two passes — run it again with the guide rail.',
    });
    expect(returned.statusCode).toBe(200);
    expect(returned.json()).toMatchObject({ status: 'RETURNED', score: null });
  });

  it('clears a mark that was already given, because a RETURNED row is not counted', async () => {
    const teacher = await signIn('as-t30@example.com', 'TEACHER');
    const alice = await signIn('as-s19@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId);
    await post(handInUrl(assignmentId), alice.token, {
      uploadId: await committedUpload(alice),
    });
    const submissionId = (await prisma.submission.findFirstOrThrow()).id;
    await post(`/api/v1/submissions/${submissionId}/grade`, teacher.token, { score: 30 });

    const returned = await post(`/api/v1/submissions/${submissionId}/return`, teacher.token, {
      feedback: 'Have another go.',
    });
    expect(returned.json().score).toBeNull();
  });

  /*
   * The bodyless-POST trap (LESSONS-LEARNED #12) applied to a new route.
   *
   * Fastify hands a POST sent with NO BODY to the validator as `null`, and body
   * validation runs BEFORE the policy preHandler — so a caller who was never entitled
   * would learn "malformed" about a hand-in they were not allowed to touch. A test
   * that sends `{}` passes either way, which is why the broken spelling has to be the
   * one the test sends.
   */
  it('answers 403 and not 422 to a bodyless return from a colleague', async () => {
    const teacher = await signIn('as-t31@example.com', 'TEACHER');
    const other = await signIn('as-t32@example.com', 'TEACHER');
    const alice = await signIn('as-s20@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId);
    await post(handInUrl(assignmentId), alice.token, {
      uploadId: await committedUpload(alice),
    });
    const submissionId = (await prisma.submission.findFirstOrThrow()).id;

    const response = await post(`/api/v1/submissions/${submissionId}/return`, other.token);
    expect(response.statusCode).toBe(403);
  });
});

/*
 * The debt commit 95b0913 wrote down when it shipped grading: "a graded hand-in sends
 * no notification, which needs a NotificationType member and therefore a migration
 * nobody asked for." Migration 0014 adds the members; this is the half that is a
 * service change, and it is the half a comment in a migration file cannot make true.
 */
describe('announcing a verdict', () => {
  it('tells the student their work was marked, with a payload that renders', async () => {
    const teacher = await signIn('as-t40@example.com', 'TEACHER');
    const alice = await signIn('as-s30@example.com', 'STUDENT');
    const { courseId, offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId, { title: 'Weld the fillet' });
    await post(handInUrl(assignmentId), alice.token, { uploadId: await committedUpload(alice) });
    const submissionId = (await prisma.submission.findFirstOrThrow()).id;

    await post(`/api/v1/submissions/${submissionId}/grade`, teacher.token, {
      score: 62.5,
      feedback: 'Good root, a little proud on the third leg.',
    });

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: alice.id, type: 'SUBMISSION_GRADED' },
    });
    // LESSONS-LEARNED #17 again, and for the same reason: a payload missing either key
    // is served as `{title: '', body: ''}` and renders blank with no error anywhere.
    // Asserted against the round trip, against the real writer.
    const payload = notification.payload as { title?: string; body?: string };
    expect(payload.title).toBe('Your work has been marked');
    expect(payload.body).toContain('62.5');
    expect(payload.body).toContain('Weld the fillet');
    // The bell navigates straight to the course the task hangs off, which is the
    // Assignments panel the student reads the mark in.
    expect(notification.linkPath).toBe(`/courses/${courseId}`);
  });

  it('tells the student their work came back, and says no mark was given', async () => {
    const teacher = await signIn('as-t41@example.com', 'TEACHER');
    const alice = await signIn('as-s31@example.com', 'STUDENT');
    const { courseId, offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId, { title: 'Weld the fillet' });
    await post(handInUrl(assignmentId), alice.token, { uploadId: await committedUpload(alice) });
    const submissionId = (await prisma.submission.findFirstOrThrow()).id;

    await post(`/api/v1/submissions/${submissionId}/return`, teacher.token, {
      feedback: 'Undercut on two passes — run it again with the guide rail.',
    });

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: alice.id, type: 'SUBMISSION_RETURNED' },
    });
    const payload = notification.payload as { title?: string; body?: string };
    expect(payload.title).toBe('Your work needs another attempt');
    expect(payload.body).toContain('Weld the fillet');
    // A return carries no score by design, and the sentence must not imply one.
    expect(payload.body).not.toMatch(/\d+\s*(out of|\/)\s*\d+/);
    expect(notification.linkPath).toBe(`/courses/${courseId}`);
  });

  it('keeps the two types apart, because the notifications page filters by type', async () => {
    const teacher = await signIn('as-t42@example.com', 'TEACHER');
    const alice = await signIn('as-s32@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId);
    await post(handInUrl(assignmentId), alice.token, { uploadId: await committedUpload(alice) });
    const submissionId = (await prisma.submission.findFirstOrThrow()).id;

    await post(`/api/v1/submissions/${submissionId}/return`, teacher.token, {
      feedback: 'Another go, please.',
    });
    await post(`/api/v1/submissions/${submissionId}/grade`, teacher.token, { score: 80 });

    expect(
      await prisma.notification.count({ where: { userId: alice.id, type: 'SUBMISSION_RETURNED' } }),
    ).toBe(1);
    expect(
      await prisma.notification.count({ where: { userId: alice.id, type: 'SUBMISSION_GRADED' } }),
    ).toBe(1);
  });

  it('says nothing when the mark was refused, because nothing was marked', async () => {
    const teacher = await signIn('as-t43@example.com', 'TEACHER');
    const alice = await signIn('as-s33@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId, { maxScore: 50 });
    await post(handInUrl(assignmentId), alice.token, { uploadId: await committedUpload(alice) });
    const submissionId = (await prisma.submission.findFirstOrThrow()).id;

    const refused = await post(`/api/v1/submissions/${submissionId}/grade`, teacher.token, {
      score: 80,
    });
    expect(refused.statusCode).toBe(422);

    // A notification written for a mark that was never stored is the one failure mode
    // this whole feature exists to prevent, so the negative is asserted rather than
    // assumed: the count is compared against 0 and not against undefined.
    expect(
      await prisma.notification.count({ where: { userId: alice.id, type: 'SUBMISSION_GRADED' } }),
    ).toBe(0);
  });

  it('says nothing to the grader, who is the one who already knows', async () => {
    const teacher = await signIn('as-t44@example.com', 'TEACHER');
    const alice = await signIn('as-s34@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    const assignmentId = await makeAssignment(offeringId);
    await post(handInUrl(assignmentId), alice.token, { uploadId: await committedUpload(alice) });
    const submissionId = (await prisma.submission.findFirstOrThrow()).id;

    await post(`/api/v1/submissions/${submissionId}/grade`, teacher.token, { score: 90 });

    expect(
      await prisma.notification.count({
        where: { userId: teacher.id, type: { in: ['SUBMISSION_GRADED', 'SUBMISSION_RETURNED'] } },
      }),
    ).toBe(0);
  });
});

describe('the student’s own list', () => {
  it('joins every task they hold a seat for to whether they have handed in', async () => {
    const teacher = await signIn('as-t33@example.com', 'TEACHER');
    const alice = await signIn('as-s21@example.com', 'STUDENT');
    const { courseId, offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);

    const undone = await makeAssignment(offeringId, { title: 'Not handed in' });
    const done = await makeAssignment(offeringId, { title: 'Handed in' });
    const overdue = await makeAssignment(offeringId, {
      title: 'Overdue',
      dueAt: IN_THE_PAST,
    });

    await post(handInUrl(done), alice.token, { uploadId: await committedUpload(alice) });
    const submissionId = (await prisma.submission.findFirstOrThrow()).id;
    await post(`/api/v1/submissions/${submissionId}/grade`, teacher.token, {
      score: 15,
      feedback: 'Half marks — the undercut needs work.',
    });

    const response = await get(`/api/v1/assignments/mine?courseId=${courseId}`, alice.token);
    expect(response.statusCode).toBe(200);
    const rows = response.json().data as Array<{
      id: string;
      submission: { score: number; attempt: number } | null;
      submissionCount: number;
      scorePercent: number | null;
      overdue: boolean;
      course: { code: string };
    }>;

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.id).sort()).toEqual([undone, done, overdue].sort());

    const handed = rows.find((row) => row.id === done);
    expect(handed?.submission).not.toBeNull();
    expect(handed?.submission?.attempt).toBe(1);
    expect(handed?.submissionCount).toBe(1);
    // The division a Phase 3 certificate will perform, done once and server-side.
    expect(handed?.scorePercent).toBe(15);

    const untouched = rows.find((row) => row.id === undone);
    expect(untouched?.submission).toBeNull();
    // Null, not 0: a zero is a mark nobody gave, and a client that renders it as
    // "0%" has invented a grade.
    expect(untouched?.scorePercent).toBeNull();
    expect(untouched?.submissionCount).toBe(0);

    expect(rows.find((row) => row.id === overdue)?.overdue).toBe(true);
    expect(untouched?.overdue).toBe(false);
  });

  it('carries only the student’s OWN hand-in, never a classmate’s', async () => {
    const teacher = await signIn('as-t34@example.com', 'TEACHER');
    const alice = await signIn('as-s22@example.com', 'STUDENT');
    const bob = await signIn('as-s23@example.com', 'STUDENT');
    const { courseId, offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);
    await enroll(bob, offeringId);
    const assignmentId = await makeAssignment(offeringId);

    await post(handInUrl(assignmentId), alice.token, { uploadId: await committedUpload(alice) });
    await post(handInUrl(assignmentId), bob.token, { uploadId: await committedUpload(bob) });

    const rows = (await get(`/api/v1/assignments/mine?courseId=${courseId}`, alice.token)).json()
      .data as Array<{ submission: { enrollmentId: string } | null }>;

    const aliceEnrollment = await prisma.enrollment.findFirstOrThrow({
      where: { studentId: alice.id },
      select: { id: true },
    });
    expect(rows[0]?.submission?.enrollmentId).toBe(aliceEnrollment.id);
  });

  it('is empty for a student with no seat, and for a teacher', async () => {
    const teacher = await signIn('as-t35@example.com', 'TEACHER');
    const carol = await signIn('as-s24@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    const assignmentId = await makeAssignment(offeringId);

    expect((await get('/api/v1/assignments/mine', carol.token)).json()).toEqual({ data: [] });
    // A teacher has no enrolment of their own, so the list is empty by construction
    // rather than by a refusal. The per-intake list is their reader.
    expect((await get('/api/v1/assignments/mine', teacher.token)).json()).toEqual({ data: [] });
    expect(await prisma.assignment.count({ where: { id: assignmentId } })).toBe(1);
  });

  it('refuses an anonymous caller', async () => {
    expect((await get('/api/v1/assignments/mine')).statusCode).toBe(401);
  });
});

/**
 * The assessment chain in `AUDITED_MODELS` (packages/db/src/audit.ts), asserted through
 * the routes rather than through a direct Prisma write.
 *
 * The reason it has to be a test and not a line in a comment is the shape of the
 * failure. Adding a model to that set is not an error anywhere if it is wrong: the
 * interceptors return early for a model they do not recognise, no query throws, no log
 * line is written, and every functional assertion in this file still passes. What
 * disappears is the RECORD — so the only honest check is that the row exists, with the
 * right action, carrying the field that changed.
 *
 * Driving it through `POST /offerings/:id/assignments` and `POST /submissions/:id/grade`
 * is what makes it a test of the product rather than of the extension: the fixture
 * helpers `makeAssignment` and `committedUpload` write straight through Prisma, and a
 * mark is a route.
 */
describe('what the assessment chain leaves in the audit trail', () => {
  it('records the task, the hand-in, and the mark as a diffed UPDATE', async () => {
    const teacher = await signIn('as-t36@example.com', 'TEACHER');
    const alice = await signIn('as-s25@example.com', 'STUDENT');
    const { offeringId } = await makeCourse(teacher.id);
    await enroll(alice, offeringId);

    const created = await post(
      listUrl(offeringId),
      teacher.token,
      createAssignmentBody(offeringId),
    );
    expect(created.statusCode).toBe(201);
    const assignmentId = created.json().id as string;

    const assignmentEvents = await prisma.auditEvent.findMany({
      where: { entityType: 'Assignment', entityId: assignmentId },
      orderBy: { createdAt: 'asc' },
    });
    // One row, from the extension, with the whole after-image rather than a diff: a
    // CREATE has no before side, so the body of the task — the brief, the deadline,
    // the maximum — is what an appeal is read against.
    expect(assignmentEvents.map((event) => event.action)).toEqual(['CREATE']);
    expect(assignmentEvents[0]?.before).toBeNull();
    expect(Object.keys(assignmentEvents[0]?.after as object)).toEqual(
      expect.arrayContaining(['title', 'brief', 'dueAt', 'maxScore', 'offeringId']),
    );

    const handedIn = await post(handInUrl(assignmentId), alice.token, {
      uploadId: await committedUpload(alice),
    });
    expect(handedIn.statusCode).toBe(201);
    const submissionId = handedIn.json().id as string;

    const graded = await post(`/api/v1/submissions/${submissionId}/grade`, teacher.token, {
      score: 62.5,
      feedback: 'Good root, a little proud on the third leg.',
    });
    expect(graded.statusCode).toBe(200);

    const submissionEvents = await prisma.auditEvent.findMany({
      where: { entityType: 'Submission', entityId: submissionId },
      orderBy: { createdAt: 'asc' },
    });
    // CREATE, then the mark as an UPDATE — the same CREATE -> diffed-UPDATE pair
    // `AttendanceRecord` earns from the attendance bulk-mark, because a correction
    // that left no trail would be indistinguishable from a mark nobody ever gave.
    expect(submissionEvents.map((event) => event.action)).toEqual(['CREATE', 'UPDATE']);

    // The DIFF, not the whole row, and the assertion is on the field a registrar
    // disputes. `score` is a Prisma Decimal, so `diff()`'s JSON comparison sees it as
    // a string in both images and it is the feedback that has to be present to prove
    // the update was recorded at all.
    const mark = submissionEvents[1];
    const changed = mark?.after as Record<string, unknown> | null;
    expect(Object.keys(changed ?? {})).toContain('feedback');
    expect(changed?.feedback).toBe('Good root, a little proud on the third leg.');
    // And the actor is on it, which is the whole point: `withAuditContext` supplies the
    // session, so a trail row is attributable without the service naming anyone.
    expect(submissionEvents.map((event) => event.actorId)).toEqual([alice.id, teacher.id]);
  });
});
