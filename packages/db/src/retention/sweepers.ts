/**
 * Retention. Phase 7 of docs/roadmap/10-FEATURE-PLAN.md, which opened with the finding
 * that this is the one defect nobody notices: "Nothing in this repository grows forever,
 * because nothing in it ever stops growing."
 *
 * Four passes, three of which reclaim a row the database itself already says is dead and
 * the fourth of which is the only one that has to be argued for. They live here rather
 * than in `apps/api/src/modules/*` because they are statements about rows and the
 * package that owns rows is this one; the API's job is only to decide WHEN they run
 * (`apps/api/src/modules/audit/retention.sweeper.ts`), which keeps the retention WINDOW
 * in `env.ts` and this file free of any knowledge of the process's configuration.
 *
 * The three credential passes share one rule, and it is the rule the upload sweeper's
 * header already states for uploads: a sweep may only select a row that something has
 * already declared worthless, and age alone must never do it. For `Session` and
 * `Verification` the declaration is written in the row (`expiresAt`), so the WHERE clause
 * below IS the safety argument. For `RecoveryCode` there is no such column, which is the
 * interesting case and is written at length on `sweepSpentRecoveryCodes`.
 *
 * None of these takes its threshold from the environment, deliberately. `uploads.sweeper.ts`
 * defaults `maxAgeMs` from `env` because the upload age is a tuning knob with a safe
 * default (a day, against a 15-minute signature). These are different: a wrong default
 * here destroys a credential, and the caller holding the configuration is the only thing
 * that knows the deployment's own policy. A required argument cannot be forgotten the
 * way a defaulted one can.
 */

import { basePrisma } from '../client.js';
import { logger } from '../logger.js';

/**
 * `basePrisma`, not the extended `prisma` from the package root.
 *
 * Two reasons, and the second is the one that bites. The index barrel re-exports this
 * module, so importing `prisma` from there is a cycle; and none of the four models below
 * is in `AUDITED_MODELS` (packages/db/src/audit.ts), so the extension's interceptors
 * return immediately for them and carrying the extension buys nothing. Taking the un-extended
 * client is the accurate description of what this code does.
 */
const db = basePrisma;

/**
 * How many audit rows one pass deletes.
 *
 * The three credential passes do not batch, and the difference is deliberate rather than
 * an oversight. `uploads.sweeper.ts` batches at twenty because each row costs a network
 * round trip to the object store; these are single statements, and the tables they touch
 * are bounded by construction — a `Session` cannot outlive its 30-day ceiling
 * (session.service.ts:9), and a `Verification` cannot outlive its ten-minute TTL
 * (verification.service.ts:7) — so a full delete is a statement over a table that stays
 * small no matter how long the process runs. `AuditEvent` is the opposite case and is the
 * only table here that genuinely grows without bound, which is why only it is chunked.
 */
const AUDIT_PRUNE_BATCH = 1_000;

/**
 * Sessions that can no longer authenticate anything.
 *
 * The predicate is `findLiveSession`'s, term for term: a row is
 * dead once EITHER clock has passed. Copying the read path's own test rather than
 * restating it is the structural half of lesson 28 — a comment asking the next person to
 * keep the two in step is a wish, and the failure it invites is a sweeper that keeps
 * deleting rows nobody uses, or an expired session that is never reclaimed.
 *
 * Reclaiming a lapsed session is a pure delete and touches no object store, so unlike the
 * upload sweeper it is idempotent on crash-retry by construction: a half-finished run
 * has either deleted the row or not, and "not" is simply the next run's work.
 *
 * Note what this does NOT do, because the alternative was tempting and wrong: it does
 * not delete sessions for a suspended or soft-deleted user. `findLiveSession` refuses
 * those too, so they would be safe to remove — but the admin suspension path already
 * destroys every session for that user in the same transaction as the status change
 * (`destroyAllSessions`), and soft deletion is another agent's Phase 6 work
 * (`User.deletedAt`). Adding the clause now would be a second, slower copy of a rule
 * that a first copy already implements.
 */
export async function sweepExpiredSessions(): Promise<number> {
  const now = new Date();
  const { count } = await db.session.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { absoluteExpiresAt: { lte: now } }] },
  });
  if (count > 0) logger.info('expired sessions swept', { swept: count });
  return count;
}

/**
 * Verification codes whose own expiry has passed.
 *
 * `expiresAt` is written by `issueAndSendCode` at ten minutes (verification.service.ts:61)
 * and is the ONLY thing that decides whether `consumeCode` will accept the row: its query
 * filters on `expiresAt: { gt: new Date() }` (verification.service.ts:79). A row past
 * that instant is already unreachable by the code that would spend it, so deleting it
 * cannot remove a working credential — that is the whole safety argument, and it is the
 * same argument `uploads.sweeper.ts` makes about `assertUploadClaimable`.
 *
 * A CONSUMED but not yet expired row is deliberately left alone rather than swept on
 * `consumedAt` as well. It is already dead — `consumeCode` filters on `consumedAt: null` —
 * so both clauses would be correct, but the expiry clause is the one that is total, and
 * adding the second would be a second way to spell "dead" that could drift from the
 * first. The cost of the simpler predicate is that a spent code's hash lives for at most
 * ten more minutes.
 */
export async function sweepExpiredVerifications(): Promise<number> {
  const { count } = await db.verification.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  if (count > 0) logger.info('expired verification codes swept', { swept: count });
  return count;
}

