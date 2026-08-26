import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// app.ts:51-52: "Anything that holds an instance built here — main.ts, the integration
// tests — should name this type. Plain FastifyInstance is a type error, not a widening."
import type { AppInstance } from '../src/app.js';
import { hashPassword } from '../src/lib/password.js';
import { headObject, stagingKeyFor } from '../src/lib/storage.js';
import { sweepAbandonedUploads } from '../src/modules/uploads/uploads.sweeper.js';
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

/**
 * The sweeper is driven DIRECTLY — `sweepAbandonedUploads` with explicit options — and
 * never by wall-clock: buildApp() skips `startUploadSweeper` under NODE_ENV=test
 * (app.ts, registration guard), so no background timer races these assertions.
 *
 * The bucket assertions are real. Each stale row under test gets REAL bytes via the
 * presigned flow, so `headObject(key) === null` after a sweep means the object was
 * genuinely deleted and not merely that the row went away; MinIO answering for itself
 * is the same standard uploads.test.ts holds its download URLs to.
 */

let app: AppInstance;
let departmentId: string;
/** Hashed once: argon2 is deliberately expensive, and every account here shares it. */
let passwordHash: string;

/**
 * setup.ts clears most of these too, but a suite that leaves a course behind breaks the
 * NEXT file's reset: Course.teacherId is onDelete: Restrict, so the user delete inside
 * resetDatabase() fails while any course survives. Same discipline as uploads.test.ts,
 * with uploads cleared before courses for the same Restrict-shaped reason.
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
  passwordHash = await hashPassword(PASSWORD);
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

// --- harness ---------------------------------------------------------------

/** Provisioned directly; nothing here needs the register-and-verify flow. */
async function createAccount(
  email: string,
  role: 'STUDENT' | 'TEACHER' | 'ADMIN',
): Promise<string> {
  const user = await prisma.user.create({
    data: { email, name: 'Test Person', role, status: 'ACTIVE', passwordHash },
  });
  return user.id;
}

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
 * Presign -> PUT, and stop there: the row stays PENDING with real bytes behind it,
 * which is exactly an abandoned upload as the client leaves it when the dialog closes
 * AFTER the PUT but before commit ever fired.
 */
async function putPendingObject(token: string): Promise<{ uploadId: string; key: string }> {
  const body = fileBytes('abandoned');
  const presigned = await app.inject({
    method: 'POST',
    url: '/api/v1/uploads/presign',
    headers: { ...originHeaders, cookie: cookieHeader(token) },
    payload: {
      purpose: 'RESOURCE',
      originalName: 'abandoned.pdf',
      contentType: 'application/pdf',
      sizeBytes: body.length,
    },
  });
  expect(presigned.statusCode).toBe(201);
  const signed: PresignBody = presigned.json();

  const put = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body });
  if (!put.ok) throw new Error(`PUT to the signed URL failed: ${put.status} ${await put.text()}`);

  return { uploadId: signed.uploadId, key: signed.key };
}

/** Backdate a row so it crosses whatever maxAgeMs the test sweeps with. */
async function backdate(uploadId: string, hoursAgo = 2): Promise<void> {
  await prisma.upload.update({
    where: { id: uploadId },
    data: { createdAt: new Date(Date.now() - hoursAgo * 3_600_000) },
  });
}

/** Uniqueness without cleverness: one more than the last key this helper built. */
let bareKeySequence = 0;

/** A row with no object at all — legal to sweep, because DeleteObject is idempotent. */
async function bareStaleRow(ownerId: string): Promise<string> {
  bareKeySequence += 1;
  const row = await prisma.upload.create({
    data: {
      key: `resources/01HZZZZZZZZZZZZZZZZZZZ${String(bareKeySequence).padStart(4, '0')}.pdf`,
      bucket: process.env.S3_BUCKET ?? 'skillwright-uploads',
      contentType: 'application/pdf',
      sizeBytes: 128,
      originalName: 'never-put.pdf',
      status: 'PENDING',
      ownerId,
      createdAt: new Date(Date.now() - 2 * 3_600_000),
    },
  });
  return row.id;
}

