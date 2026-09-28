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

/**
 * A well-formed id that names no row anywhere. Same shape and same reasoning as
 * resources.test.ts's ABSENT_ID: `idSchema` accepts a cuid or a ULID, and this has to
 * be well-formed or `idParamSchema` refuses it with a 422 before the preHandler ever
 * runs, which would test zod rather than the policy gate.
 */
const ABSENT_ID = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

let app: AppInstance;
let departmentId: string;
let sequence = 0;

/**
 * `resetDatabase()` (setup.ts:110-119) already deletes Comment and Announcement, in
 * that order, before Resource/Enrollment/Course/User/Department — so it alone is FK-
 * safe for everything this file creates. This local helper exists only for `afterAll`:
 * it clears the two Restrict-adjacent rows (Announcement.authorId is
 * `onDelete: Restrict` in schema.prisma) without also deleting Department and User,
 * which is `resetDatabase()`'s job at the START of the NEXT file's `beforeEach` — the
 * same division of labour resources.test.ts:50-56 uses for its own tables.
 */
async function clearAnnouncementRows(): Promise<void> {
  await prisma.comment.deleteMany({});
  await prisma.announcement.deleteMany({});
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await clearAnnouncementRows();
  await app.close();
});

beforeEach(async () => {
  await clearAnnouncementRows();
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

function get(path: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1${path}`,
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

/** Every mutation carries `originHeaders`, or csrf.plugin.ts:20-30 refuses it first. */
function send(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  payload: unknown,
  cookie?: string,
) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { ...originHeaders, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
    payload: payload as Record<string, unknown>,
  });
}

function idsOf(response: { json: () => { data: Array<{ id: string }> } }): string[] {
  return response.json().data.map((row) => row.id);
}

/**
 * Registration always produces a STUDENT (auth.service.ts:199-201), so a teacher or
 * admin fixture is a registered account promoted directly on the row, then logged in.
 * Copied from resources.test.ts:154-171.
 */
async function signIn(email: string, role: Role): Promise<{ id: string; token: string }> {
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

interface AnnouncementFixture {
  authorId: string;
  title?: string;
  type?: 'NEWS' | 'EVENT' | 'ANNOUNCEMENT';
  published?: boolean;
  deletedAt?: Date;
  content?: string;
}

/** Published by default, mirroring resources.test.ts's `makeResource`/`makeCourse` fixtures. */
async function makeAnnouncement(fixture: AnnouncementFixture): Promise<string> {
  sequence += 1;
  const row = await prisma.announcement.create({
    data: {
      title: fixture.title ?? `Announcement ${sequence}`,
      slug: `announcement-${sequence}`,
      content: fixture.content ?? 'Body text.',
      type: fixture.type ?? 'ANNOUNCEMENT',
      authorId: fixture.authorId,
      publishedAt: fixture.published === false ? null : new Date(),
      ...(fixture.deletedAt ? { deletedAt: fixture.deletedAt } : {}),
    },
  });
  return row.id;
}

interface World {
  authorA: { id: string; token: string };
  authorB: { id: string; token: string };
  student: { id: string; token: string };
  admin: { id: string; token: string };
  publishedA: string;
  draftA: string;
  publishedB: string;
  draftB: string;
}

/**
 * Two authors, each with a published post and a draft — on purpose, the same shape as
 * resources.test.ts's `seedWorld`. Every listing assertion below runs against a world
 * holding a second author's rows, so a service that filtered nothing at all would
 * still look right against a world with one author in it.
 */
async function seedWorld(): Promise<World> {
  const authorA = await signIn('teacher-a@example.com', 'TEACHER');
  const authorB = await signIn('teacher-b@example.com', 'TEACHER');
  const student = await signIn('student@example.com', 'STUDENT');
  const admin = await signIn('admin@example.com', 'ADMIN');

  return {
    authorA,
    authorB,
    student,
    admin,
    publishedA: await makeAnnouncement({ authorId: authorA.id, title: 'Published A' }),
    draftA: await makeAnnouncement({ authorId: authorA.id, title: 'Draft A', published: false }),
    publishedB: await makeAnnouncement({ authorId: authorB.id, title: 'Published B' }),
    draftB: await makeAnnouncement({ authorId: authorB.id, title: 'Draft B', published: false }),
  };
}

// --- tests -----------------------------------------------------------------

/**
 * Every case here is a row of `announcement:read` (policy.ts) expressed as rows in a
 * response body — the anonymous and STUDENT rules are both `isPublished`, so the list
 * has to be a WHERE clause, never a subject gate (docs/LESSONS-LEARNED.md #15): a
 * subject-free `can()` denies EVERY caller, admins included.
 */
describe('listing announcements', () => {
  it('serves an anonymous visitor only published announcements, never a draft', async () => {
    const world = await seedWorld();

    const response = await get('/announcements');

    expect(response.statusCode).toBe(200);
    expect(idsOf(response).sort()).toEqual([world.publishedA, world.publishedB].sort());
  });

  it("serves a student only published posts, never someone else's draft", async () => {
    const world = await seedWorld();

    const response = await get('/announcements', world.student.token);

    // policy.ts — STUDENT is `isPublished`, the same rule as anonymous. There is no
    // STUDENT branch that reads `authorId` at all.
    expect(response.statusCode).toBe(200);
    expect(idsOf(response).sort()).toEqual([world.publishedA, world.publishedB].sort());
  });

  it('serves the author their own draft in addition to every published post', async () => {
    const world = await seedWorld();

    const response = await get('/announcements', world.authorA.token);

    expect(response.statusCode).toBe(200);
    // TEACHER is `or(isPublished, isAuthor)`: their own draft joins the published set,
    // but authorB's draft does not — authorship does not make someone else's post theirs.
    expect(idsOf(response).sort()).toEqual(
      [world.publishedA, world.draftA, world.publishedB].sort(),
    );
    expect(idsOf(response)).not.toContain(world.draftB);
  });

  it('serves a teacher who wrote nothing here no more than a stranger sees', async () => {
    const world = await seedWorld();
    const strangerTeacher = await signIn('teacher-stranger@example.com', 'TEACHER');

    const response = await get('/announcements', strangerTeacher.token);

    expect(response.statusCode).toBe(200);
    expect(idsOf(response).sort()).toEqual([world.publishedA, world.publishedB].sort());
  });

  it('serves an admin everything, drafts included', async () => {
    const world = await seedWorld();

    const response = await get('/announcements', world.admin.token);

    expect(response.statusCode).toBe(200);
    expect(idsOf(response).sort()).toEqual(
      [world.publishedA, world.draftA, world.publishedB, world.draftB].sort(),
    );
  });

  it('hides a soft-deleted announcement from everyone, the admin included', async () => {
    const world = await seedWorld();
    await prisma.announcement.update({
      where: { id: world.publishedA },
      data: { deletedAt: new Date() },
    });

    // The soft-delete filter is the WHERE clause's own base term, not part of any role
    // branch (mirrors resources.test.ts:411-418) — an admin whose branch reads nothing
    // at all must still not see this row.
    const admin = await get('/announcements', world.admin.token);
    expect(idsOf(admin)).not.toContain(world.publishedA);

    const author = await get('/announcements', world.authorA.token);
    expect(idsOf(author)).not.toContain(world.publishedA);
  });
});

describe('reading one announcement', () => {
  it('serves a published post to an anonymous caller', async () => {
    const world = await seedWorld();

    const response = await get(`/announcements/${world.publishedA}`);

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(world.publishedA);
  });

  it('refuses an anonymous caller a draft with 401, not 403', async () => {
    const world = await seedWorld();

    // Every denial with a null actor answers 401 (auth.plugin.ts's `authorize`), even
    // though the anonymous rule here is `isPublished` and not a bare `deny` — the
    // caller cannot tell "this needs a session" from "this needs a different session"
    // apart from a resource that has no anonymous row at all.
    const response = await get(`/announcements/${world.draftA}`);

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
  });

  it("refuses a stranger teacher a colleague's draft, naming the rule", async () => {
    const world = await seedWorld();

    const response = await get(`/announcements/${world.draftA}`, world.authorB.token);

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain('TEACHER:or(isPublished, isAuthor)');
  });

  it('refuses a student a draft, naming the rule', async () => {
    const world = await seedWorld();

    const response = await get(`/announcements/${world.draftA}`, world.student.token);

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain('STUDENT:isPublished');
  });

  it('serves the author their own draft, and an admin any draft', async () => {
    const world = await seedWorld();

    const own = await get(`/announcements/${world.draftA}`, world.authorA.token);
    expect(own.statusCode).toBe(200);

    const admin = await get(`/announcements/${world.draftA}`, world.admin.token);
    expect(admin.statusCode).toBe(200);
  });

  it('answers 404 for a soft-deleted row for an admin, 403 for a signed-in stranger', async () => {
    const world = await seedWorld();
    await prisma.announcement.update({
      where: { id: world.publishedA },
      data: { deletedAt: new Date() },
    });

    // Neither `announcement:read` rule reads `deletedAt` (policy.ts) — the loader
    // answers `undefined` for a soft-deleted row exactly as it does for an absent one,
    // so ADMIN:allow passes the gate on an empty subject and the service then reports
    // the only true thing left. Every other rule reads a field that is now absent and
    // must deny (actor.ts), which is why this is 403 and not 404 for anyone else — a
    // 404 here would be an enumeration oracle telling a stranger the row exists.
    const admin = await get(`/announcements/${world.publishedA}`, world.admin.token);
    expect(admin.statusCode).toBe(404);
    expect(admin.json().code).toBe('NOT_FOUND');

    const stranger = await get(`/announcements/${world.publishedA}`, world.authorB.token);
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json().code).toBe('FORBIDDEN');
    expect(stranger.json().detail).toContain('TEACHER:or(isPublished, isAuthor)');

    const student = await get(`/announcements/${world.publishedA}`, world.student.token);
    expect(student.statusCode).toBe(403);
    expect(student.json().detail).toContain('STUDENT:isPublished');
  });

  it('serialises the author summary and derives an excerpt, without leaking credentials', async () => {
    const teacher = await signIn('teacher-dto@example.com', 'TEACHER');
    const student = await signIn('student-dto@example.com', 'STUDENT');
    const longContent = 'x'.repeat(400);
    const id = await makeAnnouncement({ authorId: teacher.id, content: longContent });
    await prisma.comment.create({
      data: { content: 'First!', authorId: student.id, announcementId: id },
    });

    const response = await get(`/announcements/${id}`);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.content).toBe(longContent);
    // "First ~200 characters, built server-side" (announcement.ts) — bounded, and a
    // genuine prefix of the full body rather than something unrelated.
    expect(body.excerpt.length).toBeLessThanOrEqual(210);
    expect(longContent.startsWith(body.excerpt.slice(0, 50))).toBe(true);
    expect(body.commentCount).toBe(1);
    expect(body.author.id).toBe(teacher.id);
    // userSummarySchema is {id,name,role,avatarUrl} (user.ts) — a response schema
    // strips what it does not declare, so the absence is asserted rather than assumed
    // (resources.test.ts:668-674 makes the identical point about `RESOURCE_INCLUDE`).
    expect(body.author).not.toHaveProperty('email');
    expect(body.author).not.toHaveProperty('passwordHash');
  });
});

describe('creating an announcement', () => {
  it('creates a draft by default, authored by the actor', async () => {
    const teacher = await signIn('teacher-create@example.com', 'TEACHER');

    const response = await send(
      'POST',
      '/announcements',
      {
        title: 'New safety policy',
        slug: 'new-safety-policy',
        content: 'Read this.',
        type: 'ANNOUNCEMENT',
      },
      teacher.token,
    );

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.author.id).toBe(teacher.id);
    expect(body.publishedAt).toBeNull();
    expect(body.commentCount).toBe(0);

    const row = await prisma.announcement.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.authorId).toBe(teacher.id);
    expect(row.publishedAt).toBeNull();
  });

  it('publishes immediately when the caller asks for it, setting publishedAt', async () => {
    const teacher = await signIn('teacher-create-pub@example.com', 'TEACHER');

    const response = await send(
      'POST',
      '/announcements',
      {
        title: 'Live from day one',
        slug: 'live-from-day-one',
        content: 'Read this.',
        type: 'ANNOUNCEMENT',
        publish: true,
      },
      teacher.token,
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().publishedAt).toEqual(expect.any(String));
  });

  it('lets an admin create one too', async () => {
    const admin = await signIn('admin-create@example.com', 'ADMIN');

    const response = await send(
      'POST',
      '/announcements',
      {
        title: 'From the office',
        slug: 'from-the-office',
        content: 'Read this.',
        type: 'ANNOUNCEMENT',
      },
      admin.token,
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().author.id).toBe(admin.id);
  });

  it('refuses a student outright, naming deny', async () => {
    const student = await signIn('student-create@example.com', 'STUDENT');

    const response = await send(
      'POST',
      '/announcements',
      { title: 'Student post', slug: 'student-post', content: 'Read this.', type: 'ANNOUNCEMENT' },
      student.token,
    );

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain('STUDENT:deny');
    expect(await prisma.announcement.count({ where: { slug: 'student-post' } })).toBe(0);
  });

  it('refuses an anonymous caller with 401', async () => {
    const response = await send('POST', '/announcements', {
      title: 'Anon post',
      slug: 'anon-post',
      content: 'Read this.',
      type: 'ANNOUNCEMENT',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
  });
});

describe('publishing', () => {
  it('publishes a draft, setting publishedAt, and is idempotent on a second call', async () => {
    const teacher = await signIn('teacher-publish@example.com', 'TEACHER');
    const id = await makeAnnouncement({ authorId: teacher.id, published: false });
    // A fixed past instant, not "now" — so a re-stamp on the second call is something
    // this assertion can actually catch, rather than two `Date.now()` calls that might
    // coincidentally land in the same millisecond.
    const fixedInstant = new Date('2020-06-01T00:00:00.000Z');
    await prisma.announcement.update({ where: { id }, data: { publishedAt: fixedInstant } });

    const again = await send(
      'POST',
      `/announcements/${id}/publish`,
      { published: true },
      teacher.token,
    );

    expect(again.statusCode).toBe(200);
    expect(again.json().publishedAt).toBe(fixedInstant.toISOString());

    const row = await prisma.announcement.findUniqueOrThrow({ where: { id } });
    expect(row.publishedAt).toEqual(fixedInstant);
  });

  it('publishes and unpublishes through the one verb', async () => {
    const teacher = await signIn('teacher-toggle@example.com', 'TEACHER');
    const id = await makeAnnouncement({ authorId: teacher.id, published: false });

    const published = await send(
      'POST',
      `/announcements/${id}/publish`,
      { published: true },
      teacher.token,
    );
    expect(published.statusCode).toBe(200);
    expect(published.json().publishedAt).toEqual(expect.any(String));

    const withdrawn = await send(
      'POST',
      `/announcements/${id}/publish`,
      { published: false },
      teacher.token,
    );
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json().publishedAt).toBeNull();
  });

  it('refuses a stranger teacher, naming isAuthor', async () => {
    const owner = await signIn('teacher-publish-owner@example.com', 'TEACHER');
    const stranger = await signIn('teacher-publish-stranger@example.com', 'TEACHER');
    const id = await makeAnnouncement({ authorId: owner.id, published: false });

    const response = await send(
      'POST',
      `/announcements/${id}/publish`,
      { published: true },
      stranger.token,
    );

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain('TEACHER:isAuthor');
    const row = await prisma.announcement.findUniqueOrThrow({ where: { id } });
    expect(row.publishedAt).toBeNull();
  });

  it("lets an admin publish anyone's draft, and refuses a student outright", async () => {
    const owner = await signIn('teacher-publish-owner2@example.com', 'TEACHER');
    const admin = await signIn('admin-publish@example.com', 'ADMIN');
    const student = await signIn('student-publish@example.com', 'STUDENT');
    const id = await makeAnnouncement({ authorId: owner.id, published: false });

    const asAdmin = await send(
      'POST',
      `/announcements/${id}/publish`,
      { published: true },
      admin.token,
    );
    expect(asAdmin.statusCode).toBe(200);

    const asStudent = await send(
      'POST',
      `/announcements/${id}/publish`,
      { published: false },
      student.token,
    );
    expect(asStudent.statusCode).toBe(403);
    expect(asStudent.json().detail).toContain('STUDENT:deny');
  });
});

describe('updating and deleting', () => {
  it('lets the author edit, and refuses a stranger by name', async () => {
    const owner = await signIn('teacher-patch@example.com', 'TEACHER');
    const stranger = await signIn('teacher-patch-b@example.com', 'TEACHER');
    const id = await makeAnnouncement({ authorId: owner.id, title: 'Original title' });

    const edited = await send(
      'PATCH',
      `/announcements/${id}`,
      { title: 'Revised title' },
      owner.token,
    );
    expect(edited.statusCode).toBe(200);
    expect(edited.json().title).toBe('Revised title');

    const refused = await send(
      'PATCH',
      `/announcements/${id}`,
      { title: 'Hijacked title' },
      stranger.token,
    );
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('FORBIDDEN');
    expect(refused.json().detail).toContain('TEACHER:isAuthor');

    const row = await prisma.announcement.findUniqueOrThrow({ where: { id } });
    expect(row.title).toBe('Revised title');
  });

  it('refuses a student from editing, naming deny', async () => {
    const owner = await signIn('teacher-patch-c@example.com', 'TEACHER');
    const student = await signIn('student-patch@example.com', 'STUDENT');
    const id = await makeAnnouncement({ authorId: owner.id });

    const response = await send(
      'PATCH',
      `/announcements/${id}`,
      { title: 'New title' },
      student.token,
    );

    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('STUDENT:deny');
  });

  it('soft-deletes: 204, the row survives with deletedAt set, and the list drops it', async () => {
    const teacher = await signIn('teacher-delete@example.com', 'TEACHER');
    const id = await makeAnnouncement({ authorId: teacher.id });

    const response = await send('DELETE', `/announcements/${id}`, undefined, teacher.token);
    expect(response.statusCode).toBe(204);

    const row = await prisma.announcement.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).not.toBeNull();

    const admin = await signIn('admin-delete-check@example.com', 'ADMIN');
    expect(idsOf(await get('/announcements', admin.token))).not.toContain(id);
  });

  it('refuses DELETE from a stranger teacher, naming the rule, and lets an admin delete anyone', async () => {
    const owner = await signIn('teacher-delete-owner@example.com', 'TEACHER');
    const stranger = await signIn('teacher-delete-stranger@example.com', 'TEACHER');
    const admin = await signIn('admin-delete2@example.com', 'ADMIN');
    const id = await makeAnnouncement({ authorId: owner.id });

    const refused = await send('DELETE', `/announcements/${id}`, undefined, stranger.token);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('FORBIDDEN');
    expect(refused.json().detail).toContain('announcement:delete');
    expect(refused.json().detail).toContain('TEACHER:isAuthor');
    expect((await prisma.announcement.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();

    const removed = await send('DELETE', `/announcements/${id}`, undefined, admin.token);
    expect(removed.statusCode).toBe(204);
  });

  it('refuses a second delete and any edit of an already soft-deleted row, even for an admin', async () => {
    const teacher = await signIn('teacher-gone@example.com', 'TEACHER');
    const admin = await signIn('admin-gone@example.com', 'ADMIN');
    const id = await makeAnnouncement({ authorId: teacher.id, title: 'Original title' });

    const first = await send('DELETE', `/announcements/${id}`, undefined, admin.token);
    expect(first.statusCode).toBe(204);

    const again = await send('DELETE', `/announcements/${id}`, undefined, admin.token);
    expect(again.statusCode).toBe(404);
    expect(again.json().code).toBe('NOT_FOUND');

    const edit = await send(
      'PATCH',
      `/announcements/${id}`,
      { title: 'Back from the dead' },
      admin.token,
    );
    expect(edit.statusCode).toBe(404);
    expect(edit.json().code).toBe('NOT_FOUND');

    const row = await prisma.announcement.findUniqueOrThrow({ where: { id } });
    expect(row.title).toBe('Original title');
  });

  it('tells an absent id apart by role: 404 for an admin, 403 for everyone else', async () => {
    const world = await seedWorld();

    const admin = await get(`/announcements/${ABSENT_ID}`, world.admin.token);
    expect(admin.statusCode).toBe(404);
    expect(admin.json().code).toBe('NOT_FOUND');

    // Every non-ADMIN rule reads a field on a subject that does not exist, and a rule
    // that reads an absent field must deny (actor.ts) — so a non-admin is refused and
    // learns nothing about whether the row exists. A 404 here would be an enumeration
    // oracle.
    const teacher = await get(`/announcements/${ABSENT_ID}`, world.authorA.token);
    expect(teacher.statusCode).toBe(403);
    expect(teacher.json().detail).toContain('TEACHER:or(isPublished, isAuthor)');

    const removed = await send(
      'DELETE',
      `/announcements/${ABSENT_ID}`,
      undefined,
      world.admin.token,
    );
    expect(removed.statusCode).toBe(404);
    expect(removed.json().code).toBe('NOT_FOUND');
  });
});
