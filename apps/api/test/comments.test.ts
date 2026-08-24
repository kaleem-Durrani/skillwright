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
 * `resetDatabase()` (setup.ts:110-119) already clears Comment, Announcement, Resource,
 * Enrollment, Course, User and Department in FK-safe order, so it alone is enough for
 * every table this file writes to. This local helper exists only for `afterAll`: it
 * clears the Restrict-adjacent rows — `Course.teacherId`, `Resource.authorId` and
 * `Announcement.authorId` are all `onDelete: Restrict` (schema.prisma:321,435,473) —
 * without also deleting Department and User, which is `resetDatabase()`'s job at the
 * START of the next file's `beforeEach`. Same division of labour resources.test.ts's
 * `clearAcademicRows` uses; no Upload fixtures here, so there is nothing of the kind
 * that helper additionally clears for the CHECK-constraint reason it documents.
 */
async function clearAcademicRows(): Promise<void> {
  await prisma.comment.deleteMany({});
  await prisma.resource.deleteMany({});
  await prisma.enrollment.deleteMany({});
  await prisma.course.deleteMany({});
  await prisma.announcement.deleteMany({});
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

interface FieldErrorLike {
  path: string;
  message: string;
}

function errorAt(
  response: { json: () => { errors?: FieldErrorLike[] } },
  path: string,
): FieldErrorLike | undefined {
  return response.json().errors?.find((error) => error.path === path);
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

/** Published unless asked otherwise — copied from resources.test.ts:179-198. */
async function makeCourse(
  teacherId: string,
  options: { published?: boolean } = {},
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
      publishedAt: options.published === false ? null : new Date(),
    },
  });
  // Phase 9: every course gets at least one intake so enrollment fixtures have a
  // seat to attach to.
  await prisma.courseOffering.create({ data: { courseId: course.id, capacity: 10 } });
  return course.id;
}

interface ResourceFixture {
  courseId: string;
  authorId: string;
  isPublic?: boolean;
  title?: string;
  deletedAt?: Date;
}

/** LINK only — no fixture here ever needs an Upload row. Copied from resources.test.ts:227-249. */
async function makeResource(fixture: ResourceFixture): Promise<string> {
  sequence += 1;
  const row = await prisma.resource.create({
    data: {
      title: fixture.title ?? `Resource ${sequence}`,
      type: 'LINK',
      externalUrl: `https://example.com/${sequence}`,
      courseId: fixture.courseId,
      authorId: fixture.authorId,
      isPublic: fixture.isPublic ?? false,
      ...(fixture.deletedAt ? { deletedAt: fixture.deletedAt } : {}),
    },
  });
  return row.id;
}

interface AnnouncementFixture {
  authorId: string;
  published?: boolean;
}

async function makeAnnouncement(fixture: AnnouncementFixture): Promise<string> {
  sequence += 1;
  const row = await prisma.announcement.create({
    data: {
      title: `Announcement ${sequence}`,
      slug: `announcement-${sequence}`,
      content: 'Body text.',
      type: 'ANNOUNCEMENT',
      authorId: fixture.authorId,
      publishedAt: fixture.published === false ? null : new Date(),
    },
  });
  return row.id;
}

async function enrol(
  studentId: string,
  courseId: string,
  status: 'PENDING' | 'APPROVED',
): Promise<void> {
  // Seats are per-intake since Phase 9; the fixture's course has exactly one.
  const offering = await prisma.courseOffering.findFirstOrThrow({
    where: { courseId, deletedAt: null },
    select: { id: true },
  });
  await prisma.enrollment.create({
    data: { studentId, offeringId: offering.id, status },
  });
}

interface CommentFixture {
  authorId: string;
  content?: string;
  resourceId?: string;
  announcementId?: string;
  parentId?: string;
  deletedAt?: Date;
}

/** Written straight to the table, exactly like resources.test.ts's `makeResource` writes
 * a row zod would also accept — these fixtures build the WORLD the policy is checked
 * against, not the create endpoint's own validation, which has its own tests below. */
