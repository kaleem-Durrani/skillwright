import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@skillwright/db';
import { can, type NotificationTypeValue } from '@skillwright/shared';
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
  // `resetDatabase()` never mentions Notification, and does not need to:
  // `Notification.user` is onDelete: Cascade (schema.prisma:598), so deleting every
  // user takes the notifications with it. Adding a delete here would be a second,
  // drifting teardown for a table the shared fixture already handles.
  await resetDatabase();
  await resetRateLimits(app.redis);
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
async function signedIn(email: string, role: TestRole = 'STUDENT', name?: string): Promise<string> {
  await createAccount(email, role, name);
  return login(email);
}

function get(url: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/notifications${url}`,
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

/** Every non-GET must look same-origin or csrf.plugin.ts:20-30 rejects it first. */
function send(
  url: string,
  payload: unknown,
  cookie?: string,
  headers: Record<string, string> = originHeaders,
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/notifications${url}`,
    headers: { ...headers, ...(cookie ? { cookie: cookieHeader(cookie) } : {}) },
    payload: payload as Record<string, unknown>,
  });
}

interface SeedOptions {
  type?: NotificationTypeValue;
  title?: string;
  read?: boolean;
  /** Typed as Prisma's json input rather than `unknown` so the malformed-payload case needs no cast. */
  payload?: Prisma.InputJsonValue;
  /** Explicit so ordering assertions do not depend on two `now()` calls landing in different milliseconds. */
  createdAt?: Date;
}

/**
 * Notifications are written by other modules' side effects, not by any endpoint this
 * module exposes, so the fixture writes them directly — the same reason
 * courses.test.ts:342 seats an approved count by hand.
 */
async function seedNotification(userId: string, options: SeedOptions = {}): Promise<string> {
  const row = await prisma.notification.create({
    data: {
      userId,
      type: options.type ?? 'ENROLLMENT_APPROVED',
      payload: options.payload ?? {
        title: options.title ?? 'Enrollment approved',
        body: 'You have a place on Welding Fundamentals.',
      },
      linkPath: '/courses/welding-fundamentals',
      readAt: options.read === true ? new Date() : null,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
  });
  return row.id;
}

// --- tests -----------------------------------------------------------------

describe('the rule these routes rest on', () => {
  it('denies notification:read for someone else’s subject, which is why the rows are filtered', () => {
    const actor = {
      id: 'me',
      role: 'STUDENT',
      status: 'ACTIVE',
      provenance: 'PASSWORD',
    } as const;

    expect(can(actor, 'notification:read', { userId: 'me' })).toEqual({ allowed: true });
    // policy.ts:461-463 — isSelf for all three roles. The gate can only answer yes/no
    // for the caller's own subject, so `scopedWhere` is what stops the list serving
    // another user's rows; this assertion names the rule that makes that necessary.
    expect(can(actor, 'notification:read', { userId: 'someone-else' })).toMatchObject({
      allowed: false,
      rule: 'STUDENT:isSelf',
    });
  });
});

describe('GET /notifications/unread-count', () => {
  it('counts the caller’s unread rows and nobody else’s', async () => {
    const mineId = await createAccount('mine@example.com', 'STUDENT', 'Mine');
    const theirsId = await createAccount('theirs@example.com', 'STUDENT', 'Theirs');
    const cookie = await login('mine@example.com');

    await seedNotification(mineId);
    await seedNotification(mineId);
    await seedNotification(mineId, { read: true });
    await seedNotification(theirsId);
    await seedNotification(theirsId);

    const response = await get('/unread-count', cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ unread: 2 });
  });

  it('refuses an anonymous caller, naming the action that needed a session', async () => {
    const response = await get('/unread-count');
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
    expect(response.json().detail).toContain("'notification:read' requires authentication");
  });
});

