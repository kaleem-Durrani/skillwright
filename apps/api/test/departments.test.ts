import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
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

/** A syntactically valid cuid that no row carries, so `idParamSchema` passes and the lookup misses. */
const ABSENT_ID = 'ckzzzzzzzzzzzzzzzzzzzzzzz';

let app: FastifyInstance;
let departmentId: string;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  await resetRateLimits(app.redis);
  departmentId = await createDepartment();
});

afterEach(async () => {
  // `resetDatabase()` deletes users and departments only. `Course.teacherId` is
  // `onDelete: Restrict`, so a course left behind by this file makes the NEXT file's
  // reset fail with a foreign-key error rather than anything readable.
  await prisma.course.deleteMany({});
});

// --- helpers ---------------------------------------------------------------

function authPost(path: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/auth${path}`,
    headers: { ...originHeaders },
    payload: payload as Record<string, unknown>,
  });
}

function get(url: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/departments${url}`,
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

function post(url: string, payload: unknown, cookie?: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/departments${url}`,
    headers: { ...originHeaders, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
    payload: payload as Record<string, unknown>,
  });
}

function patch(url: string, payload: unknown, cookie?: string) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/departments${url}`,
    headers: { ...originHeaders, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
    payload: payload as Record<string, unknown>,
  });
}

