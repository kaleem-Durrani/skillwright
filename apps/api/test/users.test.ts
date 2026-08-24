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

/** Shaped like a cuid so `idSchema` (common.ts:20-22) accepts it and the route reaches the service. */
const ABSENT_ID = 'ckzzzzzzzzzzzzzzzzzzzzzzz';

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

// --- uploads (real bytes through the real presigned flow) -------------------

/** Bytes shaped enough like a document that a human could tell them apart in a diff. */
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
 * Presign -> PUT -> (optionally) commit, straight to the bucket over `fetch` exactly as
 * the browser does. The API never sees these bytes, so an injected request would prove
 * nothing about whether MinIO accepted the signature — or, below, about the avatar URL
 * really serving what was PUT.
 *
 * The declared contentType follows the PURPOSE, because that is what the purpose limits
 * check; the bytes themselves are irrelevant to MinIO.
 */
async function storeUpload(
  token: string,
  options: { purpose: 'AVATAR' | 'RESOURCE'; originalName?: string; commit?: boolean },
): Promise<{ uploadId: string; key: string; body: Buffer }> {
  const body = fileBytes(options.originalName ?? 'uploaded');
  const presigned = await app.inject({
    method: 'POST',
    url: '/api/v1/uploads/presign',
    headers: { ...originHeaders, cookie: cookieHeader(token) },
    payload: {
      purpose: options.purpose,
      originalName: options.originalName ?? 'me.png',
      contentType: options.purpose === 'AVATAR' ? 'image/png' : 'application/pdf',
      sizeBytes: body.length,
    },
  });
  expect(presigned.statusCode).toBe(201);
  const signed: PresignBody = presigned.json();

  const put = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body });
  if (!put.ok) throw new Error(`PUT to the signed URL failed: ${put.status} ${await put.text()}`);

  if (options.commit !== false) {
    const committed = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/commit',
      headers: { ...originHeaders, cookie: cookieHeader(token) },
      payload: { uploadId: signed.uploadId },
    });
    expect(committed.statusCode).toBe(200);
    expect(committed.json().status).toBe('COMMITTED');
  }

  return { uploadId: signed.uploadId, key: signed.key, body };
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

  /**
   * The avatar path end to end: presign (purpose AVATAR), PUT, commit, attach through
   * PATCH /users/me, then read the face back and pull its BYTES out of the bucket. The
   * bytes assertion is what stops a plausible-looking URL from passing the test — a
   * signed URL for a deleted or never-uploaded key answers 403 from the private bucket,
   * which a status-only check would happily read as "not dicebear".
   */
  it('attaches the caller’s own committed AVATAR upload and serves it as avatarUrl', async () => {
    const studentId = await createAccount('avatar-ok@example.com', 'STUDENT', 'Avatar');
    const token = await login('avatar-ok@example.com');
    const file = await storeUpload(token, { purpose: 'AVATAR', originalName: 'me.png' });

    const response = await send('PATCH', '/me', { avatarUploadId: file.uploadId }, token);
    expect(response.statusCode).toBe(200);

    // Stored on the row, not merely echoed.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: studentId } });
    expect(row.avatarUploadId).toBe(file.uploadId);

    // The detail read prefers the upload over the derived fallback...
    const me = await get('/me', token);
    expect(me.statusCode).toBe(200);
    expect(me.json().avatarUrl).not.toContain('dicebear');
    expect(me.json().avatarUrl).toContain(file.key);

    // ...and it is a real door to the real bytes.
    const fetched = await fetch(me.json().avatarUrl as string);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(file.body)).toBe(true);

    // The admin list shares the same preference — USER_DETAIL_INCLUDE feeds both.
    const admin = await signedIn('avatar-admin@example.com', 'ADMIN');
    const listed = await get(`/${studentId}`, admin);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().avatarUrl).toContain(file.key);
  });

  it('clears the avatar with an explicit null and falls back to the derived face', async () => {
    const token = await signedIn('avatar-clear@example.com', 'STUDENT', 'Clear');
    const file = await storeUpload(token, { purpose: 'AVATAR' });

    const attached = await send('PATCH', '/me', { avatarUploadId: file.uploadId }, token);
    expect(attached.statusCode).toBe(200);

    const cleared = await send('PATCH', '/me', { avatarUploadId: null }, token);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().avatarUrl).toContain('dicebear');

    const row = await prisma.user.findFirstOrThrow({
      where: { email: 'avatar-clear@example.com' },
    });
    expect(row.avatarUploadId).toBeNull();
  });

  it("refuses an upload minted for another purpose, at path 'avatarUploadId'", async () => {
    const token = await signedIn('avatar-purpose@example.com', 'STUDENT', 'Purpose');
    // Committed, owned, unclaimed — every question except the purpose one passes.
    const file = await storeUpload(token, { purpose: 'RESOURCE', originalName: 'handbook.pdf' });

    const response = await send('PATCH', '/me', { avatarUploadId: file.uploadId }, token);
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual(
      expect.objectContaining({
        path: 'avatarUploadId',
        message: expect.stringContaining('avatar'),
      }),
    );

    const row = await prisma.user.findFirstOrThrow({
      where: { email: 'avatar-purpose@example.com' },
    });
    expect(row.avatarUploadId).toBeNull();
  });

  it("refuses an upload that was never committed, at path 'avatarUploadId'", async () => {
    const token = await signedIn('avatar-pending@example.com', 'STUDENT', 'Pending');
    // The PUT happened; the commit did not. From the client's side this looks finished,
    // which is exactly why the refusal must name the skipped step rather than 409.
    const file = await storeUpload(token, { purpose: 'AVATAR', commit: false });

    const response = await send('PATCH', '/me', { avatarUploadId: file.uploadId }, token);
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual(
      expect.objectContaining({
        path: 'avatarUploadId',
        message: expect.stringContaining('confirmed'),
      }),
    );
  });

  it("refuses somebody else's upload, at path 'avatarUploadId'", async () => {
    const owner = await signedIn('avatar-owner@example.com', 'STUDENT', 'Owner');
    const thiefToken = await signedIn('avatar-thief@example.com', 'STUDENT', 'Thief');
    const file = await storeUpload(owner, { purpose: 'AVATAR' });

    const response = await send('PATCH', '/me', { avatarUploadId: file.uploadId }, thiefToken);
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual(
      expect.objectContaining({
        path: 'avatarUploadId',
        message: expect.stringContaining('someone else'),
      }),
    );
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

// --- Phase 4b: provisioning --------------------------------------------------

describe('POST /users (provisioning)', () => {
  /** The body every happy-path test starts from; individual tests override fields. */
  function teacherBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      email: 'nora@example.com',
      name: 'Nora Teacher',
      role: 'TEACHER',
      departmentId,
      qualification: 'CSWIP 3.1 Senior Welding Inspector',
      specialization: 'Underwater welding',
      staffNo: 'STF-0042',
      ...overrides,
    };
  }

  it('provisions a teacher with profile fields, no password, and a CREATE audit row', async () => {
    const adminId = await createAccount('provisioner@example.com', 'ADMIN', 'Ada Admin');
    const admin = await login('provisioner@example.com');

    const response = await send('POST', '', teacherBody(), admin);
    expect(response.statusCode).toBe(201);

    // The existing user detail shape, with the profile projected from the request.
    const body = response.json();
    expect(body).toMatchObject({
      email: 'nora@example.com',
      name: 'Nora Teacher',
      role: 'TEACHER',
      teacherProfile: {
        departmentId,
        departmentName: 'Department welding',
        qualification: 'CSWIP 3.1 Senior Welding Inspector',
        specialization: 'Underwater welding',
        staffNo: 'STF-0042',
      },
      studentProfile: null,
    });

    // No credential is invented: the person sets their own password through the
    // existing forgot/reset-password flow (Mailpit in dev), which also flips the
    // status default to ACTIVE once they have proved they hold the mailbox.
    expect(body.status).toBe('PENDING_VERIFICATION');
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: body.id },
      include: { teacherProfile: true },
    });
    expect(row.passwordHash).toBeNull();
    expect(row.teacherProfile?.staffNo).toBe('STF-0042');

    // Written by the Prisma extension off `prisma.user.create` — one CREATE row whose
    // actor is the provisioning admin. resetDatabase() does not clear AuditEvent, so
    // the count is scoped to this fixture's id.
    const audits = await prisma.auditEvent.findMany({
      where: { entityType: 'User', entityId: body.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'CREATE', actorId: adminId });
  });

  it('provisions a student, honoring an enrollmentNo and generating one when absent', async () => {
    const admin = await signedIn('student-provisioner@example.com', 'ADMIN');

    const explicit = await send(
      'POST',
      '',
      {
        email: 'enrolled@example.com',
        name: 'Enrolled Person',
        role: 'STUDENT',
        departmentId,
        enrollmentNo: 'SW-ENR-0001',
      },
      admin,
    );
    expect(explicit.statusCode).toBe(201);
    expect(explicit.json().studentProfile).toMatchObject({
      departmentId,
      departmentName: 'Department welding',
      enrollmentNo: 'SW-ENR-0001',
    });

    const generated = await send(
      'POST',
      '',
      { email: 'generated@example.com', name: 'Generated Person', role: 'STUDENT', departmentId },
      admin,
    );
    expect(generated.statusCode).toBe(201);
    expect(generated.json().studentProfile.enrollmentNo).toMatch(/^SW-\d{4}-/);
  });

  it('answers 409 on a duplicate email and creates nothing', async () => {
    const admin = await signedIn('dup-admin@example.com', 'ADMIN');
    await createAccount('taken@example.com', 'STUDENT', 'Taken Person', 'student');

    const response = await send(
      'POST',
      '',
      { email: 'taken@example.com', name: 'Second Person', role: 'STUDENT', departmentId },
      admin,
    );
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('CONFLICT');

    // Exactly one row for that address — the pre-existing one.
    const rows = await prisma.user.findMany({ where: { email: 'taken@example.com' } });
    expect(rows).toHaveLength(1);
  });

  it('refuses a teacher with the rule tag, and nothing is created', async () => {
    const teacher = await signedIn('hiring@example.com', 'TEACHER', 'Hiring Teacher', 'teacher');

    const response = await send('POST', '', teacherBody({ email: 'sneak@example.com' }), teacher);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain('rule: TEACHER:deny');

    const rows = await prisma.user.findMany({ where: { email: 'sneak@example.com' } });
    expect(rows).toHaveLength(0);
  });

  it('refuses a student with the rule tag', async () => {
    const student = await signedIn('selfhire@example.com', 'STUDENT', 'Self Hire', 'student');

    const response = await send(
      'POST',
      '',
      {
        email: 'selfhire-target@example.com',
        name: 'Self Hire Target',
        role: 'STUDENT',
        departmentId,
      },
      student,
    );
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: STUDENT:deny');
  });

  it('refuses an anonymous caller before any validation of the body matters', async () => {
    const response = await send('POST', '', teacherBody());
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
  });

  it('refuses role-inappropriate profile fields at their own path', async () => {
    const admin = await signedIn('field-admin@example.com', 'ADMIN');

    // A STUDENT has no TeacherProfile to hold a qualification.
    const studentWithQualification = await send(
      'POST',
      '',
      teacherBody({
        email: 'mismatched@example.com',
        role: 'STUDENT',
        qualification: 'MSc Welding',
      }),
      admin,
    );
    expect(studentWithQualification.statusCode).toBe(422);
    expect(studentWithQualification.json().errors).toContainEqual(
      expect.objectContaining({ path: 'qualification' }),
    );

    // An admin belongs to no department, so there is nowhere for the id to go.
    const adminWithDepartment = await send(
      'POST',
      '',
      { email: 'dept-admin@example.com', name: 'Dept Admin', role: 'ADMIN', departmentId },
      admin,
    );
    expect(adminWithDepartment.statusCode).toBe(422);
    expect(adminWithDepartment.json().errors).toContainEqual(
      expect.objectContaining({ path: 'departmentId' }),
    );

    const rows = await prisma.user.findMany({
      where: { email: { in: ['mismatched@example.com', 'dept-admin@example.com'] } },
    });
    expect(rows).toHaveLength(0);
  });

  it('lets the wire schema refuse a teacher without a qualification, via superRefine', async () => {
    const admin = await signedIn('wire-admin@example.com', 'ADMIN');

    const response = await send(
      'POST',
      '',
      teacherBody({
        email: 'unqualified@example.com',
        qualification: undefined,
        specialization: undefined,
        staffNo: undefined,
      }),
      admin,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual(
      expect.objectContaining({ path: 'qualification' }),
    );
  });
});

