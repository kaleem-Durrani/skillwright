import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// app.ts:51-52: "Anything that holds an instance built here — main.ts, the integration
// tests — should name this type. Plain FastifyInstance is a type error, not a
// widening." It was a type error the whole time; nothing typechecked test/ until
// tsconfig.test.json existed.
import type { AppInstance } from '../src/app.js';
import * as notificationsService from '../src/modules/notifications/notifications.service.js';
import type { Prisma } from '@skillwright/db';
import { can, type NotificationTypeValue, type Role } from '@skillwright/shared';
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
  testOutbox,
} from './setup.js';

const PASSWORD = 'correct-horse-battery-staple';

let app: AppInstance;
/** Hashed once: argon2 is deliberately expensive, and every account here shares it. */
let passwordHash: string;
let departmentId: string;
let sequence = 0;

/**
 * The event tests below create courses, resources and announcements. Course holds a
 * Restrict foreign key to User and Department (schema.prisma), so any academic row
 * left behind would make the next `resetDatabase()` — here or in another suite — fail
 * on a foreign-key error. Same clearing enrollments.test.ts does, for the same reason.
 */
async function clearAcademicRows(): Promise<void> {
  await prisma.comment.deleteMany({});
  await prisma.announcement.deleteMany({});
  await prisma.resource.deleteMany({});
  await prisma.enrollment.deleteMany({});
  await prisma.course.deleteMany({});
}

beforeAll(async () => {
  app = await buildApp();
  passwordHash = await hashPassword(PASSWORD);
});

afterAll(async () => {
  await clearAcademicRows();
  await app.close();
});

beforeEach(async () => {
  // `resetDatabase()` never mentions Notification, and does not need to:
  // `Notification.user` is onDelete: Cascade (schema.prisma:598), so deleting every
  // user takes the notifications with it. Adding a delete here would be a second,
  // drifting teardown for a table the shared fixture already handles.
  await clearAcademicRows();
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
async function signedIn(email: string, role: TestRole = 'STUDENT', name?: string): Promise<string> {
  await createAccount(email, role, name);
  return login(email);
}

function get(url: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/notifications${url}`,
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

/** Every non-GET must look same-origin or csrf.plugin.ts:20-30 rejects it first. */
function send(
  url: string,
  payload: unknown,
  cookie?: string,
  headers: Record<string, string> = originHeaders,
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/notifications${url}`,
    headers: { ...headers, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
    payload: payload as Record<string, unknown>,
  });
}

interface SeedOptions {
  type?: NotificationTypeValue;
  title?: string;
  read?: boolean;
  /** Typed as Prisma's json input rather than `unknown` so the malformed-payload case needs no cast. */
  payload?: Prisma.InputJsonValue;
  /** Explicit so ordering assertions do not depend on two `now()` calls landing in different milliseconds. */
  createdAt?: Date;
}

/**
 * Notifications are written by other modules' side effects, not by any endpoint this
 * module exposes, so the fixture writes them directly — the same reason
 * courses.test.ts:342 seats an approved count by hand.
 */
async function seedNotification(userId: string, options: SeedOptions = {}): Promise<string> {
  const row = await prisma.notification.create({
    data: {
      userId,
      type: options.type ?? 'ENROLLMENT_APPROVED',
      payload: options.payload ?? {
        title: options.title ?? 'Enrollment approved',
        body: 'You have a place on Welding Fundamentals.',
      },
      linkPath: '/courses/welding-fundamentals',
      readAt: options.read === true ? new Date() : null,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
  });
  return row.id;
}

// --- fixtures for the seven wired events ------------------------------------

interface Person {
  id: string;
  token: string;
}

/**
 * Registration always produces a STUDENT — auth.service.ts self-registration never
 * chooses a privileged role — so a teacher or admin is a registered account promoted
 * directly on the row, then logged in. Same fixture enrollments.test.ts uses.
 */
async function signIn(email: string, role: Role, name = 'Test Person'): Promise<Person> {
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { ...originHeaders },
        payload: { email, password: PASSWORD, name, departmentId },
      })
    ).statusCode,
  ).toBe(202);

  const code = testOutbox.lastCodeFor(email);
  expect(code).toBeTruthy();
  const verified = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/verify-email',
    headers: { ...originHeaders },
    payload: { email, code },
  });
  expect(verified.statusCode).toBe(200);

  const user = await prisma.user.update({ where: { email }, data: { role } });

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { ...originHeaders },
    payload: { email, password: PASSWORD },
  });
  expect(login.statusCode).toBe(200);
  const token = sessionCookie(login);
  expect(token).toBeTruthy();

  return { id: user.id, token: token as string };
}

