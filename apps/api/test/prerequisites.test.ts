import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// app.ts:51-52: "Anything that holds an instance built here — main.ts, the integration
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

/**
 * Phase 6 prerequisites, end to end: an admin sets the ladder rung with PATCH, the
 * catalogue names it without a second fetch, and `enrollment:request` enforces the
 * rule — refusing the student who never climbed it (403 with the policy rule tag)
 * and seating the one who did.
 *
 * The subject-loader half is LESSONS-LEARNED #31: a subject that omits
 * `completedCourseIds` denies EVERY gated request silently. The "allowed when
 * completed" test is therefore a regression pin on the loader as much as on the
 * rule — it can only pass if `loadCourseEnrollmentSubject` and
 * `loadRequestedCourseSubject` actually carry the field.
 */

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
function send(method: 'POST' | 'PATCH', url: string, payload: unknown, cookie?: string) {
  return app.inject({
    method,
    url: `/api/v1/courses${url}`,
    headers: { ...originHeaders, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
    payload: payload as Record<string, unknown>,
  });
}

function get(url: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/courses${url}`,
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

/** The flat enrollment route — `POST /api/v1/enrollments`, the OTHER `enrollment:request` gate. */
function postEnrollment(payload: unknown, cookie: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/enrollments',
    headers: { ...originHeaders, cookie: cookieHeader(cookie) },
    payload: payload as Record<string, unknown>,
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
  options: { published?: boolean } = {},
): Promise<{ id: string; code: string; name: string }> {
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
      capacity: 10,
      publishedAt: options.published === false ? null : new Date(),
    },
  });
  return { id: course.id, code: course.code, name: course.name };
}

/** Sets the rung through the real route, so the validation below is the tested path. */
function setPrerequisite(courseId: string, prerequisiteCourseId: string | null, cookie: string) {
  return send('PATCH', `/${courseId}`, { prerequisiteCourseId }, cookie);
}

/** Applies through the course-nested route and approves through the enrollment route. */
async function completeCourse(student: Person, teacher: Person, courseId: string): Promise<void> {
  const applied = await send('POST', `/${courseId}/enrollments`, undefined, student.token);
  expect(applied.statusCode).toBe(201);
  const approved = await app.inject({
    method: 'POST',
    url: `/api/v1/enrollments/${(applied.json() as { id: string }).id}/approve`,
    headers: { ...originHeaders, cookie: cookieHeader(teacher.token) },
    payload: {},
  });
  expect(approved.statusCode).toBe(200);
}

// --- setting and clearing the prerequisite ---------------------------------

describe('PATCH /courses/:id sets the prerequisite', () => {
  it('stores the pointer and returns the named block', async () => {
    const admin = await signIn('p6-admin@example.com', 'ADMIN');
    const level1 = await makeCourse(admin.id);
    const level2 = await makeCourse(admin.id);

    const response = await setPrerequisite(level2.id, level1.id, admin.token);
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.prerequisiteCourseId).toBe(level1.id);
    // coursePrerequisiteSchema (course.ts) — enough to name "Requires: SMAW Level 1".
    expect(body.prerequisite).toEqual({ id: level1.id, code: level1.code, name: level1.name });

    // The detail DTO carries the same block...
    const detail = await get(`/${level2.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().prerequisiteCourseId).toBe(level1.id);
    expect(detail.json().prerequisite).toEqual({
      id: level1.id,
      code: level1.code,
      name: level1.name,
    });

    // ...and so does the catalogue row, without a per-card fetch.
    const list = await get('/');
    const row = (list.json() as { data: Array<{ id: string }> }).data.find(
      (candidate) => candidate.id === level2.id,
    );
    expect(row).toBeDefined();
  });

  it('clears the prerequisite with an explicit null', async () => {
    const admin = await signIn('p6-admin@example.com', 'ADMIN');
    const level1 = await makeCourse(admin.id);
    const level2 = await makeCourse(admin.id);
    expect((await setPrerequisite(level2.id, level1.id, admin.token)).statusCode).toBe(200);

    const cleared = await setPrerequisite(level2.id, null, admin.token);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().prerequisiteCourseId).toBeNull();
    expect(cleared.json().prerequisite).toBeNull();

    // A course with no prerequisite stays requestable by anyone.
    const student = await signIn('p6-clear-student@example.com', 'STUDENT');
    const request = await send('POST', `/${level2.id}/enrollments`, undefined, student.token);
    expect(request.statusCode).toBe(201);
  });

  it('refuses an unknown prerequisite id with a field-level 422', async () => {
    const admin = await signIn('p6-admin@example.com', 'ADMIN');
    const course = await makeCourse(admin.id);

    const response = await setPrerequisite(course.id, 'crs_missing', admin.token);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(response.json().errors).toContainEqual({
      path: 'prerequisiteCourseId',
      message: 'Unknown course',
    });
  });

  it('refuses a self-reference', async () => {
    const admin = await signIn('p6-admin@example.com', 'ADMIN');
    const course = await makeCourse(admin.id);

    const response = await setPrerequisite(course.id, course.id, admin.token);
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual({
      path: 'prerequisiteCourseId',
      message: 'A course cannot be its own prerequisite',
    });
  });

  it('refuses a two-course cycle', async () => {
    const admin = await signIn('p6-admin@example.com', 'ADMIN');
    const a = await makeCourse(admin.id);
    const b = await makeCourse(admin.id);
    expect((await setPrerequisite(a.id, b.id, admin.token)).statusCode).toBe(200);

    const response = await setPrerequisite(b.id, a.id, admin.token);
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual({
      path: 'prerequisiteCourseId',
      message: 'Setting this prerequisite would create a cycle',
    });
  });

  it('walks past depth two and refuses a three-course cycle', async () => {
    const admin = await signIn('p6-admin@example.com', 'ADMIN');
    const a = await makeCourse(admin.id);
    const b = await makeCourse(admin.id);
    const c = await makeCourse(admin.id);
    expect((await setPrerequisite(a.id, b.id, admin.token)).statusCode).toBe(200);
    expect((await setPrerequisite(b.id, c.id, admin.token)).statusCode).toBe(200);

    const response = await setPrerequisite(c.id, a.id, admin.token);
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual({
      path: 'prerequisiteCourseId',
      message: 'Setting this prerequisite would create a cycle',
    });
  });

  it('allows lengthening a chain that does not loop back', async () => {
    const admin = await signIn('p6-admin@example.com', 'ADMIN');
    const a = await makeCourse(admin.id);
    const b = await makeCourse(admin.id);
    const c = await makeCourse(admin.id);
    expect((await setPrerequisite(a.id, b.id, admin.token)).statusCode).toBe(200);
    expect((await setPrerequisite(b.id, c.id, admin.token)).statusCode).toBe(200);

    // Pointing c at a NEW rung lengthens the ladder (a -> b -> c -> d); pointing
    // c back at b would close the b<->c loop the cycle test above refuses.
    const d = await makeCourse(admin.id);
    const response = await setPrerequisite(c.id, d.id, admin.token);
    expect(response.statusCode).toBe(200);
  });
});

