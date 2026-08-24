import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// app.ts:51-52: "Anything that holds an instance built here — main.ts, the integration
// tests — should name this type. Plain FastifyInstance is a type error, not a
// widening." It was a type error the whole time; nothing typechecked test/ until
// tsconfig.test.json existed.
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
    // A course is born WITH its first intake since Phase 9 — dates and seats have
    // nowhere else to live.
    offerings: [{ capacity: 12 }],
    ...overrides,
  };
}

async function firstOfferingId(courseId: string): Promise<string> {
  const offering = await prisma.courseOffering.findFirstOrThrow({
    where: { courseId, deletedAt: null },
    select: { id: true },
  });
  return offering.id;
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
 * The request names an INTAKE (Phase 9) — the course's first live one here. Returns the
 * enrollment id so a test can move it past PENDING.
 */
async function apply(courseId: string, cookie: string): Promise<string> {
  const offeringId = await firstOfferingId(courseId);
  const response = await send('POST', `/${courseId}/enrollments`, { offeringId }, cookie);
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

// --- syllabus uploads (real bytes through the real presigned flow) ----------

function fileBytes(marker: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${marker}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
    'utf8',
  );
}

/** presignUploadResponseSchema (upload.ts:77-84), named so the fetch call below typechecks. */
interface PresignBody {
  uploadId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  key: string;
  expiresAt: string;
}

/**
 * Presign (purpose SYLLABUS), PUT straight to the bucket over `fetch` — the API never
 * sees these bytes, so an injected request would prove nothing about the signature —
 * then commit. What comes back attaches cleanly through POST /courses.
 */
async function storeSyllabus(
  token: string,
): Promise<{ uploadId: string; key: string; body: Buffer }> {
  const body = fileBytes('syllabus');
  const presigned = await app.inject({
    method: 'POST',
    url: '/api/v1/uploads/presign',
    headers: { ...originHeaders, cookie: cookieHeader(token) },
    payload: {
      purpose: 'SYLLABUS',
      originalName: 'course-handbook.pdf',
      contentType: 'application/pdf',
      sizeBytes: body.length,
    },
  });
  expect(presigned.statusCode).toBe(201);
  const signed: PresignBody = presigned.json();

  const put = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body });
  if (!put.ok) throw new Error(`PUT to the signed URL failed: ${put.status} ${await put.text()}`);

  const committed = await app.inject({
    method: 'POST',
    url: '/api/v1/uploads/commit',
    headers: { ...originHeaders, cookie: cookieHeader(token) },
    payload: { uploadId: signed.uploadId },
  });
  expect(committed.statusCode).toBe(200);

  return { uploadId: signed.uploadId, key: signed.key, body };
}

/** One catalogue row, as the SPA reads it. */
interface ListItem {
  code: string;
  description: string | null;
  /** Since Phase 9 the viewer-relative badge lives on each intake, not the row. */
  offerings: Array<{ viewerEnrollmentStatus: string | null }>;
}

function itemsOf(response: { json: () => { data: ListItem[] } }): ListItem[] {
  return response.json().data;
}

