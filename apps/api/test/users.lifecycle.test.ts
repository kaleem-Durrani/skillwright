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

/**
 * Provisioned directly, as users.test.ts does and for its reason: only students
 * self-register, and these suites need all three roles.
 */
async function createAccount(
  email: string,
  role: 'STUDENT' | 'TEACHER' | 'ADMIN',
  name = 'Test Person',
  profile: 'none' | 'student' | 'teacher' = 'none',
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

async function signedIn(
  email: string,
  role: 'STUDENT' | 'TEACHER' | 'ADMIN',
  name?: string,
  profile: 'none' | 'student' | 'teacher' = 'none',
): Promise<string> {
  await createAccount(email, role, name, profile);
  return login(email);
}

function send(
  method: 'POST' | 'PATCH' | 'DELETE' | 'GET',
  url: string,
  payload?: unknown,
  cookie?: string,
) {
  return app.inject({
    method,
    url: `/api/v1/users${url}`,
    headers: { ...originHeaders, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

/** A student row shaped like a real import row. */
function studentRow(email: string, overrides: Record<string, unknown> = {}) {
  return { email, name: 'Imported Person', role: 'STUDENT', departmentId, ...overrides };
}

async function userIdOf(email: string): Promise<string> {
  return (await prisma.user.findFirstOrThrow({ where: { email } })).id;
}

// ---------------------------------------------------------------------------
// Phase 4 — cohort import
// ---------------------------------------------------------------------------

describe('POST /users/bulk — cohort import', () => {
  it('creates every row, one audit row each, all attributed to the importing admin', async () => {
    const adminId = await createAccount('bulk-admin@example.com', 'ADMIN', 'Ada Admin');
    const admin = await login('bulk-admin@example.com');

    const rows = [
      studentRow('one@example.com', { name: 'One' }),
      studentRow('two@example.com', { name: 'Two' }),
      studentRow('three@example.com', { name: 'Three' }),
    ];
    const response = await send('POST', '/bulk', { rows }, admin);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.dryRun).toBe(false);
    expect(body.failed).toEqual([]);
    expect(body.created).toHaveLength(3);
    expect(body.created.map((u: { email: string }) => u.email).sort()).toEqual([
      'one@example.com',
      'three@example.com',
      'two@example.com',
    ]);

    // The rows really exist, WITH their profile satellite — the department is what
    // `create()`'s nested write carries and what `createMany` could not.
    for (const email of ['one@example.com', 'two@example.com', 'three@example.com']) {
      const row = await prisma.user.findUniqueOrThrow({
        where: { email },
        include: { studentProfile: true },
      });
      expect(row.studentProfile?.departmentId).toBe(departmentId);
      expect(row.studentProfile?.enrollmentNo).toMatch(/^SW-\d{4}-/);
    }

    /*
     * ONE AUDIT ROW PER CREATED USER, and the count is the assertion. A weaker one
     * — "an audit row exists" — would be satisfied by a single summary row per
     * import, which is exactly the shape that makes an audit trail useless for the
     * question it exists to answer: who created this person, and when.
     */
    const created = body.created as Array<{ id: string }>;
    for (const user of created) {
      const audits = await prisma.auditEvent.findMany({
        where: { entityType: 'User', entityId: user.id, action: 'CREATE' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]?.actorId).toBe(adminId);
    }
  });

  /**
   * The plan's own sentence, as a test: "A school importing 60 people will hit 4
   * already-existing addresses and needs the other 56 to land."
   */
  it('is per-row, not all-or-nothing: the good rows land when four addresses already exist', async () => {
    const admin = await signedIn('bulk-partial@example.com', 'ADMIN', 'Ada Admin');
    await createAccount('taken1@example.com', 'STUDENT', 'Taken One', 'student');
    await createAccount('taken2@example.com', 'STUDENT', 'Taken Two', 'student');
    await createAccount('taken3@example.com', 'STUDENT', 'Taken Three', 'student');
    await createAccount('taken4@example.com', 'STUDENT', 'Taken Four', 'student');

    const response = await send(
      'POST',
      '/bulk',
      {
        rows: [
          studentRow('fresh1@example.com'),
          studentRow('taken2@example.com'),
          studentRow('fresh2@example.com'),
          studentRow('taken1@example.com'),
          studentRow('fresh3@example.com'),
        ],
      },
      admin,
    );

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.created.map((u: { email: string }) => u.email).sort()).toEqual([
      'fresh1@example.com',
      'fresh2@example.com',
      'fresh3@example.com',
    ]);

    // Row numbers are 1-BASED, because the person fixing the file is looking at a
    // spreadsheet whose first row is row 1.
    expect(body.failed).toEqual([
      {
        row: 2,
        code: 'CONFLICT',
        detail: 'An account with this email already exists',
      },
      {
        row: 4,
        code: 'CONFLICT',
        detail: 'An account with this email already exists',
      },
    ]);

    // And the successful rows are committed, not merely reported.
    expect(await prisma.user.count({ where: { email: { startsWith: 'fresh' } } })).toBe(3);
  });

  /**
   * The feature's more valuable half. It must run the SAME checks as the real
   * import, so the only honest way to test that is to compare the two verdicts on
   * the same input.
   */
  it('a dry run reports the same failures as the real run and writes nothing', async () => {
    const admin = await signedIn('bulk-dry@example.com', 'ADMIN', 'Ada Admin');
    await createAccount('already-here@example.com', 'STUDENT', 'Already Here', 'student');

    const payload = {
      rows: [
        studentRow('dry1@example.com'),
        studentRow('already-here@example.com'),
        // No department — `createUserSchema`'s superRefine refuses it.
        { email: 'dry2@example.com', name: 'No Department', role: 'STUDENT' },
        // A teacher with no qualification, which superRefine also refuses.
        { email: 'dry3@example.com', name: 'No Qualification', role: 'TEACHER', departmentId },
      ],
      dryRun: true,
    };

    const dry = await send('POST', '/bulk', payload, admin);
    expect(dry.statusCode).toBe(200);
    const dryBody = dry.json();
    expect(dryBody.dryRun).toBe(true);

    // A dry run creates nobody, so `created` is empty rather than hypothetical.
    expect(dryBody.created).toEqual([]);
    expect(dryBody.failed.map((f: { row: number; code: string }) => [f.row, f.code])).toEqual([
      [2, 'CONFLICT'],
      [3, 'VALIDATION_FAILED'],
      [4, 'VALIDATION_FAILED'],
    ]);

    // NOT ONE ROW WAS WRITTEN. The whole point: the first thing an admin does with
    // an import is upload the wrong file, and a wrong file that is a hundred rows
    // of real students is not a mistake anybody undoes by hand. The two rows that
    // exist are the admin making the request and the account already in the system.
    expect(await prisma.user.count()).toBe(2);

    // And the real run of the SAME body produces the SAME per-row verdicts — which
    // is the property that makes the dry run worth running at all.
    const real = await send('POST', '/bulk', { ...payload, dryRun: false }, admin);
    expect(real.json().failed.map((f: { row: number; code: string }) => [f.row, f.code])).toEqual(
      dryBody.failed.map((f: { row: number; code: string }) => [f.row, f.code]),
    );
  });

  /**
   * The failure mode a dry run that under-reports causes. Rows 1 and 3 share an
   * address: neither is in the database yet, so a naive validator passes both, and
   * the admin is told the file is clean.
   */
  it('catches a duplicate address WITHIN the file, in the dry run and in the real run', async () => {
    const admin = await signedIn('bulk-dup@example.com', 'ADMIN', 'Ada Admin');
    const payload = {
      rows: [
        studentRow('repeat@example.com'),
        studentRow('other@example.com'),
        studentRow('repeat@example.com'),
      ],
    };

    const dry = await send('POST', '/bulk', { ...payload, dryRun: true }, admin);
    expect(dry.json().failed).toEqual([
      {
        row: 3,
        code: 'CONFLICT',
        detail: 'An earlier row in this import already uses this email address',
      },
    ]);

    const real = await send('POST', '/bulk', payload, admin);
    expect(real.json().failed).toEqual([
      {
        row: 3,
        code: 'CONFLICT',
        detail: 'An earlier row in this import already uses this email address',
      },
    ]);
    // The duplicate really did not land twice.
    expect(await prisma.user.count({ where: { email: 'repeat@example.com' } })).toBe(1);
  });

  /**
   * `email` is `@db.Citext`, so uniqueness is case-insensitive IN THE DATABASE. A
   * duplicate-detection Set of raw strings would miss the very collision the insert
   * is about to hit, and the dry run would promise a clean file.
   */
  it('treats a differently-cased duplicate as a duplicate, because the column is citext', async () => {
    const admin = await signedIn('bulk-case@example.com', 'ADMIN', 'Ada Admin');

    const response = await send(
      'POST',
      '/bulk',
      { rows: [studentRow('Mixed.Case@Example.com'), studentRow('mixed.case@example.com')] },
      admin,
    );

    expect(response.json().failed).toEqual([
      {
        row: 2,
        code: 'CONFLICT',
        detail: 'An earlier row in this import already uses this email address',
      },
    ]);
  });

  it('carries the same role/field rules the single-create endpoint enforces', async () => {
    const admin = await signedIn('bulk-rules@example.com', 'ADMIN', 'Ada Admin');

    const response = await send(
      'POST',
      '/bulk',
      {
        rows: [
          // A qualification on a STUDENT: `rejectMismatchedProfileFields`.
          {
            email: 'rule1@example.com',
            name: 'Rule One',
            role: 'STUDENT',
            departmentId,
            qualification: 'MSc',
          },
          // A department on an ADMIN, which `create` refuses at its own path.
          { email: 'rule2@example.com', name: 'Rule Two', role: 'ADMIN', departmentId },
        ],
      },
      admin,
    );

    expect(response.json().failed.map((f: { code: string }) => f.code)).toEqual([
      'VALIDATION_FAILED',
      'VALIDATION_FAILED',
    ]);
    expect(await prisma.user.count()).toBe(1); // the admin
  });

  it('provisions a teacher row with its profile satellite, like the single create', async () => {
    const admin = await signedIn('bulk-teacher@example.com', 'ADMIN', 'Ada Admin');

    const response = await send(
      'POST',
      '/bulk',
      {
        rows: [
          {
            email: 'teacher@example.com',
            name: 'Nora Teacher',
            role: 'TEACHER',
            departmentId,
            qualification: 'CSWIP 3.1',
            specialization: 'Underwater welding',
            staffNo: 'STF-0042',
          },
        ],
      },
      admin,
    );

    expect(response.json().failed).toEqual([]);
    expect(response.json().created[0].teacherProfile).toMatchObject({
      departmentId,
      departmentName: 'Department welding',
      qualification: 'CSWIP 3.1',
      specialization: 'Underwater welding',
      staffNo: 'STF-0042',
    });
  });

  it('refuses a teacher, a student and an anonymous caller with the rule tag', async () => {
    const teacher = await signedIn('bulk-teach-denied@example.com', 'TEACHER', 'Tessa', 'teacher');
    const student = await signedIn('bulk-stu-denied@example.com', 'STUDENT', 'Sam', 'student');

    const asTeacher = await send('POST', '/bulk', { rows: [studentRow('x@example.com')] }, teacher);
    expect(asTeacher.statusCode).toBe(403);
    expect(asTeacher.json().detail).toContain('rule: TEACHER:deny');

    const asStudent = await send('POST', '/bulk', { rows: [studentRow('y@example.com')] }, student);
    expect(asStudent.statusCode).toBe(403);
    expect(asStudent.json().detail).toContain('rule: STUDENT:deny');

    const anonymous = await send('POST', '/bulk', { rows: [studentRow('z@example.com')] });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().code).toBe('UNAUTHENTICATED');
    expect(await prisma.user.count()).toBe(2); // the two fixtures, nobody imported
  });

  it('refuses a body that is not a cohort, before any row is touched', async () => {
    const admin = await signedIn('bulk-empty@example.com', 'ADMIN', 'Ada Admin');

    const empty = await send('POST', '/bulk', { rows: [] }, admin);
    expect(empty.statusCode).toBe(422);
    expect(empty.json().code).toBe('VALIDATION_FAILED');

    // And the cap. 100 is BULK_IMPORT_MAX_ROWS, shared with the SPA so the dialog
    // can refuse an oversized file before uploading it.
    const oversized = await send(
      'POST',
      '/bulk',
      { rows: Array.from({ length: 101 }, (_, i) => studentRow(`bulk${i}@example.com`)) },
      admin,
    );
    expect(oversized.statusCode).toBe(422);
    expect(await prisma.user.count()).toBe(1);
  });

  it('routes /bulk to the static segment rather than parsing it as an id', async () => {
    const admin = await signedIn('bulk-static@example.com', 'ADMIN', 'Ada Admin');

    // If '/bulk' fell through to '/:id', `idParamSchema` would 422 before the
    // policy preHandler ever ran — a 422 where a 200 belongs.
    const response = await send(
      'POST',
      '/bulk',
      { rows: [studentRow('static@example.com')] },
      admin,
    );
    expect(response.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — self-service account deletion
// ---------------------------------------------------------------------------

describe('POST /users/me/deletion — the cool-off', () => {
  it('schedules rather than deletes, and signs the account out everywhere', async () => {
    const token = await signedIn('del-1@example.com', 'STUDENT', 'Sam Student', 'student');
    const userId = (await prisma.user.findFirstOrThrow({ where: { email: 'del-1@example.com' } }))
      .id;

    const response = await send(
      'POST',
      '/me/deletion',
      { confirmEmail: 'del-1@example.com' },
      token,
    );

    /*
     * 202, not 200, and the distinction IS the feature. The account is not deleted:
     * the response is a schedule with a deadline in it. A 200 would tell the caller
     * — and any script reading it — that the thing was done, and the person would
     * discover a month later that the undo they were told about had a deadline they
     * never saw.
     */
    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.cancellable).toBe(true);
    expect(body.deletionRequestedAt).toEqual(expect.any(String));
    expect(body.deletionEffectiveFor).toEqual(expect.any(String));

    // Thirty days, from the shared constant both sides render from.
    const requested = new Date(body.deletionRequestedAt as string);
    const effective = new Date(body.deletionEffectiveFor as string);
    const days = (effective.getTime() - requested.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(30);

    // NOT deleted. The whole point.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.deletedAt).toBeNull();
    expect(row.deletionRequestedAt).not.toBeNull();

    // Sessions are destroyed IMMEDIATELY, which is what makes the cool-off mean
    // anything: the window is for the person who asked to undo it, not for anybody
    // else to use the account. The requester can still sign back in — they hold the
    // password — and that is the undo.
    expect((await send('GET', '/me', undefined, token)).statusCode).toBe(401);
    const fresh = await login('del-1@example.com');
    expect((await send('GET', '/me', undefined, fresh)).statusCode).toBe(200);
  });

  it('writes an audit row for the request — the extension’s, never a hand-written one', async () => {
    const token = await signedIn('del-audit@example.com', 'STUDENT', 'Sam', 'student');
    const userId = (
      await prisma.user.findFirstOrThrow({ where: { email: 'del-audit@example.com' } })
    ).id;
    const before = await prisma.auditEvent.count({
      where: { entityType: 'User', entityId: userId },
    });

    await send('POST', '/me/deletion', { confirmEmail: 'del-audit@example.com' }, token);

    const rows = await prisma.auditEvent.findMany({
      where: { entityType: 'User', entityId: userId, action: 'UPDATE' },
    });
    // The fixture's CREATE and the login's LOGIN were already there; this adds
    // exactly ONE more row. `resetDatabase()` does not clear AuditEvent, so both
    // counts are scoped to this id rather than taken absolutely.
    expect(await prisma.auditEvent.count({ where: { entityType: 'User', entityId: userId } })).toBe(
      before + 1,
    );
    expect(rows).toHaveLength(1);
    /*
     * It reads as UPDATE rather than DELETE, and that is ACCURATE: at this moment
     * nothing has been deleted. The DELETE row is written when the soft delete
     * actually lands. Two rows, two true facts, neither written by hand.
     */
    expect(rows[0]?.actorId).toBe(userId);
    expect(rows[0]?.after).toMatchObject({
      deletionRequestedAt: expect.any(String),
      deletionEffectiveFor: expect.any(String),
    });
  });

  it('refuses a confirmation that is not the account’s own address, at its own field', async () => {
    const token = await signedIn('del-wrong@example.com', 'STUDENT', 'Sam', 'student');

    const response = await send(
      'POST',
      '/me/deletion',
      { confirmEmail: 'someone@else.com' },
      token,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toContainEqual(
      expect.objectContaining({ path: 'confirmEmail' }),
    );

    const row = await prisma.user.findFirstOrThrow({ where: { email: 'del-wrong@example.com' } });
    expect(row.deletionRequestedAt).toBeNull();
  });

  it('accepts a differently-cased confirmation, because the column is citext', async () => {
    const token = await signedIn('del-case@example.com', 'STUDENT', 'Sam', 'student');

    const response = await send(
      'POST',
      '/me/deletion',
      { confirmEmail: 'DEL-Case@Example.com' },
      token,
    );
    expect(response.statusCode).toBe(202);
  });

  /**
   * The body is NOT `.nullish()` here, unlike the two bodyless POSTs on this
   * router — a bodyless delete request confirms nothing, and the confirm-by-typing
   * is a real control whose server half is the `confirmEmail` comparison.
   */
  it('refuses a bodyless request rather than scheduling a thirty-day clock', async () => {
    const token = await signedIn('del-nobody@example.com', 'STUDENT', 'Sam', 'student');

    const response = await send('POST', '/me/deletion', undefined, token);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');

    const row = await prisma.user.findFirstOrThrow({ where: { email: 'del-nobody@example.com' } });
    expect(row.deletionRequestedAt).toBeNull();
  });

  it('does not let a second click push the deadline out', async () => {
    await signedIn('del-twice@example.com', 'STUDENT', 'Sam', 'student');
    // A fresh token each time, because the first request destroyed every session —
    // reusing the old cookie would 401 and prove nothing about the deadline.
    const first = await send(
      'POST',
      '/me/deletion',
      { confirmEmail: 'del-twice@example.com' },
      await login('del-twice@example.com'),
    );
    const second = await send(
      'POST',
      '/me/deletion',
      { confirmEmail: 'del-twice@example.com' },
      await login('del-twice@example.com'),
    );

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    // The ORIGINAL deadline stands. A cool-off whose length is a function of how
    // anxious the requester is is exactly backwards.
    expect(second.json().deletionEffectiveFor).toBe(first.json().deletionEffectiveFor);
  });

  it('refuses an anonymous caller and names the rule for a teacher deleting a student', async () => {
    const studentId = await createAccount('del-victim@example.com', 'STUDENT', 'Victim', 'student');
    const teacher = await signedIn('del-teacher@example.com', 'TEACHER', 'Tessa', 'teacher');

    const anonymous = await send('POST', '/me/deletion', {
      confirmEmail: 'del-victim@example.com',
    });
    expect(anonymous.statusCode).toBe(401);

    // There is no `/users/:id/deletion` route at all, so the only way a teacher
    // could try is their own account — which is why the route takes no id.
    const own = await send(
      'POST',
      '/me/deletion',
      { confirmEmail: 'del-teacher@example.com' },
      teacher,
    );
    expect(own.statusCode).toBe(202);

    const victim = await prisma.user.findUniqueOrThrow({ where: { id: studentId } });
    expect(victim.deletionRequestedAt).toBeNull();
  });
});

describe('DELETE /users/me/deletion — the undo', () => {
  it('cancels inside the window, and the account keeps working', async () => {
    const token = await signedIn('cancel-1@example.com', 'STUDENT', 'Sam', 'student');
    await send('POST', '/me/deletion', { confirmEmail: 'cancel-1@example.com' }, token);

    const fresh = await login('cancel-1@example.com');
    const cancelled = await send('DELETE', '/me/deletion', undefined, fresh);
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toEqual({
      deletionRequestedAt: null,
      deletionEffectiveFor: null,
      cancellable: false,
    });

    const row = await prisma.user.findFirstOrThrow({ where: { email: 'cancel-1@example.com' } });
    expect(row.deletionRequestedAt).toBeNull();
    expect(row.deletedAt).toBeNull();
  });

  it('409s when there is nothing to cancel, rather than answering an empty success', async () => {
    const token = await signedIn('cancel-none@example.com', 'STUDENT', 'Sam', 'student');

    const response = await send('DELETE', '/me/deletion', undefined, token);
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('CONFLICT');
  });

  it('refuses once the window has passed, and says the account is already gone', async () => {
    await signedIn('cancel-late@example.com', 'STUDENT', 'Sam', 'student');
    await send(
      'POST',
      '/me/deletion',
      { confirmEmail: 'cancel-late@example.com' },
      await login('cancel-late@example.com'),
    );

    // Wind the clock forward rather than waiting thirty days. The row is the
    // authority, so moving `deletionEffectiveFor` is the same state the passage of
    // time would produce — and the test says which state it is reaching for.
    //
    // The cancel is attempted through a DIRECT service-level path rather than a
    // request, because a request cannot get there: `findLiveSession` finalises the
    // due deletion on the way in, so the session is already gone. That is the
    // correct behaviour and it is asserted separately, below.
    const { cancelDeletion } = await import('../src/modules/users/users.lifecycle.service.js');
    await prisma.user.updateMany({
      where: { email: 'cancel-late@example.com' },
      data: { deletionEffectiveFor: new Date(Date.now() - 1000) },
    });

    const lateId = await userIdOf('cancel-late@example.com');
    await expect(cancelDeletion(lateId)).rejects.toMatchObject({
      code: 'CONFLICT',
      detail: expect.stringContaining('window has passed'),
    });
  });
});

describe('the lazy finaliser — a due deletion takes effect on the account’s next request', () => {
  it('soft-deletes the row, writes the derived DELETE audit row, and refuses the session', async () => {
    const token = await signedIn('final-1@example.com', 'STUDENT', 'Sam', 'student');
    const userId = (await prisma.user.findFirstOrThrow({ where: { email: 'final-1@example.com' } }))
      .id;
    await send('POST', '/me/deletion', { confirmEmail: 'final-1@example.com' }, token);

    // The cool-off expires.
    await prisma.user.updateMany({
      where: { id: userId },
      data: { deletionEffectiveFor: new Date(Date.now() - 1000) },
    });

    const fresh = await login('final-1@example.com');
    // The next authenticated request is the one that finalises it — and is refused.
    const refused = await send('GET', '/me', undefined, fresh);
    expect(refused.statusCode).toBe(401);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.deletedAt).not.toBeNull();

    /*
     * The `DELETE` audit row is DERIVED by the extension from the deletedAt
     * null → set transition (packages/db/src/audit.ts's `deriveUpdateAction`), and
     * never written by hand. Asserted here because it is the row that says the
     * account ended, and an account that vanishes from the directory with no such
     * row is the failure a compliance reader would find.
     */
    const deletes = await prisma.auditEvent.findMany({
      where: { entityType: 'User', entityId: userId, action: 'DELETE' },
    });
    expect(deletes).toHaveLength(1);
    // Actor is the person themselves: nobody else did this to them.
    expect(deletes[0]?.actorId).toBe(userId);
  });

  it('leaves every OTHER account untouched — the index is a filter, not a blanket', async () => {
    await signedIn('final-bystander@example.com', 'STUDENT', 'Bystander', 'student');
    const token = await signedIn('final-2@example.com', 'STUDENT', 'Sam', 'student');
    await send('POST', '/me/deletion', { confirmEmail: 'final-2@example.com' }, token);

    const bystander = await login('final-bystander@example.com');
    // A bystander request must not sweep the due deletion as a side effect.
    expect((await send('GET', '/me', undefined, bystander)).statusCode).toBe(200);

    const rows = await prisma.user.findMany({ where: { deletedAt: { not: null } } });
    expect(rows).toHaveLength(0);
  });

  it('a non-due pending deletion does not take effect early', async () => {
    const token = await signedIn('final-early@example.com', 'STUDENT', 'Sam', 'student');
    await send('POST', '/me/deletion', { confirmEmail: 'final-early@example.com' }, token);

    const fresh = await login('final-early@example.com');
    expect((await send('GET', '/me', undefined, fresh)).statusCode).toBe(200);

    const row = await prisma.user.findFirstOrThrow({ where: { email: 'final-early@example.com' } });
    expect(row.deletedAt).toBeNull();
  });
});

describe('GET /users/me/deletion', () => {
  it('reports no pending deletion for an ordinary account', async () => {
    const token = await signedIn('status-none@example.com', 'STUDENT', 'Sam', 'student');

    const response = await send('GET', '/me/deletion', undefined, token);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      deletionRequestedAt: null,
      deletionEffectiveFor: null,
      cancellable: false,
    });
  });

  it('reports the deadline, and stops claiming cancellable once it has passed', async () => {
    await signedIn('status-pending@example.com', 'STUDENT', 'Sam', 'student');
    await send(
      'POST',
      '/me/deletion',
      { confirmEmail: 'status-pending@example.com' },
      await login('status-pending@example.com'),
    );

    const pending = await send(
      'GET',
      '/me/deletion',
      undefined,
      await login('status-pending@example.com'),
    );
    expect(pending.json().cancellable).toBe(true);
    expect(pending.json().deletionEffectiveFor).toEqual(expect.any(String));

    // `cancellable` is DERIVED from the deadline, never stored — so a persisted
    // answer that said true at request time would still say true after the clock
    // passed it, which is how a person gets told they can cancel and then cannot.
    // The row is the authority; move it and read the answer off the same helper.
    await prisma.user.updateMany({
      where: { email: 'status-pending@example.com' },
      data: { deletionEffectiveFor: new Date(Date.now() - 1000) },
    });

    const { deletionStatus } = await import('../src/modules/users/users.lifecycle.service.js');
    const lapsed = await deletionStatus(await userIdOf('status-pending@example.com'));
    expect(lapsed.cancellable).toBe(false);
    expect(lapsed.deletionEffectiveFor).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — data export
// ---------------------------------------------------------------------------

describe('GET /users/me/export', () => {
  /** Deep-searches the served JSON for a string, to assert an ABSENCE. */
  function containsValue(value: unknown, needle: string): boolean {
    return JSON.stringify(value ?? null).includes(needle);
  }

  async function seedForExport() {
    const studentId = await createAccount(
      'export-me@example.com',
      'STUDENT',
      'Sam Student',
      'student',
    );
    const otherId = await createAccount(
      'export-other@example.com',
      'STUDENT',
      'Other Person',
      'student',
    );

    // A course with a teacher who is somebody else, and an offering for it.
    const teacherId = await createAccount(
      'export-teacher@example.com',
      'TEACHER',
      'Tessa',
      'teacher',
    );
    const course = await prisma.course.create({
      data: {
        code: 'WELD-101',
        slug: 'weld-101',
        name: 'Welding Fundamentals',
        departmentId,
        teacherId,
        durationValue: 6,
        durationUnit: 'MONTH',
      },
    });
    const offering = await prisma.courseOffering.create({
      data: { courseId: course.id, capacity: 20, startDate: new Date('2026-09-01') },
    });
    const enrollment = await prisma.enrollment.create({
      data: { studentId, offeringId: offering.id, status: 'APPROVED', decidedById: teacherId },
    });
    const attendance = await prisma.attendanceRecord.create({
      data: {
        enrollmentId: enrollment.id,
        sessionDate: new Date('2026-09-02'),
        status: 'PRESENT',
        markedById: teacherId,
      },
    });

    await prisma.notification.create({
      data: {
        userId: studentId,
        type: 'ENROLLMENT_APPROVED',
        payload: { title: 'Seat approved', body: 'You are on the autumn intake.' },
      },
    });
    // A Comment needs EXACTLY ONE parent — the database holds it with a CHECK
    // constraint (migration 0002), so a null/null comment row is refused rather
    // than accepted and sorted out later.
    const announcement = await prisma.announcement.create({
      data: {
        title: 'Tooling night',
        slug: 'tooling-night',
        content: 'Bring your own.',
        type: 'NEWS',
        authorId: otherId,
      },
    });
    await prisma.comment.create({
      data: {
        authorId: studentId,
        content: 'Do we need gloves?',
        resourceId: null,
        announcementId: announcement.id,
      },
    });
    await prisma.upload.create({
      data: {
        key: 'avatars/avatar/01ABC.png',
        bucket: 'skillwright-uploads',
        contentType: 'image/png',
        sizeBytes: 1024,
        originalName: 'me.png',
        status: 'COMMITTED',
        ownerId: studentId,
      },
    });

    return { studentId, otherId, teacherId, course, offering, enrollment, attendance };
  }

  it('serves the caller their own record, and nothing credential-shaped', async () => {
    await seedForExport();
    const token = await login('export-me@example.com');

    const response = await send('GET', '/me/export', undefined, token);
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.account).toMatchObject({
      email: 'export-me@example.com',
      name: 'Sam Student',
      role: 'STUDENT',
      mfaEnabled: false,
    });
    expect(body.studentProfile).toMatchObject({
      departmentName: 'Department welding',
      enrollmentNo: 'SW-export-me@example.com',
    });
    expect(body.enrollments).toHaveLength(1);
    expect(body.enrollments[0]).toMatchObject({
      courseCode: 'WELD-101',
      courseName: 'Welding Fundamentals',
    });
    expect(body.notifications[0].payload).toEqual({
      title: 'Seat approved',
      body: 'You are on the autumn intake.',
    });
    expect(body.comments[0].content).toBe('Do we need gloves?');
    expect(body.uploads[0].originalName).toBe('me.png');
    // The session they are reading this with is their own record of signing in.
    expect(body.sessions.length).toBeGreaterThanOrEqual(1);

    /*
     * THE CREDENTIAL ASSERTION. A privacy export is the one document guaranteed to
     * be forwarded to somebody who is not the person it describes, so this checks
     * the whole envelope for each of these by name rather than trusting the select
     * lists above to have been right.
     */
    for (const secret of [
      'passwordHash',
      'totpSecret',
      'totpLastUsedCounter',
      'tokenHash',
      'codeHash',
    ]) {
      expect(containsValue(body, secret), `${secret} must not appear in the export`).toBe(false);
    }
  });

  /**
   * The brief's own instruction: "The export must NOT include another user's data
   * through any relation — check every include you reach for." Every assertion below
   * is an ABSENCE, because that is what a leak looks like.
   */
  it('reaches no second person through any relation', async () => {
    const { teacherId } = await seedForExport();
    const token = await login('export-me@example.com');

    const body = (await send('GET', '/me/export', undefined, token)).json();

    // The teacher who approved the seat, marked the register and owns the course.
    // `decidedById`, `completedById`, `markedById` and `course.teacherId` are the
    // four columns that would have leaked them.
    expect(containsValue(body, 'export-teacher@example.com')).toBe(false);
    expect(containsValue(body, 'Tessa')).toBe(false);
    expect(containsValue(body, teacherId)).toBe(false);
    for (const column of ['decidedById', 'completedById', 'markedById', 'teacherId']) {
      expect(containsValue(body, column), `${column} must not appear in the export`).toBe(false);
    }

    // Another student entirely.
    expect(containsValue(body, 'export-other@example.com')).toBe(false);
  });

  /**
   * A conversation is a two-sided record, and `messages` with no filter would hand
   * out the other side of every thread. The filter is `senderId = viewerId`, so
   * somebody else's message simply is not in the result.
   */
  it('exports only the caller’s own messages from a thread', async () => {
    const me = await createAccount('thread-me@example.com', 'STUDENT', 'Me', 'student');
    const them = await createAccount('thread-them@example.com', 'TEACHER', 'Them', 'teacher');
    const token = await login('thread-me@example.com');

    const conversation = await prisma.conversation.create({ data: { title: null } });
    await prisma.conversationParticipant.createMany({
      data: [
        { conversationId: conversation.id, userId: me },
        { conversationId: conversation.id, userId: them },
      ],
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: me,
        seq: 1n,
        content: 'Mine',
        clientMsgId: '01AAAAAAAAAAAAAAAAAAAAAAAA',
      },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: them,
        seq: 2n,
        content: 'THEIR SECRET REPLY',
        clientMsgId: '01BBBBBBBBBBBBBBBBBBBBBBBB',
      },
    });

    const body = (await send('GET', '/me/export', undefined, token)).json();
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0].messages).toHaveLength(1);
    expect(body.conversations[0].messages[0].content).toBe('Mine');
    expect(containsValue(body, 'THEIR SECRET REPLY')).toBe(false);
    expect(containsValue(body, 'thread-them@example.com')).toBe(false);
  });

  /**
   * An admin's export must not be a log of what they did to other people. An
   * `AuditEvent`'s before/after snapshot is a full copy of whatever was written, so
   * including the rows the admin is the actor on would carry every account they
   * ever edited.
   */
  it('exports no AuditEvent rows, even for an admin who is the actor on them', async () => {
    const adminId = await createAccount('export-admin@example.com', 'ADMIN', 'Ada Admin');
    const victimId = await createAccount(
      'export-victim@example.com',
      'STUDENT',
      'Victim',
      'student',
    );
    const token = await login('export-admin@example.com');

    // An audit row the admin is the actor on, about somebody else.
    await prisma.auditEvent.create({
      data: {
        actorId: adminId,
        action: 'SUSPEND',
        entityType: 'User',
        entityId: victimId,
        before: { email: 'export-victim@example.com', name: 'Victim' },
        after: { email: 'export-victim@example.com', status: 'SUSPENDED' },
      },
    });

    const body = (await send('GET', '/me/export', undefined, token)).json();
    expect(containsValue(body, 'export-victim@example.com')).toBe(false);
    expect(containsValue(body, 'SUSPEND')).toBe(false);
    // The admin's OWN account is still fully present — the omission is the trail,
    // not the record.
    expect(body.account.email).toBe('export-admin@example.com');
  });

  /**
   * `Notification.payload` is an unconstrained `Json` column written by other
   * modules' side effects. A row whose payload does not parse is DROPPED, not
   * emitted blank: lesson 17 is a blank payload that rendered every notification
   * in a list with no error anywhere.
   */
  it('drops a notification whose payload does not match the two-key contract', async () => {
    const me = await createAccount('payload@example.com', 'STUDENT', 'Me', 'student');
    const token = await login('payload@example.com');

    await prisma.notification.create({
      data: { userId: me, type: 'ACCOUNT_SUSPENDED', payload: { title: 'Only a title' } },
    });
    await prisma.notification.create({
      data: {
        userId: me,
        type: 'ENROLLMENT_APPROVED',
        payload: { title: 'Seat approved', body: 'You are in.' },
      },
    });

    const body = (await send('GET', '/me/export', undefined, token)).json();
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].payload).toEqual({ title: 'Seat approved', body: 'You are in.' });
  });

  it('refuses an anonymous caller, and takes no id', async () => {
    await seedForExport();

    const anonymous = await send('GET', '/me/export');
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().code).toBe('UNAUTHENTICATED');
  });

  it('routes /me/export to the static segment rather than parsing it as an id', async () => {
    await createAccount('static-export@example.com', 'STUDENT', 'Sam', 'student');
    const token = await login('static-export@example.com');

    // If '/me/export' were caught by '/:id', `idParamSchema` would 422 before any
    // policy ran.
    const response = await send('GET', '/me/export', undefined, token);
    expect(response.statusCode).toBe(200);
    expect(response.json().account.email).toBe('static-export@example.com');
  });
});

// ---------------------------------------------------------------------------
// The import's own rate-limit bucket
// ---------------------------------------------------------------------------

describe('POST /users/bulk — its own rate-limit bucket', () => {
  /**
   * "Rate-limited separately from the rest of `/users`" is only true if the two
   * counters cannot see each other, and a shared counter with a different label on
   * it is the same counter. So this spends the import bucket to exhaustion and then
   * proves the rest of `/users` is UNAFFECTED — which is the assertion that
   * distinguishes a separate bucket from a separate comment.
   *
   * The ceiling is the route's own `max: 10`, not the global 100_000 the test
   * setup raises, so eleven imports is enough and the suite stays quick.
   */
  it('exhausts on imports without touching the rest of /users', async () => {
    const admin = await signedIn('rl-admin@example.com', 'ADMIN', 'Ada Admin');

    // Eleven imports: the eleventh must be refused.
    let refused: Awaited<ReturnType<typeof send>> | null = null;
    for (let i = 0; i < 11; i += 1) {
      const response = await send(
        'POST',
        '/bulk',
        { rows: [studentRow(`rl${i}@example.com`)] },
        admin,
      );
      if (response.statusCode === 429) {
        refused = response;
        break;
      }
      expect(response.statusCode).toBe(200);
    }

    expect(refused).not.toBeNull();
    expect(refused!.statusCode).toBe(429);
    // The problem+json code the SPA maps to "Too many attempts" — lesson 25's
    // contract, asserted on the CODE rather than on any sentence.
    expect(refused!.json().code).toBe('RATE_LIMITED');

    /*
     * THE OTHER HALF, and the one that makes the test worth writing: the single
     * create is on the GLOBAL bucket and is still wide open. An admin who has
     * imported ten cohorts this morning can still add one person, which is the
     * whole point of a separate bucket — and an assertion that only checked the
     * 429 would pass against a route that simply 429'd everything.
     */
    const single = await send(
      'POST',
      '',
      { email: 'after-the-limit@example.com', name: 'Still Works', role: 'STUDENT', departmentId },
      admin,
    );
    expect(single.statusCode).toBe(201);

    // And the key is the ADMIN's, not their address: a second admin on the same IP
    // is unaffected, which is what `keyGenerator: request.actor?.id` buys and what
    // a college behind one NAT would otherwise lose.
    const other = await signedIn('rl-admin2@example.com', 'ADMIN', 'Bea Admin');
    const theirs = await send(
      'POST',
      '/bulk',
      { rows: [studentRow('other-admin@example.com')] },
      other,
    );
    expect(theirs.statusCode).toBe(200);
  });
});
