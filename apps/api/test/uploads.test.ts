import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// app.ts:43-49: "Anything that holds an instance built here — main.ts, the integration
// tests — should name this type." Plain FastifyInstance is a type error, not a widening.
import type { AppInstance } from '../src/app.js';
import type { Role } from '@skillwright/shared';
import { UPLOAD_LIMITS } from '@skillwright/shared';
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
 * A well-formed id that names no row anywhere. `idSchema` accepts a cuid OR a ULID
 * (common.ts:17-22); a malformed id would be refused by the body schema BEFORE the
 * preHandler runs, and the case below is about what the gate does with a subject the
 * loader could not build, not about zod.
 */
const ABSENT_ID = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

/**
 * The object store this suite actually talks to, read from the same environment the
 * application reads (env.ts:71-76) rather than hardcoded.
 *
 * That matters on this machine: MinIO is published on 9002, not the 9000 that
 * setup.ts:68 falls back to, and the root .env setup.ts:26 loads first is what carries
 * the real port. A hardcoded 9000 here would sign URLs against the app's MinIO and then
 * probe a different one — or nothing at all — and every bucket assertion below would
 * pass or fail for reasons that have nothing to do with the code under test.
 */
function requiredEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.length === 0) {
    throw new Error(`${key} is not set; test/setup.ts is meant to guarantee it.`);
  }
  return value;
}

const S3_ENDPOINT = requiredEnv('S3_ENDPOINT').replace(/\/$/, '');
const S3_BUCKET = requiredEnv('S3_BUCKET');

let app: AppInstance;
let departmentId: string;
let sequence = 0;

/**
 * setup.ts:110-119 clears most of these too, but a suite that leaves a course, a resource
 * or an upload behind breaks the NEXT file's reset: `Course.teacherId` and
 * `Resource.authorId` are `onDelete: Restrict` (schema.prisma:321, :430), so the user
 * delete inside `resetDatabase()` fails while either row survives — in someone else's
 * suite, not this one.
 *
 * Resources before uploads, and that order is now load-bearing for a second reason.
 * Migration 0003 made `Resource.uploadId` ON DELETE RESTRICT, and `User` cascades to
 * `Upload`: deleting a user who owns an upload that still backs a resource fails at the
 * foreign key rather than at the migration-0002 CHECK three constraints later. Every row
 * this suite writes has real bytes behind it, so there is no fixture shortcut around it.
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

// --- harness ---------------------------------------------------------------

function authPost(url: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/auth${url}`,
    headers: { ...originHeaders },
    payload: payload as Record<string, unknown>,
  });
}

/** Two prefixes are in play — `/uploads` and `/resources` — so these take a whole path. */
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

/** The `{ path, message }` pairs a 422 carries (errors.plugin.ts:126-135). */
interface FieldErrorLike {
  path: string;
  message: string;
}

function errorsOf(response: { json: () => { errors?: FieldErrorLike[] } }): FieldErrorLike[] {
  return response.json().errors ?? [];
}

/**
 * A validation error looked up BY ITS PATH, never by array position: `presignUploadSchema`
 * can raise two issues from one body (upload.ts:54-70), so `errors[0]` quietly asserts the
 * wrong one the moment zod reorders them.
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

async function makeCourse(teacherId: string): Promise<string> {
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
      publishedAt: new Date(),
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

// --- the bucket ------------------------------------------------------------

/**
 * Real bytes, unique per caller, and shaped like the thing they claim to be.
 *
 * The seed writes Upload ROWS with nothing behind them, so a suite that wants to prove a
 * download returns the file has to put the file there itself — through a presigned URL,
 * because the bucket is private and this test holds no credentials of its own.
 */
function pdfBytes(marker: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${marker}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
    'utf8',
  );
}

/** presignUploadResponseSchema (upload.ts:77-84), named so the fetch calls below typecheck. */
interface PresignBody {
  uploadId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  key: string;
  expiresAt: string;
}

/** downloadUrlResponseSchema (upload.ts:108-112). */
interface DownloadBody {
  url: string;
  expiresAt: string;
  filename: string;
}

interface StoredFile {
  uploadId: string;
  key: string;
  originalName: string;
  body: Buffer;
}

/**
 * The three steps a browser performs, in order: ask for a URL, PUT to the object store
 * directly, then tell the API the bytes arrived.
 *
 * The PUT goes out over `fetch`, not `app.inject` — the API never sees these bytes, which
 * is the entire reason the presigned-PUT design exists (upload.ts:73-76), and an injected
 * request would prove nothing about whether MinIO accepts the signature.
 */
async function storeFile(
  person: Person,
  options: { originalName: string; contentType?: string; marker: string },
): Promise<StoredFile> {
  const body = pdfBytes(options.marker);
  const contentType = options.contentType ?? 'application/pdf';

  const presigned = await send(
    'POST',
    '/uploads/presign',
    {
      purpose: 'RESOURCE',
      originalName: options.originalName,
      contentType,
      sizeBytes: body.length,
    },
    person.token,
  );
  expect(presigned.statusCode).toBe(201);
  const signed: PresignBody = presigned.json();

  const put = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body });
  // Surfaced as a message rather than a bare `expect`, because every plausible cause —
  // wrong port, unsigned header, skewed clock — is diagnosable only from MinIO's body.
  if (!put.ok) {
    throw new Error(`PUT to the signed URL failed: ${put.status} ${await put.text()}`);
  }

  const committed = await send(
    'POST',
    '/uploads/commit',
    { uploadId: signed.uploadId },
    person.token,
  );
  expect(committed.statusCode).toBe(200);
  expect(committed.json().status).toBe('COMMITTED');

  return { uploadId: signed.uploadId, key: signed.key, originalName: options.originalName, body };
}

interface PublishedDocument extends StoredFile {
  resourceId: string;
}

/** Golden path 3 end to end: bytes in the bucket, a DOCUMENT resource pointing at them. */
async function publishDocument(
  teacher: Person,
  courseId: string,
  options: { isPublic: boolean; originalName?: string; marker: string },
): Promise<PublishedDocument> {
  const file = await storeFile(teacher, {
    originalName: options.originalName ?? 'safety-handbook.pdf',
    marker: options.marker,
  });

  const created = await send(
    'POST',
    '/resources',
    {
      courseId,
      title: 'Safety handbook',
      type: 'DOCUMENT',
      uploadId: file.uploadId,
      isPublic: options.isPublic,
    },
    teacher.token,
  );
  expect(created.statusCode).toBe(201);
  expect(created.json().uploadId).toBe(file.uploadId);

  return { ...file, resourceId: created.json().id };
}

/** The URL an attacker would guess: no signature, no credentials, just bucket and key. */
function rawObjectUrl(key: string): string {
  return `${S3_ENDPOINT}/${S3_BUCKET}/${key}`;
}

// --- presign ---------------------------------------------------------------

