/**
 * Retention, as a barrel. `packages/db/src/index.ts` re-exports these, so the API
 * imports them from the package root like everything else it touches.
 *
 * `pruneAuditEvents` and `SPENT_RECOVERY_CODE_RETENTION_MS` are named exports because
 * the API's sweeper passes their values through from `env.ts`; the rest are called
 * without arguments. The module has no singleton state and no import side effects, so
 * importing it costs nothing at boot — which matters, because `index.ts` is on the path
 * of every process that loads the Prisma client, including the seed and `studio`.
 */
export {
  pruneAuditEvents,
  sweepExpiredSessions,
  sweepExpiredVerifications,
  sweepSpentRecoveryCodes,
  SPENT_RECOVERY_CODE_RETENTION_MS,
} from './sweepers.js';
