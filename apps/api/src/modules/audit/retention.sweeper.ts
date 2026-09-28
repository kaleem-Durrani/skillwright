import {
  pruneAuditEvents,
  sweepExpiredSessions,
  sweepExpiredVerifications,
  sweepSpentRecoveryCodes,
} from '@skillwright/db';
import type { AppInstance } from '../../app.js';
import { env } from '../../env.js';
import { baseLogger } from '../../lib/logger.js';
import { finaliseDueAccountDeletions } from '../users/users.lifecycle.service.js';

const log = baseLogger.child({ module: 'audit.retention' });

/**
 * The retention sweeper — Phase 7 — and the reason it lives in the audit module.
 *
 * The directory name is a convenience, not a taxonomy: three of the FIVE passes have
 * nothing to do with the audit trail. What they share is that all five are the same
 * shape of job (a timer, a threshold from `env.ts`, a statement, a log line), they belong
 * to the same phase, and Phase 7's other half — the append-only guarantee and the audit
 * pruner — is here. Splitting them across `auth/`, `users/` and `audit/` would give each
 * one its own timer and three more places for a retention policy to live, which is the
 * outcome lesson 20 warns about with an address: a setting written in more than one file
 * drifts, and nothing checks.
 *
 * The fifth pass, `finaliseDueAccountDeletions`, is the odd one out and is here for a
 * reason worth stating: it is a FEATURE rather than a table, and the request path already
 * finalised a due deletion, so it was missed when the three credential passes and the
 * pruner were written. It runs on this timer because the deadline a person was shown is
 * already enforced by `findLiveSession` — the account cannot be USED the instant the
 * cool-off passes, so an hour late costs disk and nothing observable.
 *
 * The sweeps themselves are in `packages/db/src/retention/sweepers.ts` rather than here,
 * because they are statements about rows and that package owns rows. This file is only
 * the decision about WHEN they run, which is why it is the one that reads `env.ts` and
 * why the sweep functions take their thresholds as required arguments.
 *
 * Every rule `uploads.sweeper.ts` established is inherited rather than re-decided: an
 * unref'd interval so it can never hold the process open, an `onClose` hook so
 * `app.close()` in main.ts's shutdown sequence is the whole teardown, no wall-clock
 * dependency in the logic so the tests can drive the passes directly, and a per-pass
 * catch so one table's failure cannot stop the other three.
 *
 * THE FIFTH PASS IS NOT A TABLE, and it runs here for a reason worth stating rather
 * than assuming: the account-deletion finaliser is a FEATURE, not a row reclaim, so
 * Phase 7 shipped four sweepers for the tables that grew without bound and this one was
 * missed because nothing about it looks like a table. It is here, on this timer, in
 * this process, for three reasons and against the two obvious alternatives:
 *
 *   Same PROCESS, because it is the same kind of job — a threshold from `env.ts`, a
 *   statement, a log line — and the directory this file lives in is a convenience
 *   rather than a taxonomy (see the header). A separate module for one pass would put
 *   a second "when does retention run" answer next to the first, which is the drift
 *   lesson 20 warns about with an address and lesson 34 generalises to every setting
 *   written in more than one place.
 *
 *   Same TIMER, and deliberately not its own interval. Two intervals means two knobs,
 *   two unref'd handles and two `onClose` hooks for one question, and a sweeper on a
 *   faster clock than it needs buys nothing here: the request path already guarantees
 *   the account cannot be USED the instant the cool-off passes, so an hour late costs
 *   disk and nothing a person can observe. The one argument that WOULD have forced a
 *   separate timer — "a deadline the user was shown should be honoured to the minute"
 *   — is answered by `findLiveSession`, not by this file, and it was answered before
 *   this pass existed.
 *
 *   Its own THRESHOLD anyway, for the per-run batch, because that is a genuinely
 *   different quantity from an interval: it bounds how much work one tick may do, not
 *   how often the tick happens.
 */