describe('POST /uploads/presign', () => {
  /**
   * 401, not 403 — and that is the repository's rule, not a concession.
   *
   * `upload:presign` denies anonymous (policy.ts:380), and `authorize()` turns a refusal
   * with no actor into `unauthenticated()` before it ever reaches `forbidden()`
   * (auth.plugin.ts:121). Every anonymous-denial assertion in this suite says the same
   * thing (enrollments.test.ts:519-524). A logged-out caller therefore never learns a rule
   * name, which is the point: rule names describe the policy to people who have already
   * proved who they are.
   */
  it('refuses an anonymous caller before anything is signed', async () => {
    const response = await send('POST', '/uploads/presign', {
      purpose: 'RESOURCE',
      originalName: 'notes.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
    // Nothing was reserved on the way out: a row here would be a free write primitive for
    // anyone who can reach the port.
    expect(await prisma.upload.count({})).toBe(0);
  });

  it('signs a PUT for a student, a teacher and an admin alike', async () => {
    const people = [
      await signIn('student-presign@example.com', 'STUDENT'),
      await signIn('teacher-presign@example.com', 'TEACHER'),
      await signIn('admin-presign@example.com', 'ADMIN'),
    ];

    for (const person of people) {
      const response = await send(
        'POST',
        '/uploads/presign',
        {
          purpose: 'RESOURCE',
          originalName: 'lecture.pdf',
          contentType: 'application/pdf',
          sizeBytes: 4096,
        },
        person.token,
      );

      // policy.ts:379-384 — `upload:presign` is `allow` for all three roles and carries no
      // subject at all (it is in SUBJECT_INDEPENDENT_ACTIONS, policy.ts:516). Asking for a
      // URL is not the same as being allowed to attach the result to anything.
      expect(response.statusCode).toBe(201);
      const signed: PresignBody = response.json();
      expect(signed.url).toMatch(/^https?:\/\//);
      expect(signed.method).toBe('PUT');
      expect(signed.uploadId).toBeTruthy();
      expect(new Date(signed.expiresAt).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('never puts the client filename in the key, and never repeats a key', async () => {
    const student = await signIn('student-key@example.com', 'STUDENT');
    const payload = {
      purpose: 'RESOURCE',
      originalName: 'confidential-payroll-2026.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
    };

    const first = await send('POST', '/uploads/presign', payload, student.token);
    const second = await send('POST', '/uploads/presign', payload, student.token);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const a: PresignBody = first.json();
    const b: PresignBody = second.json();

    // upload.ts:49-50 and schema.prisma:394-396, both in writing: "Server-generated ...
    // Never the client's filename." A key built from user input is a path-traversal and a
    // privacy leak at once — the key travels inside every signed URL, so `payroll` in the
    // key is `payroll` in a link somebody forwards.
    expect(a.key).not.toContain('confidential');
    expect(a.key).not.toContain('payroll');
    expect(a.key).not.toContain('2026');
    // The extension IS derived from the name, so the object keeps a usable suffix.
    expect(a.key.endsWith('.pdf')).toBe(true);
    expect(a.key).toContain('/');

    // Two callers uploading `report.pdf` must not collide, and neither must one caller
    // twice: a key derived from the filename would make the second PUT silently overwrite
    // the first.
    expect(b.key).not.toBe(a.key);
    expect(b.uploadId).not.toBe(a.uploadId);
  });

  it("refuses a contentType the purpose does not accept, at path 'contentType'", async () => {
    const student = await signIn('student-mime@example.com', 'STUDENT');

    const response = await send(
      'POST',
      '/uploads/presign',
      {
        // AVATAR accepts images only (upload.ts:38). The purpose is what makes this a
        // refusal: the same PDF is perfectly legal as a RESOURCE.
        purpose: 'AVATAR',
        originalName: 'me.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
      },
      student.token,
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(errorAt(response, 'contentType')).toBeDefined();
    // The size is inside the avatar limit, so exactly ONE issue may fire. Without this the
    // test passes against a body rejected for the other reason entirely.
    expect(errorAt(response, 'sizeBytes')).toBeUndefined();
    expect(await prisma.upload.count({})).toBe(0);
  });

  it("refuses a size above the purpose limit, at path 'sizeBytes'", async () => {
    const student = await signIn('student-size@example.com', 'STUDENT');

    const response = await send(
      'POST',
      '/uploads/presign',
      {
        purpose: 'AVATAR',
        originalName: 'me.png',
        contentType: 'image/png',
        sizeBytes: UPLOAD_LIMITS.AVATAR.maxBytes + 1,
      },
      student.token,
    );

    // One byte over, not a round number: `>` and `>=` are indistinguishable at exactly 2 MB.
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(errorAt(response, 'sizeBytes')).toBeDefined();
    expect(errorAt(response, 'contentType')).toBeUndefined();

    // The same size against a purpose that allows it: the limit is per purpose
    // (upload.ts:35-44), not global, and a single global ceiling would satisfy the refusal
    // above while quietly capping every course resource at an avatar's size.
    const allowed = await send(
      'POST',
      '/uploads/presign',
      {
        purpose: 'RESOURCE',
        originalName: 'me.png',
        contentType: 'image/png',
        sizeBytes: UPLOAD_LIMITS.AVATAR.maxBytes + 1,
      },
      student.token,
    );
    expect(allowed.statusCode).toBe(201);
  });

  it('writes a PENDING row owned by the caller, never by the ownerId in the body', async () => {
    const caller = await signIn('student-owner@example.com', 'STUDENT');
    const victim = await signIn('student-victim@example.com', 'STUDENT');

    const response = await send(
      'POST',
      '/uploads/presign',
      {
        purpose: 'RESOURCE',
        originalName: 'notes.pdf',
        contentType: 'application/pdf',
        sizeBytes: 2048,
        // Ignored, not honoured: `presignUploadSchema` (upload.ts:46-53) declares no owner,
        // so zod strips this before the handler sees it. The owner is the session — the only
        // claim the server can verify — and it is what `upload:commit`'s `isSelf` will later
        // be decided against (policy.ts:385-392), so a body-chosen owner here would hand the
        // commit gate away with it.
        ownerId: victim.id,
      },
      caller.token,
    );

    expect(response.statusCode).toBe(201);
    const signed: PresignBody = response.json();

    // The row exists BEFORE the bytes do. An upload nobody commits stays PENDING until a
    // sweeper collects it, and that job does not exist yet (upload.ts:87 promises a cron);
    // saying so is better than pretending the lifecycle is closed.
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: signed.uploadId } });
    expect(row.status).toBe('PENDING');
    expect(row.ownerId).toBe(caller.id);
    expect(row.ownerId).not.toBe(victim.id);
    expect(row.committedAt).toBeNull();
    expect(row.key).toBe(signed.key);
    expect(row.bucket).toBe(S3_BUCKET);
    // Kept for display, never used to build the key (schema.prisma:402-403).
    expect(row.originalName).toBe('notes.pdf');
  });

  /**
   * The upper limit from the INSIDE.
   *
   * The test above pins `maxBytes + 1`, and on its own that is satisfied by `>=` exactly
   * as happily as by `>`. upload.ts:63 is `body.sizeBytes > limit.maxBytes`, so the
   * boundary is INCLUSIVE, and a limit that refuses the very figure it advertises is a
   * bug a user meets with a file the UI told them was legal. Two tests, one comparison,
   * pinned from both sides.
   */
  it('accepts a size at exactly the purpose limit, because the boundary is inclusive', async () => {
    const student = await signIn('student-boundary@example.com', 'STUDENT');

    const response = await send(
      'POST',
      '/uploads/presign',
      {
        purpose: 'AVATAR',
        originalName: 'me.png',
        contentType: 'image/png',
        sizeBytes: UPLOAD_LIMITS.AVATAR.maxBytes,
      },
      student.token,
    );

    expect(response.statusCode).toBe(201);
    expect(errorAt(response, 'sizeBytes')).toBeUndefined();
    const signed: PresignBody = response.json();

    // The figure reaches the row AND, through `presignPut`, the signature itself
    // (storage.ts:159-183): a caller granted the boundary is granted exactly it, so the
    // store will not refuse the PUT the API just authorised.
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: signed.uploadId } });
    expect(row.sizeBytes).toBe(UPLOAD_LIMITS.AVATAR.maxBytes);
    expect(row.status).toBe('PENDING');
  });

  /**
   * The other end of the same range, and not pedantry.
   *
   * `sizeBytes` is `z.number().int().min(1)` (upload.ts:52), which is the BASE object
   * rather than the `superRefine` — so a zero fires before the per-purpose rules run and
   * `contentType` must stay silent, the mirror image of the over-limit case above. Zero
   * matters because `presignPut` signs `content-length: 0` (storage.ts:170): a row minted
   * at zero is a signature for an empty object, and the only thing that would ever notice
   * is a HeadObject round trip at commit — a question put to the object store that the
   * schema had already answered.
   */
  it("refuses a zero-byte upload at path 'sizeBytes'", async () => {
    const student = await signIn('student-zero@example.com', 'STUDENT');

    const response = await send(
      'POST',
      '/uploads/presign',
      {
        purpose: 'AVATAR',
        originalName: 'empty.png',
        contentType: 'image/png',
        sizeBytes: 0,
      },
      student.token,
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(errorAt(response, 'sizeBytes')).toBeDefined();
    expect(errorAt(response, 'contentType')).toBeUndefined();
    // Nothing reserved, for the same reason as the anonymous case above: a refused
    // presign that still wrote a row leaves a signature-shaped hole in the table.
    expect(await prisma.upload.count({})).toBe(0);
  });

  /**
   * The filename is the ONLY fragment of client input that reaches the object key, and
   * `extensionOf` (storage.ts:78-83) is the whole of what survives it: at most one dot
   * suffix, ASCII alphanumerics, lowercased, or nothing at all. `x.pdf` — the only shape
   * the rest of this suite presigns — exercises none of the interesting branches.
   *
   * Each row asserts what the implementation SPECIFIES, which is not always what a
   * reader would wish for:
   *
   *   '../../etc/passwd.pdf' -> '.pdf'  the traversal never reaches the key at all,
   *                                     because the key is rebuilt and not sanitised.
   *   'notes.tar.gz'         -> '.gz'   `lastIndexOf` takes the LAST suffix, so the
   *                                     compound extension is deliberately not kept.
   *   'invoice.pdf.exe'      -> '.exe'  the same rule, and it keeps the executable half.
   *                                     Harmless here — the object is never executed,
   *                                     never served inline (storage.ts:248-263 forces
   *                                     `attachment`), and the download is named from
   *                                     `originalName` rather than from the key — but
   *                                     worth pinning rather than rediscovering.
   *   'README'               -> ''      no dot at all.
   *   '.bashrc'              -> ''      `dot <= 0`: a dotfile's dot is a NAME, not an
   *                                     extension, or the key would end in `.bashrc`.
   *   a non-ASCII name       -> '.pdf'  the non-ASCII lives in the discarded half.
   *   a non-ASCII SUFFIX     -> ''      it fails `[a-z0-9]{1,16}`, so the key carries no
   *                                     extension rather than a percent-encoded one.
   */
  it('derives the key extension from the filename and lets nothing else through', async () => {
    const student = await signIn('student-extensions@example.com', 'STUDENT');

    const cases: ReadonlyArray<{
      originalName: string;
      extension: string;
      /** Fragments of the client's name that must appear nowhere in the key. */
      forbidden: readonly string[];
    }> = [
      { originalName: '../../etc/passwd.pdf', extension: '.pdf', forbidden: ['etc', 'passwd'] },
      { originalName: 'notes.tar.gz', extension: '.gz', forbidden: ['notes', 'tar'] },
      { originalName: 'invoice.pdf.exe', extension: '.exe', forbidden: ['invoice', 'pdf'] },
      { originalName: 'README', extension: '', forbidden: ['README'] },
      { originalName: '.bashrc', extension: '', forbidden: ['bashrc'] },
      // 'résumé.pdf': the non-ASCII is in the part `extensionOf` throws away, and neither
      // the character nor its UTF-8 percent-encoding may turn up in the key.
      {
        originalName: 'résumé.pdf',
        extension: '.pdf',
        forbidden: ['sum', 'é', '%C3%A9'],
      },
      // 'lecture.pdƒ': a florin sign where the 'f' belongs, so the SUFFIX itself is
      // non-ASCII and the regex refuses it outright.
      {
        originalName: 'lecture.pdƒ',
        extension: '',
        forbidden: ['lecture', 'pd', 'ƒ'],
      },
    ];

    for (const testCase of cases) {
      const response = await send(
        'POST',
        '/uploads/presign',
        {
          purpose: 'RESOURCE',
          originalName: testCase.originalName,
          contentType: 'application/pdf',
          sizeBytes: 2048,
        },
        student.token,
      );

      expect(response.statusCode).toBe(201);
      const signed: PresignBody = response.json();

      // The WHOLE shape, not a suffix check: `resources/`, one ULID, the derived
      // extension, and provably nothing else. `endsWith('.pdf')` on its own is satisfied
      // by `resources/../../etc/passwd.pdf`, which is the exact key the rebuild in
      // storage.ts:86-104 exists to make impossible.
      expect(signed.key.startsWith('resources/')).toBe(true);
      expect(signed.key).not.toContain('..');
      const objectName = signed.key.slice('resources/'.length);
      // Crockford base32, 26 characters: the alphabet omits I, L, O and U.
      expect(objectName.slice(0, 26)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(objectName.slice(26)).toBe(testCase.extension);
      for (const fragment of testCase.forbidden) {
        expect(signed.key).not.toContain(fragment);
      }

      // The name the user typed is kept verbatim on the ROW, because display and key are
      // two different things (schema.prisma:407-408) — which is why discarding the
      // traversal from the key costs the user nothing.
      const row = await prisma.upload.findUniqueOrThrow({ where: { id: signed.uploadId } });
      expect(row.originalName).toBe(testCase.originalName);
      expect(row.key).toBe(signed.key);
    }
  });

  /**
   * `PURPOSE_FOLDER` (storage.ts:56-60) is the ONLY trace a purpose leaves behind:
   * `Upload` has no `purpose` column (schema.prisma:392-424), so the prefix is what makes
   * a bucket listing legible and what keeps the seed's layout and the live one identical
   * rather than two conventions in one bucket.
   *
   * Nothing a request can see would break if two purposes shared a folder, which is
   * precisely why nothing was pinning it.
   */
  it('files each purpose under its own folder', async () => {
    const student = await signIn('student-folders@example.com', 'STUDENT');

    // Every contentType here is one its own purpose accepts (upload.ts:35-44): an avatar
    // presigned as a PDF is refused at the schema and no key is ever built, so a mismatch
    // would re-test the MIME rule instead of the folder map.
    const cases: ReadonlyArray<{
      purpose: string;
      originalName: string;
      contentType: string;
      folder: string;
    }> = [
      {
        purpose: 'RESOURCE',
        originalName: 'handbook.pdf',
        contentType: 'application/pdf',
        folder: 'resources/',
      },
      { purpose: 'AVATAR', originalName: 'me.png', contentType: 'image/png', folder: 'avatars/' },
      {
        purpose: 'SYLLABUS',
        originalName: 'syllabus.pdf',
        contentType: 'application/pdf',
        folder: 'syllabi/',
      },
    ];

    const folders: string[] = [];
    for (const testCase of cases) {
      const response = await send(
        'POST',
        '/uploads/presign',
        {
          purpose: testCase.purpose,
          originalName: testCase.originalName,
          contentType: testCase.contentType,
          sizeBytes: 4096,
        },
        student.token,
      );

      expect(response.statusCode).toBe(201);
      const signed: PresignBody = response.json();
      expect(signed.key.startsWith(testCase.folder)).toBe(true);
      // One folder, one slash: `syllabi/<ulid>.pdf`, never a nested prefix.
      expect(signed.key.split('/')).toHaveLength(2);
      // The row records the key the client was handed, so a bucket listing and the table
      // agree about where the object lives.
      const row = await prisma.upload.findUniqueOrThrow({ where: { id: signed.uploadId } });
      expect(row.key).toBe(signed.key);
      folders.push(testCase.folder);
    }

    // Three purposes, three DISTINCT folders — the assertion a map with a copy-pasted
    // value would fail while every individual prefix check above still passed.
    expect(new Set(folders).size).toBe(3);
  });
});

// --- commit ----------------------------------------------------------------

describe('POST /uploads/commit', () => {
  it("refuses to commit someone else's upload, naming isSelf, and leaves it PENDING", async () => {
    const owner = await signIn('owner-commit@example.com', 'STUDENT');
    const thief = await signIn('thief-commit@example.com', 'STUDENT');

    const presigned = await send(
      'POST',
      '/uploads/presign',
      {
        purpose: 'RESOURCE',
        originalName: 'notes.pdf',
        contentType: 'application/pdf',
        sizeBytes: 2048,
      },
      owner.token,
    );
    expect(presigned.statusCode).toBe(201);
    const signed: PresignBody = presigned.json();

    const response = await send(
      'POST',
      '/uploads/commit',
      { uploadId: signed.uploadId },
      thief.token,
    );

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    // policy.ts:387-389, verbatim: "Committing someone else's pending upload would let an
    // attacker attach bytes they never uploaded." The rule name is what proves the subject
    // was actually loaded — a gate handed no subject at all denies with the SAME name while
    // refusing the owner too, which is LESSONS-LEARNED #15's exact shape.
    expect(response.json().detail).toContain('STUDENT:isSelf');

    const row = await prisma.upload.findUniqueOrThrow({ where: { id: signed.uploadId } });
    expect(row.status).toBe('PENDING');
    expect(row.committedAt).toBeNull();
  });

  it('refuses to commit an upload whose bytes never arrived', async () => {
    const student = await signIn('student-nobytes@example.com', 'STUDENT');

    const presigned = await send(
      'POST',
      '/uploads/presign',
      {
        purpose: 'RESOURCE',
        originalName: 'never-sent.pdf',
        contentType: 'application/pdf',
        sizeBytes: 2048,
      },
      student.token,
    );
    expect(presigned.statusCode).toBe(201);
    const signed: PresignBody = presigned.json();

    // No PUT at all: the row was reserved and the browser closed the tab.
    const response = await send(
      'POST',
      '/uploads/commit',
      { uploadId: signed.uploadId },
      student.token,
    );

    // 422 at `uploadId`, because HeadObject came back empty. Without this a resource can be
    // created from an upload that has no bytes, and the failure surfaces much later as a
    // download that 403s out of the bucket — a very long way from its cause.
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(errorAt(response, 'uploadId')).toBeDefined();

    const row = await prisma.upload.findUniqueOrThrow({ where: { id: signed.uploadId } });
    expect(row.status).toBe('PENDING');
  });

  it('presign, PUT, commit: the row goes COMMITTED with the facts the bucket holds', async () => {
    const teacher = await signIn('teacher-commit@example.com', 'TEACHER');
    const body = pdfBytes('happy-path');

    const presigned = await send(
      'POST',
      '/uploads/presign',
      {
        purpose: 'RESOURCE',
        originalName: 'safety-handbook.pdf',
        contentType: 'application/pdf',
        sizeBytes: body.length,
      },
      teacher.token,
    );
    expect(presigned.statusCode).toBe(201);
    const signed: PresignBody = presigned.json();

    const put = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body });
    if (!put.ok) throw new Error(`PUT failed: ${put.status} ${await put.text()}`);

    const before = Date.now();
    const response = await send(
      'POST',
      '/uploads/commit',
      { uploadId: signed.uploadId },
      teacher.token,
    );

    expect(response.statusCode).toBe(200);
    // uploadSchema (upload.ts:93-104) in full, because the SPA renders the file facts
    // straight off this reply.
    expect(response.json()).toMatchObject({
      id: signed.uploadId,
      key: signed.key,
      bucket: S3_BUCKET,
      contentType: 'application/pdf',
      sizeBytes: body.length,
      originalName: 'safety-handbook.pdf',
      status: 'COMMITTED',
      ownerId: teacher.id,
    });
    expect(response.json().committedAt).not.toBeNull();

    const row = await prisma.upload.findUniqueOrThrow({ where: { id: signed.uploadId } });
    expect(row.status).toBe('COMMITTED');
    expect(row.committedAt).not.toBeNull();
    expect(row.committedAt?.getTime() ?? 0).toBeGreaterThanOrEqual(before - 1000);
    // The size agrees with the OBJECT, not merely with what the client said twice: commit
    // is the HeadObject checkpoint (upload.ts:87), and a commit that copied the presign
    // declaration forward would satisfy every other assertion here.
    expect(row.sizeBytes).toBe(body.length);
  });

  /**
   * Not in the enumerated list, but it is the sentence the contract uses to justify commit
   * existing at all: "the client declared a 2 KB PDF and the bucket must agree."
   *
   * Reachable because `presignPut` signs the key and the content type and nothing else, so
   * SigV4 never pins the length: a client is free to PUT more bytes than it announced, and
   * only HeadObject at commit can notice.
   */
  /**
   * This used to assert that the oversized bytes LANDED and `commit` refused the row
   * afterwards. They no longer land: `content-length` is part of the signature
   * (storage.ts's measurement table), so the store rejects the PUT itself and the
   * bucket never holds the object at all.
   *
   * That is the stronger guarantee and the one worth pinning, because `commit` running
   * afterwards was never the problem — a caller who declared a 1 KB avatar could PUT
   * half a gigabyte, be refused a row, and leave the BYTES behind in a bucket nothing
   * reclaims. `commit`'s own size comparison survives as a backstop for a store that
   * does not enforce a signed `content-length`; it cannot be reached through MinIO,
   * which is why no test drives it.
   */
  it('lets the object store refuse a body that is not the size that was signed', async () => {
    const student = await signIn('student-mismatch@example.com', 'STUDENT');
    const declared = pdfBytes('declared');
    const actual = Buffer.concat([declared, Buffer.alloc(4096, 0x20)]);

    const presigned = await send(
      'POST',
      '/uploads/presign',
      {
        purpose: 'RESOURCE',
        originalName: 'small.pdf',
        contentType: 'application/pdf',
        sizeBytes: declared.length,
      },
      student.token,
    );
    expect(presigned.statusCode).toBe(201);
    const signed: PresignBody = presigned.json();

    // `content-length` is a forbidden header for fetch, so the runtime sets it from the
    // body — which is precisely the value the signature is checked against.
    const put = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: actual });
    expect(put.status).toBe(403);
    expect(await put.text()).toContain('SignatureDoesNotMatch');

    // Nothing was stored, so commit has nothing to confirm.
    const response = await send(
      'POST',
      '/uploads/commit',
      { uploadId: signed.uploadId },
      student.token,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');

    const row = await prisma.upload.findUniqueOrThrow({ where: { id: signed.uploadId } });
    expect(row.status).toBe('PENDING');
  });

  /**
   * The twin of the case above, for the OTHER header in the signature.
   *
   * `presignPut` names BOTH `content-type` and `content-length` as signable
   * (storage.ts:174), and until now nothing here could tell. Every other PUT in this file
   * replays `signed.headers` verbatim — which is what a browser does and what the SPA
   * should do — so deleting `signableHeaders` broke no assertion. That line is not
   * decoration: query signing puts only `host` in `X-Amz-SignedHeaders` by default, and
   * without it the `ContentType` on the command is a suggestion the store never checks.
   *
   * What that would cost: a caller takes a signature for `application/pdf` and stores
   * `text/html` at that key. `commit` then compares HeadObject with the declaration and
   * refuses the row (uploads.service.ts:232-239) — but the BYTES are already in a bucket
   * nothing reclaims, under a content type the store will hand back to anyone holding a
   * signed GET, and the sweeper for abandoned uploads does not exist yet
   * (uploads.service.ts:102-108). The refusal has to happen at the store.
   */
  it('lets the object store refuse a PUT whose content-type is not the one that was signed', async () => {
    const student = await signIn('student-wrongtype@example.com', 'STUDENT');
    const body = pdfBytes('wrong-type');

    const presigned = await send(
      'POST',
      '/uploads/presign',
      {
        purpose: 'RESOURCE',
        originalName: 'declared.pdf',
        contentType: 'application/pdf',
        sizeBytes: body.length,
      },
      student.token,
    );
    expect(presigned.statusCode).toBe(201);
    const signed: PresignBody = presigned.json();
    // The header the SPA is told to replay (uploads.service.ts:157-159), which is what
    // makes the substitution below a deliberate deviation rather than an omission.
    expect(signed.headers['content-type']).toBe('application/pdf');

    // Same URL, same bytes, same length: the content-type is the ONLY thing that differs,
    // so nothing but the signed header can account for the refusal.
    const put = await fetch(signed.url, {
      method: 'PUT',
      headers: { 'content-type': 'text/html' },
      body,
    });
    expect(put.status).toBe(403);
    expect(await put.text()).toContain('SignatureDoesNotMatch');

    const row = await prisma.upload.findUniqueOrThrow({ where: { id: signed.uploadId } });
    expect(row.status).toBe('PENDING');
    expect(row.committedAt).toBeNull();
    // And the declaration on the row is untouched — a refused PUT is not a way to edit it.
    expect(row.contentType).toBe('application/pdf');

    // The control, and it is load-bearing: the SAME url with the signed header is
    // accepted. Without it the 403 above is equally satisfied by a stale URL, a clock
    // skew, or a key that never existed.
    const honest = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body });
    expect(honest.status).toBe(200);
  });

  /** The same signature, honoured. Proves the header pinning does not break the happy path. */
  it('accepts a body that is exactly the size that was signed', async () => {
    const student = await signIn('student-exact@example.com', 'STUDENT');
    const bytes = pdfBytes('exact');

    const presigned = await send(
      'POST',
      '/uploads/presign',
      {
        purpose: 'RESOURCE',
        originalName: 'exact.pdf',
        contentType: 'application/pdf',
        sizeBytes: bytes.length,
      },
      student.token,
    );
    const signed: PresignBody = presigned.json();

    const put = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: bytes });
    expect(put.status).toBe(200);

    const committed = await send(
      'POST',
      '/uploads/commit',
      { uploadId: signed.uploadId },
      student.token,
    );
    expect(committed.statusCode).toBe(200);
    expect(committed.json().sizeBytes).toBe(bytes.length);
  });

  /**
   * THE TOCTOU REPRODUCTION, now a regression pin (Phase 5 of the UI roadmap).
   *
   * A presigned PUT is valid for fifteen minutes and SigV4 carries no nonce, so after
   * `commit` has verified the bytes the URL is STILL a valid write to the same key:
   * a caller could commit, have the resource published, and then silently replace
   * committed bytes with a same-length, same-type body. This test walks that exact
   * attack and demands the honest outcome — the download serves what was verified,
   * not what arrived later. It first ran against the single-key layout and FAILED
   * there by serving the replacement bytes; against the copy-to-final-key commit
   * (storage.ts `stagingKeyFor`) it holds.
   */
  it('keeps a committed upload immutable against a re-PUT through its still-valid URL', async () => {
    const teacher = await signIn('teacher-immutable@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);

    // Same length on purpose: the signature pins content-length, so only an
    // equal-length body could ever ride the old URL past the store.
    const original = pdfBytes('ORIGINAL-MARKER');
    const replacement = pdfBytes('REPLACEDMARKER!');
    expect(replacement.length).toBe(original.length);

    const presigned = await send(
      'POST',
      '/uploads/presign',
      {
        purpose: 'RESOURCE',
        originalName: 'immutable-handbook.pdf',
        contentType: 'application/pdf',
        sizeBytes: original.length,
      },
      teacher.token,
    );
    expect(presigned.statusCode).toBe(201);
    const signed: PresignBody = presigned.json();

    const firstPut = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: original,
    });
    if (!firstPut.ok) throw new Error(`PUT failed: ${firstPut.status} ${await firstPut.text()}`);
    const committed = await send(
      'POST',
      '/uploads/commit',
      { uploadId: signed.uploadId },
      teacher.token,
    );
    expect(committed.statusCode).toBe(200);

    // The attack itself: minutes later, the SAME URL accepts DIFFERENT bytes. The
    // store answering 200 here is not the bug — it is the premise. The bug would be
    // that answer changing what readers receive.
    const rePut = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: replacement,
    });
    expect(rePut.status).toBe(200);

    const created = await send(
      'POST',
      '/resources',
      {
        courseId,
        title: 'Immutability probe',
        type: 'DOCUMENT',
        uploadId: signed.uploadId,
        isPublic: false,
      },
      teacher.token,
    );
    expect(created.statusCode).toBe(201);

    const download = await get(`/resources/${created.json().id}/download`, teacher.token);
    expect(download.statusCode).toBe(200);
    const fetched = await fetch(download.json().url);
    expect(fetched.status).toBe(200);
    const downloaded = Buffer.from(await fetched.arrayBuffer());

    // The verified bytes, and nothing else.
    expect(downloaded.equals(original)).toBe(true);
    expect(downloaded.equals(replacement)).toBe(false);

    // And the row still answers with the key it was minted with — the committed home
    // never moved, so every reader of Upload.key (downloads, avatars, syllabi) reads
    // the object commit verified.
    expect(committed.json().key).toBe(signed.key);
  });

  it('is idempotent: a second commit returns the same committed row', async () => {
    const student = await signIn('student-twice@example.com', 'STUDENT');
    const file = await storeFile(student, { originalName: 'twice.pdf', marker: 'twice' });

    const first = await prisma.upload.findUniqueOrThrow({ where: { id: file.uploadId } });
    const response = await send(
      'POST',
      '/uploads/commit',
      { uploadId: file.uploadId },
      student.token,
    );

    // 200 and unchanged, exactly like approving an already-APPROVED enrolment
    // (enrollments.test.ts:258-271). A retry after a dropped response must not be an error,
    // and `committedAt` must not move — it records when the bytes were confirmed, not when
    // somebody last asked.
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('COMMITTED');
    expect(response.json().id).toBe(file.uploadId);
    expect(new Date(response.json().committedAt).getTime()).toBe(first.committedAt?.getTime());

    const after = await prisma.upload.findUniqueOrThrow({ where: { id: file.uploadId } });
    expect(after.committedAt?.getTime()).toBe(first.committedAt?.getTime());
    expect(await prisma.upload.count({ where: { ownerId: student.id } })).toBe(1);
  });

  /**
   * 403, not 404 — and unlike every other absent-id case in this repository, that is the
   * correct answer for an ADMIN too.
   *
   * `resource:read` gives ADMIN `allow`, a rule that reads no field, so an admin passes the
   * gate on a missing row and the handler answers a truthful 404 (resources.test.ts:590-620).
   * `upload:commit` has no such cell: all three roles are `isSelf` (policy.ts:385-392). The
   * loader returns `undefined` for a row that is not there, `can()` runs `isSelf` against
   * EMPTY_SUBJECT (can.ts:53), `subject.userId` is absent, and a rule that reads an absent
   * field must deny (combinators.ts:46-49). So nobody — admin included — can use this
   * endpoint to discover whether an upload id exists.
   *
   * The brief asks for a 404 here. The policy table it also forbids editing makes one
   * unreachable, and the enumeration oracle a 404 would open is exactly why the table has no
   * `allow` in this row.
   */
  it('refuses an unknown uploadId at the gate, admin included, rather than confirming it is absent', async () => {
    const admin = await signIn('admin-unknown@example.com', 'ADMIN');

    const response = await send('POST', '/uploads/commit', { uploadId: ABSENT_ID }, admin.token);

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    // Both halves, because they fail independently: `can()` builds the reason from the
    // ACTION it was handed and the rule from what the loader returned (can.ts:89-96).
    expect(response.json().detail).toContain('upload:commit');
    expect(response.json().detail).toContain('ADMIN:isSelf');
  });
});

