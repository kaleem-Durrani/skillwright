import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// app.ts:43-49: "Anything that holds an instance built here — main.ts, the integration
// tests — should name this type." Plain FastifyInstance is a type error, not a widening.
import type { AppInstance } from '../src/app.js';
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

let app: AppInstance;
let departmentId: string;
/** Hashed once: argon2 is deliberately expensive, and every account here shares it. */
let passwordHash: string;
let sequence = 0;

beforeAll(async () => {
  app = await buildApp();
  passwordHash = await hashPassword(PASSWORD);
});

afterAll(async () => {
  await clearFixtures();
  await app.close();
});

/**
 * `resetDatabase()` (setup.ts:110-119) clears comments, announcements, resources,
 * enrollments, courses, users and departments in FK-safe order, so none of those are
 * repeated here.
 *
 * Conversation is the one table this suite writes that it does NOT cover: Conversation
 * holds no foreign key to User, so deleting users cascades the participants and the
 * messages away and leaves the empty thread behind. Deleting the conversation cascades
 * both children (schema.prisma:545,566), which is why this is one statement.
 */
async function clearFixtures(): Promise<void> {
  await prisma.conversation.deleteMany({});
  await prisma.enrollment.deleteMany({});
  await prisma.course.deleteMany({});
}

beforeEach(async () => {
  await clearFixtures();
  await resetDatabase();
  await resetRateLimits(app.redis);
  departmentId = await createDepartment();
});

// --- helpers ---------------------------------------------------------------

type TestRole = 'STUDENT' | 'TEACHER' | 'ADMIN';

interface Person {
  id: string;
  token: string;
}

/** Provisioned directly: only students self-register, and this suite needs all three roles. */
async function createAccount(email: string, role: TestRole): Promise<string> {
  const user = await prisma.user.create({
    data: { email, name: 'Test Person', role, status: 'ACTIVE', passwordHash },
  });
  return user.id;
}

async function login(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    // Every non-GET must look same-origin or csrf.plugin.ts:20-30 rejects it first.
    headers: { ...originHeaders },
    payload: { email, password: PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  const token = sessionCookie(response);
  expect(token).toBeTruthy();
  return token as string;
}

async function signedIn(email: string, role: TestRole): Promise<Person> {
  const id = await createAccount(email, role);
  return { id, token: await login(email) };
}

function getStats(cookie?: string) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/dashboard/stats',
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

async function statsFor(person: Person): Promise<Record<string, number>> {
  const response = await getStats(person.token);
  expect(response.statusCode).toBe(200);
  return response.json() as Record<string, number>;
}

async function makeCourse(teacherId: string, published: boolean): Promise<string> {
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
      publishedAt: published ? new Date() : null,
    },
  });
  return course.id;
}

async function enrol(
  studentId: string,
  courseId: string,
  status: 'PENDING' | 'APPROVED',
): Promise<void> {
  await prisma.enrollment.create({ data: { studentId, courseId, status } });
}

/**
 * `type: 'LINK'` with an `externalUrl` and no upload: migration 0002 CHECKs that
 * exactly one of `uploadId` / `externalUrl` is set (schema.prisma:433).
 */
async function makeResource(courseId: string, authorId: string, isPublic: boolean): Promise<void> {
  sequence += 1;
  await prisma.resource.create({
    data: {
      title: `Resource ${sequence}`,
      type: 'LINK',
      externalUrl: `https://example.com/${sequence}`,
      courseId,
      authorId,
      isPublic,
    },
  });
}

interface World {
  teacherA: Person;
  teacherB: Person;
  studentA: Person;
  studentB: Person;
  admin: Person;
  courseA1: string;
  courseA2: string;
  courseB1: string;
}

/**
 * Two of everything, on purpose. Every count assertion below is made with another
 * teacher's course, another student's application and another course's private
 * resource sitting in the same tables — a tile that filtered nothing would still be
 * "right" against a single-tenant fixture.
 */