/**
 * How long a SPENT recovery code is kept before its hash is reclaimed.
 *
 * Thirty days, and the number is a RETENTION choice rather than a validity one, which is
 * the distinction the whole function turns on. See `sweepSpentRecoveryCodes`.
 */
export const SPENT_RECOVERY_CODE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Recovery codes that have been spent, and nothing else.
 *
 * This is the one row in the repository where AGE IS THE WRONG SELECTOR, and the reason
 * is worth stating plainly because a sweeper that reached for `createdAt` here would be
 * destroying live credentials:
 *
 * A recovery code is password-equivalent. schema.prisma's `RecoveryCode` header says so in a
 * comment and
 * the code is Argon2id-hashed for exactly that reason. `regenerateRecoveryCodes` shows it
 * to the user ONCE and never again (totp.service.ts:90-95), so the row is not a cache of
 * something retrievable — it is the ONLY copy of a credential that lets someone past TOTP
 * on a phone that has been lost. Deleting an unused code because it is thirty days old
 * would, for a user who enabled TOTP before taking a holiday, silently and permanently
 * remove one of their ten ways back into their own account, with no error and no record.
 * Age cannot be the test. There is no `expiresAt` on the model to make it one, and
 * inventing one would invent an expiry policy nobody asked for.
 *
 * So the sweep is driven by EVIDENCE OF SPENDING instead: `usedAt` is stamped by
 * `consumeRecoveryCode` the instant a code matches (totp.service.ts:114-117), and a code
 * with `usedAt` set can never authenticate anything again. The age on that row is no
 * longer deciding validity — it is deciding how long the spent code's ARGON2 HASH is kept
 * for forensics, and that is a retention window in the ordinary sense, defaulted to a
 * month because the evidence a spent recovery code holds is "this person signed in
 * without a phone", which the `AuditEvent` trail already records far better.
 *
 * `usedAt IS NOT NULL` is therefore load-bearing, and the negative-control test is named
 * for the fact that removing it takes live credentials with it.
 *
 * Unused codes do not accumulate either, which is why there is nothing else to do here:
 * there are at most `RECOVERY_CODE_COUNT` (10) per user at any moment, because
 * `regenerateRecoveryCodes` deletes the previous set in the same transaction that writes
 * the new one (totp.service.ts:96-99). This pass reclaims the spent ones that
 * regeneration does not.
 */
export async function sweepSpentRecoveryCodes(options?: { retentionMs?: number }): Promise<number> {
  const retentionMs = options?.retentionMs ?? SPENT_RECOVERY_CODE_RETENTION_MS;
  const cutoff = new Date(Date.now() - retentionMs);

  const { count } = await db.recoveryCode.deleteMany({
    where: { usedAt: { not: null, lte: cutoff } },
  });
  if (count > 0) logger.info('spent recovery codes swept', { swept: count });
  return count;
}

/**
 * The audit trail's own retention pass — and the reason this file is careful about the
 * difference between "we could not decide" and "there is nothing to do".
 *
 * `windowMs === null` means KEEP EVERYTHING, and it is the default. The plan is explicit
 * that the window is a policy question ("it is the compliance record, so its retention is
 * a policy question, not a technical one. Do not invent a number"), so no number is
 * invented here: the mechanism ships, the decision does not, and `null` is the shape that
 * says so rather than a `0` that reads like "delete everything" or a 365 that reads like
 * "a year is fine". A compliance record is never trimmed by a default, because the
 * failure is invisible right up until someone needs a row from four years ago, and by then
 * it is gone.
 *
 * WHEN A WINDOW IS SET, this is the one place in the repository that may delete an audit
 * row, and migration 0012 makes that a deliberate, declared act rather than something the
 * application's DELETE privilege happens to permit: the delete runs inside a transaction
 * that has set `skillwright.audit_prune`, which is the one condition the append-only
 * trigger will accept. Ordinary DML still cannot reach these rows.
 *
 * `set_config(..., true)` is the local form, and the third argument is the whole point: it
 * scopes the flag to THIS transaction. A session-level `SET` would satisfy the trigger
 * until the connection was closed, leaving every later statement on that pooled
 * connection able to delete the audit trail — measured directly, since the API's
 * connections come from a pool that is reused for the life of the process.
 *
 * The delete is chunked because this is the one table here with no upper bound (see
 * `AUDIT_PRUNE_BATCH`). It returns the rows removed so the caller can log them; the pass
 * is deliberately NOT audited, which is unavoidable and worth naming: the event being
 * removed is the audit trail, so there is nowhere left to record that it was pruned. The
 * count is the only trace, which is why it is logged rather than returned silently.
 */
export async function pruneAuditEvents(options?: {
  windowMs?: number | null;
  batchSize?: number;
}): Promise<number> {
  const windowMs = options?.windowMs ?? null;
  if (windowMs === null) return 0;

  const batchSize = options?.batchSize ?? AUDIT_PRUNE_BATCH;
  const cutoff = new Date(Date.now() - windowMs);

  const deleted = await db.$transaction(async (tx) => {
    // The declaration, before the statement it permits. See the header.
    await tx.$executeRaw`SELECT set_config('skillwright.audit_prune', 'on', true)`;
    return tx.$executeRaw`
      DELETE FROM "AuditEvent" WHERE id IN (
        SELECT id FROM "AuditEvent" WHERE "createdAt" < ${cutoff}
        ORDER BY "createdAt" ASC LIMIT ${batchSize}
      )
    `;
  });

  if (deleted > 0) logger.info('audit events pruned', { pruned: deleted, windowMs });
  return deleted;
}
