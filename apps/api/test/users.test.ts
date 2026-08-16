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

/** Shaped like a cuid so `idSchema` (common.ts:20-22) accepts it and the route reaches the service. */
const ABSENT_ID = 'ckzzzzzzzzzzzzzzzzzzzzzzz';

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
  await resetDatabase();
  await resetRateLimits(app.redis);
  departmentId = await createDepartment();
});

// --- helpers ---------------------------------------------------------------

type TestRole = 'STUDENT' | 'TEACHER' | 'ADMIN';
type TestProfile = 'none' | 'student' | 'teacher';

/**
 * Provisioned directly: only students self-register, and this suite needs all three
 * roles. The profile is created inline because there is no `User.departmentId` — the
 * department name `userDetailSchema` carries comes through one of these two satellites
 * (schema.prisma:186-221), so a fixture without one cannot exercise that field.
 */
async function createAccount(
  email: string,
  role: TestRole,
  name = 'Test Person',
  profile: TestProfile = 'none',
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email,
      name,
      role,
      status: 'ACTIVE',
      passwordHash,
      ...(profile === 'teacher'
        ? { teacherProfile: { create: { departmentId, qualification: 'MSc Welding' } } }
        : {}),
      ...(profile === 'student'
        ? { studentProfile: { create: { departmentId, enrollmentNo: `SW-${email}` } } }
        : {}),
    },
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
async function signedIn(
  email: string,
  role: TestRole,
  name?: string,
  profile: TestProfile = 'none',
): Promise<string> {
  await createAccount(email, role, name, profile);
  return login(email);
}

