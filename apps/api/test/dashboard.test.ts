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
 * both children (`ConversationParticipant` and `Message` are both `onDelete: Cascade`
 * off `Conversation`), which is why this is one statement.
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

/**
 * The four tiles, named rather than `Record<string, number>`: under
 * `noUncheckedIndexedAccess` an index signature makes every counter `number |
 * undefined`, so `before.resources - n` does not compile — and the drop assertions
 * below are arithmetic on a counter. Declared here from the SPA's own view of the
 * response (apps/web/src/lib/types.ts:120-125) rather than imported from
 * dashboard.schema.ts, so the wire shape stays something this suite asserts instead of
 * something it inherits.
 */
interface Stats {
  courses: number;
  pendingEnrollments: number;
  unreadMessages: number;
  resources: number;
}

async function statsFor(person: Person): Promise<Stats> {
  const response = await getStats(person.token);
  expect(response.statusCode).toBe(200);
  return response.json<Stats>();
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
      publishedAt: published ? new Date() : null,
    },
  });
  // Phase 9: one intake per fixture course.
  await prisma.courseOffering.create({ data: { courseId: course.id, capacity: 10 } });
  return course.id;
}

async function enrol(
  studentId: string,
  courseId: string,
  status: 'PENDING' | 'APPROVED',
): Promise<void> {
  const offering = await prisma.courseOffering.findFirstOrThrow({
    where: { courseId, deletedAt: null },
    select: { id: true },
  });
  await prisma.enrollment.create({
    data: { studentId, offeringId: offering.id, status },
  });
}

/**
 * `type: 'LINK'` with an `externalUrl` and no upload: migration 0002 CHECKs that
 * exactly one of `uploadId` / `externalUrl` is set (migration 0002's CHECK).
 *
 * Returns the id so a caller can soft-delete the exact row it made; every existing
 * caller ignores it.
 */
async function makeResource(
  courseId: string,
  authorId: string,
  isPublic: boolean,
): Promise<string> {
  sequence += 1;
  const resource = await prisma.resource.create({
    data: {
      title: `Resource ${sequence}`,
      type: 'LINK',
      externalUrl: `https://example.com/${sequence}`,
      courseId,
      authorId,
      isPublic,
    },
  });
  return resource.id;
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
  /**
   * The one resource id this world names. It is the PUBLIC row on B1 — the only
   * resource every actor below can see — so soft-deleting it moves the teacher's, the
   * student's and the admin's number at once, which is what the tile-vs-list test needs.
   */
  publicResourceB1: string;
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
  const publicResourceB1 = await makeResource(courseB1, teacherB.id, true);
  await makeResource(courseB1, teacherB.id, false);

  return {
    teacherA,
    teacherB,
    studentA,
    studentB,
    admin,
    courseA1,
    courseA2,
    courseB1,
    publicResourceB1,
  };
}

/**
 * `meta.total` of `GET /resources` — the number the `resources` tile has to equal.
 *
 * The TOTAL and not `data.length`: the list pages at 20 by default (pagination.ts:5),
 * so comparing page lengths would agree by accident on any fixture smaller than a page
 * and stop agreeing the moment one is not.
 */
async function listedResources(person: Person): Promise<number> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/resources',
    headers: { cookie: cookieHeader(person.token) },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ meta: { total: number } }>().meta.total;
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