/** A published course taught by `teacherId`, created directly like enrollments.test.ts. */
async function makeCourse(teacherId: string): Promise<{ id: string; name: string }> {
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
      publishedAt: new Date(),
    },
    select: { id: true, name: true },
  });
  await prisma.courseOffering.create({ data: { courseId: course.id, capacity: 10 } });
  return course;
}

async function seedEnrollment(
  studentId: string,
  courseId: string,
  status: 'PENDING' | 'APPROVED' | 'WITHDRAWN',
): Promise<{ id: string }> {
  const offering = await prisma.courseOffering.findFirstOrThrow({
    where: { courseId, deletedAt: null },
    select: { id: true },
  });
  return prisma.enrollment.create({
    data: { studentId, offeringId: offering.id, status },
    select: { id: true },
  });
}

/**
 * One injector for every endpoint the event tests touch. GETs carry no CSRF origin;
 * every non-GET must look same-origin or csrf.plugin.ts rejects it first.
 */
function api(
  method: 'GET' | 'POST',
  url: string,
  opts: { person?: Person; payload?: unknown } = {},
) {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      ...(method === 'GET' ? {} : originHeaders),
      ...(opts.person ? { cookie: cookieHeader(opts.person.token) } : {}),
    },
    ...(opts.payload !== undefined ? { payload: opts.payload as Record<string, unknown> } : {}),
  });
}

/** Every notification row a user now holds, oldest first for stable assertions. */
function notificationsFor(userId: string) {
  return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
}

/** The bell's own number, read straight from the table. */
function unreadCountOf(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

// --- tests -----------------------------------------------------------------

describe('the rule these routes rest on', () => {
  it('denies notification:read for someone else’s subject, which is why the rows are filtered', () => {
    const actor = {
      id: 'me',
      role: 'STUDENT',
      status: 'ACTIVE',
      provenance: 'PASSWORD',
    } as const;

    expect(can(actor, 'notification:read', { userId: 'me' })).toEqual({ allowed: true });
    // policy.ts:461-463 — isSelf for all three roles. The gate can only answer yes/no
    // for the caller's own subject, so `scopedWhere` is what stops the list serving
    // another user's rows; this assertion names the rule that makes that necessary.
    expect(can(actor, 'notification:read', { userId: 'someone-else' })).toMatchObject({
      allowed: false,
      rule: 'STUDENT:isSelf',
    });
  });
});

describe('GET /notifications/unread-count', () => {
  it('counts the caller’s unread rows and nobody else’s', async () => {
    const mineId = await createAccount('mine@example.com', 'STUDENT', 'Mine');
    const theirsId = await createAccount('theirs@example.com', 'STUDENT', 'Theirs');
    const cookie = await login('mine@example.com');

    await seedNotification(mineId);
    await seedNotification(mineId);
    await seedNotification(mineId, { read: true });
    await seedNotification(theirsId);
    await seedNotification(theirsId);

    const response = await get('/unread-count', cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ unread: 2 });
  });

  it('refuses an anonymous caller, naming the action that needed a session', async () => {
    const response = await get('/unread-count');
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
    expect(response.json().detail).toContain("'notification:read' requires authentication");
  });
});