function get(url: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/users${url}`,
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
    url: `/api/v1/users${url}`,
    headers: { ...headers, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
    payload: payload as Record<string, unknown>,
  });
}

// --- tests -----------------------------------------------------------------

describe('GET /users', () => {
  it('serves an admin the detail rows the console actually renders', async () => {
    const admin = await signedIn('admin@example.com', 'ADMIN', 'Ada Admin');
    await createAccount('sam@example.com', 'STUDENT', 'Sam Student', 'student');

    const response = await get('', admin);
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.meta).toMatchObject({ page: 1, total: 2, totalPages: 1, hasNext: false });

    // The four fields AdminUsers.tsx reads (:126,:135,:141,:147) and `userSummarySchema`
    // does not carry. The department is NESTED under the profile, which is the mismatch
    // apps/web/src/lib/types.ts:18-29 hides behind a flat `departmentName`.
    const student = body.data.find((row: { email: string }) => row.email === 'sam@example.com');
    expect(student).toMatchObject({
      email: 'sam@example.com',
      status: 'ACTIVE',
      role: 'STUDENT',
      lastLoginAt: null,
      teacherProfile: null,
    });
    expect(student.studentProfile).toMatchObject({
      departmentId,
      departmentName: 'Department welding',
    });
    expect(student.avatarUrl).toEqual(expect.any(String));
    // Nothing credential-shaped ever reaches the wire.
    expect(student.passwordHash).toBeUndefined();
    expect(student.totpSecret).toBeUndefined();
  });

  it('refuses a teacher the directory, naming the rule that denied it', async () => {
    const teacher = await signedIn('teacher@example.com', 'TEACHER', 'Tessa Teacher', 'teacher');

    const response = await get('', teacher);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain('rule: TEACHER:deny');
  });

  it('refuses a student the directory', async () => {
    const student = await signedIn('student@example.com', 'STUDENT', 'Sam', 'student');

    const response = await get('', student);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: STUDENT:deny');
  });

  it('refuses an anonymous caller', async () => {
    const response = await get('');
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
  });

  it('filters by role and by a substring of name or email', async () => {
    const admin = await signedIn('admin2@example.com', 'ADMIN', 'Ada Admin');
    await createAccount('grace@example.com', 'STUDENT', 'Grace Hopper', 'student');
    await createAccount('linus@example.com', 'TEACHER', 'Linus Torvalds', 'teacher');

    const byRole = await get('?role=TEACHER', admin);
    expect(byRole.statusCode).toBe(200);
    expect(byRole.json().data.map((row: { name: string }) => row.name)).toEqual(['Linus Torvalds']);

    // Case-insensitive on `name`, a plain String column.
    const byName = await get('?q=hopp', admin);
    expect(byName.json().data.map((row: { name: string }) => row.name)).toEqual(['Grace Hopper']);

    // And on `email`, which is `@db.Citext` (schema.prisma:132).
    const byEmail = await get('?q=LINUS@', admin);
    expect(byEmail.json().data.map((row: { name: string }) => row.name)).toEqual([
      'Linus Torvalds',
    ]);
  });

  it('does not leak a soft-deleted account', async () => {
    const admin = await signedIn('admin3@example.com', 'ADMIN', 'Ada Admin');
    const goneId = await createAccount('gone@example.com', 'STUDENT', 'Gone Person', 'student');
    // Soft delete is not enforced by the ORM, so every read has to filter it by hand.
    await prisma.user.update({ where: { id: goneId }, data: { deletedAt: new Date() } });

    const list = await get('', admin);
    expect(list.json().data.map((row: { email: string }) => row.email)).toEqual([
      'admin3@example.com',
    ]);
    expect(list.json().meta.total).toBe(1);

    // An admin passes the gate unconditionally, so this 404 is the soft-delete filter
    // rather than a policy denial wearing a different status.
    expect((await get(`/${goneId}`, admin)).statusCode).toBe(404);
  });

  it('pages with the shared meta block', async () => {
    const admin = await signedIn('admin4@example.com', 'ADMIN', 'Ada Admin');
    await createAccount('a@example.com', 'STUDENT', 'A Person', 'student');
    await createAccount('b@example.com', 'STUDENT', 'B Person', 'student');

    const response = await get('?limit=2&page=1', admin);
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
    const admin = await signedIn('admin5@example.com', 'ADMIN', 'Ada Admin');

    const response = await get('?limit=abc', admin);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /users/me', () => {
  it('serves the caller their own record, not a summary', async () => {
    const student = await signedIn('self@example.com', 'STUDENT', 'Self Student', 'student');

    const response = await get('/me', student);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      email: 'self@example.com',
      name: 'Self Student',
      role: 'STUDENT',
      status: 'ACTIVE',
      mfaEnabled: false,
    });
    expect(response.json().studentProfile.departmentName).toBe('Department welding');
  });

  it('refuses an anonymous caller', async () => {
    const response = await get('/me');
    expect(response.statusCode).toBe(401);
  });

  it('routes /me to the static segment rather than parsing it as an id', async () => {
    const teacher = await signedIn('static@example.com', 'TEACHER', 'Tessa', 'teacher');

    // If '/me' fell through to '/:id', `idSchema` would answer 422 before any policy ran.
    const response = await get('/me', teacher);
    expect(response.statusCode).toBe(200);
    expect(response.json().email).toBe('static@example.com');
  });
});

describe('GET /users/:id', () => {
  it('refuses a teacher another user’s profile, naming the rule', async () => {
    const teacher = await signedIn('nosy@example.com', 'TEACHER', 'Nosy Teacher', 'teacher');
    const otherId = await createAccount('target@example.com', 'STUDENT', 'Target', 'student');

    const response = await get(`/${otherId}`, teacher);
    // 403 and not 404: a 404 would confirm the account does not exist, and not 422:
    // a 422 here would mean the params schema rejected a legitimate id before the
    // policy preHandler ever ran (validation runs BEFORE preHandler).
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain('rule: TEACHER:isSelf');
  });

  it('refuses a student another user’s profile', async () => {
    const student = await signedIn('peer@example.com', 'STUDENT', 'Peer', 'student');
    const otherId = await createAccount('peer2@example.com', 'STUDENT', 'Other Peer', 'student');

    const response = await get(`/${otherId}`, student);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: STUDENT:isSelf');
  });

  it('lets a teacher read themselves by id', async () => {
    const teacherId = await createAccount('mine@example.com', 'TEACHER', 'Mine', 'teacher');
    const teacher = await login('mine@example.com');

    const response = await get(`/${teacherId}`, teacher);
    expect(response.statusCode).toBe(200);
    expect(response.json().teacherProfile).toMatchObject({
      departmentId,
      qualification: 'MSc Welding',
      specialization: null,
      staffNo: null,
    });
  });

  it('lets an admin read anyone, and 404s an unknown id', async () => {
    const admin = await signedIn('admin6@example.com', 'ADMIN', 'Ada Admin');
    const otherId = await createAccount('read@example.com', 'STUDENT', 'Readable', 'student');

    expect((await get(`/${otherId}`, admin)).statusCode).toBe(200);

    const missing = await get(`/${ABSENT_ID}`, admin);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('NOT_FOUND');
  });

  it('refuses an anonymous caller', async () => {
    const otherId = await createAccount('anon@example.com', 'STUDENT', 'Anon Target', 'student');

    const response = await get(`/${otherId}`);
    expect(response.statusCode).toBe(401);
  });
});

describe('PATCH /users/me', () => {
  it('updates the caller’s own record', async () => {
    const student = await signedIn('editor@example.com', 'STUDENT', 'Before Name', 'student');

    const response = await send(
      'PATCH',
      '/me',
      { name: 'After Name', bio: 'Welding since 2019.' },
      student,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: 'After Name', bio: 'Welding since 2019.' });

    const row = await prisma.user.findFirstOrThrow({ where: { email: 'editor@example.com' } });
    expect(row.name).toBe('After Name');
  });

  it('rejects the SPA’s empty-string phoneNumber at the validator, before the policy', async () => {
    const student = await signedIn('phone@example.com', 'STUDENT', 'Phoney', 'student');

    // Settings.tsx:84 seeds defaultValues `{ phoneNumber: '', bio: '' }`, so an
    // untouched form sends this. phoneSchema (common.ts:60-63) refuses it. The fix is
    // in the SPA — sending undefined or null — not a looser shared schema.
    const response = await send('PATCH', '/me', { phoneNumber: '' }, student);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  });

  it('accepts a real phone number and a null that clears it', async () => {
    const student = await signedIn('phone2@example.com', 'STUDENT', 'Phoney Two', 'student');

    const set = await send('PATCH', '/me', { phoneNumber: '+44 7700 900123' }, student);
    expect(set.statusCode).toBe(200);
    expect(set.json().phoneNumber).toBe('+44 7700 900123');

    const cleared = await send('PATCH', '/me', { phoneNumber: null }, student);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().phoneNumber).toBeNull();
  });

  it('rejects an empty body through the shared refinement', async () => {
    const student = await signedIn('empty@example.com', 'STUDENT', 'Empty', 'student');

    const response = await send('PATCH', '/me', {}, student);
    expect(response.statusCode).toBe(422);
  });

  it('refuses an avatarUploadId with a field path while uploads do not exist', async () => {
    const student = await signedIn('avatar@example.com', 'STUDENT', 'Avatar', 'student');

    const response = await send('PATCH', '/me', { avatarUploadId: ABSENT_ID }, student);
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual({
      path: 'avatarUploadId',
      message: 'Uploads are not available yet',
    });
  });

  it('cannot change its own role or status — those keys are not in the schema', async () => {
    const student = await signedIn('climber@example.com', 'STUDENT', 'Climber', 'student');

    const response = await send('PATCH', '/me', { name: 'Climber', role: 'ADMIN' }, student);
    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe('STUDENT');

    const row = await prisma.user.findFirstOrThrow({ where: { email: 'climber@example.com' } });
    expect(row.role).toBe('STUDENT');
  });

  it('refuses an anonymous caller', async () => {
    const response = await send('PATCH', '/me', { name: 'Nobody At All' });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a state change that is not same-origin', async () => {
    const student = await signedIn('csrf@example.com', 'STUDENT', 'Csrf', 'student');

    const response = await send('PATCH', '/me', { name: 'Hijacked Name' }, student, {});
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: csrf.sameOrigin');
  });
});

describe('POST /users/:id/suspend', () => {
  it('suspends on the SPA’s bodyless POST and destroys every session', async () => {
    const admin = await signedIn('admin7@example.com', 'ADMIN', 'Ada Admin');
    await createAccount('victim@example.com', 'STUDENT', 'Victim', 'student');
    const victim = await login('victim@example.com');
    const victimId = (
      await prisma.user.findFirstOrThrow({ where: { email: 'victim@example.com' } })
    ).id;

    expect(await prisma.session.count({ where: { userId: victimId } })).toBe(1);

    // No body at all — exactly what AdminUsers.tsx:67 sends. `.optional()` on the body
    // schema would make this a 422 before the policy preHandler ran.
    const response = await send('POST', `/${victimId}/suspend`, undefined, admin);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: victimId, status: 'SUSPENDED' });

    expect(await prisma.session.count({ where: { userId: victimId } })).toBe(0);
    // The toast promises the account is signed out everywhere; the cookie is now inert.
    expect((await get('/me', victim)).statusCode).toBe(401);
  });

  it('accepts a reason when one is sent', async () => {
    const admin = await signedIn('admin8@example.com', 'ADMIN', 'Ada Admin');
    const victimId = await createAccount('victim2@example.com', 'STUDENT', 'Victim Two', 'student');

    const response = await send(
      'POST',
      `/${victimId}/suspend`,
      { reason: 'Repeated plagiarism' },
      admin,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('SUSPENDED');
  });

  it('rejects a reason that is too short, rather than silently defaulting it', async () => {
    const admin = await signedIn('admin9@example.com', 'ADMIN', 'Ada Admin');
    const victimId = await createAccount('v3@example.com', 'STUDENT', 'Victim Three', 'student');

    const response = await send('POST', `/${victimId}/suspend`, { reason: 'no' }, admin);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  });

  it('refuses an admin suspending themself, naming not(isSelf)', async () => {
    const admin = await signedIn('admin10@example.com', 'ADMIN', 'Ada Admin');
    const adminId = (
      await prisma.user.findFirstOrThrow({ where: { email: 'admin10@example.com' } })
    ).id;

    const response = await send('POST', `/${adminId}/suspend`, undefined, admin);
    // policy.ts:316-317 — self-suspension would lock the last admin out of the instance.
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: ADMIN:not(isSelf)');

    const row = await prisma.user.findUniqueOrThrow({ where: { id: adminId } });
    expect(row.status).toBe('ACTIVE');
  });

  it('refuses a teacher', async () => {
    const teacher = await signedIn('nosy2@example.com', 'TEACHER', 'Nosy', 'teacher');
    const victimId = await createAccount('v4@example.com', 'STUDENT', 'Victim Four', 'student');

    const response = await send('POST', `/${victimId}/suspend`, undefined, teacher);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: TEACHER:deny');

    const row = await prisma.user.findUniqueOrThrow({ where: { id: victimId } });
    expect(row.status).toBe('ACTIVE');
  });

  it('refuses an anonymous caller', async () => {
    const victimId = await createAccount('v5@example.com', 'STUDENT', 'Victim Five', 'student');

    const response = await send('POST', `/${victimId}/suspend`, undefined);
    expect(response.statusCode).toBe(401);
  });

  it('is idempotent: a double click leaves exactly one SUSPEND audit row', async () => {
    const admin = await signedIn('admin11@example.com', 'ADMIN', 'Ada Admin');
    const victimId = await createAccount('victim6@example.com', 'STUDENT', 'Victim Six', 'student');

    const first = await send('POST', `/${victimId}/suspend`, undefined, admin);
    const second = await send('POST', `/${victimId}/suspend`, undefined, admin);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe('SUSPENDED');

    // Written by the Prisma extension from the ACTIVE -> SUSPENDED transition
    // (audit.ts:161-163), never by hand. Scoped to this fixture's id because
    // resetDatabase() does not clear AuditEvent.
    const rows = await prisma.auditEvent.count({
      where: { entityType: 'User', entityId: victimId, action: 'SUSPEND' },
    });
    expect(rows).toBe(1);
  });

  it('404s an unknown id for an admin, who passes the gate unconditionally', async () => {
    const admin = await signedIn('admin12@example.com', 'ADMIN', 'Ada Admin');

    const response = await send('POST', `/${ABSENT_ID}/suspend`, undefined, admin);
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('NOT_FOUND');
  });
});