describe('sweepAbandonedUploads', () => {
  it('deletes a stale PENDING row AND the object behind it', async () => {
    await createAccount('sweep-owner@example.com', 'STUDENT');
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { ...originHeaders },
      payload: { email: 'sweep-owner@example.com', password: PASSWORD },
    });
    const token = sessionCookie(login);
    expect(token).toBeTruthy();

    const { uploadId, key } = await putPendingObject(token as string);
    await backdate(uploadId);

    // The object IS there before the sweep — otherwise deleting it proves nothing.
    // While the row is PENDING its bytes live at the STAGING shadow of the row's key
    // (storage.ts `stagingKeyFor`): the presigned PUT never wrote to the final key,
    // because only commit's verified copy may.
    expect(await headObject(stagingKeyFor(key))).not.toBeNull();

    const swept = await sweepAbandonedUploads({ maxAgeMs: 3_600_000 });
    expect(swept).toBe(1);

    const remaining = await prisma.upload.count({ where: { id: uploadId } });
    expect(remaining).toBe(0);
    expect(await headObject(stagingKeyFor(key))).toBeNull();
  });

  it('leaves a fresh PENDING row and its object alone', async () => {
    const ownerId = await createAccount('sweep-fresh@example.com', 'STUDENT');
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { ...originHeaders },
      payload: { email: 'sweep-fresh@example.com', password: PASSWORD },
    });
    const token = sessionCookie(login);
    expect(token).toBeTruthy();

    const { uploadId, key } = await putPendingObject(token as string);
    // NOT backdated: created moments ago, inside any sane max age.

    const swept = await sweepAbandonedUploads({ maxAgeMs: 3_600_000 });
    expect(swept).toBe(0);

    const row = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
    expect(row.status).toBe('PENDING');
    // Untouched, at the staging shadow — a fresh claim keeps its bytes.
    expect(await headObject(stagingKeyFor(key))).not.toBeNull();
  });

  /**
   * The hard edge from the feature plan: COMMITTED rows are never swept, however old.
   * The upload client reuses a committed upload across retries, and every attachment
   * point requires COMMITTED — age alone must never select a row.
   */
  it('never touches a COMMITTED row, even a stale one with bytes in the bucket', async () => {
    await createAccount('sweep-committed@example.com', 'TEACHER');
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { ...originHeaders },
      payload: { email: 'sweep-committed@example.com', password: PASSWORD },
    });
    const token = sessionCookie(login);
    expect(token).toBeTruthy();

    const body = fileBytes('committed');
    const presigned = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/presign',
      headers: { ...originHeaders, cookie: cookieHeader(token as string) },
      payload: {
        purpose: 'RESOURCE',
        originalName: 'kept.pdf',
        contentType: 'application/pdf',
        sizeBytes: body.length,
      },
    });
    const signed: PresignBody = presigned.json();
    const put = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body,
    });
    if (!put.ok) throw new Error(`PUT failed: ${put.status}`);
    const commit = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/commit',
      headers: { ...originHeaders, cookie: cookieHeader(token as string) },
      payload: { uploadId: signed.uploadId },
    });
    expect(commit.statusCode).toBe(200);
    await backdate(signed.uploadId);

    const swept = await sweepAbandonedUploads({ maxAgeMs: 3_600_000 });
    expect(swept).toBe(0);

    const row = await prisma.upload.findUniqueOrThrow({ where: { id: signed.uploadId } });
    expect(row.status).toBe('COMMITTED');
    expect(await headObject(signed.key)).not.toBeNull();
  });

  /**
   * A stale PENDING row can still be REFERENCED — attached before assertUploadClaimable
   * began refusing PENDING claims. It is not abandoned by definition, and deleting it
   * would either break the attachment or trip the Resource-side foreign key.
   */
  it('leaves a stale PENDING row that a course syllabus still points at', async () => {
    const teacherId = await createAccount('sweep-referenced@example.com', 'TEACHER');
    const body = fileBytes('referenced');
    const row = await prisma.upload.create({
      data: {
        key: 'syllabi/01HZZZZZZZZZZZZZZZZZZZZZY.pdf',
        bucket: process.env.S3_BUCKET ?? 'skillwright-uploads',
        contentType: 'application/pdf',
        sizeBytes: body.length,
        originalName: 'referenced.pdf',
        status: 'PENDING',
        ownerId: teacherId,
        createdAt: new Date(Date.now() - 2 * 3_600_000),
      },
    });
    await prisma.course.create({
      data: {
        code: 'WELD-800',
        slug: 'sweep-referenced',
        name: 'Referenced Syllabus',
        departmentId,
        teacherId,
        durationValue: 6,
        durationUnit: 'WEEK',
        syllabusUploadId: row.id,
      },
    });

    const swept = await sweepAbandonedUploads({ maxAgeMs: 3_600_000 });
    expect(swept).toBe(0);
    expect(await prisma.upload.count({ where: { id: row.id } })).toBe(1);
  });

  it('sweeps at most batchSize rows per run, oldest first', async () => {
    const ownerId = await createAccount('sweep-batch@example.com', 'ADMIN');
    const first = await bareStaleRow(ownerId);
    const second = await bareStaleRow(ownerId);
    const third = await bareStaleRow(ownerId);
    // Distinct ages so "oldest first" has an answer: first is oldest.
    await prisma.upload.update({
      where: { id: second },
      data: { createdAt: new Date(Date.now() - 3 * 3_600_000) },
    });
    await prisma.upload.update({
      where: { id: third },
      data: { createdAt: new Date(Date.now() - 4 * 3_600_000) },
    });

    const swept = await sweepAbandonedUploads({ maxAgeMs: 3_600_000, batchSize: 2 });
    expect(swept).toBe(2);

    const survivors = await prisma.upload.findMany({
      where: { id: { in: [first, second, third] } },
    });
    expect(survivors).toHaveLength(1);
    // third was oldest (4h), then second (3h); first (2h) survives.
    expect(survivors.map((row) => row.id)).toEqual([first]);
  });
});