// --- enforcement ------------------------------------------------------------

describe('enrollment:request enforces the prerequisite', () => {
  it('refuses a student who never completed the prerequisite, naming the rule', async () => {
    const teacher = await signIn('p6-t@example.com', 'TEACHER');
    const student = await signIn('p6-s@example.com', 'STUDENT');
    const level1 = await makeCourse(teacher.id);
    const level2 = await makeCourse(teacher.id);
    const admin = await signIn('p6-ta@example.com', 'ADMIN');
    expect((await setPrerequisite(level2.id, level1.id, admin.token)).statusCode).toBe(200);

    const response = await send('POST', `/${level2.id}/enrollments`, undefined, student.token);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    // The refusal carries the exact policy rule tag, same shape as every other gate.
    expect(response.json().detail).toContain('STUDENT:and(isPublished, hasCompletedPrerequisite)');
  }, 20_000);

  it('seats a student who completed the prerequisite (the #31 loader pin)', async () => {
    const teacher = await signIn('p6-t2@example.com', 'TEACHER');
    const student = await signIn('p6-s2@example.com', 'STUDENT');
    const admin = await signIn('p6-ta2@example.com', 'ADMIN');
    const level1 = await makeCourse(teacher.id);
    const level2 = await makeCourse(teacher.id);
    expect((await setPrerequisite(level2.id, level1.id, admin.token)).statusCode).toBe(200);

    // APPROVED enrollment on the prerequisite — the fixture the rule reads.
    await completeCourse(student, teacher, level1.id);

    // This can only pass if the subject loader carried `completedCourseIds`;
    // a subject missing the field denies exactly like an unmet requirement.
    const nested = await send('POST', `/${level2.id}/enrollments`, undefined, student.token);
    expect(nested.statusCode).toBe(201);
    expect(nested.json().status).toBe('PENDING');

    // The flat route runs the OTHER loader (`loadRequestedCourseSubject`) — both gates
    // must agree, so a fresh student completes the prerequisite and applies there.
    const other = await signIn('p6-s2b@example.com', 'STUDENT');
    await completeCourse(other, teacher, level1.id);
    const flat = await postEnrollment({ courseId: level2.id }, other.token);
    expect(flat.statusCode).toBe(201);
    expect(flat.json().status).toBe('PENDING');
  }, 20_000);

  it('counts only APPROVED enrollments as completion', async () => {
    const teacher = await signIn('p6-t3@example.com', 'TEACHER');
    const student = await signIn('p6-s3@example.com', 'STUDENT');
    const admin = await signIn('p6-ta3@example.com', 'ADMIN');
    const level1 = await makeCourse(teacher.id);
    const level2 = await makeCourse(teacher.id);
    expect((await setPrerequisite(level2.id, level1.id, admin.token)).statusCode).toBe(200);

    // PENDING on the prerequisite is a request, not a seat — same reading of
    // "completed" as `enrolledApproved` everywhere else in the policy.
    const applied = await send('POST', `/${level1.id}/enrollments`, undefined, student.token);
    expect(applied.statusCode).toBe(201);

    const response = await send('POST', `/${level2.id}/enrollments`, undefined, student.token);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('STUDENT:and(isPublished, hasCompletedPrerequisite)');
  }, 20_000);

  it('still refuses a draft gated course, publication being the other conjunct', async () => {
    const teacher = await signIn('p6-t4@example.com', 'TEACHER');
    const student = await signIn('p6-s4@example.com', 'STUDENT');
    const admin = await signIn('p6-ta4@example.com', 'ADMIN');
    const level1 = await makeCourse(teacher.id);
    const level2 = await makeCourse(teacher.id, { published: false });
    expect((await setPrerequisite(level2.id, level1.id, admin.token)).statusCode).toBe(200);
    await completeCourse(student, teacher, level1.id);

    const response = await send('POST', `/${level2.id}/enrollments`, undefined, student.token);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('STUDENT:and(isPublished, hasCompletedPrerequisite)');
  }, 20_000);

  it('lets an admin enroll a student directly past the gate, as policy allows', async () => {
    const teacher = await signIn('p6-t5@example.com', 'TEACHER');
    const admin = await signIn('p6-ta5@example.com', 'ADMIN');
    const student = await signIn('p6-s5@example.com', 'STUDENT');
    const level1 = await makeCourse(teacher.id);
    const level2 = await makeCourse(teacher.id);
    expect((await setPrerequisite(level2.id, level1.id, admin.token)).statusCode).toBe(200);

    const response = await postEnrollment(
      { courseId: level2.id, studentId: student.id },
      admin.token,
    );
    expect(response.statusCode).toBe(201);
  }, 20_000);
});