describe('GET /notifications', () => {
  it('serves the caller their own rows in the shared envelope', async () => {
    const userId = await createAccount('shape@example.com', 'STUDENT');
    const cookie = await login('shape@example.com');
    await seedNotification(userId, { title: 'Enrollment approved' });

    const response = await get('', cookie);
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.meta).toMatchObject({ page: 1, total: 1, totalPages: 1, hasNext: false });

    const [item] = body.data;
    expect(item).toMatchObject({
      type: 'ENROLLMENT_APPROVED',
      linkPath: '/courses/welding-fundamentals',
      readAt: null,
    });
    expect(item.payload).toMatchObject({
      title: 'Enrollment approved',
      body: 'You have a place on Welding Fundamentals.',
    });
    expect(item.createdAt).toEqual(expect.any(String));
    // notification.ts:30-37 carries no `userId`: every row served is the caller's own,
    // so the id is not on the wire to be confused about.
    expect(item.userId).toBeUndefined();
  });

  it('does not leak another user’s notifications', async () => {
    const mineId = await createAccount('reader@example.com', 'STUDENT', 'Reader');
    const theirsId = await createAccount('other@example.com', 'TEACHER', 'Other');
    const cookie = await login('reader@example.com');

    await seedNotification(mineId, { title: 'Mine' });
    await seedNotification(theirsId, { title: 'Theirs' });
    await seedNotification(theirsId, { title: 'Also theirs' });

    const body = await get('', cookie).then((response) => response.json());
    expect(body.data.map((item: { payload: { title: string } }) => item.payload.title)).toEqual([
      'Mine',
    ]);
    // The count is scoped by the same WHERE, so the meta cannot advertise rows the
    // page is not allowed to contain.
    expect(body.meta.total).toBe(1);
  });

  it('does not leak another user’s rows to an admin either — the subject is the actor, not the role', async () => {
    const studentId = await createAccount('student@example.com', 'STUDENT');
    await createAccount('admin@example.com', 'ADMIN', 'Ada Admin');
    const admin = await login('admin@example.com');

    await seedNotification(studentId, { title: 'Not for the admin' });

    const body = await get('', admin).then((response) => response.json());
    // policy.ts:463 — ADMIN is `isSelf` here, not `allow`. An admin reads their own
    // bell like everyone else.
    expect(body.data).toHaveLength(0);
    expect(body.meta.total).toBe(0);
  });

  it('filters to the unread rows with unreadOnly=true', async () => {
    const userId = await createAccount('unread@example.com', 'STUDENT');
    const cookie = await login('unread@example.com');
    await seedNotification(userId, { title: 'Still unread' });
    await seedNotification(userId, { title: 'Already read', read: true });

    const body = await get('?unreadOnly=true', cookie).then((response) => response.json());
    expect(body.data).toHaveLength(1);
    expect(body.data[0].payload.title).toBe('Still unread');
  });

  it('filters by type', async () => {
    const userId = await createAccount('typed@example.com', 'STUDENT');
    const cookie = await login('typed@example.com');
    await seedNotification(userId, { type: 'MESSAGE_RECEIVED', title: 'A message' });
    await seedNotification(userId, { type: 'ENROLLMENT_APPROVED', title: 'A place' });

    const body = await get('?type=MESSAGE_RECEIVED', cookie).then((response) => response.json());
    expect(body.data).toHaveLength(1);
    expect(body.data[0].type).toBe('MESSAGE_RECEIVED');
  });

  it('rejects an unknown type with a field path rather than an empty page', async () => {
    const cookie = await signedIn('badtype@example.com');

    const response = await get('?type=NOT_A_TYPE', cookie);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  });

  it('falls back to the default order for an unrecognised sort instead of 422ing', async () => {
    const userId = await createAccount('sorter@example.com', 'STUDENT');
    const cookie = await login('sorter@example.com');
    await seedNotification(userId, { title: 'Older', createdAt: new Date('2026-01-01T00:00:00Z') });
    await seedNotification(userId, { title: 'Newer', createdAt: new Date('2026-02-01T00:00:00Z') });

    // `sort` is free-form text (pagination.ts:16). `userId` is a real column that is
    // deliberately NOT in the whitelist, so this proves the whitelist is consulted
    // rather than the string being interpolated into an orderBy key.
    const response = await get('?sort=userId', cookie);
    expect(response.statusCode).toBe(200);
    expect(
      response.json().data.map((item: { payload: { title: string } }) => item.payload.title),
    ).toEqual(['Newer', 'Older']);
  });

  it('pages with the shared meta block', async () => {
    const userId = await createAccount('pager@example.com', 'STUDENT');
    const cookie = await login('pager@example.com');
    for (const title of ['One', 'Two', 'Three']) await seedNotification(userId, { title });

    const response = await get('?limit=2&page=1', cookie);
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

  it('refuses an anonymous caller', async () => {
    const response = await get('');
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
  });

  it('refuses an unverified account through the central session gate, not a route check', async () => {
    // The account logs in, then loses ACTIVE. auth.plugin.ts:69-71 is what refuses the
    // next request; no route in this module re-checks the status (TRAP 5).
    await createAccount('pending@example.com', 'STUDENT');
    const cookie = await login('pending@example.com');
    await prisma.user.update({
      where: { email: 'pending@example.com' },
      data: { status: 'PENDING_VERIFICATION' },
    });

    const response = await get('', cookie);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('renders a payload that does not match the schema blank rather than 500ing the page', async () => {
    const userId = await createAccount('malformed@example.com', 'STUDENT');
    const cookie = await login('malformed@example.com');
    // A `Json` column guarantees nothing about its shape (schema.prisma:604), which is
    // the whole reason the mapper re-parses.
    await seedNotification(userId, { payload: { nope: true } });
    await seedNotification(userId, { title: 'Intact' });

    const response = await get('', cookie);
    expect(response.statusCode).toBe(200);

    const titles = response
      .json()
      .data.map((item: { payload: { title: string } }) => item.payload.title);
    expect(titles).toContain('Intact');
    expect(titles).toContain('');
  });
});

describe('POST /notifications/read', () => {
  it('marks everything read for a bodyless POST and returns the recomputed count', async () => {
    const userId = await createAccount('markall@example.com', 'STUDENT');
    const cookie = await login('markall@example.com');
    await seedNotification(userId);
    await seedNotification(userId);

    // No body at all: Fastify hands that to the validator as `null`, which is why the
    // body schema is `.nullish()` and not `.optional()`. With `.optional()` this
    // answers 422 before the policy preHandler runs.
    const response = await send('/read', undefined, cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ unread: 0 });

    const rows = await prisma.notification.findMany({ where: { userId } });
    expect(rows.every((row) => row.readAt !== null)).toBe(true);
  });

  it('marks only the ids it was given', async () => {
    const userId = await createAccount('someids@example.com', 'STUDENT');
    const cookie = await login('someids@example.com');
    const first = await seedNotification(userId);
    const second = await seedNotification(userId);

    const response = await send('/read', { ids: [first] }, cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ unread: 1 });

    const untouched = await prisma.notification.findUniqueOrThrow({ where: { id: second } });
    expect(untouched.readAt).toBeNull();
  });

  it('cannot mark another user’s notification read, even with its id in the body', async () => {
    const attackerId = await createAccount('attacker@example.com', 'STUDENT');
    const victimId = await createAccount('victim@example.com', 'STUDENT');
    const cookie = await login('attacker@example.com');
    const mine = await seedNotification(attackerId);
    const theirs = await seedNotification(victimId);

    const response = await send('/read', { ids: [mine, theirs] }, cookie);
    // `userId: actor.id` intersects the caller-supplied ids with the caller's own rows,
    // so the foreign id matches nothing. It is not an error: reporting it would confirm
    // that the id exists.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ unread: 0 });

    const victimRow = await prisma.notification.findUniqueOrThrow({ where: { id: theirs } });
    expect(victimRow.readAt).toBeNull();
  });

  it('unmarks with read:false', async () => {
    const userId = await createAccount('unmark@example.com', 'STUDENT');
    const cookie = await login('unmark@example.com');
    await seedNotification(userId, { read: true });
    await seedNotification(userId, { read: true });

    const response = await send('/read', { read: false }, cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ unread: 2 });
  });

  it('rejects an ids array longer than the schema allows', async () => {
    const userId = await createAccount('toomany@example.com', 'STUDENT');
    const cookie = await login('toomany@example.com');
    const id = await seedNotification(userId);

    const response = await send('/read', { ids: Array.from({ length: 201 }, () => id) }, cookie);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  });

  it('refuses a state change that is not same-origin', async () => {
    const cookie = await signedIn('csrf@example.com');

    const response = await send('/read', undefined, cookie, {});
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: csrf.sameOrigin');
  });

  it('refuses an anonymous caller, naming the action that needed a session', async () => {
    const response = await send('/read', undefined);
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
    expect(response.json().detail).toContain("'notification:update' requires authentication");
  });
});