// --- download: golden path 3 ------------------------------------------------

/**
 * The reason this suite exists.
 *
 * `resource:download` is deliberately NARROWER than `resource:read` (policy.ts:217-226):
 * the visitor who may see that a public resource exists may not pull its bytes out of the
 * bucket. Every case below is one row of that table — and the last one is the object store
 * answering for itself, with the API taken out of the loop entirely.
 */
describe('GET /resources/:id/download', () => {
  it('serves the owning teacher a URL that returns the exact bytes that were PUT', async () => {
    const teacher = await signIn('teacher-download@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const doc = await publishDocument(teacher, courseId, { isPublic: false, marker: 'owner' });

    const response = await get(`/resources/${doc.resourceId}/download`, teacher.token);

    expect(response.statusCode).toBe(200);
    const body: DownloadBody = response.json();
    expect(body.url).toMatch(/^https?:\/\//);
    expect(body.filename).toBe('safety-handbook.pdf');
    // A GET URL expires in 5 minutes where a PUT gets 15 — a PUT is a human choosing a
    // file, a GET is a click — so this window is short, but it is still a window, and an
    // `expiresAt` already in the past would make every download in the SPA fail on arrival.
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // The BYTES, not merely a 200: a signed URL for the wrong key is answered 403 by a
    // private bucket, which a status-only assertion would happily read as "not 200".
    const fetched = await fetch(body.url);
    expect(fetched.status).toBe(200);
    const downloaded = Buffer.from(await fetched.arrayBuffer());
    expect(downloaded.equals(doc.body)).toBe(true);
  });

  it('serves an APPROVED student on that course the same bytes', async () => {
    const teacher = await signIn('teacher-approved@example.com', 'TEACHER');
    const student = await signIn('student-enrolled@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    await enrol(student.id, courseId, 'APPROVED');
    // PRIVATE on purpose: on a public resource `isPublic` would carry the student and
    // `enrolledApproved` — the term actually under test — would never be reached.
    const doc = await publishDocument(teacher, courseId, { isPublic: false, marker: 'student' });

    const response = await get(`/resources/${doc.resourceId}/download`, student.token);

    expect(response.statusCode).toBe(200);
    const fetched = await fetch(response.json().url);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(doc.body)).toBe(true);
  });

  it('refuses a student who is not enrolled, naming the rule', async () => {
    const teacher = await signIn('teacher-outsider@example.com', 'TEACHER');
    const outsider = await signIn('student-outsider@example.com', 'STUDENT');
    const waiting = await signIn('student-waiting@example.com', 'STUDENT');
    const courseId = await makeCourse(teacher.id);
    await enrol(waiting.id, courseId, 'PENDING');
    const doc = await publishDocument(teacher, courseId, { isPublic: false, marker: 'outsider' });

    const response = await get(`/resources/${doc.resourceId}/download`, outsider.token);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().detail).toContain(
      'STUDENT:or(and(isPublic, isPublished), enrolledApproved)',
    );

    // A waiting list is not access: `enrolledApproved` is APPROVED only
    // (combinators.ts:62-65). This is the assertion that catches a subject built from
    // `enrollments: { some: { studentId } }` with the status filter forgotten.
    const pending = await get(`/resources/${doc.resourceId}/download`, waiting.token);
    expect(pending.statusCode).toBe(403);
    expect(pending.json().code).toBe('FORBIDDEN');
    expect(pending.json().detail).toContain(
      'STUDENT:or(and(isPublic, isPublished), enrolledApproved)',
    );
  });

  /**
   * The narrowing itself, in one test: the same anonymous caller, the same public resource,
   * allowed to read it and refused its bytes.
   *
   * The refusal is 401 and not the 403 the brief names, for the same reason as presign
   * above — `authorize()` converts a policy refusal with no actor into `unauthenticated()`
   * (auth.plugin.ts:121), so no route in this API answers an anonymous caller 403 on a
   * policy decision. What the brief is actually asking for, that the download is refused
   * while the read is not, is what the two halves below assert.
   */
  it('refuses an anonymous caller who may still SEE the resource exists', async () => {
    const teacher = await signIn('teacher-anon@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const doc = await publishDocument(teacher, courseId, { isPublic: true, marker: 'anon' });

    // policy.ts:192 — the anonymous row of `resource:read` is `isPublic`, so this succeeds
    // and the catalogue stays browsable without an account.
    const read = await get(`/resources/${doc.resourceId}`);
    expect(read.statusCode).toBe(200);
    expect(read.json().id).toBe(doc.resourceId);
    expect(read.json().uploadId).toBe(doc.uploadId);

    // policy.ts:217-222 — the anonymous row of `resource:download` is `deny`. Same visitor,
    // same row, one step further, refused. That gap is the anti-scraping line: without it a
    // crawler drains every public course's material in an afternoon.
    const download = await get(`/resources/${doc.resourceId}/download`);
    expect(download.statusCode).toBe(401);
    expect(download.json().code).toBe('UNAUTHENTICATED');
    // And the refusal does not leak the key on its way out — the key is the one piece of
    // the bucket's layout a stranger must never be handed.
    expect(JSON.stringify(download.json())).not.toContain(doc.key);
  });

  /**
   * THE ONE ASSERTION IN THIS REPOSITORY THAT THE OBJECT STORE REFUSES FOR ITSELF.
   *
   * Every other authorization test here proves the POLICY layer said no. This one takes the
   * API out of the loop: it builds the URL an attacker would guess — endpoint, bucket, key,
   * no signature, no credentials — and asserts MinIO refuses it. If `mc anonymous set none`
   * were ever undone, or the bucket recreated with a public read policy, every policy test
   * in this file would still pass and the bytes would be world-readable anyway. A signed URL
   * is only a secret while the unsigned one is a wall.
   */
  it('is backed by a bucket that refuses the raw unsigned object URL', async () => {
    const teacher = await signIn('teacher-raw@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const doc = await publishDocument(teacher, courseId, { isPublic: true, marker: 'raw' });

    // The signed URL first, and in the SAME test. A private bucket answers 403 for an object
    // that does not exist just as readily as for one that does, so without proving the key
    // is real the refusal below is satisfied by a typo.
    const issued = await get(`/resources/${doc.resourceId}/download`, teacher.token);
    expect(issued.statusCode).toBe(200);
    const signedFetch = await fetch(issued.json().url);
    expect(signedFetch.status).toBe(200);
    expect(Buffer.from(await signedFetch.arrayBuffer()).equals(doc.body)).toBe(true);

    const unsigned = await fetch(rawObjectUrl(doc.key));

    expect(unsigned.status).not.toBe(200);
    expect([401, 403]).toContain(unsigned.status);
    // Nothing leaked in the body either — an S3 error document is XML, never the file.
    expect(await unsigned.text()).not.toContain('%PDF');
  });

  it('hands back a URL that saves under the original filename, not the ULID key', async () => {
    const teacher = await signIn('teacher-disposition@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const doc = await publishDocument(teacher, courseId, {
      isPublic: false,
      originalName: 'Welding Safety Handbook.pdf',
      marker: 'disposition',
    });

    const response = await get(`/resources/${doc.resourceId}/download`, teacher.token);
    expect(response.statusCode).toBe(200);
    expect(response.json().filename).toBe('Welding Safety Handbook.pdf');

    const fetched = await fetch(response.json().url);
    expect(fetched.status).toBe(200);

    // `ResponseContentDisposition`, signed into the URL: the browser SAVES the file under
    // the name its owner gave it. Without it the user gets a PDF rendered inline and, if
    // they save it, a file named after the server-generated key — meaningless to them, and
    // a free hint about the layout of the bucket.
    const disposition = fetched.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('Welding Safety Handbook.pdf');
    const objectName = doc.key.split('/').pop() ?? '';
    expect(disposition).not.toContain(objectName);
  });

  it('answers 409 for a LINK resource rather than fabricating a signed URL', async () => {
    const teacher = await signIn('teacher-link@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);

    const created = await send(
      'POST',
      '/resources',
      {
        courseId,
        title: 'An external standard',
        type: 'LINK',
        externalUrl: 'https://example.com/bs-en-1090',
        isPublic: true,
      },
      teacher.token,
    );
    expect(created.statusCode).toBe(201);

    const response = await get(`/resources/${created.json().id}/download`, teacher.token);

    // The caller is entitled to the row — `resource:download` says yes — so this is a state
    // conflict, not a refusal: there are no bytes to sign for, and the URL the client wants
    // is already on the resource payload it fetched a moment ago. Signing something anyway
    // would produce a 403 out of the bucket, one redirect and several seconds away from
    // anything that explains why.
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('CONFLICT');
    expect(response.json().detail).toContain('externalUrl');
  });

  /**
   * The OTHER 409 in `buildDownloadUrl` (resources.service.ts:462-464), and the only test
   * in this file that reaches for prisma to build the row it is testing.
   *
   * It has to. `assertUploadClaimable` now refuses to attach anything that is not
   * COMMITTED (uploads.service.ts:308-312 — the test at the bottom of this file pins that
   * refusal), so POST /resources can no longer produce this state and the branch became
   * unreachable from the API surface. Deleting the branch instead would be wrong: the two
   * checks guard different moments. `assertUploadClaimable` runs once, at attach time;
   * this one runs on every download of a row that already exists — a row written before
   * the COMMITTED check landed, a row from a restored backup, or a row whose upload was
   * reset by hand. A resource pointing at an unconfirmed upload must answer a truthful
   * 409 rather than sign a URL for bytes the API has never verified.
   *
   * The bytes deliberately DO arrive here. If the PUT were skipped, a signed URL would
   * 403 out of the bucket anyway and the test would pass for the wrong reason; with the
   * object present, the only thing standing between this caller and a working download is
   * the status check itself.
   */
  it('answers 409 for a resource whose upload was never committed, rather than signing it', async () => {
    const teacher = await signIn('teacher-uncommitted@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const body = pdfBytes('never-committed');

    const presigned = await send(
      'POST',
      '/uploads/presign',
      {
        purpose: 'RESOURCE',
        originalName: 'unconfirmed-handbook.pdf',
        contentType: 'application/pdf',
        sizeBytes: body.length,
      },
      teacher.token,
    );
    expect(presigned.statusCode).toBe(201);
    const signed: PresignBody = presigned.json();

    const put = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body });
    if (!put.ok) {
      throw new Error(`PUT to the signed URL failed: ${put.status} ${await put.text()}`);
    }
    // No commit. The bytes are in the bucket and nothing has compared them with the
    // declaration, which is precisely what PENDING means.
    const upload = await prisma.upload.findUniqueOrThrow({ where: { id: signed.uploadId } });
    expect(upload.status).toBe('PENDING');
    expect(upload.committedAt).toBeNull();

    const resource = await prisma.resource.create({
      data: {
        courseId,
        // The author is the teacher who owns the course, so `resource:download` says YES
        // (policy.ts:217-226) and the 409 below is reached rather than short-circuited by
        // a 403 — a conflict is only meaningful to a caller who was entitled to the row.
        authorId: teacher.id,
        title: 'Handbook whose upload was never confirmed',
        type: 'DOCUMENT',
        uploadId: signed.uploadId,
        isPublic: false,
      },
      select: { id: true },
    });

    const response = await get(`/resources/${resource.id}/download`, teacher.token);

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('CONFLICT');
    // The detail names the unconfirmed upload rather than blaming the caller: the fix is
    // to commit it, and a bare "Conflicting state" would send a teacher to the logs.
    expect(response.json().detail).toContain('never confirmed');
    // No URL was minted on the way out, and no key leaked in the refusal — a 409 that
    // still carried a signed URL would be a download the status check did not prevent.
    expect(response.json().url).toBeUndefined();
    expect(JSON.stringify(response.json())).not.toContain(signed.key);

    // The row itself is still perfectly readable: `resource:read` is a different question
    // from "are there bytes", exactly as with the LINK case above.
    const read = await get(`/resources/${resource.id}`, teacher.token);
    expect(read.statusCode).toBe(200);
    expect(read.json().uploadId).toBe(signed.uploadId);
  });

  /**
   * `attachmentDisposition` (storage.ts:198-237) takes a filename its owner chose, and the
   * result is signed into a URL that the object store replays into a response header
   * VERBATIM. Nothing downstream re-checks it, so every unsafe byte in that name is a
   * header-injection or a spoofing primitive with no second line of defence.
   *
   * The name below carries one of each thing the sanitiser exists for:
   *   `"`      would close the quoted-string early and let the rest of the name be read
   *            as header parameters
   *   CR, LF   would split the header outright
   *   `é`      is what `filename*` exists to carry and what the ASCII half must drop
   *   U+202E   right-to-left override: `invoice<RLO>fdp.exe` DISPLAYS as `invoice.pdf`
   *
   * The rewrite cleans ONCE and derives both forms from the result, and that is the part
   * worth pinning. Percent-encoding is not sanitisation — a browser decodes `%E2%80%AE`
   * straight back into an override — so while the quoted fallback was the only half being
   * cleaned, the spoof travelled intact in `filename*`, which is the form every current
   * browser PREFERS.
   */
  it('sanitises a hostile filename once, in both halves of the Content-Disposition', async () => {
    const teacher = await signIn('teacher-hostile-name@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    // Escapes rather than literals for the invisible characters: a test whose input
    // cannot be seen in the diff is a test nobody can review.
    const hostile = 'Wéld"ing\r\nSafety\u202Ekoob.pdf';

    const doc = await publishDocument(teacher, courseId, {
      isPublic: false,
      originalName: hostile,
      marker: 'hostile-name',
    });

    // Stored verbatim. Sanitising at rest would corrupt the display name for everyone and
    // hide the problem instead of solving it; the header is where the bytes are dangerous.
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: doc.uploadId } });
    expect(row.originalName).toBe(hostile);

    const response = await get(`/resources/${doc.resourceId}/download`, teacher.token);
    expect(response.statusCode).toBe(200);

    const fetched = await fetch(response.json().url);
    expect(fetched.status).toBe(200);
    const disposition = fetched.headers.get('content-disposition') ?? '';

    expect(disposition.startsWith('attachment')).toBe(true);
    // Header splitting, in the only form that matters: the raw bytes, on the wire.
    expect(disposition).not.toMatch(/[\r\n]/);
    // Neither the raw override nor the percent-encoding a browser decodes back into one.
    expect(disposition).not.toContain('\u202E');
    expect(disposition.toUpperCase()).not.toContain('%E2%80%AE');

    // Both forms, PARSED rather than substring-matched: `toContain` cannot tell a closed
    // quoted-string from one the filename closed early, which is the whole attack.
    const parsed = /^attachment; filename="([^"]*)"; filename\*=UTF-8''(\S+)$/.exec(disposition);
    if (parsed === null) {
      throw new Error(`content-disposition is not RFC 6266 shaped: ${JSON.stringify(disposition)}`);
    }
    const [, fallback, encoded] = parsed;
    if (fallback === undefined || encoded === undefined) {
      throw new Error('Both groups are part of the pattern that just matched.');
    }

    // The quoted fallback: printable ASCII, and neither of the two characters that can
    // end the quoted-string (0x22 `"` and 0x5c `\`) survives in it.
    expect(fallback).toMatch(/^[\x20-\x21\x23-\x5b\x5d-\x7e]+$/);
    expect(fallback.includes('"')).toBe(false);
    expect(fallback.includes('\\')).toBe(false);

    // `filename*` carries the real name, percent-encoded as UTF-8: `é` is two bytes, and
    // the quote is ENCODED rather than dropped — this form has no quoting to break, so
    // the byte is safe to keep and the user gets the name they chose.
    expect(encoded).toContain('%C3%A9');
    expect(encoded).toContain('%22');
    // Decoded, it is the original name minus exactly the characters that were stripped —
    // proof the two halves were derived from ONE cleaned string rather than cleaned
    // separately: the CR, the LF and the override are gone, and nothing else is.
    expect(decodeURIComponent(encoded)).toBe('Wéld"ingSafetykoob.pdf');
  });
});