async function makeComment(fixture: CommentFixture): Promise<string> {
  sequence += 1;
  const row = await prisma.comment.create({
    data: {
      content: fixture.content ?? `Comment ${sequence}`,
      authorId: fixture.authorId,
      ...(fixture.resourceId ? { resourceId: fixture.resourceId } : {}),
      ...(fixture.announcementId ? { announcementId: fixture.announcementId } : {}),
      ...(fixture.parentId ? { parentId: fixture.parentId } : {}),
      ...(fixture.deletedAt ? { deletedAt: fixture.deletedAt } : {}),
    },
  });
  return row.id;
}

interface World {
  teacherA: { id: string; token: string };
  teacherB: { id: string; token: string };
  approved: { id: string; token: string };
  pending: { id: string; token: string };
  admin: { id: string; token: string };
  courseA: string;
  publicResource: string;
  privateResource: string;
  onPublic: string;
  onPrivate: string;
}

/**
 * One course (teacherA's), a public and a private resource in it, a comment on each —
 * plus a second teacher and an APPROVED/PENDING student pair, the same shape
 * resources.test.ts's `seedWorld` uses so the resource-visibility rules being bounded
 * against are the exact ones that module's own suite already exercises.
 */
async function seedWorld(): Promise<World> {
  const teacherA = await signIn('teacher-a@example.com', 'TEACHER');
  const teacherB = await signIn('teacher-b@example.com', 'TEACHER');
  const approved = await signIn('student-approved@example.com', 'STUDENT');
  const pending = await signIn('student-pending@example.com', 'STUDENT');
  const admin = await signIn('admin@example.com', 'ADMIN');

  const courseA = await makeCourse(teacherA.id);
  await enrol(approved.id, courseA, 'APPROVED');
  await enrol(pending.id, courseA, 'PENDING');

  const publicResource = await makeResource({
    courseId: courseA,
    authorId: teacherA.id,
    isPublic: true,
  });
  const privateResource = await makeResource({
    courseId: courseA,
    authorId: teacherA.id,
    isPublic: false,
  });

  return {
    teacherA,
    teacherB,
    approved,
    pending,
    admin,
    courseA,
    publicResource,
    privateResource,
    onPublic: await makeComment({ authorId: approved.id, resourceId: publicResource }),
    onPrivate: await makeComment({ authorId: teacherA.id, resourceId: privateResource }),
  };
}

// --- tests -----------------------------------------------------------------

/*
 * `comment:read` is `allow` for every authenticated role (policy.ts) — it is in
 * `SUBJECT_INDEPENDENT_ACTIONS`, so the route's own gate cannot be where a private
 * resource's comments are kept private; there is no per-row field for it to read.
 * The bound has to live in the WHERE clause the list query builds, mirroring the
 * resource's OWN visibility rows the same way `resource:read`'s `and(isPublic,
 * isPublished)` bounds a resource by its course (docs/LESSONS-LEARNED.md #33: "a
 * child object's own visibility flag can outrank its parent's" — here the child is
 * the comment and the parent is the resource).
 */