/** `@@unique([senderId, clientMsgId])` on `model Message`, hence the counter. */
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
    // seedWorld files one PRIVATE resource on A1 (line 214). This second one is PUBLIC
    // on purpose: `or(isPublic, ...)` (policy.ts:193-194) never looks at the course, so
    // a public row on a dead course is the row a clause missing the course-level
    // soft-delete term keeps visible to every role at once.
    await makeResource(world.courseA1, world.teacherA.id, true);
    const onDeadCourse = await prisma.resource.count({ where: { courseId: world.courseA1 } });

    const teacherBefore = await statsFor(world.teacherA);
    const adminBefore = await statsFor(world.admin);

    await prisma.course.update({ where: { id: world.courseA1 }, data: { deletedAt: new Date() } });

    // Soft delete is not enforced by the ORM (a plain nullable `deletedAt` on
    // `model Course`), so this is asserting
    // the hand-written `deletedAt: null` in each clause rather than an ORM behaviour.
    //
    // Whole objects, not three of the four keys: this test's NAME says every counter,
    // and it previously asserted `courses` and `pendingEnrollments` only. `resources`
    // was the one it skipped, and skipping it is exactly how the dashboard's own copy
    // of the resource clause kept filtering only `Resource.deletedAt` while the list
    // also excluded resources whose COURSE was deleted — so the tile counted rows no
    // list would ever return.
    const teacher = await statsFor(world.teacherA);
    expect(teacher).toEqual({
      courses: 1,
      // The pending row still exists; it is hidden because its course is gone, which is
      // what `/enrollments?status=PENDING` does too (enrollments.service.ts:232-234).
      pendingEnrollments: 0,
      unreadMessages: 0,
      // Only B1's public resource survives: both of A1's died with the course.
      resources: 1,
    });

    const admin = await statsFor(world.admin);
    expect(admin).toEqual({ courses: 2, pendingEnrollments: 1, unreadMessages: 0, resources: 2 });

    // Stated as the drop, because the drop is the claim: both actors could see every
    // resource on A1 before it died — the teacher through `ownsCourse`, the admin
    // through `allow` — so each must lose exactly that many and no fewer. Under the old
    // clause both numbers are unchanged by the delete, which is what fails here.
    expect(teacher.resources).toBe(teacherBefore.resources - onDeadCourse);
    expect(admin.resources).toBe(adminBefore.resources - onDeadCourse);
  });

  /*
   * The tile's whole contract, and the one this suite did not state: `stats().resources`
   * is a COUNT of the clause `GET /resources` lists with, so the two numbers are the
   * same number or the SPA shows "3" above a shelf of one (Dashboard.tsx:66).
   *
   * dashboard.service.ts imports `visibilityWhere` from resources.service.ts to make
   * that true by construction; this test is what would notice a second copy appearing
   * again, for any policy row rather than only the soft-delete one that drifted.
   */
  it('counts exactly what GET /resources lists, for teacher, student and admin', async () => {
    const world = await seedWorld();

    // Two live resources on A2, then A2 is soft-deleted: the dead COURSE term. One of
    // them is public, so it is invisible to every role only because of that term.
    await makeResource(world.courseA2, world.teacherA.id, true);
    await makeResource(world.courseA2, world.teacherA.id, false);
    await prisma.course.update({ where: { id: world.courseA2 }, data: { deletedAt: new Date() } });
    // And one soft-deleted resource on a LIVE course: the row-level term. Both halves of
    // the two-level filter are therefore load-bearing on both sides of the equality.
    await prisma.resource.update({
      where: { id: world.publicResourceB1 },
      data: { deletedAt: new Date() },
    });

    const teacher = await statsFor(world.teacherA);
    const student = await statsFor(world.studentA);
    const admin = await statsFor(world.admin);

    // Pinned before they are compared, so the equality below cannot pass as 0 === 0.
    // A1's private resource is all the first two can see — the teacher owns it, the
    // student is APPROVED on A1 — and the admin also has B1's private row, which no
    // other actor's policy row reaches (student A is only PENDING on B1).
    expect([teacher.resources, student.resources, admin.resources]).toEqual([1, 1, 2]);

    expect(await listedResources(world.teacherA)).toBe(teacher.resources);
    expect(await listedResources(world.studentA)).toBe(student.resources);
    expect(await listedResources(world.admin)).toBe(admin.resources);
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
    //
    // All four are typed, not just that one. The other three are Prisma `count()`s and
    // cannot arrive as bigint today, but the name of this test promises four JSON
    // numbers, and a name that promises more than the body checks is precisely how the
    // resources tile carried a stale clause through review.
    const body = response.json<Record<string, unknown>>();
    for (const key of Object.keys(body)) {
      expect(typeof body[key], key).toBe('number');
    }
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
