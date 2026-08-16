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

let app: AppInstance;
let departmentId: string;
let sequence = 0;

/**
 * setup.ts's `resetDatabase()` deletes users and then departments, and Course holds a
 * Restrict foreign key to BOTH. Any course this suite leaves behind therefore makes
 * the next `resetDatabase()` — this file's or another file's — fail. So the academic
 * rows are cleared before every test and once more on the way out.
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

function authPost(url: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/auth${url}`,
    headers: { ...originHeaders },
    payload: payload as Record<string, unknown>,
  });
}

/** Every mutation carries `originHeaders`, or csrf.plugin.ts:20-30 refuses it first. */
function post(url: string, payload: unknown, cookie?: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/enrollments${url}`,
    headers: { ...originHeaders, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
    payload: payload as Record<string, unknown>,
  });
}

function get(url: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/enrollments${url}`,
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

interface Person {
  id: string;
  token: string;
}

/**
 * Registration always produces a STUDENT — auth.service.ts:199-201, "Self-service
 * registration NEVER chooses a privileged role" — so a teacher or admin fixture is a
 * registered account promoted directly on the row, then logged in.
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
  options: { capacity?: number; published?: boolean } = {},
): Promise<string> {
  sequence += 1;
  const course = await prisma.course.create({
    data: {
      code: `WELD-${1000 + sequence}`,
      slug: `welding-${sequence}`,
      name: `Welding ${sequence}`,
      departmentId,
      teacherId,
      durationValue: 6,
      durationUnit: 'WEEK',
      capacity: options.capacity ?? 10,
      publishedAt: options.published === false ? null : new Date(),
    },
  });
  return course.id;
}

async function approvedCountOf(courseId: string): Promise<number> {
  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  return course.approvedCount;
}

// --- tests -----------------------------------------------------------------

describe('requesting a seat', () => {
  it('creates a PENDING row and serialises the shared enrollment shape', async () => {
    const teacher = await signIn('t1@example.com', 'TEACHER');
    const student = await signIn('s1@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);

    const response = await post('/', { courseId }, student.token);
    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.status).toBe('PENDING');
    expect(body.student.id).toBe(student.id);
    expect(body.course.id).toBe(courseId);
    expect(body.decidedBy).toBeNull();
    expect(body.decisionNote).toBeNull();

    // userSummarySchema is {id,name,role,avatarUrl} (user.ts:22-27). There is no
    // student email anywhere in this DTO, which is what CourseDetail.tsx:286 renders.
    expect(body.student).not.toHaveProperty('email');

    // A request is PENDING; only approval moves the counter.
    expect(await approvedCountOf(courseId)).toBe(0);
  });

  it('refuses a draft course, because a draft cannot accumulate a waiting list', async () => {
    const teacher = await signIn('t2@example.com', 'TEACHER');
    const student = await signIn('s2@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id, { published: false });

    const response = await post('/', { courseId }, student.token);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain('STUDENT:isPublished');
  });

  it('refuses a second live application but re-uses the row after a withdrawal', async () => {
    const teacher = await signIn('t3@example.com', 'TEACHER');
    const student = await signIn('s3@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);

    const first = await post('/', { courseId }, student.token);
    expect(first.statusCode).toBe(201);

    const duplicate = await post('/', { courseId }, student.token);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('CONFLICT');

    expect((await post(`/${first.json().id}/withdraw`, {}, student.token)).statusCode).toBe(200);

    const again = await post('/', { courseId }, student.token);
    expect(again.statusCode).toBe(201);
    // schema.prisma:377-379 — one row per (student, course), forever.
    expect(again.json().id).toBe(first.json().id);
    expect(again.json().status).toBe('PENDING');
    expect(again.json().decidedAt).toBeNull();
    expect(again.json().decidedBy).toBeNull();
    expect(await prisma.enrollment.count({ where: { courseId } })).toBe(1);
  });

  it('ignores studentId from a non-admin and honours it for an admin', async () => {
    const teacher = await signIn('t4@example.com', 'TEACHER');
    const student = await signIn('s4@example.com', 'STUDENT');
    const other = await signIn('s4b@example.com', 'STUDENT');
    const admin = await signIn('a4@example.com', 'ADMIN');
    const courseId = await makeCourse(teacher.id);

    // enrollment.ts:28-31 — a non-admin naming someone else has it ignored, not honoured.
    const spoofed = await post('/', { courseId, studentId: other.id }, student.token);
    expect(spoofed.statusCode).toBe(201);
    expect(spoofed.json().student.id).toBe(student.id);

    const onBehalf = await post('/', { courseId, studentId: other.id }, admin.token);
    expect(onBehalf.statusCode).toBe(201);
    expect(onBehalf.json().student.id).toBe(other.id);
  });

  it('turns an unknown courseId into a field-level 422 for an admin', async () => {
    const admin = await signIn('a5@example.com', 'ADMIN');

    const response = await post('/', { courseId: 'ckvzq0000000000000000000' }, admin.token);
    expect(response.statusCode).toBe(422);
    expect(JSON.stringify(response.json())).toContain('courseId');
  });
});

describe('approval and capacity', () => {
  it('seats a student and moves the denormalised counter', async () => {
    const teacher = await signIn('t6@example.com', 'TEACHER');
    const student = await signIn('s6@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id, { capacity: 5 });

    const requested = await post('/', { courseId }, student.token);
    const approved = await post(
      `/${requested.json().id}/approve`,
      { note: 'Welcome' },
      teacher.token,
    );

    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('APPROVED');
    expect(approved.json().decidedBy.id).toBe(teacher.id);
    expect(approved.json().decisionNote).toBe('Welcome');
    expect(approved.json().course.approvedCount).toBe(1);
    expect(approved.json().course.seatsRemaining).toBe(4);
    expect(await approvedCountOf(courseId)).toBe(1);
  });

  it('is idempotent: approving twice never oversells by one', async () => {
    const teacher = await signIn('t7@example.com', 'TEACHER');
    const student = await signIn('s7@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id, { capacity: 5 });

    const requested = await post('/', { courseId }, student.token);
    const first = await post(`/${requested.json().id}/approve`, {}, teacher.token);
    const second = await post(`/${requested.json().id}/approve`, {}, teacher.token);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe('APPROVED');
    expect(await approvedCountOf(courseId)).toBe(1);
  });

  it('refuses the seat that would oversell, as 409 CAPACITY_EXCEEDED', async () => {
    const teacher = await signIn('t8@example.com', 'TEACHER');
    const first = await signIn('s8a@example.com', 'STUDENT');
    const second = await signIn('s8b@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id, { capacity: 1 });

    const a = await post('/', { courseId }, first.token);
    const b = await post('/', { courseId }, second.token);
    expect((await post(`/${a.json().id}/approve`, {}, teacher.token)).statusCode).toBe(200);

    const full = await post(`/${b.json().id}/approve`, {}, teacher.token);
    expect(full.statusCode).toBe(409);
    expect(full.json().code).toBe('CAPACITY_EXCEEDED');
    expect(full.headers['content-type']).toContain('application/problem+json');

    // The throw rolled the increment back: nothing was seated and nothing was moved.
    expect(await approvedCountOf(courseId)).toBe(1);
    const untouched = await prisma.enrollment.findUniqueOrThrow({ where: { id: b.json().id } });
    expect(untouched.status).toBe('PENDING');
  });

  /**
   * ADR 0006 line 42, verbatim: "an integration test fires 200 concurrent approvals at
   * a 30-seat course and asserts exactly 30 succeed", plus the reconciliation query
   * from line 40.
   */
  it('seats exactly the capacity under 200 concurrent approvals', async () => {
    const teacher = await signIn('t9@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id, { capacity: 30 });

    await prisma.user.createMany({
      data: Array.from({ length: 200 }, (_unused, index) => ({
        email: `load-${index}@example.com`,
        name: `Load ${index}`,
        role: 'STUDENT' as const,
        status: 'ACTIVE' as const,
      })),
    });
    const students = await prisma.user.findMany({
      where: { email: { startsWith: 'load-' } },
      select: { id: true },
    });
    expect(students).toHaveLength(200);

    await prisma.enrollment.createMany({
      data: students.map((student) => ({ studentId: student.id, courseId })),
    });
    const pending = await prisma.enrollment.findMany({ where: { courseId }, select: { id: true } });

    const responses = await Promise.all(
      pending.map((enrollment) => post(`/${enrollment.id}/approve`, {}, teacher.token)),
    );

    const seated = responses.filter((response) => response.statusCode === 200);
    const refused = responses.filter((response) => response.statusCode === 409);
    expect(seated).toHaveLength(30);
    expect(refused).toHaveLength(170);
    expect(new Set(refused.map((response) => response.json().code))).toEqual(
      new Set(['CAPACITY_EXCEEDED']),
    );

    // Reconciliation: the denormalised counter equals the real APPROVED count.
    const real = await prisma.enrollment.count({ where: { courseId, status: 'APPROVED' } });
    expect(await approvedCountOf(courseId)).toBe(30);
    expect(real).toBe(30);
  });
});