async function seedWorld(): Promise<World> {
  const teacherA = await signedIn('teacher-a@example.com', 'TEACHER');
  const teacherB = await signedIn('teacher-b@example.com', 'TEACHER');
  const studentA = await signedIn('student-a@example.com', 'STUDENT');
  const studentB = await signedIn('student-b@example.com', 'STUDENT');
  const admin = await signedIn('admin@example.com', 'ADMIN');

  const courseA1 = await makeCourse(teacherA.id, true);
  const courseA2 = await makeCourse(teacherA.id, false);
  const courseB1 = await makeCourse(teacherB.id, true);

  await enrol(studentA.id, courseA1, 'APPROVED');
  await enrol(studentA.id, courseB1, 'PENDING');
  await enrol(studentB.id, courseA1, 'PENDING');

  await makeResource(courseA1, teacherA.id, false);
  await makeResource(courseB1, teacherB.id, true);
  await makeResource(courseB1, teacherB.id, false);

  return { teacherA, teacherB, studentA, studentB, admin, courseA1, courseA2, courseB1 };
}

/** A conversation with the two given users seated in it. Returns its id. */
async function conversationOf(
  participants: Array<{ userId: string; lastReadSeq?: number; left?: boolean }>,
): Promise<string> {
  const conversation = await prisma.conversation.create({
    data: {
      participants: {
        create: participants.map((participant) => ({
          userId: participant.userId,
          lastReadSeq: BigInt(participant.lastReadSeq ?? 0),
          leftAt: participant.left === true ? new Date() : null,
        })),
      },
    },
  });
  return conversation.id;
}

/** `@@unique([senderId, clientMsgId])` (schema.prisma:587), hence the counter. */
async function message(
  conversationId: string,
  senderId: string,
  seq: number,
  options: { deleted?: boolean } = {},
): Promise<void> {
  sequence += 1;
  await prisma.message.create({
    data: {
      conversationId,
      senderId,
      seq: BigInt(seq),
      content: `Message ${sequence}`,
      clientMsgId: `client-${sequence}`,
      deletedAt: options.deleted === true ? new Date() : null,
    },
  });
}

// --- tests -----------------------------------------------------------------