describe("listing a resource's comments — bounded by the resource's own visibility", () => {
  it('serves a caller who can read the resource its top-level comments', async () => {
    const world = await seedWorld();

    const response = await get(
      `/comments?resourceId=${world.publicResource}`,
      world.approved.token,
    );

    expect(response.statusCode).toBe(200);
    expect(idsOf(response)).toContain(world.onPublic);
  });

  it('does not list a comment on a private resource to a caller who cannot read that resource', async () => {
    const world = await seedWorld();

    // PENDING is not APPROVED (`enrolledApproved`, combinators.ts) — the same student
    // whose enrolment is in courseA at all, so this is not merely "wrong course."
    const response = await get(
      `/comments?resourceId=${world.privateResource}`,
      world.pending.token,
    );

    // 200, not 403: `comment:read` itself never denies an authenticated caller. The
    // comment is simply absent from what the query returns — "not listed," never
    // "refused" — which is the whole reason this is the important case: a service
    // that forgot the bound answers 200 too, with the private comment sitting right
    // there in `data`.
    expect(response.statusCode).toBe(200);
    expect(idsOf(response)).not.toContain(world.onPrivate);
    expect(idsOf(response)).toEqual([]);

    // Same query, a teacher who owns neither the course nor the comment: same answer.
    const stranger = await get(
      `/comments?resourceId=${world.privateResource}`,
      world.teacherB.token,
    );
    expect(stranger.statusCode).toBe(200);
    expect(idsOf(stranger)).not.toContain(world.onPrivate);
  });

  it('still serves the resource owner and an admin the comment on a private resource', async () => {
    const world = await seedWorld();

    const owner = await get(`/comments?resourceId=${world.privateResource}`, world.teacherA.token);
    expect(owner.statusCode).toBe(200);
    expect(idsOf(owner)).toContain(world.onPrivate);

    const admin = await get(`/comments?resourceId=${world.privateResource}`, world.admin.token);
    expect(admin.statusCode).toBe(200);
    expect(idsOf(admin)).toContain(world.onPrivate);
  });

  it('hides every comment on a soft-deleted resource, the admin included', async () => {
    const world = await seedWorld();
    await prisma.resource.update({
      where: { id: world.publicResource },
      data: { deletedAt: new Date() },
    });

    const response = await get(`/comments?resourceId=${world.publicResource}`, world.admin.token);

    expect(response.statusCode).toBe(200);
    expect(idsOf(response)).not.toContain(world.onPublic);
  });

  it('hides a soft-deleted comment itself from the listing', async () => {
    const world = await seedWorld();
    const doomed = await makeComment({
      authorId: world.approved.id,
      resourceId: world.publicResource,
    });
    await prisma.comment.update({ where: { id: doomed }, data: { deletedAt: new Date() } });

    const response = await get(
      `/comments?resourceId=${world.publicResource}`,
      world.teacherA.token,
    );

    expect(response.statusCode).toBe(200);
    expect(idsOf(response)).not.toContain(doomed);
    expect(idsOf(response)).toContain(world.onPublic);
  });

  it('lists only top-level comments by default, and a thread with parentId', async () => {
    const world = await seedWorld();
    const reply = await makeComment({
      authorId: world.teacherA.id,
      resourceId: world.publicResource,
      parentId: world.onPublic,
    });

    const topLevel = await get(
      `/comments?resourceId=${world.publicResource}`,
      world.approved.token,
    );
    expect(idsOf(topLevel)).toContain(world.onPublic);
    expect(idsOf(topLevel)).not.toContain(reply);

    const thread = await get(
      `/comments?resourceId=${world.publicResource}&parentId=${world.onPublic}`,
      world.approved.token,
    );
    expect(idsOf(thread)).toEqual([reply]);
  });
});

/** The same bound, on the other parent — announcements have their own visibility rows
 * (`announcement:read`, policy.ts), and a comment must not be more visible than the
 * post it hangs off, whichever table it hangs off. */
describe("listing an announcement's comments — bounded the same way", () => {
  it('does not list a comment on a draft announcement to a caller who cannot read it', async () => {
    const owner = await signIn('teacher-ann-owner@example.com', 'TEACHER');
    const stranger = await signIn('teacher-ann-stranger@example.com', 'TEACHER');
    const admin = await signIn('admin-ann@example.com', 'ADMIN');
    const draftId = await makeAnnouncement({ authorId: owner.id, published: false });
    const commentId = await makeComment({ authorId: owner.id, announcementId: draftId });

    const strangerView = await get(`/comments?announcementId=${draftId}`, stranger.token);
    expect(strangerView.statusCode).toBe(200);
    expect(idsOf(strangerView)).not.toContain(commentId);

    const ownerView = await get(`/comments?announcementId=${draftId}`, owner.token);
    expect(idsOf(ownerView)).toContain(commentId);

    const adminView = await get(`/comments?announcementId=${draftId}`, admin.token);
    expect(idsOf(adminView)).toContain(commentId);
  });
});