describe('rejection and withdrawal', () => {
  it('requires a rejection reason — including the body the SPA currently sends', async () => {
    const teacher = await signIn('t10@example.com', 'TEACHER');
    const student = await signIn('s10@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const requested = await post('/', { courseId }, student.token);

    const empty = await post(`/${requested.json().id}/reject`, {}, teacher.token);
    expect(empty.statusCode).toBe(422);
    expect(JSON.stringify(empty.json())).toContain('reason');

    // CourseDetail.tsx:83-84 posts `{ decisionNote }`; rejectEnrollmentSchema wants
    // `{ reason }`. The server binds the shared schema as written — the SPA is what
    // changes — so this stays a 422 until it does.
    const spaShaped = await post(
      `/${requested.json().id}/reject`,
      { decisionNote: 'Not this term' },
      teacher.token,
    );
    expect(spaShaped.statusCode).toBe(422);
  });

  it('releases the seat when an APPROVED enrollment is rejected', async () => {
    const teacher = await signIn('t11@example.com', 'TEACHER');
    const student = await signIn('s11@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id, { capacity: 2 });
    const requested = await post('/', { courseId }, student.token);

    await post(`/${requested.json().id}/approve`, {}, teacher.token);
    expect(await approvedCountOf(courseId)).toBe(1);

    const rejected = await post(
      `/${requested.json().id}/reject`,
      { reason: 'Prerequisite missing' },
      teacher.token,
    );
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().status).toBe('REJECTED');
    expect(rejected.json().decisionNote).toBe('Prerequisite missing');
    expect(await approvedCountOf(courseId)).toBe(0);
  });

  it('releases the seat when an APPROVED student withdraws', async () => {
    const teacher = await signIn('t12@example.com', 'TEACHER');
    const student = await signIn('s12@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id, { capacity: 2 });
    const requested = await post('/', { courseId }, student.token);

    await post(`/${requested.json().id}/approve`, {}, teacher.token);
    const withdrawn = await post(
      `/${requested.json().id}/withdraw`,
      { reason: 'Changed my mind' },
      student.token,
    );

    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json().status).toBe('WITHDRAWN');
    expect(await approvedCountOf(courseId)).toBe(0);
  });

  it('refuses a transition the status machine does not allow', async () => {
    const teacher = await signIn('t13@example.com', 'TEACHER');
    const student = await signIn('s13@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const requested = await post('/', { courseId }, student.token);

    await post(`/${requested.json().id}/withdraw`, {}, student.token);

    const late = await post(`/${requested.json().id}/approve`, {}, teacher.token);
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('CONFLICT');
  });
});

describe('authorization', () => {
  it('refuses a teacher who does not own the course', async () => {
    const owner = await signIn('t14@example.com', 'TEACHER');
    const stranger = await signIn('t14b@example.com', 'TEACHER');
    const student = await signIn('s14@example.com', 'STUDENT');
    const courseId = await makeCourse(owner.id);
    const requested = await post('/', { courseId }, student.token);

    const approve = await post(`/${requested.json().id}/approve`, {}, stranger.token);
    expect(approve.statusCode).toBe(403);
    expect(approve.json().code).toBe('FORBIDDEN');
    expect(approve.json().detail).toContain('TEACHER:ownsCourse');

    const reject = await post(
      `/${requested.json().id}/reject`,
      { reason: 'Not my course' },
      stranger.token,
    );
    expect(reject.statusCode).toBe(403);
    expect(reject.json().detail).toContain('TEACHER:ownsCourse');

    // Nothing was written by the refusal.
    expect(await approvedCountOf(courseId)).toBe(0);
    expect(
      (await prisma.enrollment.findUniqueOrThrow({ where: { id: requested.json().id } })).status,
    ).toBe('PENDING');
  });

  it('refuses a student approving their own enrollment', async () => {
    const teacher = await signIn('t15@example.com', 'TEACHER');
    const student = await signIn('s15@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const requested = await post('/', { courseId }, student.token);

    const response = await post(`/${requested.json().id}/approve`, {}, student.token);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('STUDENT:deny');
    expect(await approvedCountOf(courseId)).toBe(0);
  });

  it('refuses a teacher withdrawing on a student behalf — that verb is rejection', async () => {
    const teacher = await signIn('t16@example.com', 'TEACHER');
    const student = await signIn('s16@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const requested = await post('/', { courseId }, student.token);

    const response = await post(`/${requested.json().id}/withdraw`, {}, teacher.token);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('TEACHER:deny');
  });

  it('refuses an unrelated student reading someone else enrollment', async () => {
    const teacher = await signIn('t17@example.com', 'TEACHER');
    const student = await signIn('s17@example.com', 'STUDENT');
    const stranger = await signIn('s17b@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const requested = await post('/', { courseId }, student.token);

    const mine = await get(`/${requested.json().id}`, student.token);
    expect(mine.statusCode).toBe(200);

    const theirs = await get(`/${requested.json().id}`, stranger.token);
    expect(theirs.statusCode).toBe(403);
    expect(theirs.json().detail).toContain('STUDENT:isEnrolledStudent');
  });

  it('refuses anonymous callers on both the list and a decision', async () => {
    const teacher = await signIn('t18@example.com', 'TEACHER');
    const student = await signIn('s18@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const requested = await post('/', { courseId }, student.token);

    const list = await get('/');
    expect(list.statusCode).toBe(401);
    expect(list.json().code).toBe('UNAUTHENTICATED');

    const approve = await post(`/${requested.json().id}/approve`, {});
    expect(approve.statusCode).toBe(401);
  });

  it('refuses a state change that is not provably same-origin', async () => {
    const teacher = await signIn('t19@example.com', 'TEACHER');
    const student = await signIn('s19@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/enrollments',
      headers: { cookie: cookieHeader(student.token) },
      payload: { courseId },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('csrf.sameOrigin');
    // It never reached the policy gate, so nothing was written.
    expect(await prisma.enrollment.count({ where: { courseId } })).toBe(0);
  });
});

describe('listing', () => {
  it('scopes rows to the caller, and a filter narrows but never widens', async () => {
    const owner = await signIn('t20@example.com', 'TEACHER');
    const stranger = await signIn('t20b@example.com', 'TEACHER');
    const admin = await signIn('a20@example.com', 'ADMIN');
    const one = await signIn('s20a@example.com', 'STUDENT');
    const two = await signIn('s20b@example.com', 'STUDENT');

    const courseId = await makeCourse(owner.id);
    await post('/', { courseId }, one.token);
    await post('/', { courseId }, two.token);

    const mine = await get('/', one.token);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data).toHaveLength(1);
    expect(mine.json().data[0].student.id).toBe(one.id);
    expect(mine.json().meta).toMatchObject({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });

    // A student asking for someone else's rows still sees their own scope only.
    const widened = await get(`/?studentId=${two.id}`, one.token);
    expect(widened.json().data).toHaveLength(0);

    expect((await get('/', owner.token)).json().data).toHaveLength(2);
    expect((await get('/', stranger.token)).json().data).toHaveLength(0);
    expect((await get('/', admin.token)).json().data).toHaveLength(2);

    const filtered = await get('/?status=PENDING&limit=1', owner.token);
    expect(filtered.json().data).toHaveLength(1);
    expect(filtered.json().meta).toMatchObject({ total: 2, totalPages: 2, hasNext: true });
  });

  it('rejects a non-numeric limit with a field path rather than a silent NaN', async () => {
    const student = await signIn('s21@example.com', 'STUDENT');

    const response = await get('/?limit=abc', student.token);
    expect(response.statusCode).toBe(422);
    expect(JSON.stringify(response.json())).toContain('limit');
  });
});