// --- Phase 4b: editable profiles ---------------------------------------------

describe('PATCH /users/me profile fields', () => {
  it('updates a teacher’s own qualifications, specialization and staffNo', async () => {
    const token = await signedIn('qual@example.com', 'TEACHER', 'Qualified Teacher', 'teacher');

    const response = await send(
      'PATCH',
      '/me',
      { qualification: 'NVQ Level 3 Welding', specialization: 'Pipe', staffNo: 'STF-7777' },
      token,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().teacherProfile).toMatchObject({
      departmentId,
      qualification: 'NVQ Level 3 Welding',
      specialization: 'Pipe',
      staffNo: 'STF-7777',
    });

    const row = await prisma.teacherProfile.findUniqueOrThrow({
      where: {
        userId: (await prisma.user.findFirstOrThrow({ where: { email: 'qual@example.com' } })).id,
      },
    });
    expect(row.qualification).toBe('NVQ Level 3 Welding');
  });

  it('clears nullable teacher columns with null but not the NOT NULL qualification', async () => {
    const token = await signedIn('clearable@example.com', 'TEACHER', 'Clearable', 'teacher');

    const cleared = await send('PATCH', '/me', { specialization: null, staffNo: null }, token);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().teacherProfile).toMatchObject({ specialization: null, staffNo: null });

    const nulled = await send('PATCH', '/me', { qualification: null }, token);
    expect(nulled.statusCode).toBe(422);
    expect(nulled.json().code).toBe('VALIDATION_FAILED');
  });

  it('updates a student’s own enrollmentNo, and 409s a number somebody else holds', async () => {
    const first = await signedIn('first-enrol@example.com', 'STUDENT', 'First', 'student');
    const second = await signedIn('second-enrol@example.com', 'STUDENT', 'Second', 'student');

    const response = await send('PATCH', '/me', { enrollmentNo: 'SW-MINE-01' }, first);
    expect(response.statusCode).toBe(200);
    expect(response.json().studentProfile).toMatchObject({
      departmentId,
      enrollmentNo: 'SW-MINE-01',
    });

    const clash = await send('PATCH', '/me', { enrollmentNo: 'SW-MINE-01' }, second);
    expect(clash.statusCode).toBe(409);
    expect(clash.json().code).toBe('CONFLICT');
  });

  it('refuses a student teacher fields at their own path, rather than ignoring them', async () => {
    const student = await signedIn('wrongfields@example.com', 'STUDENT', 'Wrong Fields', 'student');

    const response = await send(
      'PATCH',
      '/me',
      { qualification: 'MSc Welding', staffNo: 'STF-1' },
      student,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual(
      expect.objectContaining({ path: 'qualification' }),
    );
    expect(response.json().errors).toContainEqual(expect.objectContaining({ path: 'staffNo' }));

    // Nothing moved.
    const row = await prisma.studentProfile.findFirstOrThrow({
      where: { user: { email: 'wrongfields@example.com' } },
    });
    expect(row.enrollmentNo).not.toBe('STF-1');
  });

  it('refuses an admin profile fields — admins have no satellite row', async () => {
    const admin = await signedIn('admin-profile@example.com', 'ADMIN');

    const response = await send('PATCH', '/me', { qualification: 'MSc' }, admin);
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual(
      expect.objectContaining({ path: 'qualification' }),
    );
  });

  it('409s a teacher account with no profile row instead of inventing a department', async () => {
    // No satellite exists and self-update carries no departmentId BY DESIGN, so there
    // is nothing to create the row WITH — the honest answer names the gap.
    const token = await signedIn('satelliteless@example.com', 'TEACHER', 'No Satellite');

    const response = await send('PATCH', '/me', { qualification: 'NVQ Level 3' }, token);
    expect(response.statusCode).toBe(409);
    expect(response.json().detail).toContain('no teacher profile');
  });
});