describe('creating a comment', () => {
  it('lets a student comment on a resource they can read', async () => {
    const world = await seedWorld();

    const response = await send(
      'POST',
      '/comments',
      { resourceId: world.publicResource, content: 'Great write-up.' },
      world.approved.token,
    );

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.author.id).toBe(world.approved.id);
    expect(body.resourceId).toBe(world.publicResource);
    expect(body.announcementId).toBeNull();
    expect(body.parentId).toBeNull();
    expect(body.replyCount).toBe(0);
    expect(body.editedAt).toBeNull();
    // The commenter always owns what they just wrote.
    expect(body.canEdit).toBe(true);
    expect(body.canDelete).toBe(true);
  });

  it('refuses a comment on a resource the caller cannot read, naming the RESOURCE rule', async () => {
    const world = await seedWorld();

    const response = await send(
      'POST',
      '/comments',
      { resourceId: world.privateResource, content: 'Sneaking in.' },
      world.pending.token,
    );

    // `comment:create` is `allow` for STUDENT (policy.ts) — the gate alone would let
    // this through. What refuses it is the SAME bound the listing test above proves:
    // the service checks `resource:read` against the actual resource before writing,
    // and the rule it names is the RESOURCE's, not a comment-shaped one — the exact
    // rule string `resources.test.ts:619-621` asserts for `GET /resources/:id`.
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain(
      'STUDENT:or(and(isPublic, isPublished), enrolledApproved)',
    );
    expect(await prisma.comment.count({ where: { resourceId: world.privateResource } })).toBe(1);
  });

  it('refuses a comment on a draft announcement the caller cannot read, naming the rule', async () => {
    const owner = await signIn('teacher-ann-create@example.com', 'TEACHER');
    const student = await signIn('student-ann-create@example.com', 'STUDENT');
    const draftId = await makeAnnouncement({ authorId: owner.id, published: false });

    const response = await send(
      'POST',
      '/comments',
      { announcementId: draftId, content: 'Too early.' },
      student.token,
    );

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain('STUDENT:isPublished');
    expect(await prisma.comment.count({ where: { announcementId: draftId } })).toBe(0);
  });

  it('refuses a body naming both a resource and an announcement', async () => {
    const world = await seedWorld();
    const announcementId = await makeAnnouncement({ authorId: world.teacherA.id });

    const response = await send(
      'POST',
      '/comments',
      { resourceId: world.publicResource, announcementId, content: 'Two parents.' },
      world.approved.token,
    );

    // The CHECK's own zod mirror (comment.ts's `superRefine`): `num_nonnulls(...) = 1`
    // stays a backstop instead of the error message a caller has to read.
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(errorAt(response, 'resourceId')).toBeDefined();
  });

  it('refuses a body naming neither a resource nor an announcement', async () => {
    const world = await seedWorld();

    const response = await send(
      'POST',
      '/comments',
      { content: 'No parent at all.' },
      world.approved.token,
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(errorAt(response, 'resourceId')).toBeDefined();
  });

  it("creates a reply, and the parent's replyCount reflects it", async () => {
    const world = await seedWorld();

    const reply = await send(
      'POST',
      '/comments',
      { resourceId: world.publicResource, parentId: world.onPublic, content: 'Agreed.' },
      world.teacherA.token,
    );
    expect(reply.statusCode).toBe(201);
    expect(reply.json().parentId).toBe(world.onPublic);

    const topLevel = await get(
      `/comments?resourceId=${world.publicResource}`,
      world.teacherA.token,
    );
    const parentRow = topLevel.json().data.find((row: { id: string }) => row.id === world.onPublic);
    expect(parentRow.replyCount).toBe(1);
  });

  it('refuses a student outright when the destination is denied for their own reason', async () => {
    // Not a policy denial at all — proof that the 401 path still works with a real
    // course/resource/actor in the world, and that comment:create requires a session:
    // `comment:create` anonymous is `deny` (policy.ts).
    const world = await seedWorld();

    const response = await send('POST', '/comments', {
      resourceId: world.publicResource,
      content: 'Anonymous drive-by.',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
  });
});

describe('updating and deleting', () => {
  it('lets the author edit their own comment, setting editedAt', async () => {
    const world = await seedWorld();
    const id = await makeComment({ authorId: world.approved.id, resourceId: world.publicResource });

    const response = await send(
      'PATCH',
      `/comments/${id}`,
      { content: 'Edited.' },
      world.approved.token,
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().content).toBe('Edited.');
    expect(response.json().editedAt).toEqual(expect.any(String));
  });

  it('refuses anyone else from editing — even the course-owning teacher and an admin — naming isAuthor', async () => {
    const world = await seedWorld();
    const id = await makeComment({ authorId: world.approved.id, resourceId: world.publicResource });

    // `comment:update` is `isAuthor` for every role, ADMIN included (policy.ts):
    // "Editing is authorship only, for everyone. An admin who wants text gone
    // deletes it, which leaves an audit row."
    const teacher = await send(
      'PATCH',
      `/comments/${id}`,
      { content: 'Overwritten' },
      world.teacherA.token,
    );
    expect(teacher.statusCode).toBe(403);
    expect(teacher.json().code).toBe('FORBIDDEN');
    expect(teacher.json().detail).toContain('TEACHER:isAuthor');

    const admin = await send(
      'PATCH',
      `/comments/${id}`,
      { content: 'Overwritten' },
      world.admin.token,
    );
    expect(admin.statusCode).toBe(403);
    expect(admin.json().detail).toContain('ADMIN:isAuthor');

    const row = await prisma.comment.findUniqueOrThrow({ where: { id } });
    expect(row.content).not.toBe('Overwritten');
  });

  it('lets the author delete their own comment, which is a soft delete', async () => {
    const world = await seedWorld();
    const id = await makeComment({ authorId: world.approved.id, resourceId: world.publicResource });

    const response = await send('DELETE', `/comments/${id}`, undefined, world.approved.token);

    expect(response.statusCode).toBe(204);
    const row = await prisma.comment.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).not.toBeNull();

    const list = await get(`/comments?resourceId=${world.publicResource}`, world.approved.token);
    expect(idsOf(list)).not.toContain(id);
  });

  it("lets the course-owning teacher moderate a student's comment on their own resource", async () => {
    const world = await seedWorld();
    const id = await makeComment({ authorId: world.approved.id, resourceId: world.publicResource });

    // `TEACHER: or(isAuthor, ownsCourse)` — the moderation branch, not authorship.
    const response = await send('DELETE', `/comments/${id}`, undefined, world.teacherA.token);

    expect(response.statusCode).toBe(204);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
  });

  it('refuses a teacher who does not own the course from deleting, naming the rule', async () => {
    const world = await seedWorld();
    const id = await makeComment({ authorId: world.approved.id, resourceId: world.publicResource });

    const response = await send('DELETE', `/comments/${id}`, undefined, world.teacherB.token);

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain('comment:delete');
    expect(response.json().detail).toContain('TEACHER:or(isAuthor, ownsCourse)');
    expect((await prisma.comment.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
  });

  it('refuses a non-author teacher from deleting a comment on an announcement, where there is no course to own', async () => {
    const owner = await signIn('teacher-ann-mod-owner@example.com', 'TEACHER');
    const other = await signIn('teacher-ann-mod-other@example.com', 'TEACHER');
    const announcementId = await makeAnnouncement({ authorId: owner.id });
    const id = await makeComment({ authorId: owner.id, announcementId });

    // `ownsCourse` reads `subject.courseTeacherId` (combinators.ts), which the
    // loader has nothing to populate for an announcement-hung comment — an absent
    // field must deny (actor.ts), so this teacher has ONLY `isAuthor` to fall back
    // on, and they are not the author.
    const response = await send('DELETE', `/comments/${id}`, undefined, other.token);

    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('TEACHER:or(isAuthor, ownsCourse)');
    expect((await prisma.comment.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
  });

  it("refuses a student from deleting someone else's comment, naming isAuthor", async () => {
    const world = await seedWorld();
    const id = await makeComment({ authorId: world.teacherA.id, resourceId: world.publicResource });

    const response = await send('DELETE', `/comments/${id}`, undefined, world.approved.token);

    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('STUDENT:isAuthor');
  });

  it('lets an admin delete any comment outright', async () => {
    const world = await seedWorld();
    const id = await makeComment({ authorId: world.approved.id, resourceId: world.publicResource });

    const response = await send('DELETE', `/comments/${id}`, undefined, world.admin.token);

    expect(response.statusCode).toBe(204);
  });

  it('refuses a second delete of an already soft-deleted comment, and every edit of it — even by an admin', async () => {
    const world = await seedWorld();
    const id = await makeComment({ authorId: world.approved.id, resourceId: world.publicResource });

    const first = await send('DELETE', `/comments/${id}`, undefined, world.admin.token);
    expect(first.statusCode).toBe(204);

    // `comment:delete` ADMIN is `allow`, which reads no field — the gate passes on the
    // `undefined` subject a deleted row's loader now returns, and the service answers
    // the only true thing left.
    const again = await send('DELETE', `/comments/${id}`, undefined, world.admin.token);
    expect(again.statusCode).toBe(404);
    expect(again.json().code).toBe('NOT_FOUND');

    // `comment:update` has no `allow` role at all — ADMIN is `isAuthor` too
    // (policy.ts: "Editing is authorship only, for everyone") — so there is no caller
    // for whom this gate passes through to a truthful 404 on a deleted row. Even the
    // platform's most privileged actor is refused at the GATE, on the subject the
    // loader can no longer supply, which is a genuinely different answer from the
    // DELETE case one line up.
    const edit = await send(
      'PATCH',
      `/comments/${id}`,
      { content: 'Resurrected' },
      world.admin.token,
    );
    expect(edit.statusCode).toBe(403);
    expect(edit.json().code).toBe('FORBIDDEN');
    expect(edit.json().detail).toContain('ADMIN:isAuthor');
  });
});

/**
 * `canEdit`/`canDelete` (comment.ts) exist so the SPA never re-derives policy — they
 * have to equal exactly what `can()` would answer for the VIEWER, not the author, on
 * both actions. Each case below is one cell of `comment:update` / `comment:delete`
 * (policy.ts) read back out of the DTO instead of out of a 403.
 */
describe('canEdit and canDelete match what the policy allows the viewer', () => {
  it("marks the author's own comment editable and deletable", async () => {
    const world = await seedWorld();
    const id = await makeComment({ authorId: world.approved.id, resourceId: world.publicResource });

    const response = await get(
      `/comments?resourceId=${world.publicResource}`,
      world.approved.token,
    );
    const row = response.json().data.find((c: { id: string }) => c.id === id);

    expect(row).toMatchObject({ canEdit: true, canDelete: true });
  });

  it("marks a stranger student's view of someone else's comment as neither", async () => {
    const world = await seedWorld();
    const id = await makeComment({ authorId: world.teacherA.id, resourceId: world.publicResource });

    const response = await get(
      `/comments?resourceId=${world.publicResource}`,
      world.approved.token,
    );
    const row = response.json().data.find((c: { id: string }) => c.id === id);

    expect(row).toMatchObject({ canEdit: false, canDelete: false });
  });

  it("marks the course-owning teacher's view of a student's comment as deletable but not editable", async () => {
    const world = await seedWorld();
    const id = await makeComment({ authorId: world.approved.id, resourceId: world.publicResource });

    const response = await get(
      `/comments?resourceId=${world.publicResource}`,
      world.teacherA.token,
    );
    const row = response.json().data.find((c: { id: string }) => c.id === id);

    // TEACHER:isAuthor for update, TEACHER:or(isAuthor, ownsCourse) for delete — the
    // same asymmetry the DELETE tests above prove from the other side, read here off
    // the DTO a LIST response hands back instead of off a mutation's result.
    expect(row).toMatchObject({ canEdit: false, canDelete: true });
  });

  it("marks a non-owning teacher's view of the same comment as neither", async () => {
    const world = await seedWorld();
    const id = await makeComment({ authorId: world.approved.id, resourceId: world.publicResource });

    const response = await get(
      `/comments?resourceId=${world.publicResource}`,
      world.teacherB.token,
    );
    const row = response.json().data.find((c: { id: string }) => c.id === id);

    expect(row).toMatchObject({ canEdit: false, canDelete: false });
  });

  it("marks an admin's view of anyone's comment as deletable but not editable", async () => {
    const world = await seedWorld();
    const id = await makeComment({ authorId: world.approved.id, resourceId: world.publicResource });

    const response = await get(`/comments?resourceId=${world.publicResource}`, world.admin.token);
    const row = response.json().data.find((c: { id: string }) => c.id === id);

    // ADMIN:isAuthor for update (not `allow` — the update PATCH test above proves an
    // admin is actually refused when they try), ADMIN:allow for delete.
    expect(row).toMatchObject({ canEdit: false, canDelete: true });
  });
});
