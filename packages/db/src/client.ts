import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * `tsx --watch` and Vite's SSR HMR re-evaluate this module on every save. Without the
 * globalThis cache each reload constructs a fresh PrismaClient, each of which opens its
 * own connection pool, and Postgres runs out of connections after a few dozen edits.
 * The cache is deliberately not applied in production, where the module is evaluated once
 * and a stray global would only obscure the lifetime.
 */
function createBaseClient() {
  const client = new PrismaClient({
    // Always emit as events; the level filter lives in the handlers below so that turning
    // query logging on and off never changes the client's type.
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
    errorFormat: isProduction ? 'minimal' : 'pretty',
  });

  client.$on('query', (e) => {
    if (isProduction) return;
    logger.debug('prisma.query', { durationMs: e.duration, query: e.query, params: e.params });
  });
  client.$on('warn', (e) => logger.warn('prisma.warn', { target: e.target, detail: e.message }));
  client.$on('error', (e) => logger.error('prisma.error', { target: e.target, detail: e.message }));

  return client;
}

/**
 * A SECOND pool, reserved for the audit extension.
 *
 * The extension reads a before-image and writes its AuditEvent outside any enclosing
 * interactive transaction, deliberately (see audit.ts). An interactive transaction holds
 * its connection for the whole callback, so on ONE pool each in-flight transaction holds
 * a connection and then asks for another — and once concurrency reaches the pool size
 * every transaction is waiting for a connection only another transaction can release.
 * That is a deadlock, not slowness: it resolves as P2024 `Timed out fetching a new
 * connection`, and it took out 12 of 30 seats in the 200-concurrent-approval test that
 * ADR 0006 stakes the no-oversell claim on.
 *
 * Audit work never waits on a transaction, so a dedicated pool always drains and progress
 * is guaranteed. Keep it small: it bounds concurrent audit writes, not request throughput.
 */
function auditDatasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (raw === undefined || raw === '') return undefined;
  try {
    const url = new URL(raw);
    url.searchParams.set('connection_limit', process.env.AUDIT_CONNECTION_LIMIT ?? '10');
    url.searchParams.set('pool_timeout', '20');
    return url.toString();
  } catch {
    // A malformed URL is env.ts's problem to report, not this module's to crash on.
    return undefined;
  }
}

function createAuditClient() {
  const url = auditDatasourceUrl();
  return new PrismaClient({
    ...(url === undefined ? {} : { datasourceUrl: url }),
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
    errorFormat: isProduction ? 'minimal' : 'pretty',
  });
}

/** Declared after the factory so the client's log-event typing survives inference. */
const globalForPrisma = globalThis as unknown as {
  __skillwrightPrismaBase?: ReturnType<typeof createBaseClient>;
  __skillwrightPrismaAudit?: ReturnType<typeof createAuditClient>;
};

/**
 * The un-extended client. Exported for the audit extension, which needs a handle that its
 * own interceptors do not sit in front of — otherwise writing an audit row would audit the
 * audit row. Application code must import `prisma` from the package root instead.
 */
export const basePrisma = globalForPrisma.__skillwrightPrismaBase ?? createBaseClient();

/**
 * The handle the audit extension writes through. Separate pool, same database — see
 * `createAuditClient`. Application code must never use it directly.
 */
export const auditPrisma = globalForPrisma.__skillwrightPrismaAudit ?? createAuditClient();

auditPrisma.$on('warn', (e) => logger.warn('prisma.audit.warn', { detail: e.message }));
auditPrisma.$on('error', (e) => logger.error('prisma.audit.error', { detail: e.message }));

if (!isProduction) {
  globalForPrisma.__skillwrightPrismaBase = basePrisma;
  globalForPrisma.__skillwrightPrismaAudit = auditPrisma;
}
