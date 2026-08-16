import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { hashPassword } from '../src/lib/password.js';
import {
  buildApp,
  cookieHeader,
  originHeaders,
  prisma,
  resetDatabase,
  resetRateLimits,
  sessionCookie,
} from './setup.js';

const PASSWORD = 'correct-horse-battery-staple';

let app: FastifyInstance;
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
  // resetDatabase() does NOT touch AuditEvent — the table has no `deletedAt` and is
  // append-only (schema.prisma:616-619), and its own `deleteMany` calls on User,
  // Course and Department are audited models, so unwinding the previous suite writes
  // rows of its own. Clearing has to come afterwards or this suite reads them.
  await clearAudit();
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

async function signedIn(email: string, role: TestRole, name?: string): Promise<string> {
  await createAccount(email, role, name);
  return login(email);
}

/**
 * Creating an account and logging in both mutate audited models, so every test that
 * asserts on the CONTENTS of the feed clears it once its fixtures exist and seeds the
 * rows it means to observe afterwards. Reading the feed writes nothing: the only write
 * a GET performs is the session slide, and Session is deliberately unaudited
 * (audit.ts:43-59).
 */
async function clearAudit(): Promise<void> {
  await prisma.auditEvent.deleteMany({});
}

type AuditActionName = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'SUSPEND' | 'APPROVE';

