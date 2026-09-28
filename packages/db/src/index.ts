import { auditPrisma, basePrisma } from './client.js';
import { auditExtension } from './audit.js';

/**
 * The only client application code may use.
 *
 * Every mutation of an audited model that passes through this handle writes an AuditEvent,
 * because the interception lives here rather than in the services that call it.
 *
 * The extension writes through `auditPrisma`, a second pool. Handing it `basePrisma` makes
 * every interactive transaction hold one connection while asking for another from the same
 * pool, which deadlocks at concurrency — see the comment on `createAuditClient`.
 */
export const prisma = basePrisma.$extends(auditExtension(auditPrisma));

/** The extended client's type, for anything that needs to accept it as a parameter. */
export type Db = typeof prisma;

export { withAuditContext, getAuditContext, auditExtension, AUDITED_MODELS } from './audit.js';
export type { AuditContext } from './audit.js';

export { avatarUrlFor } from './avatar.js';

// Retention passes — Phase 7. The thresholds live in the API's env.ts, so this package
// never reads its own configuration and the window a deployment sweeps to is set in one
// place (packages/db/src/retention/sweepers.ts).
export {
  pruneAuditEvents,
  sweepExpiredSessions,
  sweepExpiredVerifications,
  sweepSpentRecoveryCodes,
  SPENT_RECOVERY_CODE_RETENTION_MS,
} from './retention/index.js';

export { logger as dbLogger } from './logger.js';

// The TOTP storage envelope. Exported so the seed and apps/api share ONE
// implementation instead of two that silently disagreed — see totp.ts.
export { encryptTotpSecret } from './totp.js';
export type { EncryptTotpSecretOptions } from './totp.js';

// Model types, enum objects, Prisma namespace and error classes. Consumers should never
// need to depend on @prisma/client directly — that is what keeps the generated client an
// implementation detail of this package.
export * from '@prisma/client';