function del(url: string, cookie?: string) {
  return app.inject({
    method: 'DELETE',
    url: `/api/v1/departments${url}`,
    headers: { ...originHeaders, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
  });
}

/**
 * Registers, verifies and signs in, returning the session cookie.
 *
 * Self-service registration never mints a privileged role (auth.service.ts:199-201) and
 * always builds a StudentProfile, so a provisioned teacher or admin is modelled here the
 * way the real provisioning flow would leave it: the student satellite is removed, and a
 * teacher gets a TeacherProfile. The department counts under test are profile counts, so
 * a promoted-student shortcut would quietly assert the wrong numbers.
 */
async function signIn(email: string, role: Role = 'STUDENT'): Promise<string> {
  const registered = await authPost('/register', {
    email,
    password: PASSWORD,
    name: 'Test Person',
    departmentId,
  });
  expect(registered.statusCode).toBe(202);

  const code = testOutbox.lastCodeFor(email);
  expect(code).toMatch(/^\d{6}$/);
  expect((await authPost('/verify-email', { email, code })).statusCode).toBe(200);

  if (role !== 'STUDENT') {
    const user = await prisma.user.update({ where: { email }, data: { role } });
    await prisma.studentProfile.delete({ where: { userId: user.id } });
    if (role === 'TEACHER') {
      await prisma.teacherProfile.create({
        data: { userId: user.id, departmentId, qualification: 'MSc Welding' },
      });
    }
  }

  const login = await authPost('/login', { email, password: PASSWORD });
  expect(login.statusCode).toBe(200);
  const token = sessionCookie(login);
  expect(token).toBeTruthy();
  return token as string;
}

/** A DEMO-provenance admin, which is the only way to exercise the DEMO_DENIED branch. */
async function signInDemoAdmin(): Promise<string> {
  const response = await authPost('/demo', { role: 'ADMIN' });
  expect(response.statusCode).toBe(200);
  expect(response.json().actor.provenance).toBe('DEMO');
  return sessionCookie(response) as string;
}

async function userIdFor(email: string): Promise<string> {
  return (await prisma.user.findFirstOrThrow({ where: { email } })).id;
}

async function createCourse(teacherId: string, slug: string, deletedAt?: Date): Promise<void> {
  await prisma.course.create({
    data: {
      code: `CODE-${slug}`,
      slug,
      name: `Course ${slug}`,
      departmentId,
      teacherId,
      durationValue: 6,
      durationUnit: 'WEEK',
      capacity: 30,
      ...(deletedAt ? { deletedAt } : {}),
    },
  });
}

// --- tests -----------------------------------------------------------------

describe('reading the catalogue', () => {
  it('serves an anonymous list, because the sign-up dropdown needs one', async () => {
    const response = await get('/');

    // `department:list` is public; Register.tsx fills a required department select on a
    // page where no session can exist. The summary is {id, name, slug} and nothing else.
    expect(response.statusCode).toBe(200);
    const [first] = response.json().data;
    expect(Object.keys(first).sort()).toEqual(['id', 'name', 'slug']);
  });

  it('still refuses anonymous the detail view, which carries head-counts', async () => {
    const response = await get(`/${departmentId}`);

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('serves the shared summary shape, and nothing more, to a signed-in student', async () => {
    const student = await signIn('student@example.com');

    const response = await get('/', student);
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.data).toHaveLength(1);
    // `courseCount` lives on departmentDetailSchema only. The SPA's hand-written
    // DepartmentSummary (web/src/lib/types.ts:31-36) claims it; the wire does not carry it.
    expect(Object.keys(body.data[0]).sort()).toEqual(['id', 'name', 'slug']);
    expect(body.meta).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  });

  it('lets a teacher read as well', async () => {
    const teacher = await signIn('teacher@example.com', 'TEACHER');
    expect((await get('/', teacher)).statusCode).toBe(200);
  });

  it('filters by q and pages with the shared envelope', async () => {
    const student = await signIn('pager@example.com');
    await prisma.department.create({ data: { name: 'Plumbing', slug: 'plumbing' } });
    await prisma.department.create({ data: { name: 'Carpentry', slug: 'carpentry' } });

    const filtered = await get('/?q=WELD', student);
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().data).toHaveLength(1);
    expect(filtered.json().data[0].slug).toBe('welding');

    const second = await get('/?page=2&limit=1&sort=name&order=asc', student);
    expect(second.statusCode).toBe(200);
    expect(second.json().data).toHaveLength(1);
    expect(second.json().meta).toMatchObject({
      page: 2,
      limit: 1,
      total: 3,
      totalPages: 3,
      hasNext: true,
      hasPrev: true,
    });
  });

  it('rejects a non-numeric limit with a field path instead of a silent NaN', async () => {
    const student = await signIn('coerce@example.com');

    const response = await get('/?limit=abc', student);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(response.json().errors[0].path).toBe('limit');
  });
});

describe('a single department', () => {
  it('counts live courses and profiles, and leaves soft-deleted courses out', async () => {
    const admin = await signIn('admin@example.com', 'ADMIN');
    await signIn('member@example.com');
    await signIn('lecturer@example.com', 'TEACHER');
    const teacherId = await userIdFor('lecturer@example.com');

    await createCourse(teacherId, 'live-course');
    await createCourse(teacherId, 'removed-course', new Date());

    const response = await get(`/${departmentId}`, admin);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: departmentId,
      slug: 'welding',
      description: null,
      courseCount: 1,
      teacherCount: 1,
      studentCount: 1,
    });
    // isoDateTimeSchema normalises on serialisation; the wire never carries a Date.
    expect(response.json().createdAt).toEqual(expect.any(String));
  });

  it('answers 404 for an unknown id and 422 for a malformed one', async () => {
    const student = await signIn('lookup@example.com');

    const missing = await get(`/${ABSENT_ID}`, student);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('NOT_FOUND');

    const malformed = await get('/not-a-cuid', student);
    expect(malformed.statusCode).toBe(422);
    expect(malformed.json().code).toBe('VALIDATION_FAILED');
  });

  it('stops serving a department once it is soft-deleted', async () => {
    const student = await signIn('ghost@example.com');
    await prisma.department.update({
      where: { id: departmentId },
      data: { deletedAt: new Date() },
    });

    expect((await get(`/${departmentId}`, student)).statusCode).toBe(404);
    expect((await get('/', student)).json().data).toHaveLength(0);
  });
});

describe('creating', () => {
  it('refuses a student, naming the rule that denied it', async () => {
    const student = await signIn('nobody@example.com');

    const response = await post('/', { name: 'Marine Engineering' }, student);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain('STUDENT:deny');
    expect(await prisma.department.count()).toBe(1);
  });

  it('refuses an anonymous caller', async () => {
    const response = await post('/', { name: 'Marine Engineering' });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a cross-origin create before the route runs', async () => {
    const admin = await signIn('admin@example.com', 'ADMIN');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/departments',
      headers: { origin: 'https://evil.example', cookie: cookieHeader(admin) },
      payload: { name: 'Marine Engineering' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('csrf.sameOrigin');
  });

  it('derives the slug from the name for an admin', async () => {
    const admin = await signIn('admin@example.com', 'ADMIN');

    const response = await post('/', { name: 'Marine Engineering' }, admin);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: 'Marine Engineering',
      slug: 'marine-engineering',
      description: null,
      courseCount: 0,
      teacherCount: 0,
      studentCount: 0,
    });
  });

  it('keeps an explicit slug, so a migration can preserve an existing URL', async () => {
    const admin = await signIn('admin@example.com', 'ADMIN');

    const response = await post(
      '/',
      { name: 'Applied Physics', slug: 'physics-legacy', description: 'Kept for old links.' },
      admin,
    );
    expect(response.statusCode).toBe(201);
    expect(response.json().slug).toBe('physics-legacy');
    expect(response.json().description).toBe('Kept for old links.');
  });

  it('turns an underivable name into a 422 on slug, not a raw insert', async () => {
    const admin = await signIn('admin@example.com', 'ADMIN');

    const response = await post('/', { name: '!!!' }, admin);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(response.json().errors[0].path).toBe('slug');
    expect(await prisma.department.count()).toBe(1);
  });

  it('answers a duplicate name with a 409 rather than a Prisma error', async () => {
    const admin = await signIn('admin@example.com', 'ADMIN');

    expect((await post('/', { name: 'Marine Engineering' }, admin)).statusCode).toBe(201);
    const second = await post('/', { name: 'Marine Engineering' }, admin);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('CONFLICT');
  });
});

