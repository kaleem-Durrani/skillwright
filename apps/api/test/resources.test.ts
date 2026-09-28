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
 * A well-formed id that names no row anywhere.
 *
 * `idSchema` accepts a cuid OR a ULID (common.ts:17-22), so this is a syntactically
 * valid ULID of the shape `packages/db/prisma/seed.ts` produces. It has to be
 * well-formed: a malformed id is refused by `idParamSchema` with a 422 before the
 * preHandler runs, and these cases are about what the POLICY does with a subject that
 * came back `undefined` (resources.service.ts:143), not about zod.
 */
const ABSENT_ID = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

let app: AppInstance;
let departmentId: string;
let sequence = 0;

/**
 * setup.ts:110-119 clears these tables too, but a suite that leaves a course or a
 * resource behind breaks the NEXT file's reset: `Course.teacherId` and
 * `Resource.authorId` are both `onDelete: Restrict` in schema.prisma, so the
 * user delete inside `resetDatabase()` fails while either row survives — and it fails
 * in someone else's suite, not this one.
 *
 * The order is load-bearing at both ends, and for DIFFERENT reasons at each, which is
 * why it is written down rather than trusted to read off the code.
 *
 * Comments cascade off a resource, so deleting them first is belt-and-braces: the
 * dependency is stated rather than relied upon.
 *
 * Uploads go AFTER resources because `Resource.uploadId` is `onDelete: Restrict`, so
 * the database REFUSES the delete while any resource row still points at the object.
 * That is the whole reason. This comment previously said `SetNull` and argued that
 * nulling the column under a live DOCUMENT row would trip migration 0002's CHECK that
 * exactly one of `uploadId` / `externalUrl` is set — an argument about a nulling that
 * cannot happen, and one that described a real SetNull-vs-CHECK conflict that has not
 * existed since migration 0003 made the relation `Restrict`. The Restrict is also the
 * same choice `Submission.uploadId` and `StudentQualification.artifactUploadId` make,
 * and for the same reason: the bytes ARE the thing, and clearing the pointer would
 * degrade quietly to a row that has lost its content.
 *
 * A stale anchor is a nuisance. A stale CLAIM is a trap: the next person reads it,
 * believes deletion order is negotiable, and discovers otherwise at 2am.
 */
