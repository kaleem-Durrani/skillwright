import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { hashPassword } from '../src/lib/password.js';
import {
  buildApp,
  cookieHeader,
  createDepartment,
  originHeaders,
  prisma,
  resetDatabase,
  resetRateLimits,
  sessionCookie,
} from './setup.js';

const PASSWORD = 'correct-horse-battery-staple';

let app: FastifyInstance;
let departmentId: string;
/** Hashed once: argon2 is deliberately expensive, and every account here shares it. */
let passwordHash: string;

beforeAll(async () => {
  app = await buildApp();
  passwordHash = await hashPassword(PASSWORD);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  // `Course.teacher` is onDelete: Restrict (schema.prisma), so the user delete inside
  // resetDatabase() fails while any course still points at a teacher. Enrollments and
  // resources cascade off the course, so one delete is enough.
  await prisma.course.deleteMany({});
  await resetDatabase();
  await resetRateLimits(app.redis);
  departmentId = await createDepartment();
});

// --- helpers ---------------------------------------------------------------

type TestRole = 'STUDENT' | 'TEACHER' | 'ADMIN';

/** Provisioned directly: only students self-register, and this suite needs all three roles. */
async function createAccount(email: string, role: TestRole, name = 'Test Person'): Promise<string> {
  const user = await prisma.user.create({
    data: { email, name, role, status: 'ACTIVE', passwordHash },
  });
  return user.id;
}