describe('PATCH /users/:id (admin edits another user)', () => {
  it('edits another user’s teacher profile from the same body schema', async () => {
    const admin = await signedIn('edit-admin@example.com', 'ADMIN', 'Editing Admin');
    const targetId = await createAccount('edit-target@example.com', 'TEACHER', 'Target', 'teacher');

    const response = await send(
      'PATCH',
      `/${targetId}`,
      { qualification: 'CSWIP 3.2', staffNo: 'STF-9000' },
      admin,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().teacherProfile).toMatchObject({
      qualification: 'CSWIP 3.2',
      staffNo: 'STF-9000',
    });

    const row = await prisma.teacherProfile.findUniqueOrThrow({ where: { userId: targetId } });
    expect(row.qualification).toBe('CSWIP 3.2');
  });

  it('judges profile fields against the TARGET’s role, not the caller’s', async () => {
    // The admin may legitimately send teacher fields; the STUDENT target may not
    // receive them. The refusal is about the target, so the path names the field.
    const admin = await signedIn('rolefit-admin@example.com', 'ADMIN');
    const studentId = await createAccount('rolefit@example.com', 'STUDENT', 'Role Fit', 'student');

    const response = await send('PATCH', `/${studentId}`, { staffNo: 'STF-1' }, admin);
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual(expect.objectContaining({ path: 'staffNo' }));

    const row = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: studentId } });
    expect(row.enrollmentNo).not.toBe('STF-1');
  });

  it('refuses avatarUploadId on the admin path at its own field', async () => {
    const admin = await signedIn('avatar-admin2@example.com', 'ADMIN');
    const targetId = await createAccount(
      'avatar-target@example.com',
      'STUDENT',
      'Target',
      'student',
    );
    const owner = await signedIn('avatar-owner2@example.com', 'STUDENT', 'Owner');
    const file = await storeUpload(owner, { purpose: 'AVATAR' });

    const response = await send('PATCH', `/${targetId}`, { avatarUploadId: file.uploadId }, admin);
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual(
      expect.objectContaining({ path: 'avatarUploadId' }),
    );
  });

  it('keeps the policy gate: a teacher cannot edit another user at all', async () => {
    const teacher = await signedIn('editor-nosy@example.com', 'TEACHER', 'Nosy Editor', 'teacher');
    const targetId = await createAccount('edit-victim@example.com', 'STUDENT', 'Victim', 'student');

    const response = await send('PATCH', `/${targetId}`, { name: 'Renamed' }, teacher);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: TEACHER:isSelf');

    const row = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(row.name).toBe('Victim');
  });

  it('404s an unknown id for an admin and refuses an anonymous caller', async () => {
    const admin = await signedIn('patch404-admin@example.com', 'ADMIN');

    const missing = await send('PATCH', `/${ABSENT_ID}`, { name: 'Nobody' }, admin);
    expect(missing.statusCode).toBe(404);

    const anonymous = await send('PATCH', `/${ABSENT_ID}`, { name: 'Nobody' });
    expect(anonymous.statusCode).toBe(401);
  });
});