describe('GET /notifications', () => {
  it('serves the caller their own rows in the shared envelope', async () => {
    const userId = await createAccount('shape@example.com', 'STUDENT');
    const cookie = await login('shape@example.com');
    await seedNotification(userId, { title: 'Enrollment approved' });

    const response = await get('', cookie);
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.meta).toMatchObject({ page: 1, total: 1, totalPages: 1, hasNext: false });

    const [item] = body.data;
    expect(item).toMatchObject({
      type: 'ENROLLMENT_APPROVED',
      linkPath: '/courses/welding-fundamentals',
      readAt: null,
    });
    expect(item.payload).toMatchObject({
      title: 'Enrollment approved',
      body: 'You have a place on Welding Fundamentals.',
    });
    expect(item.createdAt).toEqual(expect.any(String));
    // notification.ts:30-37 carries no `userId`: every row served is the caller's own,
    // so the id is not on the wire to be confused about.
    expect(item.userId).toBeUndefined();
  });

  it('does not leak another user’s notifications', async () => {
    const mineId = await createAccount('reader@example.com', 'STUDENT', 'Reader');
    const theirsId = await createAccount('other@example.com', 'TEACHER', 'Other');
    const cookie = await login('reader@example.com');

    await seedNotification(mineId, { title: 'Mine' });
    await seedNotification(theirsId, { title: 'Theirs' });
    await seedNotification(theirsId, { title: 'Also theirs' });

    const body = await get('', cookie).then((response) => response.json());
    expect(body.data.map((item: { payload: { title: string } }) => item.payload.title)).toEqual([
      'Mine',
    ]);
    // The count is scoped by the same WHERE, so the meta cannot advertise rows the
    // page is not allowed to contain.
    expect(body.meta.total).toBe(1);
  });

  it('does not leak another user’s rows to an admin either — the subject is the actor, not the role', async () => {
    const studentId = await createAccount('student@example.com', 'STUDENT');
    await createAccount('admin@example.com', 'ADMIN', 'Ada Admin');
    const admin = await login('admin@example.com');

    await seedNotification(studentId, { title: 'Not for the admin' });

    const body = await get('', admin).then((response) => response.json());
    // policy.ts:463 — ADMIN is `isSelf` here, not `allow`. An admin reads their own
    // bell like everyone else.
    expect(body.data).toHaveLength(0);
    expect(body.meta.total).toBe(0);
  });

  it('filters to the unread rows with unreadOnly=true', async () => {
    const userId = await createAccount('unread@example.com', 'STUDENT');
    const cookie = await login('unread@example.com');
    await seedNotification(userId, { title: 'Still unread' });
    await seedNotification(userId, { title: 'Already read', read: true });

    const body = await get('?unreadOnly=true', cookie).then((response) => response.json());
    expect(body.data).toHaveLength(1);
    expect(body.data[0].payload.title).toBe('Still unread');
  });

  it('filters by type', async () => {
    const userId = await createAccount('typed@example.com', 'STUDENT');
    const cookie = await login('typed@example.com');
    await seedNotification(userId, { type: 'MESSAGE_RECEIVED', title: 'A message' });
    await seedNotification(userId, { type: 'ENROLLMENT_APPROVED', title: 'A place' });

    const body = await get('?type=MESSAGE_RECEIVED', cookie).then((response) => response.json());
    expect(body.data).toHaveLength(1);
    expect(body.data[0].type).toBe('MESSAGE_RECEIVED');
  });

  it('rejects an unknown type with a field path rather than an empty page', async () => {
    const cookie = await signedIn('badtype@example.com');

    const response = await get('?type=NOT_A_TYPE', cookie);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  });

  it('falls back to the default order for an unrecognised sort instead of 422ing', async () => {
    const userId = await createAccount('sorter@example.com', 'STUDENT');
    const cookie = await login('sorter@example.com');
    await seedNotification(userId, { title: 'Older', createdAt: new Date('2026-01-01T00:00:00Z') });
    await seedNotification(userId, { title: 'Newer', createdAt: new Date('2026-02-01T00:00:00Z') });

    // `sort` is free-form text (pagination.ts:16). `userId` is a real column that is
    // deliberately NOT in the whitelist, so this proves the whitelist is consulted
    // rather than the string being interpolated into an orderBy key.
    const response = await get('?sort=userId', cookie);
    expect(response.statusCode).toBe(200);
    expect(
      response.json().data.map((item: { payload: { title: string } }) => item.payload.title),
    ).toEqual(['Newer', 'Older']);
  });

  it('pages with the shared meta block', async () => {
    const userId = await createAccount('pager@example.com', 'STUDENT');
    const cookie = await login('pager@example.com');
    for (const title of ['One', 'Two', 'Three']) await seedNotification(userId, { title });

    const response = await get('?limit=2&page=1', cookie);
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

  it('refuses an anonymous caller', async () => {
    const response = await get('');
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
  });

  it('refuses an unverified account through the central session gate, not a route check', async () => {
    // The account logs in, then loses ACTIVE. auth.plugin.ts:69-71 is what refuses the
    // next request; no route in this module re-checks the status (TRAP 5).
    await createAccount('pending@example.com', 'STUDENT');
    const cookie = await login('pending@example.com');
    await prisma.user.update({
      where: { email: 'pending@example.com' },
      data: { status: 'PENDING_VERIFICATION' },
    });

    const response = await get('', cookie);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('renders a payload that does not match the schema blank rather than 500ing the page', async () => {
    const userId = await createAccount('malformed@example.com', 'STUDENT');
    const cookie = await login('malformed@example.com');
    // A `Json` column guarantees nothing about its shape (schema.prisma:604), which is
    // the whole reason the mapper re-parses.
    await seedNotification(userId, { payload: { nope: true } });
    await seedNotification(userId, { title: 'Intact' });

    const response = await get('', cookie);
    expect(response.statusCode).toBe(200);

    const titles = response
      .json()
      .data.map((item: { payload: { title: string } }) => item.payload.title);
    expect(titles).toContain('Intact');
    expect(titles).toContain('');
  });
});

describe('POST /notifications/read', () => {
  it('marks everything read for a bodyless POST and returns the recomputed count', async () => {
    const userId = await createAccount('markall@example.com', 'STUDENT');
    const cookie = await login('markall@example.com');
    await seedNotification(userId);
    await seedNotification(userId);

    // No body at all: Fastify hands that to the validator as `null`, which is why the
    // body schema is `.nullish()` and not `.optional()`. With `.optional()` this
    // answers 422 before the policy preHandler runs.
    const response = await send('/read', undefined, cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ unread: 0 });

    const rows = await prisma.notification.findMany({ where: { userId } });
    expect(rows.every((row) => row.readAt !== null)).toBe(true);
  });

  it('marks only the ids it was given', async () => {
    const userId = await createAccount('someids@example.com', 'STUDENT');
    const cookie = await login('someids@example.com');
    const first = await seedNotification(userId);
    const second = await seedNotification(userId);

    const response = await send('/read', { ids: [first] }, cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ unread: 1 });

    const untouched = await prisma.notification.findUniqueOrThrow({ where: { id: second } });
    expect(untouched.readAt).toBeNull();
  });

  it('cannot mark another user’s notification read, even with its id in the body', async () => {
    const attackerId = await createAccount('attacker@example.com', 'STUDENT');
    const victimId = await createAccount('victim@example.com', 'STUDENT');
    const cookie = await login('attacker@example.com');
    const mine = await seedNotification(attackerId);
    const theirs = await seedNotification(victimId);

    const response = await send('/read', { ids: [mine, theirs] }, cookie);
    // `userId: actor.id` intersects the caller-supplied ids with the caller's own rows,
    // so the foreign id matches nothing. It is not an error: reporting it would confirm
    // that the id exists.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ unread: 0 });

    const victimRow = await prisma.notification.findUniqueOrThrow({ where: { id: theirs } });
    expect(victimRow.readAt).toBeNull();
  });

  it('unmarks with read:false', async () => {
    const userId = await createAccount('unmark@example.com', 'STUDENT');
    const cookie = await login('unmark@example.com');
    await seedNotification(userId, { read: true });
    await seedNotification(userId, { read: true });

    const response = await send('/read', { read: false }, cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ unread: 2 });
  });

  it('rejects an ids array longer than the schema allows', async () => {
    const userId = await createAccount('toomany@example.com', 'STUDENT');
    const cookie = await login('toomany@example.com');
    const id = await seedNotification(userId);

    const response = await send('/read', { ids: Array.from({ length: 201 }, () => id) }, cookie);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  });

  it('refuses a state change that is not same-origin', async () => {
    const cookie = await signedIn('csrf@example.com');

    const response = await send('/read', undefined, cookie, {});
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: csrf.sameOrigin');
  });

  it('refuses an anonymous caller, naming the action that needed a session', async () => {
    const response = await send('/read', undefined);
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
    expect(response.json().detail).toContain("'notification:update' requires authentication");
  });
});