/** The badge the browse screen renders: the viewer's status on the course's first intake. */
function badgeOf(row: ListItem | undefined): string | null | undefined {
  return row?.offerings[0]?.viewerEnrollmentStatus;
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

    // The shape courseSummarySchema describes — nested department/teacher/duration.
    // Since Phase 9 the template carries NO seat arithmetic; that lives on each
    // intake in `offerings`.
    expect(summary.department).toMatchObject({ id: departmentId, slug: 'welding' });
    expect(summary.teacher).toMatchObject({ name: 'Tessa Teacher', role: 'TEACHER' });
    expect(summary.duration).toEqual({ value: 6, unit: 'WEEK' });
    expect(summary.capacity).toBeUndefined();
    expect(summary.offerings).toHaveLength(1);
    const [intake] = summary.offerings;
    expect(intake).toMatchObject({
      capacity: 12,
      approvedCount: 0,
      seatsRemaining: 12,
      isFull: false,
      viewerEnrollmentStatus: null,
    });
    // No workshop on this intake — unbound is null, never a zero-seat count.
    expect(intake?.workshopCapacity).toBeNull();
    expect(intake?.workshopSeatsRemaining).toBeNull();
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
    expect(badgeOf(item)).toBeNull();
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

    expect(badgeOf(itemsOf(await get('', student))[0])).toBe('PENDING');
  });

  it('reports a decided status, not only the pending one', async () => {
    const teacher = await signedIn('decided-teacher@example.com', 'TEACHER');
    const courseId = await publishedCourse(teacher);
    const student = await signedIn('decided-student@example.com', 'STUDENT');
    const enrollmentId = await apply(courseId, student);

    // Decided directly: the approval transaction belongs to the enrollments module, and
    // this assertion is about what the catalogue reads back, not about how it got there.
    await prisma.enrollment.update({ where: { id: enrollmentId }, data: { status: 'APPROVED' } });

    expect(badgeOf(itemsOf(await get('', student))[0])).toBe('APPROVED');
  });

  it('leaves the badge null for a student who has not applied', async () => {
    const teacher = await signedIn('unapplied-teacher@example.com', 'TEACHER');
    await publishedCourse(teacher);
    const student = await signedIn('unapplied-student@example.com', 'STUDENT');

    expect(badgeOf(itemsOf(await get('', student))[0])).toBeNull();
  });

  it('leaves the badge null for a teacher and for an admin, who never enrol', async () => {
    const teacher = await signedIn('badge-teacher@example.com', 'TEACHER');
    await publishedCourse(teacher);
    const admin = await signedIn('badge-admin@example.com', 'ADMIN');

    expect(badgeOf(itemsOf(await get('', teacher))[0])).toBeNull();
    expect(badgeOf(itemsOf(await get('', admin))[0])).toBeNull();
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
      badgeOf(rows.find((row) => row.code === code));

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
    expect(theirs.every((row) => badgeOf(row) === null)).toBe(true);
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
    const body = response.json();
    expect(body).toMatchObject({ resourceCount: 0, syllabusUrl: null });
    // The viewer-relative field lives per intake now; a teacher has none anywhere.
    expect(body.offerings).toHaveLength(1);
    expect(body.offerings[0]?.viewerEnrollmentStatus).toBeNull();
  });

  /**
   * The syllabus download, end to end: attach a COMMITTED SYLLABUS upload at creation,
   * read the course back, then pull the file's BYTES out of the private bucket through
   * the URL the DTO served. A fabricated or stale URL answers 403 from MinIO, so the
   * byte-equality fetch is what separates "a link" from "a working download button".
   */
  it('serves an attached syllabus as a short-lived signed download', async () => {
    const teacher = await signedIn('syllabus@example.com', 'TEACHER');
    const file = await storeSyllabus(teacher);
    const course = await createCourse(teacher, { syllabusUploadId: file.uploadId });

    const response = await get(`/${course.id}`, teacher);
    expect(response.statusCode).toBe(200);
    expect(response.json().syllabusUploadId).toBe(file.uploadId);

    const url = response.json().syllabusUrl as string;
    expect(url).not.toBe('');
    expect(url).toContain(file.key);

    const fetched = await fetch(url);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(file.body)).toBe(true);
  });

  it('answers syllabusUrl null for a PENDING syllabus rather than signing unverified bytes', async () => {
    // Built directly because no API path can produce this state any more —
    // assertUploadClaimable refuses PENDING claims. Legacy rows and restored backups
    // can still carry one, and the detail must degrade to "no link", not hand out a
    // URL for bytes nothing ever verified.
    const teacherId = await createAccount('legacy@example.com', 'TEACHER');
    const token = await login('legacy@example.com');
    const pending = await prisma.upload.create({
      data: {
        key: 'syllabi/01HZZZZZZZZZZZZZZZZZZZZZZZ.pdf',
        bucket: 'skillwright-uploads',
        contentType: 'application/pdf',
        sizeBytes: 128,
        originalName: 'old-handbook.pdf',
        status: 'PENDING',
        ownerId: teacherId,
      },
    });
    const course = await prisma.course.create({
      data: {
        code: 'WELD-900',
        slug: 'legacy-syllabus',
        name: 'Legacy Syllabus Course',
        departmentId,
        teacherId,
        durationValue: 6,
        durationUnit: 'WEEK',
        syllabusUploadId: pending.id,
      },
    });

    const response = await get(`/${course.id}`, token);
    expect(response.statusCode).toBe(200);
    expect(response.json().syllabusUploadId).toBe(pending.id);
    expect(response.json().syllabusUrl).toBeNull();
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

    // Seat numbers left the template in Phase 9, so the admin patch here is a
    // template fact — the name — while capacity moves to the intake routes below.
    const response = await send('PATCH', `/${course.id}`, { name: 'Admin Renamed' }, admin);
    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('Admin Renamed');
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

describe('offerings — retuning an intake (Phase 9)', () => {
  it('opens a second intake through POST /courses/:courseId/offerings', async () => {
    const owner = await signedIn('intake@example.com', 'TEACHER');
    const course = await createCourse(owner);

    const response = await send(
      'POST',
      `/${course.id}/offerings`,
      { capacity: 15, startDate: '2026-10-01T09:00:00.000Z', endDate: '2027-01-01T09:00:00.000Z' },
      owner,
    );
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      capacity: 15,
      approvedCount: 0,
      seatsRemaining: 15,
      isFull: false,
      workshopCapacity: null,
    });

    // The detail payload now lists BOTH intakes, soonest start first.
    const detail = await get(`/${course.id}`, owner).then((body) => body.json());
    expect(detail.offerings).toHaveLength(2);
    expect(detail.offerings[0].startDate).toBe('2026-10-01T09:00:00.000Z');
  });

  it('keeps the seat arithmetic on the intake and refuses shrinking below seated students', async () => {
    const owner = await signedIn('capacity@example.com', 'TEACHER');
    const course = await createCourse(owner, { offerings: [{ capacity: 10 }] });
    const offeringId = await firstOfferingId(course.id);
    // Seated directly: the approval transaction belongs to the enrollments module,
    // and this assertion is about the guard that runs before the DB CHECK.
    await prisma.courseOffering.update({
      where: { id: offeringId },
      data: { approvedCount: 4 },
    });

    const response = await send(
      'PATCH',
      `/${course.id}/offerings/${offeringId}`,
      { capacity: 3 },
      owner,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual({
      path: 'capacity',
      message: 'Capacity cannot be lower than the approved count',
    });
  });

  /** The same guard, mirrored onto the second bound (Phase 7), now on the intake (Phase 9). */
  it('refuses to lower workshopCapacity below the approved count', async () => {
    const owner = await signedIn('workshop@example.com', 'TEACHER');
    const course = await createCourse(owner, {
      offerings: [{ capacity: 10, workshopCapacity: 8 }],
    });
    const offeringId = await firstOfferingId(course.id);
    await prisma.courseOffering.update({
      where: { id: offeringId },
      data: { approvedCount: 4 },
    });

    const response = await send(
      'PATCH',
      `/${course.id}/offerings/${offeringId}`,
      { workshopCapacity: 3 },
      owner,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual({
      path: 'workshopCapacity',
      message: 'Workshop capacity cannot be lower than the approved count',
    });

    // The refusal wrote nothing.
    const untouched = await prisma.courseOffering.findUniqueOrThrow({ where: { id: offeringId } });
    expect(untouched.workshopCapacity).toBe(8);
  });

  it('exposes the workshop bound per intake, and explicit null clears it there', async () => {
    const owner = await signedIn('workshop-null@example.com', 'TEACHER');
    const course = await createCourse(owner, {
      offerings: [{ capacity: 10, workshopCapacity: 2 }],
    });
    const offeringId = await firstOfferingId(course.id);

    const readBack = await send('PATCH', `/${course.id}/offerings/${offeringId}`, {}, owner).then(
      (response) => response.json(),
    );
    expect(readBack.workshopCapacity).toBe(2);
    expect(readBack.workshopSeatsRemaining).toBe(2);

    // Seated directly: the derived arithmetic is under test, not the approval path.
    await prisma.courseOffering.update({ where: { id: offeringId }, data: { approvedCount: 1 } });
    const detail = await get(`/${course.id}`, owner).then((body) => body.json());
    expect(detail.offerings[0].workshopSeatsRemaining).toBe(1);

    const cleared = await send(
      'PATCH',
      `/${course.id}/offerings/${offeringId}`,
      { workshopCapacity: null },
      owner,
    );
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().workshopCapacity).toBeNull();
    expect(cleared.json().workshopSeatsRemaining).toBeNull();
  });

  it('compares a patched end date against the STORED start date of that intake', async () => {
    const owner = await signedIn('dates@example.com', 'TEACHER');
    const course = await createCourse(owner, {
      offerings: [{ capacity: 10, startDate: '2026-09-01T09:00:00.000Z' }],
    });
    const offeringId = await firstOfferingId(course.id);

    // The zod refinement only ever sees the submitted fields; the stored row is what
    // the CHECK reads, so the service merges before comparing.
    const response = await send(
      'PATCH',
      `/${course.id}/offerings/${offeringId}`,
      { endDate: '2026-08-01T09:00:00.000Z' },
      owner,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual({
      path: 'endDate',
      message: 'The end date must come after the start date.',
    });
  });

  it('gates every offering write on the TEMPLATE subject — no new action, same rule', async () => {
    const owner = await signedIn('intake-owner@example.com', 'TEACHER');
    const intruder = await signedIn('intake-intruder@example.com', 'TEACHER');
    const course = await createCourse(owner);
    const offeringId = await firstOfferingId(course.id);

    const patched = await send(
      'PATCH',
      `/${course.id}/offerings/${offeringId}`,
      { capacity: 99 },
      intruder,
    );
    expect(patched.statusCode).toBe(403);
    expect(patched.json().detail).toContain('rule: TEACHER:ownsCourse');

    // Same action, same rule, for opening and retiring intakes.
    const opened = await send('POST', `/${course.id}/offerings`, { capacity: 5 }, intruder);
    expect(opened.statusCode).toBe(403);

    const retired = await send(
      'DELETE',
      `/${course.id}/offerings/${offeringId}`,
      undefined,
      intruder,
    );
    expect(retired.statusCode).toBe(403);
  });

  it('refuses retiring an intake while anyone holds or awaits a seat on it', async () => {
    const owner = await signedIn('retire@example.com', 'TEACHER');
    const student = await signedIn('retire-student@example.com', 'STUDENT');
    const course = await createCourse(owner);
    await publish(course.id, owner);
    const offeringId = await firstOfferingId(course.id);
    await apply(course.id, student);

    const blocked = await send('DELETE', `/${course.id}/offerings/${offeringId}`, undefined, owner);
    expect(blocked.statusCode).toBe(409);
    expect(
      (await prisma.courseOffering.findUniqueOrThrow({ where: { id: offeringId } })).deletedAt,
    ).toBeNull();

    // With nothing live on it, retirement succeeds — soft delete only, exactly like
    // the course itself.
    await prisma.enrollment.deleteMany({});
    const retired = await send('DELETE', `/${course.id}/offerings/${offeringId}`, undefined, owner);
    expect(retired.statusCode).toBe(204);
    expect(
      (await prisma.courseOffering.findUniqueOrThrow({ where: { id: offeringId } })).deletedAt,
    ).not.toBeNull();
  });

  it('answers 404 for an intake of another course, even for its own teacher', async () => {
    const one = await signedIn('cross-one@example.com', 'TEACHER');
    const other = await signedIn('cross-two@example.com', 'TEACHER');
    const mine = await createCourse(one, { code: 'WELD-911', name: 'Cross One' });
    const theirs = await createCourse(other, { code: 'WELD-912', name: 'Cross Two' });
    const foreignIntake = await firstOfferingId(theirs.id);

    const response = await send(
      'PATCH',
      `/${mine.id}/offerings/${foreignIntake}`,
      { capacity: 5 },
      one,
    );
    expect(response.statusCode).toBe(404);
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

  /**
   * The bodyless-POST trap, fourth-and-one: Fastify hands a POST with no body to the
   * validator as `null`, so a `.optional()` binding (and any non-nullish one) answers
   * 422 before the policy preHandler runs. This route is the last of the five to carry
   * the fix; the test sends NO body deliberately — `{}` would pass either binding.
   */
  it('publishes a POST with no body at all', async () => {
    const owner = await signedIn('bodyless@example.com', 'TEACHER');
    const course = await createCourse(owner);

    const response = await send('POST', `/${course.id}/publish`, undefined, owner);
    expect(response.statusCode).toBe(200);

    // The verb names the action, so an absent body publishes rather than unpublishes.
    expect(response.json().publishedAt).toEqual(expect.any(String));

    const row = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(row.publishedAt).not.toBeNull();
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

    // A well-formed application (it names an intake) so the POLICY is what refuses
    // the teacher rather than request validation running before the gate.
    const offering = await prisma.courseOffering.findFirstOrThrow({
      where: { courseId: course.id, deletedAt: null },
      select: { id: true },
    });
    const response = await send(
      'POST',
      `/${course.id}/enrollments`,
      { offeringId: offering.id },
      owner,
    );
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: TEACHER:deny');
  });

  it('refuses a student a place on a draft course', async () => {
    const owner = await signedIn('owner10@example.com', 'TEACHER');
    const student = await signedIn('applicant@example.com', 'STUDENT');
    const course = await createCourse(owner);

    const offering = await prisma.courseOffering.findFirstOrThrow({
      where: { courseId: course.id, deletedAt: null },
      select: { id: true },
    });
    const response = await send(
      'POST',
      `/${course.id}/enrollments`,
      { offeringId: offering.id },
      student,
    );
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain(
      'rule: STUDENT:and(isPublished, hasCompletedPrerequisite)',
    );
  });
});
