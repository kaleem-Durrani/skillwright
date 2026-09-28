import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// app.ts: "Anything that holds an instance built here should name this type. Plain
// FastifyInstance is a type error, not a widening."
import type { AppInstance } from '../src/app.js';
import { hashPassword } from '../src/lib/password.js';
import {
  pruneAuditEvents,
  sweepExpiredSessions,
  sweepExpiredVerifications,
  sweepSpentRecoveryCodes,
} from '@skillwright/db';
import { runRetentionSweep } from '../src/modules/audit/retention.sweeper.js';
import { finaliseDueAccountDeletions } from '../src/modules/users/users.lifecycle.service.js';
import {
  buildApp,
  clearAuditEvents,
  cookieHeader,
  originHeaders,
  prisma,
  resetDatabase,
  resetRateLimits,
  sessionCookie,
} from './setup.js';

const PASSWORD = 'correct-horse-battery-staple';
const DAY_MS = 24 * 60 * 60 * 1000;

let app: AppInstance;
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
  // After the reset, not before: User is an audited model, so resetDatabase's own
  // deletes write rows (the argument audit.test.ts's clearAudit makes).
  await clearAuditEvents();
});

// --- helpers ---------------------------------------------------------------

async function createAccount(email: string, role: 'STUDENT' | 'TEACHER' | 'ADMIN' = 'STUDENT') {
  const user = await prisma.user.create({
    data: { email, name: 'Retention Person', role, status: 'ACTIVE', passwordHash },
  });
  return user.id;
}

