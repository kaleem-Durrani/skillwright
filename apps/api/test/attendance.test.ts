import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// app.ts:43-49: "Anything that holds an instance built here — main.ts, the integration
// tests — should name this type." Plain FastifyInstance is a type error, not a widening.
import type { AppInstance } from '../src/app.js';
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

/** Any teaching day works; constants keep assertions about ordering trivial. */
const DAY_ONE = '2030-03-14';
const DAY_TWO = '2030-03-15';

let app: AppInstance;
let departmentId: string;
let sequence = 0;

/**
 * Same discipline as enrollments.test.ts: Course holds Restrict foreign keys to
 * User and Department, so any academic row left behind breaks the next suite's
 * resetDatabase(). Attendance rows need no separate sweep — they cascade from
 * their enrollment.
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
 * Registration always produces a STUDENT — auth.service.ts:199-201 — so privileged
 * fixtures are promoted directly on the row, exactly as enrollments.test.ts does.
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

async function makeCourse(teacherId: string, options: { capacity?: number } = {}): Promise<string> {
  sequence += 1;
  const course = await prisma.course.create({
    data: {
      code: `ATT-${1000 + sequence}`,
      slug: `attendance-${sequence}`,
      name: `Attendance ${sequence}`,
      departmentId,
      teacherId,
      durationValue: 6,
      durationUnit: 'WEEK',
      capacity: options.capacity ?? 10,
      publishedAt: new Date(),
    },
  });
  return course.id;
}

async function enroll(
  student: Person,
  courseId: string,
  status: 'PENDING' | 'APPROVED' | 'WITHDRAWN' = 'APPROVED',
): Promise<string> {
  const enrollment = await prisma.enrollment.create({
    data: { studentId: student.id, courseId, status },
  });
  // Keep the denormalised counter honest so unrelated assertions stay meaningful.
  if (status === 'APPROVED') {
    await prisma.course.update({
      where: { id: courseId },
      data: { approvedCount: { increment: 1 } },
    });
  }
  return enrollment.id;
}

type MarkStatus = 'PRESENT' | 'ABSENT' | 'LATE';

interface MarkRow {
  enrollmentId: string;
  status: MarkStatus;
  note?: string;
}

function markUrl(courseId: string): string {
  return `/api/v1/courses/${courseId}/attendance`;
}

/** Every mutation carries `originHeaders`, or csrf.plugin.ts refuses it first. */
function mark(courseId: string, date: string, marks: MarkRow[], cookie: string) {
  return app.inject({
    method: 'PUT',
    url: markUrl(courseId),
    headers: { ...originHeaders, cookie: cookieHeader(cookie) },
    payload: { date, marks } as Record<string, unknown>,
  });
}