describe('the gate on GET /dashboard/stats', () => {
  /*
   * There is no `dashboard:*` action, so there is no policy rule name to assert here:
   * the refusal comes from `requireActor` (auth.plugin.ts:96-99), not from `can()`.
   * That is the whole design of this route — see the comment in dashboard.routes.ts.
   * A 403 with a rule name would mean somebody reached for a near-miss action.
   */
  it('refuses an anonymous caller with 401, not a policy 403', async () => {
    const response = await getStats();
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
  });

  /*
   * TRAP 5. Skipping `authorize()` does not skip the session-state gates: they are
   * enforced centrally in auth.plugin.ts's onRequest hook (:63-83), which is what makes
   * an authentication-only route safe. If this ever returns 200, the hook stopped
   * covering routes that do not call `authorize()`.
   */
  it('still refuses a suspended account, from the central onRequest gate', async () => {
    const teacher = await signedIn('suspended@example.com', 'TEACHER');
    await prisma.user.update({ where: { id: teacher.id }, data: { status: 'SUSPENDED' } });

    const response = await getStats(teacher.token);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('the counters', () => {
  it('serves a teacher their own rows and nobody else’s', async () => {
    const world = await seedWorld();

    // courses: A1 published + A2 draft. Teacher B's published course is NOT counted —
    // the tile sits above "Your courses" (Dashboard.tsx:53), so it is `course:read`
    // narrowed to ownership, never the catalogue.
    // pendingEnrollments: student B on course A1 only. Student A's PENDING row is on
    // teacher B's course, and `ownsCourse` (policy.ts:164) does not reach it.
    // resources: the private one on their own course + the public one on B1;
    // B1's private resource fails or(isPublic, ownsCourse, isAuthor) (policy.ts:194).
    expect(await statsFor(world.teacherA)).toEqual({
      courses: 2,
      pendingEnrollments: 1,
      unreadMessages: 0,
      resources: 2,
    });

    expect(await statsFor(world.teacherB)).toEqual({
      courses: 1,
      pendingEnrollments: 1,
      unreadMessages: 0,
      resources: 2,
    });
  });

  it('counts a student’s approved courses and only their own applications', async () => {
    const world = await seedWorld();

    // courses: `enrolledApproved` only — a PENDING application is not a course you
    // have, so course B1 is absent.
    // pendingEnrollments: `isEnrolledStudent` (policy.ts:163) — their own row on B1,
    // never student B's row on A1.
    // resources: the public one, plus the private one on the course they are approved
    // on. B1's private resource is invisible: PENDING is not `enrolledApproved`.
    expect(await statsFor(world.studentA)).toEqual({
      courses: 1,
      pendingEnrollments: 1,
      unreadMessages: 0,
      resources: 2,
    });

    // Student B is approved on nothing, so the only resource they can see is the public
    // one — which is exactly what `or(isPublic, enrolledApproved)` says (policy.ts:193).
    expect(await statsFor(world.studentB)).toEqual({
      courses: 0,
      pendingEnrollments: 1,
      unreadMessages: 0,
      resources: 1,
    });
  });

  it('gives an admin the unrestricted totals', async () => {
    const world = await seedWorld();

    expect(await statsFor(world.admin)).toEqual({
      courses: 3,
      pendingEnrollments: 2,
      unreadMessages: 0,
      resources: 3,
    });
  });

  it('drops a soft-deleted course out of every counter that reaches it', async () => {
    const world = await seedWorld();
    await prisma.course.update({ where: { id: world.courseA1 }, data: { deletedAt: new Date() } });

    // Soft delete is not enforced by the ORM (schema.prisma:344), so this is asserting
    // the hand-written `deletedAt: null` in each clause rather than an ORM behaviour.
    const teacher = await statsFor(world.teacherA);
    expect(teacher.courses).toBe(1);
    // The pending row still exists; it is hidden because its course is gone, which is
    // what `/enrollments?status=PENDING` does too (enrollments.service.ts:232-234).
    expect(teacher.pendingEnrollments).toBe(0);

    expect((await statsFor(world.admin)).courses).toBe(2);
  });

  it('serves exactly the four keys the SPA reads, as JSON numbers', async () => {
    const world = await seedWorld();
    const response = await getStats(world.admin.token);

    // apps/web/src/lib/types.ts:120-125 and Dashboard.tsx:53,57,63,66.
    expect(Object.keys(response.json()).sort()).toEqual([
      'courses',
      'pendingEnrollments',
      'resources',
      'unreadMessages',
    ]);
    // The `::int` cast in the raw count. Without it Postgres returns bigint and the
    // response is a 500 from serialisation, not a number in a string.
    expect(typeof response.json().unreadMessages).toBe('number');
  });
});

describe('unreadMessages', () => {
  it('counts only what this participant has not read, in threads they are seated in', async () => {
    const teacher = await signedIn('reader-t@example.com', 'TEACHER');
    const student = await signedIn('reader-s@example.com', 'STUDENT');
    const stranger = await signedIn('reader-x@example.com', 'STUDENT');

    // The teacher has read up to seq 1; the student has read nothing.
    const thread = await conversationOf([
      { userId: teacher.id, lastReadSeq: 1 },
      { userId: student.id, lastReadSeq: 0 },
    ]);
    await message(thread, student.id, 1); // already read by the teacher
    await message(thread, student.id, 2); // unread by the teacher
    await message(thread, teacher.id, 3); // the teacher's own: never their own unread
    await message(thread, student.id, 4, { deleted: true }); // soft-deleted

    // A thread neither of them is seated in. `isParticipant` (policy.ts:397-404) is the
    // whole scope, so this must not reach either badge.
    const elsewhere = await conversationOf([{ userId: stranger.id, lastReadSeq: 0 }]);
    await message(elsewhere, stranger.id, 1);

    expect((await statsFor(teacher)).unreadMessages).toBe(1);
    // seq 1, 2 and 4 are the student's own; seq 3 is the teacher's and unread.
    expect((await statsFor(student)).unreadMessages).toBe(1);
    // The stranger's only message is their own.
    expect((await statsFor(stranger)).unreadMessages).toBe(0);
  });

  it('stops counting a thread the participant has left', async () => {
    const teacher = await signedIn('left-t@example.com', 'TEACHER');
    const student = await signedIn('left-s@example.com', 'STUDENT');

    const thread = await conversationOf([
      { userId: teacher.id, lastReadSeq: 0, left: true },
      { userId: student.id, lastReadSeq: 0 },
    ]);
    await message(thread, student.id, 1);

    // `p."leftAt" IS NULL` in the raw count: a seat you gave up is not a seat.
    expect((await statsFor(teacher)).unreadMessages).toBe(0);
  });
});