async function login(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { ...originHeaders },
    payload: { email, password: PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  const token = sessionCookie(response);
  expect(token).toBeTruthy();
  return token as string;
}

/** Creates the account and returns the session cookie for it. */
async function signedIn(email: string, role: TestRole, name?: string): Promise<string> {
  await createAccount(email, role, name);
  return login(email);
}

function get(url: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/courses${url}`,
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

/** Every non-GET must look same-origin or csrf.plugin.ts:20-30 rejects it first. */
function send(
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload: unknown,
  cookie?: string,
  headers: Record<string, string> = originHeaders,
) {
  return app.inject({
    method,
    url: `/api/v1/courses${url}`,
    headers: { ...headers, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
    payload: payload as Record<string, unknown>,
  });
}

function coursePayload(overrides: Record<string, unknown> = {}) {
  return {
    code: 'WELD-101',
    name: 'Welding Fundamentals',
    departmentId,
    duration: { value: 6, unit: 'WEEK' },
    capacity: 12,
    ...overrides,
  };
}

async function createCourse(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; slug: string }> {
  const response = await send('POST', '/', coursePayload(overrides), cookie);
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; slug: string };
}

async function publish(id: string, cookie: string): Promise<void> {
  const response = await send('POST', `/${id}/publish`, { published: true }, cookie);
  expect(response.statusCode).toBe(200);
}

/** Creates and publishes it — the state every caller below can see, whoever they are. */
async function publishedCourse(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const course = await createCourse(cookie, overrides);
  await publish(course.id, cookie);
  return course.id;
}

/**
 * A student applying through the real route rather than a direct insert: the row the
 * catalogue's badge reads has to be the one the browse -> request -> approve flow writes.
 * Returns the enrollment id so a test can move it past PENDING.
 */
async function apply(courseId: string, cookie: string): Promise<string> {
  const response = await send('POST', `/${courseId}/enrollments`, undefined, cookie);
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

/** One catalogue row, as the SPA reads it. */
interface ListItem {
  code: string;
  description: string | null;
  viewerEnrollmentStatus: string | null;
}

function itemsOf(response: { json: () => { data: ListItem[] } }): ListItem[] {
  return response.json().data;
}

// --- tests -----------------------------------------------------------------

describe('GET /courses', () => {
  it('serves an anonymous visitor only the published courses', async () => {
    const teacher = await signedIn('teacher@example.com', 'TEACHER', 'Tessa Teacher');
    const live = await createCourse(teacher, { code: 'WELD-101', name: 'Welding Fundamentals' });
    await createCourse(teacher, { code: 'WELD-202', name: 'Welding Advanced' });
    await publish(live.id, teacher);

    const response = await get('');
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].code).toBe('WELD-101');
    expect(body.meta).toMatchObject({ page: 1, total: 1, totalPages: 1, hasNext: false });
  });

  it('shows a teacher their own draft and hides another teacher’s', async () => {
    const mine = await signedIn('mine@example.com', 'TEACHER', 'Mine');
    const theirs = await signedIn('theirs@example.com', 'TEACHER', 'Theirs');

    await createCourse(mine, { code: 'MINE-11', name: 'My Draft' });
    await createCourse(theirs, { code: 'THEM-11', name: 'Their Draft' });

    const response = await get('', mine);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((course: { code: string }) => course.code)).toEqual([
      'MINE-11',
    ]);
  });

  it('serves the shared envelope, not the flat client type', async () => {
    const teacher = await signedIn('shape@example.com', 'TEACHER', 'Tessa Teacher');
    const course = await createCourse(teacher);
    await publish(course.id, teacher);

    const body = await get('').then((response) => response.json());
    const [summary] = body.data;

    // The shape courseSummarySchema describes — nested department/teacher/duration and
    // the two derived capacity fields. `apps/web/src/lib/types.ts` disagrees with all
    // of this, which is the point.
    expect(summary.department).toMatchObject({ id: departmentId, slug: 'welding' });
    expect(summary.teacher).toMatchObject({ name: 'Tessa Teacher', role: 'TEACHER' });
    expect(summary.duration).toEqual({ value: 6, unit: 'WEEK' });
    expect(summary).toMatchObject({ capacity: 12, approvedCount: 0, seatsRemaining: 12 });
    expect(summary.isFull).toBe(false);
    expect(summary.slug).toBe('welding-fundamentals');
    expect(summary.publishedAt).toEqual(expect.any(String));
  });

  it('pages with the shared meta block', async () => {
    const teacher = await signedIn('pager@example.com', 'TEACHER');
    for (const code of ['AAA-11', 'BBB-22', 'CCC-33']) {
      const course = await createCourse(teacher, { code, name: `Course ${code}` });
      await publish(course.id, teacher);
    }

    const response = await get('?limit=2&page=1');
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(2);
    expect(response.json().meta).toEqual({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
      hasNext: true,
      hasPrev: false,
    });
  });

  it('rejects a non-numeric limit with a field path rather than a NaN query', async () => {
    const response = await get('?limit=abc');
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  });
});

/**
 * The catalogue row is `courseListItemSchema`, not `courseSummarySchema`: the browse
 * screen renders a blurb and a badge saying whether the viewer has already applied.
 * `viewerEnrollmentStatus` is relative to the CALLER, so every assertion below fixes who
 * is asking as carefully as it fixes what is stored.
 */
describe('GET /courses — the catalogue row', () => {
  it('carries the blurb, and no badge at all for an anonymous visitor', async () => {
    const teacher = await signedIn('blurb@example.com', 'TEACHER');
    await publishedCourse(teacher, { description: 'Hot work, cold steel.' });

    const [item] = itemsOf(await get(''));
    expect(item?.description).toBe('Hot work, cold steel.');
    // Null, and present: an anonymous caller has no enrollment for the field to be
    // relative to, and the SPA renders `null` as "not applied" rather than crashing on
    // an absent key.
    expect(item?.viewerEnrollmentStatus).toBeNull();
  });

  it('serves null description for a course that has none', async () => {
    const teacher = await signedIn('noblurb@example.com', 'TEACHER');
    await publishedCourse(teacher);

    expect(itemsOf(await get(''))[0]?.description).toBeNull();
  });

  it('shows a student the status of a course they have applied to', async () => {
    const teacher = await signedIn('applied-teacher@example.com', 'TEACHER');
    const courseId = await publishedCourse(teacher);
    const student = await signedIn('applied-student@example.com', 'STUDENT');
    await apply(courseId, student);

    expect(itemsOf(await get('', student))[0]?.viewerEnrollmentStatus).toBe('PENDING');
  });

  it('reports a decided status, not only the pending one', async () => {
    const teacher = await signedIn('decided-teacher@example.com', 'TEACHER');
    const courseId = await publishedCourse(teacher);
    const student = await signedIn('decided-student@example.com', 'STUDENT');
    const enrollmentId = await apply(courseId, student);

    // Decided directly: the approval transaction belongs to the enrollments module, and
    // this assertion is about what the catalogue reads back, not about how it got there.
    await prisma.enrollment.update({ where: { id: enrollmentId }, data: { status: 'APPROVED' } });

    expect(itemsOf(await get('', student))[0]?.viewerEnrollmentStatus).toBe('APPROVED');
  });

  it('leaves the badge null for a student who has not applied', async () => {
    const teacher = await signedIn('unapplied-teacher@example.com', 'TEACHER');
    await publishedCourse(teacher);
    const student = await signedIn('unapplied-student@example.com', 'STUDENT');

    expect(itemsOf(await get('', student))[0]?.viewerEnrollmentStatus).toBeNull();
  });

  it('leaves the badge null for a teacher and for an admin, who never enrol', async () => {
    const teacher = await signedIn('badge-teacher@example.com', 'TEACHER');
    await publishedCourse(teacher);
    const admin = await signedIn('badge-admin@example.com', 'ADMIN');

    expect(itemsOf(await get('', teacher))[0]?.viewerEnrollmentStatus).toBeNull();
    expect(itemsOf(await get('', admin))[0]?.viewerEnrollmentStatus).toBeNull();
  });

  /**
   * What this test can and cannot prove about the N+1.
   *
   * The service resolves the whole page with ONE `enrollment.findMany` keyed by
   * `courseId: { in: ids }`, so its query count is flat in the page size. This suite
   * cannot count queries to say so directly: Prisma emits query events only from
   * `basePrisma`, and `@skillwright/db` exports only the audit-extended `prisma`, which
   * has no `$on`. Spying on the delegate would be worse than nothing — it asserts a call
   * shape rather than a cost, and it breaks on any Prisma internals change.
   *
   * So the guard is this five-row page: it fails on a per-row lookup that gets any row
   * wrong, and it fails on any rewrite that reads a row belonging to another student. A
   * cost-only regression that stayed correct would need a real query-count assertion,
   * which needs `basePrisma` exported from `@skillwright/db` first.
   */
  it('resolves the badge per row across a whole page, and per viewer', async () => {
    const teacher = await signedIn('page-teacher@example.com', 'TEACHER');
    const pending = await publishedCourse(teacher, { code: 'AAA-11', name: 'Course AAA-11' });
    const seated = await publishedCourse(teacher, { code: 'CCC-33', name: 'Course CCC-33' });
    for (const code of ['BBB-22', 'DDD-44', 'EEE-55']) {
      await publishedCourse(teacher, { code, name: `Course ${code}` });
    }

    const student = await signedIn('page-student@example.com', 'STUDENT');
    await apply(pending, student);
    const approved = await apply(seated, student);
    // Decided directly: the approval transaction belongs to the enrollments module.
    await prisma.enrollment.update({ where: { id: approved }, data: { status: 'APPROVED' } });

    const rows = itemsOf(await get('?limit=5', student));
    expect(rows).toHaveLength(5);

    // Looked up by code rather than by index: the page is ordered by createdAt, and an
    // assertion that depends on the sort would pass for the wrong reason.
    const badgeFor = (code: string): string | null | undefined =>
      rows.find((row) => row.code === code)?.viewerEnrollmentStatus;

    expect(badgeFor('AAA-11')).toBe('PENDING');
    expect(badgeFor('CCC-33')).toBe('APPROVED');
    expect(badgeFor('BBB-22')).toBeNull();
    expect(badgeFor('DDD-44')).toBeNull();
    expect(badgeFor('EEE-55')).toBeNull();

    // A second student sees their OWN answer for the same five courses — the batched
    // lookup is scoped to the caller, so one student's application can never surface on
    // another student's page.
    const bystander = await signedIn('page-bystander@example.com', 'STUDENT');
    const theirs = itemsOf(await get('?limit=5', bystander));
    expect(theirs).toHaveLength(5);
    expect(theirs.every((row) => row.viewerEnrollmentStatus === null)).toBe(true);
  });
});

describe('POST /courses', () => {
  it('refuses a student, naming the rule that denied it', async () => {
    const student = await signedIn('student@example.com', 'STUDENT');

    const response = await send('POST', '/', coursePayload(), student);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain('rule: STUDENT:deny');
  });

  it('refuses an anonymous caller', async () => {
    const response = await send('POST', '/', coursePayload());
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
  });

  it('refuses a state change that is not same-origin', async () => {
    const teacher = await signedIn('csrf@example.com', 'TEACHER');

    const response = await send('POST', '/', coursePayload(), teacher, {});
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: csrf.sameOrigin');
  });

  it('ignores teacherId for a teacher, who always gets themself', async () => {
    const otherId = await createAccount('other@example.com', 'TEACHER', 'Other Teacher');
    const teacher = await signedIn('owner@example.com', 'TEACHER', 'Owner Teacher');

    const response = await send('POST', '/', coursePayload({ teacherId: otherId }), teacher);
    expect(response.statusCode).toBe(201);
    expect(response.json().teacher.name).toBe('Owner Teacher');
  });

  it('honours teacherId for an admin', async () => {
    const teacherId = await createAccount('assigned@example.com', 'TEACHER', 'Assigned Teacher');
    const admin = await signedIn('admin@example.com', 'ADMIN', 'Ada Admin');

    const response = await send('POST', '/', coursePayload({ teacherId }), admin);
    expect(response.statusCode).toBe(201);
    expect(response.json().teacher.id).toBe(teacherId);
    expect(response.json().publishedAt).toBeNull();
  });

  it('turns an unknown departmentId into a 422 with a field path', async () => {
    const teacher = await signedIn('fk@example.com', 'TEACHER');

    const response = await send(
      'POST',
      '/',
      coursePayload({ departmentId: 'ckzzzzzzzzzzzzzzzzzzzzzzz' }),
      teacher,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual({
      path: 'departmentId',
      message: 'Unknown department',
    });
  });

  it('rejects a malformed course code before the database sees it', async () => {
    const teacher = await signedIn('code@example.com', 'TEACHER');

    const response = await send('POST', '/', coursePayload({ code: 'welding' }), teacher);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /courses/:id', () => {
  it('lets the owning teacher read their own draft', async () => {
    const teacher = await signedIn('detail@example.com', 'TEACHER');
    const course = await createCourse(teacher);

    const response = await get(`/${course.id}`, teacher);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      resourceCount: 0,
      syllabusUrl: null,
      viewerEnrollmentStatus: null,
    });
  });

  it('refuses an anonymous visitor a draft course', async () => {
    const teacher = await signedIn('hidden@example.com', 'TEACHER');
    const course = await createCourse(teacher);

    const response = await get(`/${course.id}`);
    expect(response.statusCode).toBe(401);
  });

  it('refuses a student a draft course, naming the composed rule', async () => {
    const teacher = await signedIn('draft@example.com', 'TEACHER');
    const course = await createCourse(teacher);
    const student = await signedIn('reader@example.com', 'STUDENT');

    const response = await get(`/${course.id}`, student);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: STUDENT:or(isPublished, enrolledApproved)');
  });
});

describe('PATCH /courses/:id', () => {
  it('refuses a teacher patching another teacher’s course', async () => {
    const owner = await signedIn('owner2@example.com', 'TEACHER', 'Owner');
    const intruder = await signedIn('intruder@example.com', 'TEACHER', 'Intruder');
    const course = await createCourse(owner);

    const response = await send('PATCH', `/${course.id}`, { name: 'Hijacked' }, intruder);

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain('rule: TEACHER:ownsCourse');

    const untouched = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(untouched.name).toBe('Welding Fundamentals');
  });

  it('lets the owning teacher patch it', async () => {
    const owner = await signedIn('owner3@example.com', 'TEACHER');
    const course = await createCourse(owner);

    const response = await send('PATCH', `/${course.id}`, { name: 'Welding Reworked' }, owner);
    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('Welding Reworked');
  });

  it('lets an admin patch a course they do not own', async () => {
    const owner = await signedIn('owner4@example.com', 'TEACHER');
    const course = await createCourse(owner);
    const admin = await signedIn('admin2@example.com', 'ADMIN');

    const response = await send('PATCH', `/${course.id}`, { capacity: 30 }, admin);
    expect(response.statusCode).toBe(200);
    expect(response.json().capacity).toBe(30);
    expect(response.json().seatsRemaining).toBe(30);
  });

  it('refuses to lower capacity below the approved count', async () => {
    const owner = await signedIn('capacity@example.com', 'TEACHER');
    const course = await createCourse(owner, { capacity: 10 });
    // Seated directly: the approval transaction belongs to the enrollments module, and
    // this assertion is about the guard that runs before the DB CHECK.
    await prisma.course.update({ where: { id: course.id }, data: { approvedCount: 4 } });

    const response = await send('PATCH', `/${course.id}`, { capacity: 3 }, owner);
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual({
      path: 'capacity',
      message: 'Capacity cannot be lower than the approved count',
    });
  });

  it('compares a patched end date against the stored start date', async () => {
    const owner = await signedIn('dates@example.com', 'TEACHER');
    const course = await createCourse(owner, { startDate: '2026-09-01T09:00:00.000Z' });

    const response = await send(
      'PATCH',
      `/${course.id}`,
      { endDate: '2026-08-01T09:00:00.000Z' },
      owner,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual({
      path: 'endDate',
      message: 'The end date must come after the start date.',
    });
  });

  it('ignores teacherId in the body for a teacher', async () => {
    const otherId = await createAccount('other2@example.com', 'TEACHER', 'Other Teacher');
    const owner = await signedIn('owner5@example.com', 'TEACHER', 'Owner Teacher');
    const course = await createCourse(owner);

    const response = await send('PATCH', `/${course.id}`, { teacherId: otherId }, owner);
    expect(response.statusCode).toBe(200);
    expect(response.json().teacher.name).toBe('Owner Teacher');
  });
});

describe('POST /courses/:id/publish', () => {
  it('publishes and unpublishes through the one verb', async () => {
    const owner = await signedIn('publisher@example.com', 'TEACHER');
    const course = await createCourse(owner);

    const published = await send('POST', `/${course.id}/publish`, { published: true }, owner);
    expect(published.statusCode).toBe(200);
    expect(published.json().publishedAt).toEqual(expect.any(String));

    const withdrawn = await send('POST', `/${course.id}/publish`, { published: false }, owner);
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json().publishedAt).toBeNull();
  });

  it('refuses a teacher who does not own the course', async () => {
    const owner = await signedIn('owner6@example.com', 'TEACHER');
    const intruder = await signedIn('intruder2@example.com', 'TEACHER');
    const course = await createCourse(owner);

    const response = await send('POST', `/${course.id}/publish`, { published: true }, intruder);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: TEACHER:ownsCourse');
  });
});

describe('DELETE /courses/:id', () => {
  it('soft-deletes and disappears from every read', async () => {
    const owner = await signedIn('deleter@example.com', 'TEACHER');
    const admin = await signedIn('admin3@example.com', 'ADMIN');
    const course = await createCourse(owner);
    await publish(course.id, owner);

    const response = await send('DELETE', `/${course.id}`, undefined, owner);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');

    const row = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(row.deletedAt).not.toBeNull();

    expect((await get('')).json().data).toHaveLength(0);
    // An admin passes the gate unconditionally, so this 404 is the service's soft-delete
    // filter rather than a policy denial wearing a different status.
    expect((await get(`/${course.id}`, admin)).statusCode).toBe(404);
  });

  it('refuses a teacher who does not own the course', async () => {
    const owner = await signedIn('owner7@example.com', 'TEACHER');
    const intruder = await signedIn('intruder3@example.com', 'TEACHER');
    const course = await createCourse(owner);

    const response = await send('DELETE', `/${course.id}`, undefined, intruder);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: TEACHER:ownsCourse');
  });
});

describe('enrollments under a course', () => {
  it('refuses an anonymous caller the roster', async () => {
    const owner = await signedIn('roster@example.com', 'TEACHER');
    const course = await createCourse(owner);
    await publish(course.id, owner);

    const response = await get(`/${course.id}/enrollments`);
    expect(response.statusCode).toBe(401);
  });

  it('refuses a teacher the roster of a course they do not own', async () => {
    const owner = await signedIn('owner8@example.com', 'TEACHER');
    const intruder = await signedIn('intruder4@example.com', 'TEACHER');
    const course = await createCourse(owner);
    await publish(course.id, owner);

    const response = await get(`/${course.id}/enrollments`, intruder);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: TEACHER:ownsCourse');
  });

  it('refuses a teacher who tries to enrol in a course', async () => {
    const owner = await signedIn('owner9@example.com', 'TEACHER');
    const course = await createCourse(owner);
    await publish(course.id, owner);

    const response = await send('POST', `/${course.id}/enrollments`, undefined, owner);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: TEACHER:deny');
  });

  it('refuses a student a place on a draft course', async () => {
    const owner = await signedIn('owner10@example.com', 'TEACHER');
    const student = await signedIn('applicant@example.com', 'STUDENT');
    const course = await createCourse(owner);

    const response = await send('POST', `/${course.id}/enrollments`, undefined, student);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: STUDENT:isPublished');
  });
});