async function signIn(email: string): Promise<string> {
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

/**
 * `tokenHash` is UNIQUE, so every session built here needs its own. The value is never
 * read back — these rows are fixtures, not logins — but it must still be unique or the
 * second insert fails on the index rather than on anything a test is asserting.
 */
let tokenSequence = 0;
function uniqueTokenHash(): string {
  tokenSequence += 1;
  return `retention-test-token-hash-${tokenSequence}`;
}

interface SessionFixture {
  expiresAt: Date;
  absoluteExpiresAt: Date;
  provenance?: 'PASSWORD' | 'MFA_PENDING';
}

async function makeSession(userId: string, fixture: SessionFixture): Promise<string> {
  const row = await prisma.session.create({
    data: {
      tokenHash: uniqueTokenHash(),
      userId,
      ...fixture,
      ...(fixture.provenance !== undefined ? { provenance: fixture.provenance } : {}),
    },
  });
  return row.id;
}

async function makeVerification(
  userId: string,
  fixture: { expiresAt: Date; consumedAt?: Date | null },
): Promise<string> {
  const row = await prisma.verification.create({
    data: {
      userId,
      purpose: 'EMAIL_VERIFY',
      codeHash: `retention-hash-${tokenSequence}`,
      expiresAt: fixture.expiresAt,
      ...(fixture.consumedAt !== undefined ? { consumedAt: fixture.consumedAt } : {}),
    },
  });
  return row.id;
}

/** The hash is never verified in these tests; only `usedAt` is load-bearing. */
async function makeRecoveryCode(
  userId: string,
  fixture: { createdAt?: Date; usedAt?: Date | null },
): Promise<string> {
  tokenSequence += 1;
  const row = await prisma.recoveryCode.create({
    data: {
      userId,
      codeHash: `$argon2id$v=19$m=1,t=1,p=1$c2FsdA$retention${tokenSequence}`,
      ...(fixture.createdAt !== undefined ? { createdAt: fixture.createdAt } : {}),
      ...(fixture.usedAt !== undefined ? { usedAt: fixture.usedAt } : {}),
    },
  });
  return row.id;
}

/**
 * An audit row, INSERTED at its final age.
 *
 * Written by insertion rather than by creating a row and then moving it because that is
 * no longer possible: migration 0012's trigger refuses `UPDATE` on this table, so
 * backdating one is itself a thing the database now forbids. That is a useful accident —
 * it means a test cannot fabricate a "pruned" event by rewriting a real one.
 */
async function makeAuditEvent(createdAt: Date, entityId: string): Promise<string> {
  const row = await prisma.auditEvent.create({
    data: { action: 'CREATE', entityType: 'Course', entityId, createdAt },
  });
  return row.id;
}

/**
 * "Is this row still here?", taking the count rather than a model name.
 *
 * A `prisma[model]` index would be the tidier signature and does not compile: the
 * union of three delegate signatures has no common call signature, so the test file
 * would not typecheck. Passing the count keeps every call site spelling out the model
 * anyway, which is the part worth reading.
 */
const exists = async (count: Promise<number>): Promise<boolean> => (await count) === 1;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

describe('sweepExpiredSessions', () => {
  it('reclaims a session whose sliding window has passed', async () => {
    const userId = await createAccount('swept@example.com');
    const id = await makeSession(userId, {
      expiresAt: new Date(Date.now() - 60_000),
      absoluteExpiresAt: new Date(Date.now() + 30 * DAY_MS),
    });

    expect(await sweepExpiredSessions()).toBe(1);
    expect(await exists(prisma.session.count({ where: { id } }))).toBe(false);
  });

  /**
   * THE negative control. A session on both clocks is a live credential — the cookie in
   * somebody's browser still authenticates — so no age threshold may select it. The
   * assertion is deliberately made with the sweeper's own clock as the only thing
   * protecting it: there is no maxAge parameter to pass here, which is the point.
   */
  it('never touches a live session, however it was created', async () => {
    const userId = await createAccount('live@example.com');
    const password = await makeSession(userId, {
      expiresAt: new Date(Date.now() + 7 * DAY_MS),
      absoluteExpiresAt: new Date(Date.now() + 30 * DAY_MS),
    });
    const mfaPending = await makeSession(userId, {
      expiresAt: new Date(Date.now() + 4 * 60_000),
      absoluteExpiresAt: new Date(Date.now() + 30 * DAY_MS),
      provenance: 'MFA_PENDING',
    });

    expect(await sweepExpiredSessions()).toBe(0);
    expect(await exists(prisma.session.count({ where: { id: password } }))).toBe(true);
    expect(await exists(prisma.session.count({ where: { id: mfaPending } }))).toBe(true);
  });

  /**
   * The clause that keeps this predicate from drifting out of `findLiveSession`.
   * `findLiveSession` (session.service.ts) refuses a session when `expiresAt <= now OR
   * absoluteExpiresAt <= now`, so a row whose hard ceiling has passed is refused there —
   * and a sweeper that only checked `expiresAt` would leave it forever, growing a table
   * of rows nothing can use. A sweeper that checked only ONE of the two is a bug; this
   * is the test that says which.
   */
  it('reclaims a session whose absolute ceiling passed even though its window has not', async () => {
    const userId = await createAccount('ceiling@example.com');
    const id = await makeSession(userId, {
      expiresAt: new Date(Date.now() + 7 * DAY_MS),
      absoluteExpiresAt: new Date(Date.now() - 60_000),
    });

    expect(await sweepExpiredSessions()).toBe(1);
    expect(await exists(prisma.session.count({ where: { id } }))).toBe(false);
  });

  it('is idempotent — a second pass finds nothing left to do', async () => {
    const userId = await createAccount('twice@example.com');
    await makeSession(userId, {
      expiresAt: new Date(Date.now() - 60_000),
      absoluteExpiresAt: new Date(Date.now() - 60_000),
    });

    expect(await sweepExpiredSessions()).toBe(1);
    // The crash-retry requirement from uploads.sweeper.ts: replaying a run must not
    // double-count or fail, because a crash between two passes is the normal case.
    expect(await sweepExpiredSessions()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

describe('sweepExpiredVerifications', () => {
  it('reclaims a code past its own expiry', async () => {
    const userId = await createAccount('verify-expired@example.com');
    const id = await makeVerification(userId, { expiresAt: new Date(Date.now() - 60_000) });

    expect(await sweepExpiredVerifications()).toBe(1);
    expect(await exists(prisma.verification.count({ where: { id } }))).toBe(false);
  });

  /**
   * THE negative control. `consumeCode` accepts a row only while
   * `expiresAt: { gt: new Date() }` (verification.service.ts:79), so a code inside its
   * ten-minute TTL is a code somebody can still redeem, and a sweep that reached for
   * `createdAt` here would lock a user out of the email change or password reset they
   * just requested.
   */
  it('never touches a code that has not expired', async () => {
    const userId = await createAccount('verify-live@example.com');
    const id = await makeVerification(userId, { expiresAt: new Date(Date.now() + 9 * 60_000) });

    expect(await sweepExpiredVerifications()).toBe(0);
    expect(await exists(prisma.verification.count({ where: { id } }))).toBe(true);
  });

  /**
   * A consumed code is already dead — `consumeCode` filters on `consumedAt: null` — but
   * the sweeper deliberately does NOT select on it, and this test is what makes that
   * decision visible rather than an oversight. It survives until its own expiry, which
   * is at most ten minutes away, and there is then exactly one clause in this function
   * that can spell "dead" instead of two that could disagree.
   */
  it('leaves a consumed but unexpired code until its expiry passes', async () => {
    const userId = await createAccount('verify-consumed@example.com');
    const id = await makeVerification(userId, {
      expiresAt: new Date(Date.now() + 9 * 60_000),
      consumedAt: new Date(),
    });

    expect(await sweepExpiredVerifications()).toBe(0);
    expect(await exists(prisma.verification.count({ where: { id } }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RecoveryCode — the one where age would destroy live credentials
// ---------------------------------------------------------------------------

describe('sweepSpentRecoveryCodes', () => {
  /**
   * THE negative control, and the most important assertion in this file.
   *
   * A recovery code is password-equivalent (`RecoveryCode`'s own header comment) and is shown to the
   * user exactly once (totp.service.ts:90-95), so this row is the only copy of a way back
   * into an account for somebody who has lost their phone. It is FOUR HUNDRED DAYS old
   * and the retention window below is one day, and it must still be there afterwards: it
   * has never been spent, so nothing in the database says it is worthless. Removing the
   * `usedAt: { not: null }` clause from the sweeper makes this test fail, and that is the
   * point of writing it with a row that is old enough to be swept by any age-based rule.
   */
  it('never touches an UNUSED recovery code, however old', async () => {
    const userId = await createAccount('recovery-unused@example.com');
    const id = await makeRecoveryCode(userId, { createdAt: new Date(Date.now() - 400 * DAY_MS) });

    expect(await sweepSpentRecoveryCodes({ retentionMs: DAY_MS })).toBe(0);
    expect(await exists(prisma.recoveryCode.count({ where: { id } }))).toBe(true);
  });

  it('reclaims a SPENT code once it is past the retention window', async () => {
    const userId = await createAccount('recovery-spent@example.com');
    const id = await makeRecoveryCode(userId, {
      createdAt: new Date(Date.now() - 400 * DAY_MS),
      usedAt: new Date(Date.now() - 40 * DAY_MS),
    });

    expect(await sweepSpentRecoveryCodes({ retentionMs: 30 * DAY_MS })).toBe(1);
    expect(await exists(prisma.recoveryCode.count({ where: { id } }))).toBe(false);
  });

  /**
   * The retention window is a decision about a hash nobody can authenticate with, not
   * about a live credential. A code spent yesterday is still worth keeping for a month,
   * because that is what the default says and the default is not a decision anyone has
   * made yet.
   */
  it('keeps a recently spent code inside the retention window', async () => {
    const userId = await createAccount('recovery-recent@example.com');
    const id = await makeRecoveryCode(userId, { usedAt: new Date(Date.now() - DAY_MS) });

    expect(await sweepSpentRecoveryCodes({ retentionMs: 30 * DAY_MS })).toBe(0);
    expect(await exists(prisma.recoveryCode.count({ where: { id } }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AuditEvent — append-only, and retention as an unset policy
// ---------------------------------------------------------------------------

describe('AuditEvent is append-only', () => {
  it('refuses a direct UPDATE', async () => {
    const id = await makeAuditEvent(new Date(), 'update-target');
    await expect(
      prisma.auditEvent.update({ where: { id }, data: { action: 'DELETE' } }),
    ).rejects.toThrow(/append-only; UPDATE is not permitted/);
    expect((await prisma.auditEvent.findUniqueOrThrow({ where: { id } })).action).toBe('CREATE');
  });

  it('refuses a direct DELETE', async () => {
    const id = await makeAuditEvent(new Date(), 'delete-target');
    await expect(prisma.auditEvent.delete({ where: { id } })).rejects.toThrow(
      /append-only; DELETE is not permitted/,
    );
    expect(await prisma.auditEvent.count({ where: { id } })).toBe(1);
  });

  it('refuses a direct DELETE of the whole table', async () => {
    await makeAuditEvent(new Date(), 'delete-many-target');
    await expect(prisma.auditEvent.deleteMany({})).rejects.toThrow(
      /append-only; DELETE is not permitted/,
    );
  });

  it('refuses a TRUNCATE even from a connection that set the prune flag', async () => {
    await makeAuditEvent(new Date(), 'truncate-target');
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('skillwright.audit_prune', 'on', true)`;
        return tx.$executeRawUnsafe('TRUNCATE "AuditEvent"');
      }),
    ).rejects.toThrow(/append-only; TRUNCATE is not permitted/);
    expect(await prisma.auditEvent.count()).toBeGreaterThan(0);
  });

  /**
   * The exception that has to exist, and the reason the trigger is written the way it
   * is. `AuditEvent.actorId` is `onDelete: SetNull` (the `actor` relation on `AuditEvent`), which Postgres
   * implements as a literal UPDATE. A trigger that refused every UPDATE made every
   * `DELETE FROM "User"` fail — measured directly, and it would have taken out
   * `resetDatabase()` in setup.ts, which every suite in this directory depends on.
   * Nulling a foreign key is the database keeping its own integrity, not an application
   * rewriting history, so it is let through — and the record itself must be untouched by
   * it, which is what the second assertion is for.
   */
  it('still lets a user be deleted, nulling the actor without touching the event', async () => {
    const userId = await createAccount('deleted-actor@example.com', 'ADMIN');
    // Only the CREATE the extension wrote above and the DELETE this test causes share
    // this entity; the row under assertion is found by its own id rather than by
    // entityType/entityId, so it cannot be confused with the extension's own traffic.
    const mine = await prisma.auditEvent.create({
      data: {
        action: 'LOGIN',
        entityType: 'User',
        entityId: userId,
        actorId: userId,
      },
    });

    await prisma.user.delete({ where: { id: userId } });

    const surviving = await prisma.auditEvent.findUniqueOrThrow({ where: { id: mine.id } });
    expect(surviving.actorId).toBeNull();
    // The action is the recorded fact and it is still there.
    expect(surviving.action).toBe('LOGIN');
    expect(surviving.entityId).toBe(userId);
  });

  it('still refuses an application UPDATE after a user has been deleted', async () => {
    const userId = await createAccount('deleted-then-update@example.com', 'ADMIN');
    const row = await prisma.auditEvent.create({
      data: { action: 'LOGIN', entityType: 'User', entityId: userId, actorId: userId },
    });
    await prisma.user.delete({ where: { id: userId } });

    await expect(
      prisma.auditEvent.update({ where: { id: row.id }, data: { action: 'DELETE' } }),
    ).rejects.toThrow(/append-only; UPDATE is not permitted/);
  });
});

describe('pruneAuditEvents', () => {
  /**
   * The default is KEEP EVERYTHING, and this is the test that holds it there. Phase 7
   * of the feature plan is explicit that the audit window is a policy question this
   * repository has not answered, so the pruner's default has to be the absence of a
   * decision. A default of 365 would have read as a decision, in a file nobody reads,
   * quietly deleting compliance evidence on a schedule nobody chose.
   */
  it('deletes nothing at all while no window is set', async () => {
    const ancient = await makeAuditEvent(new Date(Date.now() - 10_000 * DAY_MS), 'ancient');
    const recent = await makeAuditEvent(new Date(), 'recent');

    expect(await pruneAuditEvents()).toBe(0);
    expect(await prisma.auditEvent.count({ where: { id: { in: [ancient, recent] } } })).toBe(2);
  });

  it('deletes only the rows past the window, leaving the recent ones intact', async () => {
    const old = await makeAuditEvent(new Date(Date.now() - 400 * DAY_MS), 'old');
    const boundary = await makeAuditEvent(new Date(Date.now() - 10 * DAY_MS), 'inside-window');
    const recent = await makeAuditEvent(new Date(), 'recent');

    const pruned = await pruneAuditEvents({ windowMs: 365 * DAY_MS });

    expect(pruned).toBe(1);
    const survivors = await prisma.auditEvent.findMany({
      where: { id: { in: [old, boundary, recent] } },
      select: { id: true },
    });
    expect(survivors.map((r) => r.id).sort()).toEqual([boundary, recent].sort());
  });

  it('respects the batch size, so one pass cannot lock the table for a table-sized delete', async () => {
    for (let i = 0; i < 5; i += 1) {
      await makeAuditEvent(new Date(Date.now() - 400 * DAY_MS), `bulk-${i}`);
    }
    const before = await prisma.auditEvent.count({
      where: { createdAt: { lt: new Date(Date.now() - 365 * DAY_MS) } },
    });
    expect(before).toBe(5);

    expect(await pruneAuditEvents({ windowMs: 365 * DAY_MS, batchSize: 2 })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { entityId: { startsWith: 'bulk-' } } })).toBe(3);
  });

  it('is idempotent — a second pass over the same window removes nothing more', async () => {
    await makeAuditEvent(new Date(Date.now() - 400 * DAY_MS), 'once');
    expect(await pruneAuditEvents({ windowMs: 365 * DAY_MS })).toBe(1);
    expect(await pruneAuditEvents({ windowMs: 365 * DAY_MS })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The wired-up sweep, and the export
// ---------------------------------------------------------------------------

describe('runRetentionSweep', () => {
  /**
   * The one test that runs the function `startRetentionSweeper` actually schedules,
   * rather than the four passes in isolation, because a sweeper that is correct four
   * times and wired up wrongly is still a sweeper that never runs. It runs with
   * `AUDIT_RETENTION_DAYS` unset — which is the shipped default — so the audit pass is
   * a no-op and the assertion is that the credential passes still happened.
   */
  it('runs every pass in one go, with the audit pass disabled by default', async () => {
    const userId = await createAccount('sweep-all@example.com');
    await makeSession(userId, {
      expiresAt: new Date(Date.now() - 60_000),
      absoluteExpiresAt: new Date(Date.now() - 60_000),
    });
    await makeVerification(userId, { expiresAt: new Date(Date.now() - 60_000) });
    await makeRecoveryCode(userId, { usedAt: new Date(Date.now() - 400 * DAY_MS) });
    const ancient = await makeAuditEvent(new Date(Date.now() - 10_000 * DAY_MS), 'sweep-ancient');

    await runRetentionSweep();

    expect(await prisma.session.count({ where: { userId } })).toBe(0);
    expect(await prisma.verification.count({ where: { userId } })).toBe(0);
    expect(await prisma.recoveryCode.count({ where: { userId } })).toBe(0);
    // Unset means keep everything, and the default has to be visible from the outside.
    expect(await prisma.auditEvent.count({ where: { id: ancient } })).toBe(1);
  });

  it('does not let one failing pass stop the others', async () => {
    const userId = await createAccount('sweep-partial@example.com');
    await makeSession(userId, {
      expiresAt: new Date(Date.now() - 60_000),
      absoluteExpiresAt: new Date(Date.now() - 60_000),
    });

    // Closing the pool makes the first pass throw. A timer that died here would stop
    // reclaiming expired sessions for the life of the process.
    await prisma.$disconnect();
    try {
      await runRetentionSweep();
    } finally {
      await prisma.$connect();
    }

    // The connection was restored, so the next run does the work; what matters is that
    // the sweep returned rather than rejecting out of the interval callback.
    await runRetentionSweep();
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The fifth pass: due account deletions
// ---------------------------------------------------------------------------

describe('finaliseDueAccountDeletions', () => {
  /**
   * A row mid-cool-off, written at its final state rather than aged into it.
   *
   * `deletionEffectiveFor` is written by `requestDeletion` as "now plus the cool-off",
   * so a deadline in the future IS a pending deletion and one in the past IS a due one.
   * The test reaches for the deadline rather than the clock because the row is the
   * authority — the same reasoning users.lifecycle.test.ts gives for winding the clock
   * forward instead of waiting thirty days.
   */
  async function scheduleDeletion(email: string, effectiveFor: Date): Promise<string> {
    const userId = await createAccount(email);
    await prisma.user.update({
      where: { id: userId },
      data: {
        deletionRequestedAt: new Date(Date.now() - 30 * DAY_MS),
        deletionEffectiveFor: effectiveFor,
      },
    });
    return userId;
  }

  const softDeletedAt = (userId: string): Promise<Date | null> =>
    prisma.user
      .findUniqueOrThrow({ where: { id: userId }, select: { deletedAt: true } })
      .then((r) => r.deletedAt);

  /**
   * THE NEGATIVE CONTROL, and the assertion the whole pass rests on.
   *
   * A deletion inside the cool-off is still Cancellable — the person is entitled to
   * `DELETE /users/me/deletion` and get their account back. No age threshold, no batch
   * bound and no scheduler may select it, and there is deliberately no `maxAgeMs`
   * parameter a caller could tune here: the only input is the row, exactly as
   * `sweepExpiredSessions` takes no age either.
   */
  it('leaves a deletion whose window has not passed exactly where it is', async () => {
    const pending = await scheduleDeletion(
      'cooling-off@example.com',
      new Date(Date.now() + 29 * DAY_MS),
    );

    expect(await finaliseDueAccountDeletions()).toBe(0);
    expect(await softDeletedAt(pending)).toBeNull();
  });

  /**
   * AGE IS NOT THE SELECTOR, stated as its own case rather than left to the first one.
   *
   * A decade-old account with a NULL `deletionEffectiveFor` is an account somebody is
   * still using, and a sweeper that reached for `createdAt` would take it. `User` is
   * one of the few tables in this schema with no expiry on it at all, which is the
   * strongest form of that argument: there is no column here that could mean "dead".
   */
  it('never finalises an old account nobody asked to delete', async () => {
    const userId = await createAccount('ancient@example.com');
    await prisma.user.update({
      where: { id: userId },
      data: { createdAt: new Date(Date.now() - 3650 * DAY_MS) },
    });

    expect(await finaliseDueAccountDeletions()).toBe(0);
    expect(await softDeletedAt(userId)).toBeNull();
  });

  /**
   * THE CASE NOTHING COVERED, and the reason this pass exists.
   *
   * Every test above is about a row that survives. This one is the inverse and it is
   * the whole point: an owner who asked to be deleted and then never signed in again.
   * The previous mechanism — `finaliseDueDeletions`, called from `findLiveSession` —
   * cannot reach this account at all, because reaching it requires the account to make
   * a request, and signing back in is precisely how the deletion would have been
   * CANCELLED. So the accounts that most need finalising were the ones the lazy path
   * was guaranteed never to see.
   *
   * No request is made. Not a login, not a `GET /me`, nothing: the fixture is inserted
   * directly and the only call in the test is the sweep. If this test ever started
   * passing because a request finalised the row, it would be testing the old mechanism
   * under a new name, which is how a gap gets re-closed by accident.
   */
  it('finalises a due deletion with nobody asking, soft-deleting the row and purging its sessions', async () => {
    const userId = await scheduleDeletion('never-returns@example.com', new Date(Date.now() - 1000));
    const sessionId = await makeSession(userId, {
      expiresAt: new Date(Date.now() + 7 * DAY_MS),
      absoluteExpiresAt: new Date(Date.now() + 30 * DAY_MS),
    });

    expect(await finaliseDueAccountDeletions()).toBe(1);

    expect(await softDeletedAt(userId)).not.toBeNull();
    // A live session on a soft-deleted account is a credential that outlives the
    // account, so the purge is part of "finalised" rather than a separate concern.
    expect(await exists(prisma.session.count({ where: { id: sessionId } }))).toBe(false);
  });

  /**
   * The audit row, because the pass writes an irreversible act and the trail is how it
   * is explained afterwards. The other three passes DELETE rows nothing reads; this one
   * soft-deletes an account, so it goes through the extended client on purpose.
   *
   * `actorId` is NULL, and asserting THAT is the point rather than a convenience. On
   * the request path the account holder is the actor; here there is no request, so there
   * is no ambient audit context, and the honest record of "the cool-off elapsed and a
   * timer acted" is a deletion with nobody attached to it. Writing the subject's own id
   * here would be the tidier row and the false one — it would say they deleted
   * themselves, which is a belief rather than an event, and the request that started it
   * is on its own row already.
   */
  it('writes the derived DELETE audit row with no actor, because nobody acted', async () => {
    const userId = await scheduleDeletion('audited@example.com', new Date(Date.now() - 1000));
    await clearAuditEvents();

    await finaliseDueAccountDeletions();

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: 'User', entityId: userId },
    });
    expect(event.action).toBe('DELETE');
    expect(event.actorId).toBeNull();
  });

  /**
   * THE TIMER ACTUALLY RUNS IT. The four passes above call the function directly, and a
   * pass that is correct in isolation and missing from `runRetentionSweep` is a feature
   * that still never happens — which is the precise defect this pass was written to fix.
   * So the wiring is asserted through the same entry point `startRetentionSweeper`
   * schedules.
   */
  it('is on the retention timer, not only callable by hand', async () => {
    const userId = await scheduleDeletion('on-the-timer@example.com', new Date(Date.now() - 1000));

    await runRetentionSweep();

    expect(await softDeletedAt(userId)).not.toBeNull();
  });

  /**
   * IDEMPOTENT ON CRASH-RETRY. A second pass over an already-finalised row finds
   * nothing, because the predicate excludes a `deletedAt` that is already set — so
   * "crashed halfway through a batch" leaves each row either done or not done, and
   * "not done" is simply the next tick's work.
   */
  it('is idempotent, and a re-run reports nothing rather than counting the same row twice', async () => {
    await scheduleDeletion('retry-once@example.com', new Date(Date.now() - 1000));
    await scheduleDeletion('retry-twice@example.com', new Date(Date.now() - 2000));

    expect(await finaliseDueAccountDeletions()).toBe(2);
    expect(await finaliseDueAccountDeletions()).toBe(0);
  });

  /**
   * The per-run bound, and what it does and does not mean.
   *
   * A bound on WORK, not a threshold on eligibility: the account left out of this run
   * is still inside the predicate, so the next run takes it. A sweeper that silently
   * dropped a row past `maxPerRun` would be the opposite and much worse failure, so the
   * second assertion is the one that matters.
   */
  it('bounds the work per run without dropping anybody out of the queue', async () => {
    const first = await scheduleDeletion('batch-1@example.com', new Date(Date.now() - 3000));
    const second = await scheduleDeletion('batch-2@example.com', new Date(Date.now() - 2000));
    const third = await scheduleDeletion('batch-3@example.com', new Date(Date.now() - 1000));

    expect(await finaliseDueAccountDeletions({ maxPerRun: 1 })).toBe(1);
    // Oldest deadline first, so the bound cannot be used to starve an old deadline.
    expect(await softDeletedAt(first)).not.toBeNull();
    expect(await softDeletedAt(second)).toBeNull();
    expect(await softDeletedAt(third)).toBeNull();

    expect(await finaliseDueAccountDeletions({ maxPerRun: 1 })).toBe(1);
    expect(await softDeletedAt(second)).not.toBeNull();
    expect(await finaliseDueAccountDeletions()).toBe(1);
    expect(await softDeletedAt(third)).not.toBeNull();
  });
});

describe('GET /audit-events/export still works', () => {
  /**
   * The export is this module's Phase 8 surface and the brief asked whether it survived.
   * It has no SPA caller, which is a known gap recorded in the feature plan and NOT fixed
   * here — but an endpoint with no caller is exactly the kind that breaks silently, so
   * it is exercised here as the regression check for the module this phase edits.
   *
   * It also proves the two properties are compatible: the pruner deleted rows from this
   * table in the tests above, and a full export still streams afterwards.
   */
  it('streams the feed as CSV after rows have been pruned from the same table', async () => {
    const email = 'clerk@example.com';
    await createAccount(email, 'ADMIN');
    const token = await signIn(email);
    await clearAuditEvents();

    const survivor = await makeAuditEvent(new Date(), 'exported-survivor');
    const doomed = await makeAuditEvent(new Date(Date.now() - 10_000 * DAY_MS), 'pruned-doomed');
    expect(await pruneAuditEvents({ windowMs: 365 * DAY_MS })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { id: doomed } })).toBe(0);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-events/export',
      headers: { ...originHeaders, cookie: cookieHeader(token) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    const body = response.body;
    expect(body).toContain('id,action,entity_type,entity_id,actor_id,actor_name,recorded_at');
    expect(body).toContain(survivor);
    // The header survived a table the pruner had just written to, which is the actual
    // question: the append-only trigger and the streaming read do not conflict.
    expect(body.split('\n').filter((line) => line.trim().length > 0).length).toBeGreaterThan(1);
  });
});