interface SeedEvent {
  id?: string;
  action?: AuditActionName;
  entityType?: string;
  entityId?: string;
  actorId?: string | null;
  createdAt?: Date;
  // `Record<string, string>` rather than `unknown`: Prisma's `InputJsonValue` does not
  // accept an `unknown`-valued index signature, and these two fields exist here only to
  // prove the DTO drops them.
  before?: Record<string, string>;
  after?: Record<string, string>;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

/**
 * Rows are inserted directly rather than provoked through a mutation, because the
 * assertions below are about shapes the extension writes in production — a null actor,
 * an empty `entityId`, a seeded ULID id — that no fixture-driven mutation produces.
 * `AuditEvent` is not in AUDITED_MODELS (audit.ts:51-59), so inserting one here does
 * not cascade into a second row.
 */
async function seedEvent(event: SeedEvent = {}): Promise<string> {
  const row = await prisma.auditEvent.create({
    data: {
      action: event.action ?? 'CREATE',
      entityType: event.entityType ?? 'Course',
      entityId: event.entityId ?? 'cmsvme3r703ucw4g0i6oyh6fh',
      ...(event.id !== undefined ? { id: event.id } : {}),
      ...(event.actorId !== undefined ? { actorId: event.actorId } : {}),
      ...(event.createdAt !== undefined ? { createdAt: event.createdAt } : {}),
      ...(event.before !== undefined ? { before: event.before } : {}),
      ...(event.after !== undefined ? { after: event.after } : {}),
      ...(event.ip !== undefined ? { ip: event.ip } : {}),
      ...(event.userAgent !== undefined ? { userAgent: event.userAgent } : {}),
      ...(event.requestId !== undefined ? { requestId: event.requestId } : {}),
    },
  });
  return row.id;
}

function get(url: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/audit-events${url}`,
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

// --- tests -----------------------------------------------------------------

describe('GET /audit-events', () => {
  it('serves an admin the feed newest-first, in the shared envelope', async () => {
    const admin = await signedIn('admin@example.com', 'ADMIN', 'Ada Admin');
    await clearAudit();

    await seedEvent({ entityType: 'Course', createdAt: new Date('2026-01-01T00:00:00.000Z') });
    await seedEvent({ entityType: 'Department', createdAt: new Date('2026-01-03T00:00:00.000Z') });
    await seedEvent({ entityType: 'Enrollment', createdAt: new Date('2026-01-02T00:00:00.000Z') });

    const response = await get('', admin);
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.data.map((event: { entityType: string }) => event.entityType)).toEqual([
      'Department',
      'Enrollment',
      'Course',
    ]);
    expect(body.meta).toEqual({
      page: 1,
      limit: 20,
      total: 3,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  });

  it('serves exactly the six fields the page renders, plus actorId', async () => {
    const admin = await signedIn('shape@example.com', 'ADMIN', 'Ada Admin');
    await clearAudit();

    // The redacted diff and the request metadata exist on the row and must not reach
    // the wire: AdminOverview.tsx:141-148 renders none of them, and an audit trail is
    // read by more people than the users table is (audit.ts:61-66).
    await seedEvent({
      action: 'UPDATE',
      entityType: 'User',
      entityId: 'cmsvme3r703ucw4g0i6oyh6fh',
      before: { name: 'Before' },
      after: { name: 'After' },
      ip: '203.0.113.7',
      userAgent: 'vitest',
      requestId: '01JGXDFAM0K2Z1GYCSNM5F5RCX',
    });

    const [entry] = (await get('', admin)).json().data;
    expect(Object.keys(entry).sort()).toEqual([
      'action',
      'actorId',
      'actorName',
      'createdAt',
      'entityId',
      'entityType',
      'id',
    ]);
    expect(entry.action).toBe('UPDATE');
    expect(entry.createdAt).toEqual(expect.any(String));
  });

  it('names the actor behind an event', async () => {
    const adminId = await createAccount('named@example.com', 'ADMIN', 'Ada Admin');
    const admin = await login('named@example.com');
    await clearAudit();

    await seedEvent({ actorId: adminId, action: 'SUSPEND', entityType: 'User' });

    const [entry] = (await get('', admin)).json().data;
    expect(entry.actorId).toBe(adminId);
    expect(entry.actorName).toBe('Ada Admin');
  });

  it('serves a system-initiated event with a null actor rather than failing', async () => {
    const admin = await signedIn('system@example.com', 'ADMIN');
    await clearAudit();

    // schema.prisma:623 — null is the documented shape for cron and queue workers, and
    // `onDelete: SetNull` produces it again whenever an actor's row is hard-deleted.
    // The SPA renders it as 'system' (AdminOverview.tsx:148).
    await seedEvent({ actorId: null });

    const response = await get('', admin);
    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({ actorId: null, actorName: null });
  });

  it('keeps naming an actor whose account was soft-deleted', async () => {
    const teacherId = await createAccount('gone@example.com', 'TEACHER', 'Tessa Teacher');
    const admin = await signedIn('keeper@example.com', 'ADMIN');
    await clearAudit();

    await seedEvent({ actorId: teacherId, entityType: 'Course' });
    // The one read in the codebase that deliberately does NOT filter `deletedAt`:
    // blanking the name here would render the row as 'system' and make the trail lie
    // about who acted. This update is itself audited, hence the entityType filter.
    await prisma.user.update({ where: { id: teacherId }, data: { deletedAt: new Date() } });

    const response = await get('?entityType=Course', admin);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
    expect(response.json().data[0].actorName).toBe('Tessa Teacher');
  });

  it('serves a seeded ULID id as readily as an application cuid', async () => {
    const admin = await signedIn('ulid@example.com', 'ADMIN');
    await clearAudit();

    // The seed writes deterministic ULIDs and the application writes cuids; `idSchema`
    // (common.ts:17-22) accepts both. A narrower response rule would 500 the whole page
    // the first time it met the 595 seeded rows NEXT.md records.
    const ulid = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
    await seedEvent({ id: ulid });

    const response = await get('', admin);
    expect(response.statusCode).toBe(200);
    expect(response.json().data[0].id).toBe(ulid);
  });

  it('serves a historical row whose entityId is the empty string', async () => {
    const admin = await signedIn('legacy@example.com', 'ADMIN');
    await clearAudit();

    // audit.ts:203-206 writes '' when a createMany row carried no id. `entityId` is
    // `z.string()` on the response for exactly this row, and `idSchema` on the query.
    await seedEvent({ entityId: '' });

    const response = await get('', admin);
    expect(response.statusCode).toBe(200);
    expect(response.json().data[0].entityId).toBe('');
  });

  it('filters by action, entityType and actorId', async () => {
    const actorId = await createAccount('filter@example.com', 'ADMIN', 'Ada Admin');
    const admin = await login('filter@example.com');
    await clearAudit();

    await seedEvent({ action: 'SUSPEND', entityType: 'User', actorId });
    await seedEvent({ action: 'CREATE', entityType: 'Course', actorId: null });
    await seedEvent({ action: 'CREATE', entityType: 'Department', actorId: null });

    expect((await get('?action=SUSPEND', admin)).json().meta.total).toBe(1);
    expect((await get('?entityType=Course', admin)).json().meta.total).toBe(1);
    expect((await get('?action=CREATE', admin)).json().meta.total).toBe(2);

    const byActor = (await get(`?actorId=${actorId}`, admin)).json();
    expect(byActor.meta.total).toBe(1);
    expect(byActor.data[0].entityType).toBe('User');
  });

  it('filters by entityId, so a row can be traced to one entity', async () => {
    const admin = await signedIn('trace@example.com', 'ADMIN');
    await clearAudit();

    const entityId = 'cmsvme3r703ucw4g0i6oyh6fh';
    await seedEvent({ entityType: 'Course', entityId, action: 'CREATE' });
    await seedEvent({ entityType: 'Course', entityId, action: 'UPDATE' });
    await seedEvent({ entityType: 'Course', entityId: '01JGXDFAM0K2Z1GYCSNM5F5RCX' });

    const response = await get(`?entityId=${entityId}`, admin);
    expect(response.statusCode).toBe(200);
    expect(response.json().meta.total).toBe(2);
  });

  it('pages with the shared meta block', async () => {
    const admin = await signedIn('pager@example.com', 'ADMIN');
    await clearAudit();

    for (const day of [1, 2, 3]) {
      await seedEvent({ createdAt: new Date(`2026-02-0${day}T00:00:00.000Z`) });
    }

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

  it('honours order=asc for reading the feed oldest-first', async () => {
    const admin = await signedIn('order@example.com', 'ADMIN');
    await clearAudit();

    await seedEvent({ entityType: 'Older', createdAt: new Date('2026-03-01T00:00:00.000Z') });
    await seedEvent({ entityType: 'Newer', createdAt: new Date('2026-03-02T00:00:00.000Z') });

    const response = await get('?order=asc', admin);
    expect(response.json().data.map((e: { entityType: string }) => e.entityType)).toEqual([
      'Older',
      'Newer',
    ]);
  });

  it('falls back to createdAt for an unrecognised sort rather than 422ing', async () => {
    const admin = await signedIn('sort@example.com', 'ADMIN');
    await clearAudit();

    await seedEvent({ entityType: 'Older', createdAt: new Date('2026-04-01T00:00:00.000Z') });
    await seedEvent({ entityType: 'Newer', createdAt: new Date('2026-04-02T00:00:00.000Z') });

    // `sort` is free-form text (pagination.ts:16). A stale bookmark must still render a
    // page, and the value must never reach an orderBy key.
    const response = await get('?sort=actorId%3B+drop+table', admin);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((e: { entityType: string }) => e.entityType)).toEqual([
      'Newer',
      'Older',
    ]);
  });

  it('rejects a non-numeric limit with a field path rather than a NaN query', async () => {
    const admin = await signedIn('limit@example.com', 'ADMIN');

    const response = await get('?limit=abc', admin);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  });

  it('rejects an action outside the enum', async () => {
    const admin = await signedIn('enum@example.com', 'ADMIN');

    const response = await get('?action=DROP_TABLE', admin);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /audit-events — who may read it', () => {
  it('refuses an anonymous caller', async () => {
    await seedEvent();

    const response = await get('');
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
    expect(response.json().data).toBeUndefined();
  });

  it('refuses a student, naming the rule that denied it', async () => {
    const student = await signedIn('student@example.com', 'STUDENT');
    await seedEvent();

    const response = await get('', student);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    // policy.ts:452-457 — a terminal deny that reads no Subject field, which is why the
    // route can be gated by a bare authorize('audit:read') with no subject loader.
    expect(response.json().detail).toContain('rule: STUDENT:deny');
  });

  it('refuses a teacher even the rows recording their own actions', async () => {
    const teacherId = await createAccount('own@example.com', 'TEACHER', 'Tessa Teacher');
    const teacher = await login('own@example.com');
    await clearAudit();

    // The feed has no per-actor scope to fall back to: it is admin-only in full, so
    // there is no filtered 200 hiding behind this 403 and no partial body to leak.
    await seedEvent({ actorId: teacherId, entityType: 'Course' });

    const response = await get(`?actorId=${teacherId}`, teacher);
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: TEACHER:deny');
    expect(response.json().data).toBeUndefined();
  });

  it('exposes no write route — rows come from the extension, never from a client', async () => {
    const admin = await signedIn('writer@example.com', 'ADMIN');

    // Same-origin, so the CSRF guard (csrf.plugin.ts) passes and the 404 is the router
    // saying this module declares one route. Migration 0002:107-108 revokes UPDATE and
    // DELETE on the table from the application role; INSERT belongs to audit.ts:288-427.
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/audit-events',
      headers: { ...originHeaders, cookie: cookieHeader(admin) },
      payload: { action: 'CREATE', entityType: 'Course', entityId: 'x' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('the feed is written by the extension, not by this module', () => {
  it('shows a mutation performed through another module, attributed to its actor', async () => {
    const adminId = await createAccount('extension@example.com', 'ADMIN', 'Ada Admin');
    const admin = await login('extension@example.com');
    await clearAudit();

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/departments',
      headers: { ...originHeaders, cookie: cookieHeader(admin) },
      payload: { name: 'Fabrication' },
    });
    expect(created.statusCode).toBe(201);

    const response = await get('?entityType=Department', admin);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
    expect(response.json().data[0]).toMatchObject({
      action: 'CREATE',
      entityType: 'Department',
      entityId: created.json().id,
      // The actor comes from the AsyncLocalStorage seeded in logger.plugin.ts:26-28,
      // not from anything this module passed.
      actorId: adminId,
      actorName: 'Ada Admin',
    });
  });
});