function get(url: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url,
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

function rowByEnrollment(
  rows: Array<{ enrollmentId: string } & Record<string, unknown>>,
  enrollmentId: string,
): Record<string, unknown> {
  const found = rows.find((row) => row.enrollmentId === enrollmentId);
  expect(found, `expected a roster row for enrollment ${enrollmentId}`).toBeTruthy();
  return found as Record<string, unknown>;
}

// --- tests -----------------------------------------------------------------

describe('bulk marking a register', () => {
  it('marks a whole register in one request and echoes the roster back', async () => {
    const teacher = await signIn('at-t1@example.com', 'TEACHER');
    const alice = await signIn('at-s1@example.com', 'STUDENT');
    const bob = await signIn('at-s2@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const enrolmentA = await enroll(alice, courseId);
    const enrolmentB = await enroll(bob, courseId);

    const response = await mark(
      courseId,
      DAY_ONE,
      [
        { enrollmentId: enrolmentA, status: 'PRESENT' },
        { enrollmentId: enrolmentB, status: 'LATE', note: 'Bus diversion' },
      ],
      teacher.token,
    );

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.date).toBe(DAY_ONE);
    expect(body.rows).toHaveLength(2);
    // Rows come back ordered by student name; both fixtures share one name, so key
    // by enrollment instead of assuming order.
    expect(rowByEnrollment(body.rows, enrolmentA).status).toBe('PRESENT');
    const bobRow = rowByEnrollment(body.rows, enrolmentB);
    expect(bobRow.status).toBe('LATE');
    expect(bobRow.note).toBe('Bus diversion');
    expect((bobRow.markedBy as { id: string }).id).toBe(teacher.id);

    expect(await prisma.attendanceRecord.count({ where: { enrollmentId: enrolmentA } })).toBe(1);
  });

  it('corrects rather than duplicates when the same date is marked twice', async () => {
    const teacher = await signIn('at-t2@example.com', 'TEACHER');
    const alice = await signIn('at-s3@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const enrolmentA = await enroll(alice, courseId);

    const first = await mark(
      courseId,
      DAY_ONE,
      [{ enrollmentId: enrolmentA, status: 'ABSENT', note: 'No show' }],
      teacher.token,
    );
    expect(first.statusCode).toBe(200);

    const second = await mark(
      courseId,
      DAY_ONE,
      [{ enrollmentId: enrolmentA, status: 'PRESENT' }],
      teacher.token,
    );
    expect(second.statusCode).toBe(200);
    expect(second.json().rows[0].status).toBe('PRESENT');

    // @@unique([enrollmentId, sessionDate]) — one row per seat per day, forever.
    const records = await prisma.attendanceRecord.findMany({ where: { enrollmentId: enrolmentA } });
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe('PRESENT');
    // Omitting `note` preserves the existing one rather than clearing it.
    expect(records[0]?.note).toBe('No show');

    // The audit extension treats the correction as a diffed UPDATE, not a CREATE —
    // the one-line addition of AttendanceRecord to AUDITED_MODELS at work.
    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'AttendanceRecord', entityId: records[0]?.id ?? '' },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((event) => event.action)).toEqual(['CREATE', 'UPDATE']);
    if (events[1]?.after && typeof events[1].after === 'object') {
      expect(Object.keys(events[1].after as object)).toContain('status');
    }
  });

  it('rejects any enrollmentId that is not APPROVED on that course, writing nothing', async () => {
    const teacher = await signIn('at-t3@example.com', 'TEACHER');
    const alice = await signIn('at-s4@example.com', 'STUDENT');
    const pending = await signIn('at-s5@example.com', 'STUDENT');
    const otherTeacher = await signIn('at-t3b@example.com', 'TEACHER');
    const otherStudent = await signIn('at-s5b@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const enrolmentA = await enroll(alice, courseId);
    const pendingEnrolment = await enroll(pending, courseId, 'PENDING');
    const foreignCourse = await makeCourse(otherTeacher.id);
    const foreignEnrolment = await enroll(otherStudent, foreignCourse);

    async function expectRejected(marks: MarkRow[]): Promise<void> {
      const response = await mark(courseId, DAY_TWO, marks, teacher.token);
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('CONFLICT');
      // Transactional all-or-nothing: the valid id beside the bad one wrote nothing.
      expect(await prisma.attendanceRecord.count()).toBe(0);
    }

    // PENDING is not seated.
    await expectRejected([
      { enrollmentId: enrolmentA, status: 'PRESENT' },
      { enrollmentId: pendingEnrolment, status: 'PRESENT' },
    ]);
    // Another course's APPROVED enrollment is not this register's business.
    await expectRejected([{ enrollmentId: foreignEnrolment, status: 'PRESENT' }]);
    // A well-formed id that names nobody at all conflicts just the same — the shape
    // was fine; the roster state was not. That is why this module answers 409, not 422.
    await expectRejected([{ enrollmentId: 'ckvzq0000000000000000000', status: 'PRESENT' }]);
  });

  it("refuses teacher B on teacher A's register with the policy rule named", async () => {
    const teacherA = await signIn('at-t4@example.com', 'TEACHER');
    const teacherB = await signIn('at-t5@example.com', 'TEACHER');
    const student = await signIn('at-s6@example.com', 'STUDENT');
    const courseId = await makeCourse(teacherA.id);
    const enrolment = await enroll(student, courseId);

    const marked = await mark(
      courseId,
      DAY_ONE,
      [{ enrollmentId: enrolment, status: 'PRESENT' }],
      teacherB.token,
    );
    expect(marked.statusCode).toBe(403);
    expect(marked.json().code).toBe('FORBIDDEN');
    expect(marked.json().detail).toContain('TEACHER:ownsCourse');
    expect(await prisma.attendanceRecord.count()).toBe(0);

    const read = await get(`${markUrl(courseId)}?date=${DAY_ONE}`, teacherB.token);
    expect(read.statusCode).toBe(403);
    expect(read.json().detail).toContain('TEACHER:ownsCourse');
  });

  it('refuses a student who tries to mark or read the whole register', async () => {
    const teacher = await signIn('at-t6@example.com', 'TEACHER');
    const student = await signIn('at-s7@example.com', 'STUDENT');
    const classmate = await signIn('at-s8@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const own = await enroll(student, courseId);
    await enroll(classmate, courseId);

    const marked = await mark(
      courseId,
      DAY_ONE,
      [{ enrollmentId: own, status: 'PRESENT' }],
      student.token,
    );
    expect(marked.statusCode).toBe(403);
    expect(marked.json().detail).toContain('STUDENT:deny');

    // Even enrolled-and-approved, the class list is not theirs to read.
    const read = await get(`${markUrl(courseId)}?date=${DAY_ONE}`, student.token);
    expect(read.statusCode).toBe(403);
  });

  it('lets an admin mark any register', async () => {
    const admin = await signIn('at-a1@example.com', 'ADMIN');
    const teacher = await signIn('at-t7@example.com', 'TEACHER');
    const student = await signIn('at-s9@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const enrolment = await enroll(student, courseId);

    const response = await mark(
      courseId,
      DAY_ONE,
      [{ enrollmentId: enrolment, status: 'LATE' }],
      admin.token,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().rows[0].markedBy.id).toBe(admin.id);
  });
});

describe('register scoping and validation', () => {
  it('reads the current APPROVED roster only, with unmarked seats null', async () => {
    const teacher = await signIn('at-t8@example.com', 'TEACHER');
    const approved = await signIn('at-s10@example.com', 'STUDENT');
    const pending = await signIn('at-s11@example.com', 'STUDENT');
    const withdrawn = await signIn('at-s12@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    await enroll(approved, courseId, 'APPROVED');
    await enroll(pending, courseId, 'PENDING');
    await enroll(withdrawn, courseId, 'WITHDRAWN');

    const response = await get(`${markUrl(courseId)}?date=${DAY_ONE}`, teacher.token);
    expect(response.statusCode).toBe(200);
    const body = response.json();

    // One row per APPROVED seat — PENDING and WITHDRAWN never appear.
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].student.id).toBe(approved.id);
    expect(body.rows[0].status).toBeNull();
    expect(body.rows[0].note).toBeNull();
    expect(body.rows[0].markedBy).toBeNull();
  });

  it('shows existing records joined onto the roster', async () => {
    const teacher = await signIn('at-t9@example.com', 'TEACHER');
    const student = await signIn('at-s13@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const enrolment = await enroll(student, courseId);
    await prisma.attendanceRecord.create({
      data: {
        enrollmentId: enrolment,
        sessionDate: new Date(`${DAY_ONE}T00:00:00.000Z`),
        status: 'ABSENT',
        markedById: teacher.id,
      },
    });

    const response = await get(`${markUrl(courseId)}?date=${DAY_ONE}`, teacher.token);
    expect(response.statusCode).toBe(200);
    expect(response.json().rows[0].status).toBe('ABSENT');
  });

  it('answers 404 for a register whose course does not exist, even for an admin', async () => {
    const admin = await signIn('at-a2@example.com', 'ADMIN');
    const response = await get(
      `${markUrl('ckvzq0000000000000000000')}?date=${DAY_ONE}`,
      admin.token,
    );
    // The ADMIN cell is `allow`, which ignores the subject — so the read itself
    // must catch a missing course rather than serve an empty register as real.
    expect(response.statusCode).toBe(404);
  });

  it('validates the date before anything is written', async () => {
    const teacher = await signIn('at-t10@example.com', 'TEACHER');
    const student = await signIn('at-s14@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const enrolment = await enroll(student, courseId);

    const wrongFormat = await mark(
      courseId,
      '14/03/2030',
      [{ enrollmentId: enrolment, status: 'PRESENT' }],
      teacher.token,
    );
    expect(wrongFormat.statusCode).toBe(422);

    const notADay = await get(`${markUrl(courseId)}?date=2030-03`, teacher.token);
    expect(notADay.statusCode).toBe(422);

    const missing = await get(markUrl(courseId), teacher.token);
    expect(missing.statusCode).toBe(422);

    expect(await prisma.attendanceRecord.count()).toBe(0);
  });

  it('refuses an anonymous caller entirely', async () => {
    // A well-formed-but-unknown id, so route validation passes and the gate is
    // what answers.
    const response = await get(
      `/api/v1/courses/ckvzq0000000000000000000/attendance?date=${DAY_ONE}`,
    );
    expect(response.statusCode).toBe(401);
  });
});

describe('personal attendance summary', () => {
  it("gives a student their own counts and recent rows, and nobody else's", async () => {
    const teacher = await signIn('at-t11@example.com', 'TEACHER');
    const alice = await signIn('at-s15@example.com', 'STUDENT');
    const bob = await signIn('at-s16@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const aliceEnrolment = await enroll(alice, courseId);
    const bobEnrolment = await enroll(bob, courseId);

    await prisma.attendanceRecord.createMany({
      data: [
        {
          enrollmentId: aliceEnrolment,
          sessionDate: new Date('2030-03-01T00:00:00.000Z'),
          status: 'PRESENT',
          markedById: teacher.id,
        },
        {
          enrollmentId: aliceEnrolment,
          sessionDate: new Date('2030-03-02T00:00:00.000Z'),
          status: 'LATE',
          markedById: teacher.id,
        },
        {
          enrollmentId: bobEnrolment,
          sessionDate: new Date('2030-03-01T00:00:00.000Z'),
          status: 'ABSENT',
          markedById: teacher.id,
        },
      ],
    });

    // Her own summary: two rows, counted by status.
    const own = await get(`/api/v1/enrollments/${aliceEnrolment}/attendance`, alice.token);
    expect(own.statusCode).toBe(200);
    expect(own.json().counts).toEqual({ present: 1, absent: 0, late: 1 });
    expect(own.json().total).toBe(2);
    // Newest day first, marker embedded as a summary without her email.
    expect(
      own.json().recent.map((row: { sessionDate: string }) => row.sessionDate.slice(0, 10)),
    ).toEqual(['2030-03-02', '2030-03-01']);
    expect(own.json().recent[0].markedBy.id).toBe(teacher.id);

    // Bob cannot read Alice's summary even though he shares the course.
    const stranger = await get(`/api/v1/enrollments/${aliceEnrolment}/attendance`, bob.token);
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json().detail).toContain('STUDENT:isEnrolledStudent');
  });

  it('lets the owning teacher read any summary on their course and refuses another teacher', async () => {
    const teacherA = await signIn('at-t12@example.com', 'TEACHER');
    const teacherB = await signIn('at-t13@example.com', 'TEACHER');
    const student = await signIn('at-s17@example.com', 'STUDENT');
    const courseId = await makeCourse(teacherA.id);
    const enrolment = await enroll(student, courseId);
    await prisma.attendanceRecord.create({
      data: {
        enrollmentId: enrolment,
        sessionDate: new Date(`${DAY_ONE}T00:00:00.000Z`),
        status: 'PRESENT',
        markedById: teacherA.id,
      },
    });

    const owner = await get(`/api/v1/enrollments/${enrolment}/attendance`, teacherA.token);
    expect(owner.statusCode).toBe(200);
    expect(owner.json().counts.present).toBe(1);

    const outsider = await get(`/api/v1/enrollments/${enrolment}/attendance`, teacherB.token);
    expect(outsider.statusCode).toBe(403);
    expect(outsider.json().detail).toContain('TEACHER:ownsCourse');
  });

  it('summarises an empty history as zeros, not an error', async () => {
    const teacher = await signIn('at-t14@example.com', 'TEACHER');
    const student = await signIn('at-s18@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const enrolment = await enroll(student, courseId);

    const response = await get(`/api/v1/enrollments/${enrolment}/attendance`, student.token);
    expect(response.statusCode).toBe(200);
    expect(response.json().counts).toEqual({ present: 0, absent: 0, late: 0 });
    expect(response.json().total).toBe(0);
    expect(response.json().recent).toEqual([]);
  });
});