export async function runRetentionSweep(): Promise<void> {
  // Sequential, not concurrent, and the ordering is not arbitrary: the credential passes
  // are cheap and bounded, and running the unbounded one last means a pass that is
  // skipping because no window is set — the DEFAULT — never delays the rows that are
  // genuinely dead. Each returns a count rather than throwing, and each is guarded
  // individually: if `pruneAuditEvents` fails, expired sessions still get reclaimed on the
  // next tick instead of being held hostage to a table the timer does not otherwise own.
  //
  // The account-deletion pass sits before the pruner for the same reason the credential
  // passes do: it is bounded, it is the one pass a PERSON is waiting on, and it writes
  // audit rows. Running it first means a `DELETE` row it just wrote is never in the same
  // tick's prune candidate set — which the window would rule out anyway, so this is
  // belt-and-braces rather than a fix, and is said so rather than dressed up as one.
  const passes: ReadonlyArray<{ name: string; run: () => Promise<number> }> = [
    { name: 'sessions', run: () => sweepExpiredSessions() },
    { name: 'verifications', run: () => sweepExpiredVerifications() },
    {
      name: 'recovery-codes',
      run: () => sweepSpentRecoveryCodes({ retentionMs: env.SPENT_RECOVERY_CODE_SWEEP_MAX_AGE_MS }),
    },
    {
      name: 'account-deletions',
      run: () => finaliseDueAccountDeletions({ maxPerRun: env.ACCOUNT_DELETION_SWEEP_MAX_PER_RUN }),
    },
    { name: 'audit-events', run: () => pruneAuditEvents({ windowMs: auditWindowMs() }) },
  ];

  for (const pass of passes) {
    try {
      await pass.run();
    } catch (error) {
      // A background timer must never take the process down with it; a table that is
      // locked, missing or briefly unreachable is retried on the next tick.
      log.error({ err: error, pass: pass.name }, 'retention pass failed; will retry');
    }
  }
}

/**
 * The audit window, or null when nobody has decided one.
 *
 * `AUDIT_RETENTION_DAYS` is unset by default and stays unset unless an operator sets it
 * (env.ts carries the reasoning). The log line below is the point of this function: a
 * compliance record with no retention policy is a real state to be in, and the way to
 * make it visible is to say so out loud on every boot rather than leave it to be
 * discovered by looking at how many rows the table has. It logs at `info` and not `warn`
 * because it is not a fault — nobody has misconfigured anything — but it is the sort of
 * thing that is only noticed if it is written down somewhere, which is what the feature
 * plan's "do not invent a number" is really asking for.
 */
function auditWindowMs(): number | null {
  if (env.AUDIT_RETENTION_DAYS === null) return null;
  return env.AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Register the interval against a built app, and die with it.
 *
 * Called from app.ts when NOT under test, beside `startUploadSweeper` — `isTest` guards
 * both, because the suites drive these passes directly and a background timer racing
 * their assertions would make a passing test meaningless. The timer is unref'd so it can
 * never hold the process open by itself, and `app.close()` clears it.
 */
export function startRetentionSweeper(app: AppInstance): void {
  if (env.AUDIT_RETENTION_DAYS === null) {
    log.warn(
      'AUDIT_RETENTION_DAYS is unset: audit events are KEPT FOREVER. That is a deliberate ' +
        'default, not an oversight — the audit trail is the compliance record and how long ' +
        'it must be kept is a policy decision this repository has not made. Set the variable ' +
        'to enable pruning.',
    );
  }

  const timer = setInterval(() => {
    void runRetentionSweep().catch((error: unknown) => {
      log.error({ err: error }, 'scheduled retention sweep crashed');
    });
  }, env.RETENTION_SWEEP_INTERVAL_MS);
  timer.unref();

  app.addHook('onClose', async () => {
    clearInterval(timer);
    log.info('retention sweeper stopped');
  });

  log.info(
    { intervalMs: env.RETENTION_SWEEP_INTERVAL_MS, auditRetentionDays: env.AUDIT_RETENTION_DAYS },
    'retention sweeper started',
  );
}