// ---------------------------------------------------------------------------
// The seven wired events
//
// Every action in the API used to write nothing — seed.ts was the only producer of
// notification rows, which is how 147 blank ones happened. These suites pin the
// contract the other way around: each event reaches EXACTLY its recipients, the
// actor is never notified of their own act, and a bell that cannot be written never
// fails the action that already succeeded.
// ---------------------------------------------------------------------------

describe('ENROLLMENT_REQUESTED', () => {
  it('tells the course’s teacher a student asked to join, and nobody else', async () => {
    const teacher = await signIn(`req-t${sequence}@example.com`, 'TEACHER', 'Tara Teacher');
    const student = await signIn(`req-s${sequence}@example.com`, 'STUDENT', 'Sam Applicant');
    const course = await makeCourse(teacher.id);

    const offering = await prisma.courseOffering.findFirstOrThrow({
      where: { courseId: course.id, deletedAt: null },
      select: { id: true },
    });
    const response = await api('POST', '/enrollments', {
      person: student,
      payload: { courseId: course.id, offeringId: offering.id },
    });
    expect(response.statusCode).toBe(201);

    const rows = await notificationsFor(teacher.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.type).toBe('ENROLLMENT_REQUESTED');
    expect(row.linkPath).toBe(`/courses/${course.id}`);
    // The closed, denormalised shape written by the one writer: exactly {title, body},
    // human copy carrying both names the teacher needs.
    expect(row.payload).toEqual({
      title: 'Enrolment requested',
      body: `Sam Applicant asked to join ${course.name}.`,
    });
    // The applicant does not get told about their own application.
    expect(await notificationsFor(student.id)).toHaveLength(0);
  });

  it('announces a re-application too — a fresh PENDING row needs actioning again', async () => {
    const teacher = await signIn(`reapply-t${sequence}@example.com`, 'TEACHER', 'Tara Teacher');
    const student = await signIn(`reapply-s${sequence}@example.com`, 'STUDENT', 'Sam Applicant');
    const course = await makeCourse(teacher.id);
    // One row reused forever per (student, course): this seat was withdrawn last term.
    await seedEnrollment(student.id, course.id, 'WITHDRAWN');

    const offering = await prisma.courseOffering.findFirstOrThrow({
      where: { courseId: course.id, deletedAt: null },
      select: { id: true },
    });
    const response = await api('POST', '/enrollments', {
      person: student,
      payload: { courseId: course.id, offeringId: offering.id },
    });
    expect(response.statusCode).toBe(201);

    const rows = await notificationsFor(teacher.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('ENROLLMENT_REQUESTED');
  });
});

describe('ENROLLMENT_APPROVED', () => {
  it('tells the student they have a seat — not other students, not the teacher', async () => {
    const teacher = await signIn(`appr-t${sequence}@example.com`, 'TEACHER', 'Tara Teacher');
    const student = await signIn(`appr-s${sequence}@example.com`, 'STUDENT', 'Sana Seated');
    const bystander = await signIn(`appr-b${sequence}@example.com`, 'STUDENT', 'Bo Bystander');
    const course = await makeCourse(teacher.id);
    const { id: enrollmentId } = await seedEnrollment(student.id, course.id, 'PENDING');
    await seedEnrollment(bystander.id, course.id, 'APPROVED');

    const response = await api('POST', `/enrollments/${enrollmentId}/approve`, { person: teacher });
    expect(response.statusCode).toBe(200);

    const rows = await notificationsFor(student.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.type).toBe('ENROLLMENT_APPROVED');
    expect(row.linkPath).toBe(`/courses/${course.id}`);
    expect(row.payload).toEqual({
      title: 'Enrolment approved',
      body: `You have a seat on ${course.name}.`,
    });
    // The decision-maker and every other seated student hear nothing.
    expect(await notificationsFor(teacher.id)).toHaveLength(0);
    expect(await notificationsFor(bystander.id)).toHaveLength(0);
  });

  it('does not re-notify on an idempotent second approval', async () => {
    const teacher = await signIn(`idem-t${sequence}@example.com`, 'TEACHER', 'Tara Teacher');
    const student = await signIn(`idem-s${sequence}@example.com`, 'STUDENT', 'Sana Seated');
    const course = await makeCourse(teacher.id);
    const { id: enrollmentId } = await seedEnrollment(student.id, course.id, 'PENDING');

    expect(
      (await api('POST', `/enrollments/${enrollmentId}/approve`, { person: teacher })).statusCode,
    ).toBe(200);
    expect(
      (await api('POST', `/enrollments/${enrollmentId}/approve`, { person: teacher })).statusCode,
    ).toBe(200);

    expect(await notificationsFor(student.id)).toHaveLength(1);
  });

  it('moves the unread badge the moment the row lands', async () => {
    const teacher = await signIn(`badge-t${sequence}@example.com`, 'TEACHER', 'Tara Teacher');
    const student = await signIn(`badge-s${sequence}@example.com`, 'STUDENT', 'Sana Seated');
    const course = await makeCourse(teacher.id);
    const { id: enrollmentId } = await seedEnrollment(student.id, course.id, 'PENDING');

    const before = await api('GET', '/notifications/unread-count', { person: student });
    expect(before.json()).toEqual({ unread: 0 });

    await api('POST', `/enrollments/${enrollmentId}/approve`, { person: teacher });

    const after = await api('GET', '/notifications/unread-count', { person: student });
    expect(after.json()).toEqual({ unread: 1 });
  });
});

describe('ENROLLMENT_REJECTED', () => {
  it('tells the student the request was declined', async () => {
    const teacher = await signIn(`rej-t${sequence}@example.com`, 'TEACHER', 'Tara Teacher');
    const student = await signIn(`rej-s${sequence}@example.com`, 'STUDENT', 'Rosa Refused');
    const course = await makeCourse(teacher.id);
    const { id: enrollmentId } = await seedEnrollment(student.id, course.id, 'PENDING');

    const response = await api('POST', `/enrollments/${enrollmentId}/reject`, {
      person: teacher,
      payload: { reason: 'Prerequisite not met yet' },
    });
    expect(response.statusCode).toBe(200);

    const rows = await notificationsFor(student.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('ENROLLMENT_REJECTED');
    expect(rows[0]?.linkPath).toBe(`/courses/${course.id}`);
  });

  it('stays silent on withdrawal — no enum member names that event yet', async () => {
    const teacher = await signIn(`wd-t${sequence}@example.com`, 'TEACHER', 'Tara Teacher');
    const student = await signIn(`wd-s${sequence}@example.com`, 'STUDENT', 'Walt Withdrew');
    const course = await makeCourse(teacher.id);
    const { id: enrollmentId } = await seedEnrollment(student.id, course.id, 'PENDING');

    const response = await api('POST', `/enrollments/${enrollmentId}/withdraw`, {
      person: student,
    });
    expect(response.statusCode).toBe(200);

    // Deliberate, not forgotten: the Phase 1 section of docs/roadmap/00-FEATURE-PLAN.md
    // records that NotificationType has no member for a withdrawal.
    expect(await notificationsFor(student.id)).toHaveLength(0);
    expect(await notificationsFor(teacher.id)).toHaveLength(0);
  });
});

describe('RESOURCE_PUBLISHED', () => {
  it('reaches every APPROVED student of the course except the acting teacher', async () => {
    const teacher = await signIn(`res-t${sequence}@example.com`, 'TEACHER', 'Tara Teacher');
    const colleague = await signIn(`res-c${sequence}@example.com`, 'TEACHER', 'Colin Colleague');
    const seatedA = await signIn(`res-a${sequence}@example.com`, 'STUDENT', 'Ada Approved');
    const seatedB = await signIn(`res-b${sequence}@example.com`, 'STUDENT', 'Bilal Booked');
    const waiting = await signIn(`res-w${sequence}@example.com`, 'STUDENT', 'Wai Pending');
    const elsewhere = await signIn(`res-e${sequence}@example.com`, 'STUDENT', 'Ela Elsewhere');

    const course = await makeCourse(teacher.id);
    const otherCourse = await makeCourse(colleague.id);
    await seedEnrollment(seatedA.id, course.id, 'APPROVED');
    await seedEnrollment(seatedB.id, course.id, 'APPROVED');
    await seedEnrollment(waiting.id, course.id, 'PENDING');
    await seedEnrollment(elsewhere.id, otherCourse.id, 'APPROVED');

    const created = await api('POST', '/resources', {
      person: teacher,
      payload: {
        courseId: course.id,
        title: 'SMAW technique sheet',
        type: 'LINK',
        externalUrl: 'https://example.com/sheet.pdf',
        isPublic: false,
      },
    });
    expect(created.statusCode).toBe(201);
    const resourceId = created.json().id as string;

    // Both approved students are told; the link lands on the resource itself.
    for (const person of [seatedA, seatedB]) {
      const rows = await notificationsFor(person.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe('RESOURCE_PUBLISHED');
      expect(rows[0]?.linkPath).toBe(`/resources/${resourceId}`);
      expect(rows[0]?.payload).toEqual({
        title: 'New course material',
        body: `New material was added to ${course.name}.`,
      });
    }
    // PENDING cannot even read the resource yet, so no bell pointing at a 403.
    expect(await notificationsFor(waiting.id)).toHaveLength(0);
    expect(await notificationsFor(elsewhere.id)).toHaveLength(0);
    expect(await notificationsFor(teacher.id)).toHaveLength(0);
  });
});

describe('ANNOUNCEMENT_PUBLISHED', () => {
  async function fixture(): Promise<{
    author: Person;
    student: Person;
  }> {
    const author = await signIn(`ann-a${sequence}@example.com`, 'TEACHER', 'Ada Author');
    const student = await signIn(`ann-s${sequence}@example.com`, 'STUDENT', 'Sol Student');
    const course = await makeCourse(author.id);
    await seedEnrollment(student.id, course.id, 'APPROVED');
    return { author, student };
  }

  it('is silent as a draft and rings once when published', async () => {
    const { author, student } = await fixture();

    const draft = await api('POST', '/announcements', {
      person: author,
      payload: {
        title: 'PPE sign-off week',
        content: 'Boots and goggles, workshop 2.',
        type: 'NEWS',
      },
    });
    expect(draft.statusCode).toBe(201);
    const announcementId = draft.json().id as string;
    expect(await notificationsFor(student.id)).toHaveLength(0);

    const published = await api('POST', `/announcements/${announcementId}/publish`, {
      person: author,
      payload: { published: true },
    });
    expect(published.statusCode).toBe(200);

    const rows = await notificationsFor(student.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('ANNOUNCEMENT_PUBLISHED');
    expect(rows[0]?.linkPath).toBe(`/announcements/${announcementId}`);
    expect(rows[0]?.payload).toEqual({
      title: 'New announcement',
      body: 'Ada Author posted: PPE sign-off week',
    });

    // Unpublishing is silent. Publishing again after an unpublish is a genuine second
    // go-live — a fresh draft->live transition — so it announces once more.
    await api('POST', `/announcements/${announcementId}/publish`, {
      person: author,
      payload: { published: false },
    });
    expect(await notificationsFor(student.id)).toHaveLength(1);
    await api('POST', `/announcements/${announcementId}/publish`, {
      person: author,
      payload: { published: true },
    });
    expect(await notificationsFor(student.id)).toHaveLength(2);
  });

  it('announces a creation that goes straight live', async () => {
    const { author, student } = await fixture();

    const created = await api('POST', '/announcements', {
      person: author,
      payload: {
        title: 'Spring intake applications open',
        content: 'Apply from the course page.',
        type: 'NEWS',
        publish: true,
      },
    });
    expect(created.statusCode).toBe(201);

    const rows = await notificationsFor(student.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('ANNOUNCEMENT_PUBLISHED');
  });

  it('never notifies the actor, even when they hold an approved seat themselves', async () => {
    const { author, student } = await fixture();
    // The author teaching their own enrolment is contrived; proving the exclusion is
    // not. An APPROVED row for the actor must not earn them their own announcement.
    const course = await makeCourse(author.id);
    await seedEnrollment(author.id, course.id, 'APPROVED');

    const created = await api('POST', '/announcements', {
      person: author,
      payload: {
        title: 'Staffroom notice',
        content: 'Kettle is fixed.',
        type: 'NEWS',
        publish: true,
      },
    });
    expect(created.statusCode).toBe(201);

    expect(await notificationsFor(student.id)).toHaveLength(1);
    expect(await notificationsFor(author.id)).toHaveLength(0);
  });
});

describe('MESSAGE_RECEIVED', () => {
  it('rings the other participant, never the sender', async () => {
    const sender = await signIn(`msg-a${sequence}@example.com`, 'STUDENT', 'Alice Sender');
    const receiver = await signIn(`msg-b${sequence}@example.com`, 'STUDENT', 'Bob Receiver');

    const conversation = await api('POST', '/conversations', {
      person: sender,
      payload: { participantIds: [receiver.id] },
    });
    expect(conversation.statusCode).toBe(201);
    const conversationId = conversation.json().id as string;

    const sent = await api('POST', `/conversations/${conversationId}/messages`, {
      person: sender,
      payload: { content: 'Is the MIG unit free?', clientMsgId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    });
    expect(sent.statusCode).toBe(201);

    const rows = await notificationsFor(receiver.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('MESSAGE_RECEIVED');
    expect(rows[0]?.linkPath).toBe(`/messages?conversationId=${conversationId}`);
    expect(rows[0]?.payload).toEqual({
      title: 'New message',
      body: 'Alice Sender sent you a message.',
    });
    expect(await notificationsFor(sender.id)).toHaveLength(0);
  });

  it('does not ring again when a timed-out send is replayed', async () => {
    const sender = await signIn(`rp-a${sequence}@example.com`, 'STUDENT', 'Alice Sender');
    const receiver = await signIn(`rp-b${sequence}@example.com`, 'STUDENT', 'Bob Receiver');
    const conversation = await api('POST', '/conversations', {
      person: sender,
      payload: { participantIds: [receiver.id] },
    });
    const conversationId = conversation.json().id as string;
    const payload = { content: 'Retry-safe?', clientMsgId: '01ARZ3NDEKTSV4RRFFQ69G5FAW' };

    expect(
      (await api('POST', `/conversations/${conversationId}/messages`, { person: sender, payload }))
        .statusCode,
    ).toBe(201);
    // Same clientMsgId: the endpoint replays the original message instead of
    // double-posting it — so the bell must not ring twice either.
    expect(
      (await api('POST', `/conversations/${conversationId}/messages`, { person: sender, payload }))
        .statusCode,
    ).toBe(201);

    expect(await notificationsFor(receiver.id)).toHaveLength(1);
  });
});

describe('COMMENT_REPLIED', () => {
  async function resourceFixture(): Promise<{
    teacher: Person;
    student: Person;
    resourceId: string;
  }> {
    const teacher = await signIn(`cmt-t${sequence}@example.com`, 'TEACHER', 'Tara Teacher');
    const student = await signIn(`cmt-s${sequence}@example.com`, 'STUDENT', 'Cara Commenter');
    const course = await makeCourse(teacher.id);
    const created = await api('POST', '/resources', {
      person: teacher,
      payload: {
        courseId: course.id,
        title: 'Weld defect gallery',
        type: 'LINK',
        externalUrl: 'https://example.com/gallery',
        isPublic: false,
      },
    });
    expect(created.statusCode).toBe(201);
    // Seated AFTER the resource exists, on purpose: the publication's audience is read
    // at creation time, so seeding first would pollute every count below with
    // RESOURCE_PUBLISHED rows. Seated at all because `comment:create` refuses a caller
    // who cannot READ the parent — an unenrolled student gets 403 on a private resource.
    await seedEnrollment(student.id, course.id, 'APPROVED');
    return { teacher, student, resourceId: created.json().id as string };
  }

  it('tells the parent comment’s author, never the replier', async () => {
    const { teacher, student, resourceId } = await resourceFixture();

    const topComment = await api('POST', '/comments', {
      person: student,
      payload: { resourceId, content: 'Which photo shows undercut?' },
    });
    expect(topComment.statusCode).toBe(201);
    // The top-level comment announces nothing — there is no enum member for it yet
    // (recorded as a known debt in the Phase 1 section of docs/roadmap).
    expect(await notificationsFor(teacher.id)).toHaveLength(0);

    const reply = await api('POST', '/comments', {
      person: teacher,
      payload: {
        resourceId,
        parentId: topComment.json().id as string,
        content: 'Third one down.',
      },
    });
    expect(reply.statusCode).toBe(201);

    const rows = await notificationsFor(student.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('COMMENT_REPLIED');
    expect(rows[0]?.linkPath).toBe(`/resources/${resourceId}`);
    expect(rows[0]?.payload).toEqual({
      title: 'New reply',
      body: 'Tara Teacher replied to your comment.',
    });
    expect(await notificationsFor(teacher.id)).toHaveLength(0);
  });

  it('never fires on a self-reply', async () => {
    const { student, resourceId } = await resourceFixture();

    const topComment = await api('POST', '/comments', {
      person: student,
      payload: { resourceId, content: 'Answering my own question later.' },
    });
    expect(topComment.statusCode).toBe(201);

    const selfReply = await api('POST', '/comments', {
      person: student,
      payload: {
        resourceId,
        parentId: topComment.json().id as string,
        content: 'Found it myself.',
      },
    });
    expect(selfReply.statusCode).toBe(201);

    expect(await notificationsFor(student.id)).toHaveLength(0);
  });

  it('points at the announcement when the thread hangs off one', async () => {
    const admin = await signIn(`cmt-ad${sequence}@example.com`, 'ADMIN', 'Ada Admin');
    const student = await signIn(`cmt-as${sequence}@example.com`, 'STUDENT', 'Cara Commenter');

    const created = await api('POST', '/announcements', {
      person: admin,
      payload: {
        title: 'Workshop closures',
        content: 'Shop 2 closed Friday.',
        type: 'NEWS',
        publish: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const announcementId = created.json().id as string;

    const topComment = await api('POST', '/comments', {
      person: student,
      payload: { announcementId, content: 'All day Friday?' },
    });
    expect(topComment.statusCode).toBe(201);

    const reply = await api('POST', '/comments', {
      person: admin,
      payload: { announcementId, parentId: topComment.json().id as string, content: 'From noon.' },
    });
    expect(reply.statusCode).toBe(201);

    // The publication itself had an empty audience here (no enrolments), so the only
    // row the student holds is the reply — pointed back at the announcement thread.
    const rows = await notificationsFor(student.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('COMMENT_REPLIED');
    expect(rows[0]?.linkPath).toBe(`/announcements/${announcementId}`);
  });
});

describe('when writing the notification fails', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the approval still succeeds — a failed bell never fails the enrolment', async () => {
    const teacher = await signIn(`fail-t${sequence}@example.com`, 'TEACHER', 'Tara Teacher');
    const student = await signIn(`fail-s${sequence}@example.com`, 'STUDENT', 'Fay Failed');
    const course = await makeCourse(teacher.id);
    const { id: enrollmentId } = await seedEnrollment(student.id, course.id, 'PENDING');

    // Break the exact statement `notify()` runs — not `notify` itself — so the real
    // catch inside the helper is what is under test. The next write rejects once.
    vi.spyOn(prisma.notification, 'createMany').mockRejectedValueOnce(new Error('db went away'));

    const response = await api('POST', `/enrollments/${enrollmentId}/approve`, { person: teacher });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('APPROVED');

    const stored = await prisma.enrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
      select: { status: true },
    });
    expect(stored.status).toBe('APPROVED');
    // ...and the badge stays at zero: the failure was swallowed and logged, not hidden.
    expect(await unreadCountOf(student.id)).toBe(0);
  });
});
