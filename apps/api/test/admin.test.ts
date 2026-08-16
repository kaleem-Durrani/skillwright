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
  // Same first line as courses.test.ts:32-35: `Course.teacher` is onDelete: Restrict
  // (schema.prisma:321), so the user delete inside resetDatabase() fails while any
  // course from an earlier suite still points at a teacher.
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
    url: `/api/v1/admin${url}`,
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

/**
 * The demo identity, which exists to prove `user:list` is NOT in DEMO_DENIED
 * (can.ts:24-31). It comes in through its own route because provenance is set by
 * `createSession(user.id, 'DEMO', request)` (auth.service.ts:534) and cannot be forged
 * from a password login. DEMO_MODE is already `true` for tests (setup.ts:77).
 */
async function demoSignedIn(role: TestRole): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/demo',
    headers: { ...originHeaders },
    payload: { role },
  });
  expect(response.statusCode).toBe(200);
  return sessionCookie(response) as string;
}

// --- tests -----------------------------------------------------------------

describe('GET /admin/stats', () => {
  it('answers an admin with the four tiles the overview reads', async () => {
    const admin = await signedIn('admin@example.com', 'ADMIN', 'Ada Admin');
    await createAccount('student@example.com', 'STUDENT');
    await createAccount('teacher@example.com', 'TEACHER');
    await prisma.department.create({ data: { name: 'Department joinery', slug: 'joinery' } });

    const response = await get('/stats', admin);
    expect(response.statusCode).toBe(200);

    // The four key names are fixed by AdminOverview.tsx:12-17; asserting the exact
    // object rather than a subset is what makes a rename here fail the suite instead
    // of rendering a silent zero in the SPA (AdminOverview.tsx:99).
    expect(response.json()).toEqual({
      users: 3,
      suspendedUsers: 0,
      departments: 2,
      auditEventsToday: expect.any(Number),
    });
  });

  it('counts suspended users as a subset of the users tile', async () => {
    const admin = await signedIn('admin2@example.com', 'ADMIN');
    const suspendedId = await createAccount('quiet@example.com', 'STUDENT');
    await prisma.user.update({ where: { id: suspendedId }, data: { status: 'SUSPENDED' } });

    const body = (await get('/stats', admin)).json();
    expect(body.users).toBe(2);
    expect(body.suspendedUsers).toBe(1);
  });

  it('excludes soft-deleted users and departments, because a tile that counts them lies', async () => {
    const admin = await signedIn('admin3@example.com', 'ADMIN');
    const goneId = await createAccount('gone@example.com', 'STUDENT');

    // Soft delete is not enforced by the ORM (schema.prisma:6-7 rule 3) — these rows
    // stay in the table and only the service's hand-written filter removes them.
    await prisma.user.update({ where: { id: goneId }, data: { deletedAt: new Date() } });
    await prisma.department.update({
      where: { id: departmentId },
      data: { deletedAt: new Date() },
    });

    // A suspended-AND-deleted account must not survive in the suspended tile either.
    const bothId = await createAccount('both@example.com', 'STUDENT');
    await prisma.user.update({
      where: { id: bothId },
      data: { status: 'SUSPENDED', deletedAt: new Date() },
    });

    const body = (await get('/stats', admin)).json();
    expect(body.users).toBe(1);
    expect(body.suspendedUsers).toBe(0);
    expect(body.departments).toBe(0);
  });

  it('counts only the audit events written since UTC midnight', async () => {
    const admin = await signedIn('admin4@example.com', 'ADMIN');

    /*
     * Cleared AFTER the fixtures above, because User is in AUDITED_MODELS
     * (packages/db/src/audit.ts:51-59) and every `createAccount` above therefore wrote
     * a row of its own. Deleting from AuditEvent is possible here only because
     * migration 0002:107-113 leaves the REVOKE commented out for local development,
     * where the owner and application roles are the same role; in production this
     * table is append-only and a test could not do this.
     */
    await prisma.auditEvent.deleteMany({});
    await prisma.auditEvent.createMany({
      data: [
        { action: 'CREATE', entityType: 'Department', entityId: 'today', createdAt: new Date() },
        {
          action: 'CREATE',
          entityType: 'Department',
          entityId: 'before-midnight',
          // 36 hours is always on the far side of UTC midnight, whatever hour the
          // suite runs at — a smaller offset would pass or fail depending on the clock.
          createdAt: new Date(Date.now() - 36 * 60 * 60 * 1000),
        },
      ],
    });

    const body = (await get('/stats', admin)).json();
    expect(body.auditEventsToday).toBe(1);
  });

  it('counts the audit row the Prisma extension writes, not one written by hand', async () => {
    const admin = await signedIn('admin5@example.com', 'ADMIN');
    await prisma.auditEvent.deleteMany({});

    // Department is in AUDITED_MODELS, so this single create produces exactly one
    // audit row — written by the extension on its own pool (audit.ts:234-428), never
    // by a service. A module that wrote its own would show 2 here.
    await prisma.department.create({ data: { name: 'Department masonry', slug: 'masonry' } });

    const body = (await get('/stats', admin)).json();
    expect(body.auditEventsToday).toBe(1);
  });

  it('serves a DEMO admin, because reading counters destroys nothing', async () => {
    const demoAdmin = await demoSignedIn('ADMIN');

    // `user:list` is deliberately absent from DEMO_DENIED (can.ts:24-31). If this ever
    // starts failing with `rule: provenance:DEMO`, someone added the action to that set
    // and made the demo instance's admin workspace an empty room.
    const response = await get('/stats', demoAdmin);
    expect(response.statusCode).toBe(200);
    expect(response.json().users).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /admin/stats — the permission', () => {
  it('refuses a student, naming the rule that denied it', async () => {
    const student = await signedIn('nosy.student@example.com', 'STUDENT');

    const response = await get('/stats', student);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    // policy.ts:321 — `user:list` STUDENT is a bare `deny`, and the stand-in gate is
    // only defensible because that cell reads no Subject field.
    expect(response.json().detail).toContain('rule: STUDENT:deny');
  });

  it('refuses a teacher, naming the rule that denied it', async () => {
    const teacher = await signedIn('nosy.teacher@example.com', 'TEACHER');

    const response = await get('/stats', teacher);
    expect(response.statusCode).toBe(403);
    // policy.ts:322 — a teacher runs courses, not the instance.
    expect(response.json().detail).toContain('rule: TEACHER:deny');
  });

  it('refuses an anonymous caller with 401 rather than 403', async () => {
    const response = await get('/stats');
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
    // A 422 here would mean the response schema ran before the gate (TRAP 4). It
    // cannot: the route declares no params, querystring or body to validate.
  });

  /*
   * This module has no list endpoint, so the usual "does not leak another user's rows"
   * assertion has no rows to scope. The equivalent leak is the whole payload: these are
   * instance-wide counters, and the only caller class entitled to them is ADMIN. So the
   * assertion is that a refusal carries no counters at all — not a zeroed body, not a
   * partial one, and nothing a client could render by ignoring the status code.
   */
  it('leaks no counter to the callers it refuses', async () => {
    const teacher = await signedIn('leak@example.com', 'TEACHER');
    await createAccount('one@example.com', 'STUDENT');
    const suspendedId = await createAccount('two@example.com', 'STUDENT');
    await prisma.user.update({ where: { id: suspendedId }, data: { status: 'SUSPENDED' } });

    const body = (await get('/stats', teacher)).json();
    expect(body).not.toHaveProperty('users');
    expect(body).not.toHaveProperty('suspendedUsers');
    expect(body).not.toHaveProperty('departments');
    expect(body).not.toHaveProperty('auditEventsToday');
  });
});