// --- claiming an upload -----------------------------------------------------

/**
 * `assertUploadClaimable` (uploads.service.ts:285-317) is the one gate every attachment
 * point shares: `Resource.uploadId`, `Course.syllabusUploadId` and `User.avatarUploadId`
 * are each `@unique`, each reachable from a request body, and each was previously
 * defended by a private copy of this logic or — for a course syllabus — by nothing at all.
 *
 * Of its four questions the COMMITTED check is the newest and the only one with no other
 * witness in this suite. It is answered here, through POST /resources, because that is the
 * caller a test can drive today; the sentence it enforces is the same for all three.
 */
describe('POST /resources (claiming an upload)', () => {
  it("refuses an upload that was never committed, at path 'uploadId', and writes nothing", async () => {
    const teacher = await signIn('teacher-claim-pending@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const body = pdfBytes('claim-pending');

    const presigned = await send(
      'POST',
      '/uploads/presign',
      {
        purpose: 'RESOURCE',
        originalName: 'safety-handbook.pdf',
        contentType: 'application/pdf',
        sizeBytes: body.length,
      },
      teacher.token,
    );
    expect(presigned.statusCode).toBe(201);
    const signed: PresignBody = presigned.json();

    // The bytes DO arrive, and that is the case worth testing. An upload with no object
    // behind it would be refused at commit anyway; an upload whose PUT succeeded and
    // whose commit was simply never sent looks finished from the browser's side and is
    // still unverified — nothing has compared HeadObject with what was declared
    // (uploads.service.ts:211-248).
    const put = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body });
    if (!put.ok) {
      throw new Error(`PUT to the signed URL failed: ${put.status} ${await put.text()}`);
    }

    const payload = {
      courseId,
      title: 'Safety handbook',
      type: 'DOCUMENT',
      uploadId: signed.uploadId,
      isPublic: false,
    };
    const created = await send('POST', '/resources', payload, teacher.token);

    expect(created.statusCode).toBe(422);
    expect(created.json().code).toBe('VALIDATION_FAILED');
    // A field path rather than a 403 or a 409: `uploadId` names something the CALLER sent
    // and can put right by sending the commit it skipped. The upload is the teacher's own
    // and the course is the teacher's own, so neither ownership question is what fired —
    // and asserting the path rather than the status is what tells those apart.
    expect(errorAt(created, 'uploadId')).toBeDefined();
    expect(errorAt(created, 'uploadId')?.message).toContain('confirmed');
    expect(errorAt(created, 'courseId')).toBeUndefined();

    // Nothing was written. A 422 that still created the row would be the worst of both:
    // an error for the caller and an attached upload for everybody else — and, because
    // `Resource.uploadId` is `@unique`, an upload its owner could never attach again.
    expect(await prisma.resource.count({})).toBe(0);
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: signed.uploadId } });
    expect(row.status).toBe('PENDING');

    // The control, and it is what makes the refusal above specific: commit that very
    // upload and resend that very body, and it is accepted. Without this, a check that
    // read `ownerId` wrongly — or one that refused every upload alive — satisfies every
    // assertion above.
    const committed = await send(
      'POST',
      '/uploads/commit',
      { uploadId: signed.uploadId },
      teacher.token,
    );
    expect(committed.statusCode).toBe(200);
    expect(committed.json().status).toBe('COMMITTED');

    const retried = await send('POST', '/resources', payload, teacher.token);
    expect(retried.statusCode).toBe(201);
    expect(retried.json().uploadId).toBe(signed.uploadId);
    expect(await prisma.resource.count({})).toBe(1);
  });
});