describe('updating', () => {
  it('renames without touching the slug, and ignores a slug in the body', async () => {
    const admin = await signIn('admin@example.com', 'ADMIN');

    const response = await patch(
      `/${departmentId}`,
      { name: 'Welding and Fabrication', slug: 'brand-new-slug' },
      admin,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('Welding and Fabrication');
    // `slug` is absent from updateDepartmentSchema by design; the zod object drops it.
    expect(response.json().slug).toBe('welding');
  });

  it('clears a description with an explicit null', async () => {
    const admin = await signIn('admin@example.com', 'ADMIN');
    await prisma.department.update({ where: { id: departmentId }, data: { description: 'Old.' } });

    const response = await patch(`/${departmentId}`, { description: null }, admin);
    expect(response.statusCode).toBe(200);
    expect(response.json().description).toBeNull();
  });

  it('refuses an empty body', async () => {
    const admin = await signIn('admin@example.com', 'ADMIN');

    const response = await patch(`/${departmentId}`, {}, admin);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  });

  it('refuses a teacher', async () => {
    const teacher = await signIn('teacher@example.com', 'TEACHER');

    const response = await patch(`/${departmentId}`, { name: 'Hijacked' }, teacher);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('TEACHER:deny');
  });

  it('answers 404 for a soft-deleted department instead of resurrecting it', async () => {
    const admin = await signIn('admin@example.com', 'ADMIN');
    await prisma.department.update({
      where: { id: departmentId },
      data: { deletedAt: new Date() },
    });

    const response = await patch(`/${departmentId}`, { name: 'Zombie' }, admin);
    expect(response.statusCode).toBe(404);
    expect(
      (await prisma.department.findUniqueOrThrow({ where: { id: departmentId } })).name,
    ).not.toBe('Zombie');
  });
});

describe('deleting', () => {
  it('refuses a student', async () => {
    const student = await signIn('student@example.com');

    const response = await del(`/${departmentId}`, student);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('STUDENT:deny');
  });

  it('refuses a demo admin before the role rule is ever consulted', async () => {
    const demo = await signInDemoAdmin();

    const response = await del(`/${departmentId}`, demo);
    expect(response.statusCode).toBe(403);
    // can.ts:24-31 — provenance is checked ahead of the ADMIN `allow`.
    expect(response.json().detail).toContain('provenance:DEMO');
    expect(
      (await prisma.department.findUniqueOrThrow({ where: { id: departmentId } })).deletedAt,
    ).toBeNull();
  });

  it('refuses while live courses or members still point at it', async () => {
    const admin = await signIn('admin@example.com', 'ADMIN');
    await signIn('member@example.com');

    const response = await del(`/${departmentId}`, admin);
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('CONFLICT');
    expect(response.json().detail).toContain('still has courses or members');
  });

  it('soft-deletes an empty department and drops it from every read', async () => {
    const admin = await signIn('admin@example.com', 'ADMIN');
    const created = await post('/', { name: 'Marine Engineering' }, admin);
    const id = created.json().id as string;

    const response = await del(`/${id}`, admin);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');

    expect((await get(`/${id}`, admin)).statusCode).toBe(404);
    expect((await get('/', admin)).json().data.map((row: { id: string }) => row.id)).not.toContain(
      id,
    );

    // Soft, not hard: the row survives so audit and foreign keys still resolve.
    const row = await prisma.department.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).not.toBeNull();
  });
});