async function clearAcademicRows(): Promise<void> {
  await prisma.comment.deleteMany({});
  await prisma.resource.deleteMany({});
  await prisma.upload.deleteMany({});
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

/**
 * Two prefixes are in play — `/resources` and the course-nested list — so these take a
 * whole path under the API base rather than baking in one module's prefix the way
 * enrollments.test.ts:63-78 does.
 */
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

/** Ids of a paginated body, so the set comparisons below read as one line. */
function idsOf(response: { json: () => { data: Array<{ id: string }> } }): string[] {
  return response.json().data.map((row) => row.id);
}

/** The `{ path, message }` pairs a 422 carries (errors.plugin.ts:126-135). */
interface FieldErrorLike {
  path: string;
  message: string;
}

function errorsOf(response: { json: () => { errors?: FieldErrorLike[] } }): FieldErrorLike[] {
  return response.json().errors ?? [];
}

/**
 * A validation error looked up BY ITS PATH, never by array position.
 *
 * `exactlyOneSource` can raise two issues from one body (resource.ts:39-63) and zod's
 * ordering is an implementation detail, so `errors[0]` quietly asserts the wrong thing
 * the moment a second issue joins it. The path is what the SPA renders a message
 * against, and `fastifyValidationErrors` flattens `instancePath` into exactly this key
 * (errors.plugin.ts:24-33).
 */
function errorAt(
  response: { json: () => { errors?: FieldErrorLike[] } },
  path: string,
): FieldErrorLike | undefined {
  return errorsOf(response).find((error) => error.path === path);
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

/**
 * Published unless a test says otherwise. The nested list is gated on `course:read`
 * (`POLICY`), whose anonymous and non-owning-teacher rows are `isPublished` —
 * a draft course would refuse those callers at the gate and prove nothing about the row
 * filtering underneath it.
 */
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
  // Phase 9: one intake per fixture course.
  await prisma.courseOffering.create({ data: { courseId: course.id, capacity: 10 } });
  return course.id;
}

async function makeUpload(ownerId: string): Promise<string> {
  sequence += 1;
  const upload = await prisma.upload.create({
    data: {
      key: `resources/fixture-${sequence}.pdf`,
      bucket: 'skillwright-uploads',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      originalName: 'safety-handbook.pdf',
      status: 'COMMITTED',
      committedAt: new Date(),
      ownerId,
    },
  });
  return upload.id;
}

interface ResourceFixture {
  courseId: string;
  authorId: string;
  isPublic?: boolean;
  title?: string;
  deletedAt?: Date;
  createdAt?: Date;
  uploadId?: string;
}

/**
 * `type: 'LINK'` with an `externalUrl` and no upload unless one is named: migration 0002
 * CHECKs that exactly one of the two columns is set (migration 0002, over
 * `Resource.uploadId` / `Resource.externalUrl`), so a fixture
 * that sets both — or neither — fails in the database rather than in an assertion.
 */
async function makeResource(fixture: ResourceFixture): Promise<string> {
  sequence += 1;
  const row = await prisma.resource.create({
    data: {
      title: fixture.title ?? `Resource ${sequence}`,
      type: fixture.uploadId ? 'DOCUMENT' : 'LINK',
      ...(fixture.uploadId
        ? { uploadId: fixture.uploadId }
        : { externalUrl: `https://example.com/${sequence}` }),
      courseId: fixture.courseId,
      authorId: fixture.authorId,
      isPublic: fixture.isPublic ?? false,
      ...(fixture.deletedAt ? { deletedAt: fixture.deletedAt } : {}),
      ...(fixture.createdAt ? { createdAt: fixture.createdAt } : {}),
    },
  });
  return row.id;
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

interface World {
  teacherA: Person;
  teacherB: Person;
  approved: Person;
  pending: Person;
  admin: Person;
  courseA: string;
  courseB: string;
  publicA: string;
  privateA: string;
  publicB: string;
  privateB: string;
}

/**
 * Two teachers, two courses, and a private resource in each — on purpose. Every listing
 * assertion below is made with a second tenant's rows sitting in the same tables, so a
 * service that filtered nothing at all would still look right against a world holding
 * one course.
 */
async function seedWorld(): Promise<World> {
  const teacherA = await signIn('teacher-a@example.com', 'TEACHER');
  const teacherB = await signIn('teacher-b@example.com', 'TEACHER');
  const approved = await signIn('student-approved@example.com', 'STUDENT');
  const pending = await signIn('student-pending@example.com', 'STUDENT');
  const admin = await signIn('admin@example.com', 'ADMIN');

  const courseA = await makeCourse(teacherA.id);
  const courseB = await makeCourse(teacherB.id);

  await enrol(approved.id, courseA, 'APPROVED');
  await enrol(pending.id, courseA, 'PENDING');

  return {
    teacherA,
    teacherB,
    approved,
    pending,
    admin,
    courseA,
    courseB,
    publicA: await makeResource({ courseId: courseA, authorId: teacherA.id, isPublic: true }),
    privateA: await makeResource({ courseId: courseA, authorId: teacherA.id, isPublic: false }),
    publicB: await makeResource({ courseId: courseB, authorId: teacherB.id, isPublic: true }),
    privateB: await makeResource({ courseId: courseB, authorId: teacherB.id, isPublic: false }),
  };
}

// --- tests -----------------------------------------------------------------

/**
 * Every case here is a row of `resource:read` (`POLICY`) expressed as rows in a
 * response body. The list narrows with a WHERE clause rather than a subject decision, so
 * these are the only assertions that can show the clause and the policy still agree — a
 * subject-based test exercises a different code path entirely.
 */
describe("listing a course's resources", () => {
  it('serves an anonymous visitor only the public ones', async () => {
    const world = await seedWorld();

    const response = await get(`/courses/${world.courseA}/resources`);

    expect(response.statusCode).toBe(200);
    // `POLICY` — the anonymous cell is `publicAndLive`, and this course is published.
    expect(idsOf(response)).toEqual([world.publicA]);
    expect(response.json().meta).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('serves an APPROVED student the private resources of that course as well', async () => {
    const world = await seedWorld();

    const response = await get(`/courses/${world.courseA}/resources`, world.approved.token);

    expect(response.statusCode).toBe(200);
    expect(idsOf(response).sort()).toEqual([world.publicA, world.privateA].sort());
  });

  it('serves a PENDING applicant no more than the logged-out visitor sees', async () => {
    const world = await seedWorld();

    const response = await get(`/courses/${world.courseA}/resources`, world.pending.token);

    expect(response.statusCode).toBe(200);
    // `enrolledApproved` is APPROVED only (combinators.ts:62-65): a waiting list is not
    // access. This is the assertion that catches a clause written as
    // `enrollments: { some: { studentId } }` with the status filter forgotten.
    expect(idsOf(response)).toEqual([world.publicA]);
  });

  it('never leaks another course private resource to a student enrolled elsewhere', async () => {
    const world = await seedWorld();

    const nested = await get(`/courses/${world.courseB}/resources`, world.approved.token);
    expect(nested.statusCode).toBe(200);
    expect(idsOf(nested)).toEqual([world.publicB]);

    // The same student across the whole catalogue: their own course entire, everyone
    // else's public surface, and nothing more.
    const flat = await get('/resources', world.approved.token);
    expect(flat.statusCode).toBe(200);
    expect(idsOf(flat).sort()).toEqual([world.publicA, world.privateA, world.publicB].sort());
    expect(idsOf(flat)).not.toContain(world.privateB);
  });

  it('serves the owning teacher everything in their own course', async () => {
    const world = await seedWorld();

    const response = await get(`/courses/${world.courseA}/resources`, world.teacherA.token);

    expect(response.statusCode).toBe(200);
    expect(idsOf(response).sort()).toEqual([world.publicA, world.privateA].sort());
  });

  it('serves a teacher who does not own the course only its public resources', async () => {
    const world = await seedWorld();

    const response = await get(`/courses/${world.courseA}/resources`, world.teacherB.token);

    // `resourceVisibleToTeacher` is or(publicAndLive, ownsCourse, isAuthor). Teacher B owns
    // neither the
    // course nor either row, so only the public one survives — a blanket TEACHER branch
    // would hand a colleague's unpublished material to anyone holding the role.
    expect(response.statusCode).toBe(200);
    expect(idsOf(response)).toEqual([world.publicA]);
  });

  it('serves an admin everything, in one course and across all of them', async () => {
    const world = await seedWorld();

    const nested = await get(`/courses/${world.courseA}/resources`, world.admin.token);
    expect(nested.statusCode).toBe(200);
    expect(idsOf(nested).sort()).toEqual([world.publicA, world.privateA].sort());

    const flat = await get('/resources', world.admin.token);
    expect(flat.statusCode).toBe(200);
    expect(idsOf(flat).sort()).toEqual(
      [world.publicA, world.privateA, world.publicB, world.privateB].sort(),
    );
    expect(flat.json().meta.total).toBe(4);
  });

  it('hides a soft-deleted resource from everyone, the admin included', async () => {
    const world = await seedWorld();
    await prisma.resource.update({
      where: { id: world.privateA },
      data: { deletedAt: new Date() },
    });

    const owner = await get(`/courses/${world.courseA}/resources`, world.teacherA.token);
    expect(idsOf(owner)).toEqual([world.publicA]);

    const student = await get(`/courses/${world.courseA}/resources`, world.approved.token);
    expect(idsOf(student)).toEqual([world.publicA]);

    // The ADMIN row of the policy is `allow`, which says nothing about deleted rows: the
    // soft-delete filter is the clause's own base term, not part of any role branch, so
    // an admin whose branch is `{}` must still not see this.
    const admin = await get('/resources', world.admin.token);
    expect(idsOf(admin)).not.toContain(world.privateA);
    expect(admin.json().meta.total).toBe(3);
  });

  it('hides every resource of a soft-deleted course', async () => {
    const world = await seedWorld();
    await prisma.course.update({ where: { id: world.courseB }, data: { deletedAt: new Date() } });

    // Soft delete is not enforced by the ORM, so the course-side filter is a hand-written
    // term. Without it a deleted course keeps publishing its material forever.
    const response = await get('/resources', world.admin.token);
    expect(response.statusCode).toBe(200);
    expect(idsOf(response).sort()).toEqual([world.publicA, world.privateA].sort());
  });

  /**
   * 200 and the public shelf, unconditionally — this is settled, not a judgement call.
   * resources.routes.ts:47-59 passes `request.actor` and deliberately does NOT call
   * `requireActor`, because the anonymous cell of `resource:read` is `publicAndLive` and not
   * `deny` (`POLICY`). A 401 here would be the route regressing to a session
   * requirement the policy does not ask for, and an `expect([200, 401])` cannot tell
   * that apart from the intended behaviour.
   */
  it('serves a logged-out caller the public shelf across every course', async () => {
    const world = await seedWorld();

    const response = await get('/resources');

    expect(response.statusCode).toBe(200);
    expect(idsOf(response).sort()).toEqual([world.publicA, world.publicB].sort());
    expect(response.json().meta.total).toBe(2);
  });

  it("serves a teacher the private row they authored in someone else's course", async () => {
    const world = await seedWorld();
    // Teacher B owns course B, not course A. Authorship is the ONLY term of
    // `or(isPublic, ownsCourse, isAuthor)` that can put this row on their shelf, so a
    // WHERE clause that dropped `authorId` still looks correct against every other row
    // in the world — which is exactly why the row is planted in the other course.
    const authoredByB = await makeResource({
      courseId: world.courseA,
      authorId: world.teacherB.id,
      isPublic: false,
      title: 'Guest lecture notes',
    });

    const flat = await get('/resources', world.teacherB.token);
    expect(flat.statusCode).toBe(200);
    // `visibleResourcesWhere` mirrors `resourceVisibleToTeacher` term for term.
    expect(idsOf(flat)).toContain(authoredByB);
    expect(idsOf(flat)).not.toContain(world.privateA);
    expect(idsOf(flat).sort()).toEqual(
      [world.publicA, authoredByB, world.publicB, world.privateB].sort(),
    );

    // The per-row gate is a different code path from the WHERE clause: `isAuthor` reads
    // `subject.authorId` (combinators.ts:68-72), which `loadResourceSubject` populates
    // at resources.service.ts:150. The clause and the gate can disagree silently.
    const single = await get(`/resources/${authoredByB}`, world.teacherB.token);
    expect(single.statusCode).toBe(200);
    expect(single.json().id).toBe(authoredByB);

    // Same course, same teacher, a row they did not write: still refused. Without this
    // the test above is satisfied by a TEACHER branch that returns everything.
    const refused = await get(`/resources/${world.privateA}`, world.teacherB.token);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('FORBIDDEN');
    expect(refused.json().detail).toContain(
      'TEACHER:or(and(isPublic, isPublished), ownsCourse, isAuthor)',
    );
  });

  it('drops a soft-deleted course from the teacher and student lists, not only the admin one', async () => {
    const world = await seedWorld();
    await prisma.course.update({ where: { id: world.courseA }, data: { deletedAt: new Date() } });

    // The deleted-COURSE term lives in `live`, which every branch ANDs
    // (resources.service.ts:220-251). The admin case above only proves the ADMIN branch
    // carries it; the two branches with their own `OR` are where a hand-written spread
    // would REPLACE the `course` key and lose the term (resources.service.ts:222-224).
    const teacher = await get('/resources', world.teacherA.token);
    expect(teacher.statusCode).toBe(200);
    expect(idsOf(teacher)).toEqual([world.publicB]);

    const student = await get('/resources', world.approved.token);
    expect(student.statusCode).toBe(200);
    expect(idsOf(student)).toEqual([world.publicB]);

    // And the single-row read, whose filter is a second hand-written copy of the same
    // two-level condition (resources.service.ts:133, 390).
    const single = await get(`/resources/${world.publicA}`, world.admin.token);
    expect(single.statusCode).toBe(404);
    expect(single.json().code).toBe('NOT_FOUND');
  });
});

/*
 * The course's publication state bounds its resources' visibility, so this block sits
 * between listing and reading: it is about both.
 *
 * Found by probe on 2026-08-23, before the rules carried `isPublished`: an anonymous
 * caller was refused the draft COURSE with a 401 and simultaneously served its
 * "public" resource with a 200, title and all, in `GET /resources`. `resource:create`
 * is `ownsCourse` with no publication term, so a teacher can file material into a
 * course nobody has published, and `isPublic` alone then published it to the world.
 */
describe('a resource is never more visible than its course', () => {
  it('hides a public resource in an unpublished course from anonymous callers', async () => {
    const teacher = await signIn('teacher-draft@example.com', 'TEACHER');
    const draftCourse = await makeCourse(teacher.id, { published: false });
    const hidden = await makeResource({
      courseId: draftCourse,
      authorId: teacher.id,
      isPublic: true,
      title: 'Draft handout',
    });

    // The course itself is already refused, which is the contradiction: these two
    // answers used to disagree.
    const course = await app.inject({ method: 'GET', url: `/api/v1/courses/${draftCourse}` });
    expect(course.statusCode).toBe(401);

    const list = await get('/resources');
    expect(list.statusCode).toBe(200);
    expect(idsOf(list)).not.toContain(hidden);

    const one = await get(`/resources/${hidden}`);
    expect(one.statusCode).toBe(401);
  });

  it('hides it from a signed-in student who is not enrolled', async () => {
    const teacher = await signIn('teacher-draft2@example.com', 'TEACHER');
    const stranger = await signIn('student-draft2@example.com', 'STUDENT');
    const draftCourse = await makeCourse(teacher.id, { published: false });
    const hidden = await makeResource({
      courseId: draftCourse,
      authorId: teacher.id,
      isPublic: true,
    });

    expect(idsOf(await get('/resources', stranger.token))).not.toContain(hidden);

    const refused = await get(`/resources/${hidden}`, stranger.token);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().detail).toContain(
      'STUDENT:or(and(isPublic, isPublished), enrolledApproved)',
    );
  });

  it('still shows it to the teacher who owns the draft, and to an admin', async () => {
    const teacher = await signIn('teacher-draft3@example.com', 'TEACHER');
    const admin = await signIn('admin-draft3@example.com', 'ADMIN');
    const draftCourse = await makeCourse(teacher.id, { published: false });
    const own = await makeResource({ courseId: draftCourse, authorId: teacher.id, isPublic: true });

    // The narrowing must not have cost the people who are meant to see a draft.
    expect(idsOf(await get('/resources', teacher.token))).toContain(own);
    expect((await get(`/resources/${own}`, teacher.token)).statusCode).toBe(200);
    expect(idsOf(await get('/resources', admin.token))).toContain(own);
  });

  it('keeps serving an approved student after their course is unpublished', async () => {
    const teacher = await signIn('teacher-draft4@example.com', 'TEACHER');
    const student = await signIn('student-draft4@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const resourceId = await makeResource({ courseId, authorId: teacher.id, isPublic: true });
    const offering = await prisma.courseOffering.findFirstOrThrow({
      where: { courseId, deletedAt: null },
      select: { id: true },
    });
    await prisma.enrollment.create({
      data: { offeringId: offering.id, studentId: student.id, status: 'APPROVED' },
    });

    await prisma.course.update({ where: { id: courseId }, data: { publishedAt: null } });

    // enrolledApproved carries no publication term, deliberately: the same allowance
    // `studentCourseVisible` makes for the course itself.
    expect(idsOf(await get('/resources', student.token))).toContain(resourceId);
    expect((await get(`/resources/${resourceId}`, student.token)).statusCode).toBe(200);
  });
});

describe('reading one resource', () => {
  it('answers 404 for a soft-deleted row, not 200, even for an admin', async () => {
    const world = await seedWorld();
    await prisma.resource.update({ where: { id: world.publicA }, data: { deletedAt: new Date() } });

    // The admin is the caller that settles WHICH status this is. Every role rule except
    // `allow` denies an absent subject, so a non-admin answers 403 whether the row was
    // deleted or merely invisible; ADMIN:allow passes the gate, which leaves the handler
    // to say the only true thing left — the row is gone.
    const response = await get(`/resources/${world.publicA}`, world.admin.token);

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('NOT_FOUND');
  });

  it('answers 403 naming the rule for a private row the caller may not read', async () => {
    const world = await seedWorld();

    const refused = await get(`/resources/${world.privateA}`, world.pending.token);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('FORBIDDEN');
    // The composed rule name, not merely FORBIDDEN: this is what separates "your
    // application is still pending" from a subject loaded without `enrollmentStatus`,
    // which denies identically and for entirely the wrong reason.
    expect(refused.json().detail).toContain(
      'STUDENT:or(and(isPublic, isPublished), enrolledApproved)',
    );

    // Same row, same route, an APPROVED enrolment: it was the rule that refused, not a
    // resource that is missing.
    const allowed = await get(`/resources/${world.privateA}`, world.approved.token);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().id).toBe(world.privateA);
  });

  it('serialises the DTO the catalogue reads: course name, author summary, upload facts', async () => {
    const teacher = await signIn('teacher-dto@example.com', 'TEACHER');
    const student = await signIn('student-dto@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    const uploadId = await makeUpload(teacher.id);
    const resourceId = await makeResource({
      courseId,
      authorId: teacher.id,
      isPublic: true,
      title: 'Safety handbook',
      uploadId,
    });
    await prisma.comment.create({
      data: { content: 'Page 4 is out of date.', authorId: student.id, resourceId },
    });
    const course = await prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      select: { name: true },
    });

    const response = await get(`/resources/${resourceId}`);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      id: resourceId,
      title: 'Safety handbook',
      type: 'DOCUMENT',
      courseId,
      courseName: course.name,
      isPublic: true,
      uploadId,
      externalUrl: null,
      // From the Upload row, the only place these two exist.
      sizeBytes: 2048,
      contentType: 'application/pdf',
      commentCount: 1,
    });
    expect(body.author.id).toBe(teacher.id);
    // userSummarySchema is {id,name,role,avatarUrl} (user.ts:22-27). An
    // `include: { author: true }` would pull passwordHash and totpSecret into the row the
    // handler holds and still serialise cleanly, because a response schema strips what it
    // does not declare — so the absence is asserted here rather than assumed.
    expect(body.author).not.toHaveProperty('email');
    expect(body.author).not.toHaveProperty('passwordHash');
  });

  it('tells an absent id apart by role: 404 for an admin, 403 for everyone else', async () => {
    const world = await seedWorld();

    // `loadResourceSubject` answers `undefined` for a row that is not there
    // (resources.service.ts:143), and `can()` then runs the role rule against
    // EMPTY_SUBJECT (can.ts:53). ADMIN is `allow`, which reads no field, so the admin
    // passes the gate and the handler says the only true thing left.
    const admin = await get(`/resources/${ABSENT_ID}`, world.admin.token);
    expect(admin.statusCode).toBe(404);
    expect(admin.json().code).toBe('NOT_FOUND');

    // Every other rule reads a field, and a rule that reads an absent field must deny
    // (actor.ts:49-51) — so a non-admin is refused and learns nothing about whether the
    // row exists. A 404 here would be an enumeration oracle.
    const teacher = await get(`/resources/${ABSENT_ID}`, world.teacherA.token);
    expect(teacher.statusCode).toBe(403);
    expect(teacher.json().code).toBe('FORBIDDEN');
    expect(teacher.json().detail).toContain(
      'TEACHER:or(and(isPublic, isPublished), ownsCourse, isAuthor)',
    );

    const student = await get(`/resources/${ABSENT_ID}`, world.approved.token);
    expect(student.statusCode).toBe(403);
    expect(student.json().code).toBe('FORBIDDEN');
    expect(student.json().detail).toContain(
      'STUDENT:or(and(isPublic, isPublished), enrolledApproved)',
    );

    // The delete route loads the same subject, so an admin reaches the same truthful 404
    // rather than a P2025 leaking out of `prisma.resource.update`
    // (resources.service.ts:552-563).
    const removed = await send('DELETE', `/resources/${ABSENT_ID}`, undefined, world.admin.token);
    expect(removed.statusCode).toBe(404);
    expect(removed.json().code).toBe('NOT_FOUND');
  });

  it('serves a LINK resource with null upload facts', async () => {
    const world = await seedWorld();

    const response = await get(`/resources/${world.publicA}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ uploadId: null, sizeBytes: null, contentType: null });
    expect(response.json().externalUrl).toContain('https://example.com/');
  });
});

describe('creating a resource', () => {
  it('files it into the course the owning teacher named, authored by the actor', async () => {
    const teacher = await signIn('teacher-create@example.com', 'TEACHER');
    const other = await signIn('teacher-other@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const course = await prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      select: { name: true },
    });

    const response = await send(
      'POST',
      '/resources',
      {
        courseId,
        title: 'Bead placement drills',
        description: 'Six exercises, in order.',
        type: 'LINK',
        externalUrl: 'https://example.com/bead-placement',
        // Ignored, not honoured: `createResourceSchema` (resource.ts:65-75) declares no
        // author, so zod strips this before the handler sees it. The author is the
        // session, which is the only claim the server can verify.
        authorId: other.id,
      },
      teacher.token,
    );

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.author.id).toBe(teacher.id);
    expect(body.courseId).toBe(courseId);
    expect(body.courseName).toBe(course.name);
    expect(body.isPublic).toBe(false); // resource.ts:73 — private unless asked for.
    expect(body.commentCount).toBe(0);
    expect(body.sizeBytes).toBeNull();
    expect(body.contentType).toBeNull();

    const row = await prisma.resource.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.authorId).toBe(teacher.id);
    expect(row.deletedAt).toBeNull();
  });

  it("refuses a teacher filing into another teacher's course, naming ownsCourse", async () => {
    const owner = await signIn('teacher-owner@example.com', 'TEACHER');
    const stranger = await signIn('teacher-stranger@example.com', 'TEACHER');
    const courseId = await makeCourse(owner.id);

    const response = await send(
      'POST',
      '/resources',
      {
        courseId,
        title: 'Planted material',
        type: 'LINK',
        externalUrl: 'https://example.com/planted',
      },
      stranger.token,
    );

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    // The `resource:create` TEACHER cell, verbatim: "without this a teacher could file a
    // resource into a
    // colleague's course by guessing a courseId". The subject has to be built from the
    // BODY's course for this to fire — a subject-free gate reports the same rule name
    // while denying everyone, the owner included, which is the failure mode
    // docs/LESSONS-LEARNED.md #15 records six times over.
    expect(response.json().detail).toContain('TEACHER:ownsCourse');
    expect(await prisma.resource.count({ where: { courseId } })).toBe(0);
  });

  it('refuses a student outright, naming deny', async () => {
    const teacher = await signIn('teacher-student-post@example.com', 'TEACHER');
    const student = await signIn('student-post@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    await enrol(student.id, courseId, 'APPROVED');

    const response = await send(
      'POST',
      '/resources',
      { courseId, title: 'My notes', type: 'LINK', externalUrl: 'https://example.com/notes' },
      student.token,
    );

    // An APPROVED enrolment reads the course's material; it never writes to it.
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain('STUDENT:deny');
    expect(await prisma.resource.count({ where: { courseId } })).toBe(0);
  });

  it('refuses a body carrying both an upload and an external URL', async () => {
    const teacher = await signIn('teacher-both@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const uploadId = await makeUpload(teacher.id);

    const response = await send(
      'POST',
      '/resources',
      {
        courseId,
        title: 'Two sources',
        type: 'DOCUMENT',
        uploadId,
        externalUrl: 'https://example.com/also-here',
      },
      teacher.token,
    );

    // resource.ts:39-63 — the superRefine, so the CHECK in migration 0002 stays a
    // backstop rather than the error message a user has to read.
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    // By path, not by position: a stringified body also matches a message that merely
    // mentions the field, and `errors[0]` picks whichever issue zod raised first.
    expect(errorAt(response, 'uploadId')).toBeDefined();
    expect(await prisma.resource.count({ where: { courseId } })).toBe(0);
  });

  it('refuses a body carrying neither an upload nor an external URL', async () => {
    const teacher = await signIn('teacher-neither@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);

    const response = await send(
      'POST',
      '/resources',
      { courseId, title: 'No source at all', type: 'DOCUMENT' },
      teacher.token,
    );

    // The same refinement from the other side: `hasUpload === hasUrl` is false-false here.
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(errorAt(response, 'uploadId')).toBeDefined();
    expect(await prisma.resource.count({ where: { courseId } })).toBe(0);
  });

  it("refuses a LINK carrying an upload, at path 'type'", async () => {
    const teacher = await signIn('teacher-link-upload@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const uploadId = await makeUpload(teacher.id);

    const response = await send(
      'POST',
      '/resources',
      { courseId, title: 'A link that is a file', type: 'LINK', uploadId },
      teacher.token,
    );

    // The refinement's SECOND issue (resource.ts:56-62), which neither test above can
    // reach: `hasUpload !== hasUrl` here, so the first issue never fires and `type` is
    // the only path raised. Asserting the status alone would pass against a body
    // rejected for the other reason entirely.
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(errorAt(response, 'type')).toBeDefined();
    expect(errorAt(response, 'uploadId')).toBeUndefined();
    expect(await prisma.resource.count({ where: { courseId } })).toBe(0);
  });

  it('creates a DOCUMENT from an upload the teacher owns, carrying the file facts through', async () => {
    const teacher = await signIn('teacher-document@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const uploadId = await makeUpload(teacher.id);

    const response = await send(
      'POST',
      '/resources',
      { courseId, title: 'Safety handbook', type: 'DOCUMENT', uploadId },
      teacher.token,
    );

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      type: 'DOCUMENT',
      uploadId,
      externalUrl: null,
      // Upload columns (`sizeBytes`/`contentType` on `model Upload`) that `toResourceDto`
      // flattens onto the
      // resource (resources.service.ts:69-70). The DTO test above reaches them through a
      // fixture written straight to the table; this is the only case that proves the
      // CREATE path returns them, `include: RESOURCE_INCLUDE` and all.
      sizeBytes: 2048,
      contentType: 'application/pdf',
    });

    const row = await prisma.resource.findUniqueOrThrow({ where: { id: response.json().id } });
    expect(row.uploadId).toBe(uploadId);
    // `?? null`, never `undefined` (resources.service.ts:464-468): the CHECK in
    // migration 0002 counts non-nulls.
    expect(row.externalUrl).toBeNull();
  });

  /*
   * `assertUploadUsable` (resources.service.ts:426-440). The `resource:create` gate has
   * already said yes in every case below — the caller owns the course — so these three
   * branches are the whole of what stands between a guessed upload id and a colleague's
   * private file, and there is no `upload:attach` action in the policy table to express
   * it (the `Action` union stops at `upload:presign` and `upload:commit`).
   */
  it("refuses an uploadId owned by another teacher, at path 'uploadId'", async () => {
    const owner = await signIn('teacher-upload-owner@example.com', 'TEACHER');
    const stranger = await signIn('teacher-upload-stranger@example.com', 'TEACHER');
    const courseId = await makeCourse(stranger.id);
    const uploadId = await makeUpload(owner.id);

    const response = await send(
      'POST',
      '/resources',
      { courseId, title: 'A colleague file', type: 'DOCUMENT', uploadId },
      stranger.token,
    );

    // The upload-shaped version of `ownsCourse`: without this branch a teacher attaches
    // someone else's private file to their own resource and may then publish it by
    // flipping `isPublic`.
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    // All three branches of `assertUploadUsable` answer at the same path, so the message
    // is what says WHICH one fired — a service that reported 'Unknown upload' for every
    // uploadId it disliked would satisfy the path assertion alone.
    expect(errorAt(response, 'uploadId')?.message).toContain('belongs to someone else');
    expect(await prisma.resource.count({ where: { uploadId } })).toBe(0);
  });

  it("refuses an uploadId that matches no upload, at path 'uploadId'", async () => {
    const teacher = await signIn('teacher-upload-absent@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);

    const response = await send(
      'POST',
      '/resources',
      { courseId, title: 'Missing file', type: 'DOCUMENT', uploadId: ABSENT_ID },
      teacher.token,
    );

    // A client-chosen foreign key is a 422 with a field path, not the P2003 the error
    // plugin would otherwise translate into a pathless 409 (errors.plugin.ts:54-58).
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(errorAt(response, 'uploadId')?.message).toContain('Unknown upload');
    expect(await prisma.resource.count({ where: { courseId } })).toBe(0);
  });

  it('refuses an upload that is already attached to a resource', async () => {
    const teacher = await signIn('teacher-upload-twice@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const uploadId = await makeUpload(teacher.id);
    const first = await makeResource({ courseId, authorId: teacher.id, uploadId });

    const response = await send(
      'POST',
      '/resources',
      { courseId, title: 'The same file again', type: 'DOCUMENT', uploadId },
      teacher.token,
    );

    // `Resource.uploadId` is @unique. Left to the database this is a
    // P2002 → 409 with no field path (errors.plugin.ts:46-50), which the SPA cannot
    // render against a form field.
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(errorAt(response, 'uploadId')?.message).toContain('already attached');
    expect(await prisma.resource.count({ where: { uploadId } })).toBe(1);
    expect((await prisma.resource.findFirstOrThrow({ where: { uploadId } })).id).toBe(first);
  });

  it('lets an ADMIN attach an upload they do not own, because that branch exempts them', async () => {
    const teacher = await signIn('teacher-upload-admin@example.com', 'TEACHER');
    const admin = await signIn('admin-upload@example.com', 'ADMIN');
    const courseId = await makeCourse(teacher.id);
    const uploadId = await makeUpload(teacher.id);

    const response = await send(
      'POST',
      '/resources',
      { courseId, title: 'Filed on the teacher behalf', type: 'DOCUMENT', uploadId },
      admin.token,
    );

    // resources.service.ts:432 exempts ADMIN by hand, "for the same reason ADMIN is
    // `allow` everywhere else". Without this case the ownership branch could be written
    // as a blanket refusal and every test above would stay green.
    expect(response.statusCode).toBe(201);
    expect(response.json().uploadId).toBe(uploadId);
    // The author is the session, never the upload's owner.
    expect(response.json().author.id).toBe(admin.id);
    expect(await prisma.resource.count({ where: { uploadId } })).toBe(1);
  });
});

describe('updating and deleting', () => {
  it('lets the owning teacher edit, and refuses a stranger by name', async () => {
    const owner = await signIn('teacher-patch@example.com', 'TEACHER');
    const stranger = await signIn('teacher-patch-b@example.com', 'TEACHER');
    const courseId = await makeCourse(owner.id);
    const resourceId = await makeResource({
      courseId,
      authorId: owner.id,
      title: 'Original title',
    });

    const edited = await send(
      'PATCH',
      `/resources/${resourceId}`,
      { title: 'Revised title', isPublic: true },
      owner.token,
    );
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ id: resourceId, title: 'Revised title', isPublic: true });

    const refused = await send(
      'PATCH',
      `/resources/${resourceId}`,
      { title: 'Hijacked title' },
      stranger.token,
    );
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('FORBIDDEN');
    // `POLICY` — TEACHER:ownsCourse, not isAuthor. Authorship does not travel
    // with a row into someone else's course.
    expect(refused.json().detail).toContain('TEACHER:ownsCourse');

    const row = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(row.title).toBe('Revised title');
  });

  it('soft-deletes: 204, the row survives with deletedAt set, and the list drops it', async () => {
    const teacher = await signIn('teacher-delete@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const doomed = await makeResource({ courseId, authorId: teacher.id, isPublic: true });
    const kept = await makeResource({ courseId, authorId: teacher.id, isPublic: true });

    const response = await send('DELETE', `/resources/${doomed}`, undefined, teacher.token);
    expect(response.statusCode).toBe(204);

    // Soft, not hard: the audit trail and every comment hanging off this row stay
    // meaningful only while the row itself is still there (`deletedAt` is a plain
    // nullable column on `model Resource`, and `Comment.resource` cascades off it).
    const row = await prisma.resource.findUniqueOrThrow({ where: { id: doomed } });
    expect(row.deletedAt).not.toBeNull();

    const list = await get(`/courses/${courseId}/resources`, teacher.token);
    expect(idsOf(list)).toEqual([kept]);
  });

  it('refuses DELETE from a teacher who does not own the course, naming the action and the rule', async () => {
    const world = await seedWorld();

    const response = await send(
      'DELETE',
      `/resources/${world.privateA}`,
      undefined,
      world.teacherB.token,
    );

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    // BOTH halves of `detail`, because they fail independently: `can()` builds the reason
    // from the ACTION it was handed and the rule from the row the loader returned
    // (can.ts:89-96). A delete route accidentally wired to `resource:update` — the copy
    // -paste this file has no other guard against — reports the identical rule name while
    // pinning nothing, and `resource:delete` is also the entry DEMO_DENIED matches on
    // (can.ts:24-31), so the string is load-bearing twice over.
    expect(response.json().detail).toContain('resource:delete');
    expect(response.json().detail).toContain('TEACHER:ownsCourse');

    const row = await prisma.resource.findUniqueOrThrow({ where: { id: world.privateA } });
    expect(row.deletedAt).toBeNull();
  });

  /*
   * `assertSourceStaysCoherent` (resources.service.ts:485-506). Each patch below is legal
   * zod — `updateResourceSchema` only ever sees the SUBMITTED fields — and illegal SQL,
   * because `num_nonnulls("uploadId","externalUrl") = 1` (migration 0002) reads the
   * STORED row. Without the guard each one is an untranslated constraint violation, which
   * errors.plugin.ts:59-60 turns into a 500.
   */
  it("refuses clearing the URL of a LINK resource, at path 'externalUrl'", async () => {
    const teacher = await signIn('teacher-source-clear@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const resourceId = await makeResource({ courseId, authorId: teacher.id });
    const before = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });

    const response = await send(
      'PATCH',
      `/resources/${resourceId}`,
      { externalUrl: null },
      teacher.token,
    );

    // The row would be left holding neither source. 422, not the 500 an untranslated
    // CHECK violation produces, and not a 200 that silently kept the old URL.
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    // Two branches answer at this path; the message is what tells them apart.
    expect(errorAt(response, 'externalUrl')?.message).toContain('must keep its URL');

    const after = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(after.externalUrl).toBe(before.externalUrl);
    expect(after.uploadId).toBeNull();
  });

  it("refuses hanging a URL on a resource backed by a file, at path 'externalUrl'", async () => {
    const teacher = await signIn('teacher-source-url@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const uploadId = await makeUpload(teacher.id);
    const resourceId = await makeResource({ courseId, authorId: teacher.id, uploadId });

    const response = await send(
      'PATCH',
      `/resources/${resourceId}`,
      { externalUrl: 'https://example.com/also-here' },
      teacher.token,
    );

    // The mirror image: the row would end up holding BOTH sources.
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(errorAt(response, 'externalUrl')?.message).toContain('backed by a file');

    const after = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(after.externalUrl).toBeNull();
    expect(after.uploadId).toBe(uploadId);
  });

  it("refuses retyping an uploaded resource as a LINK, at path 'type'", async () => {
    const teacher = await signIn('teacher-source-type@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const uploadId = await makeUpload(teacher.id);
    const resourceId = await makeResource({ courseId, authorId: teacher.id, uploadId });

    const response = await send(
      'PATCH',
      `/resources/${resourceId}`,
      { type: 'LINK' },
      teacher.token,
    );

    // No CHECK is violated by this one — `type` is not in the constraint at all — but
    // resource.ts:56-62 refuses the combination at creation, and a stored row that can
    // reach it by patch makes the creation rule decorative.
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(errorAt(response, 'type')).toBeDefined();

    const after = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(after.type).toBe('DOCUMENT');
    expect(after.uploadId).toBe(uploadId);
  });

  it('refuses a second delete and any edit of an already soft-deleted row', async () => {
    // The admin throughout: every other role is refused by the GATE on a subject the
    // loader returned `undefined` for, which answers 403 and would prove nothing about
    // what the service does with a row that is already gone.
    const teacher = await signIn('teacher-gone@example.com', 'TEACHER');
    const admin = await signIn('admin-gone@example.com', 'ADMIN');
    const courseId = await makeCourse(teacher.id);
    const resourceId = await makeResource({
      courseId,
      authorId: teacher.id,
      title: 'Original title',
    });

    const first = await send('DELETE', `/resources/${resourceId}`, undefined, admin.token);
    expect(first.statusCode).toBe(204);
    const deleted = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(deleted.deletedAt).not.toBeNull();

    // resources.service.ts:553-560 filters the same two levels every read filters, "so a
    // row nobody can see is also a row nobody can delete". A second 204 would re-stamp
    // `deletedAt` and move the audit trail's idea of when this vanished.
    const again = await send('DELETE', `/resources/${resourceId}`, undefined, admin.token);
    expect(again.statusCode).toBe(404);
    expect(again.json().code).toBe('NOT_FOUND');

    const edit = await send(
      'PATCH',
      `/resources/${resourceId}`,
      { title: 'Back from the dead' },
      admin.token,
    );
    expect(edit.statusCode).toBe(404);
    expect(edit.json().code).toBe('NOT_FOUND');

    const after = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(after.deletedAt).toEqual(deleted.deletedAt);
    expect(after.title).toBe('Original title');
  });

  it('refuses an empty patch rather than answering 200 to a no-op', async () => {
    const teacher = await signIn('teacher-empty-patch@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const resourceId = await makeResource({ courseId, authorId: teacher.id, title: 'Untouched' });

    const response = await send('PATCH', `/resources/${resourceId}`, {}, teacher.token);

    // resource.ts:87-89 — every field of `updateResourceSchema` is optional, so without
    // the refine `{}` parses, `update` spreads nothing into `data` and the caller gets a
    // 200 plus an audit row for a change that never happened.
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    // `(root)`, not `''`. A whole-body refinement has an empty zod path, which arrives
    // as the instancePath `'/'`; errors.plugin.ts used to test its LENGTH before
    // stripping the slash, so the `(root)` fallback was unreachable and this answered
    // `path: ''` — a different path from the one `zodFieldErrors` gives the identical
    // refinement when a service throws it. Asserted here because this endpoint is the
    // one that surfaced it.
    expect(errorAt(response, '(root)')?.message).toContain('at least one field');

    const after = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(after.title).toBe('Untouched');
  });

  it('accepts a null description and leaves the fields the caller did not name alone', async () => {
    const teacher = await signIn('teacher-null-desc@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const resourceId = await makeResource({ courseId, authorId: teacher.id, title: 'Kept title' });

    const described = await send(
      'PATCH',
      `/resources/${resourceId}`,
      { description: 'A first pass.' },
      teacher.token,
    );
    expect(described.statusCode).toBe(200);
    expect(described.json().description).toBe('A first pass.');

    // `description` is `.nullable()` (resource.ts:81) and null is a VALUE here, not an
    // omission: resources.service.ts:527-534 spreads keys in only when they are not
    // `undefined`, which is the whole difference between "clear this" and "leave it".
    const cleared = await send(
      'PATCH',
      `/resources/${resourceId}`,
      { description: null },
      teacher.token,
    );
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().description).toBeNull();
    expect(cleared.json().title).toBe('Kept title');

    const after = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(after.description).toBeNull();
    expect(after.title).toBe('Kept title');
  });

  it('moves a LINK resource to a new URL without inventing an upload', async () => {
    const teacher = await signIn('teacher-move-url@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const resourceId = await makeResource({ courseId, authorId: teacher.id });

    const response = await send(
      'PATCH',
      `/resources/${resourceId}`,
      { externalUrl: 'https://example.com/moved' },
      teacher.token,
    );

    // The one `externalUrl` patch `assertSourceStaysCoherent` must let through: a string
    // onto a row with no upload keeps `num_nonnulls(...) = 1` true. A guard written as
    // "refuse every externalUrl patch" passes both refusals above and breaks this.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      externalUrl: 'https://example.com/moved',
      uploadId: null,
    });

    const after = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(after.externalUrl).toBe('https://example.com/moved');
    expect(after.uploadId).toBeNull();
  });
});

describe('pagination', () => {
  it('reports meta that matches the rows on a course larger than one page', async () => {
    const teacher = await signIn('teacher-page@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const created: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      // Distinct timestamps: two rows created in the same millisecond make the page
      // boundary arbitrary, and an arbitrary boundary makes the union assertion flaky.
      created.push(
        await makeResource({
          courseId,
          authorId: teacher.id,
          isPublic: true,
          createdAt: new Date(Date.UTC(2026, 0, index + 1)),
        }),
      );
    }

    const first = await get(`/courses/${courseId}/resources?limit=2`, teacher.token);
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toHaveLength(2);
    expect(first.json().meta).toMatchObject({
      page: 1,
      limit: 2,
      total: 5,
      totalPages: 3,
      hasNext: true,
      hasPrev: false,
    });

    const second = await get(`/courses/${courseId}/resources?limit=2&page=2`, teacher.token);
    expect(second.json().data).toHaveLength(2);
    expect(second.json().meta).toMatchObject({ page: 2, hasNext: true, hasPrev: true });

    const third = await get(`/courses/${courseId}/resources?limit=2&page=3`, teacher.token);
    expect(third.json().data).toHaveLength(1);
    expect(third.json().meta).toMatchObject({
      page: 3,
      total: 5,
      totalPages: 3,
      hasNext: false,
      hasPrev: true,
    });

    // Five distinct rows across three pages. The counters above are satisfied just as
    // well by a query that serves one row twice and drops another.
    expect(new Set([...idsOf(first), ...idsOf(second), ...idsOf(third)])).toEqual(new Set(created));
  });

  it('rejects a non-numeric limit with a field path rather than a silent NaN', async () => {
    const teacher = await signIn('teacher-limit@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);

    const response = await get(`/courses/${courseId}/resources?limit=abc`, teacher.token);

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(errorAt(response, 'limit')).toBeDefined();
  });
});

/**
 * `sort` is free-form text off the query string (pagination.ts:16) and `ORDER_BY` is an
 * object literal, which inherits from `Object.prototype`. A bare `ORDER_BY[query.sort]`
 * therefore answers a FUNCTION for these three names rather than `undefined`, the `??`
 * accepts it, and it is called with `this` unbound: `toString` hands Prisma
 * `orderBy: '[object Undefined]'`, `valueOf` throws outright. Both are 500s an anonymous
 * caller reaches by typing a query string, which is why the guard at
 * resources.service.ts:325-331 is `Object.prototype.hasOwnProperty.call`.
 */
describe('the sort whitelist', () => {
  it.each(['toString', 'valueOf', 'constructor'])(
    'answers ?sort=%s with the default createdAt ordering, not a 500',
    async (sort) => {
      const teacher = await signIn('teacher-sort@example.com', 'TEACHER');
      const courseId = await makeCourse(teacher.id);
      const created: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        // Distinct timestamps, as in the pagination case above: rows sharing a
        // millisecond make "default ordering" unassertable.
        created.push(
          await makeResource({
            courseId,
            authorId: teacher.id,
            isPublic: true,
            createdAt: new Date(Date.UTC(2026, 0, index + 1)),
          }),
        );
      }

      const response = await get(`/resources?sort=${sort}`, teacher.token);

      expect(response.statusCode).toBe(200);
      // `order` defaults to 'desc' (pagination.ts:17), so newest first. Asserting the
      // ORDER and not merely the status is the point: a fallback that silently ordered
      // by nothing at all would answer 200 too.
      expect(idsOf(response)).toEqual([...created].reverse());
    },
  );
});
