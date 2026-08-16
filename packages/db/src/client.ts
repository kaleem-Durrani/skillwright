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

/** Declared after the factory so the client's log-event typing survives inference. */
const globalForPrisma = globalThis as unknown as {
  __skillwrightPrismaBase?: ReturnType<typeof createBaseClient>;
};

/**
 * The un-extended client. Exported for the audit extension, which needs a handle that its
 * own interceptors do not sit in front of — otherwise writing an audit row would audit the
 * audit row. Application code must import `prisma` from the package root instead.
 */
export const basePrisma = globalForPrisma.__skillwrightPrismaBase ?? createBaseClient();

if (!isProduction) {
  globalForPrisma.__skillwrightPrismaBase = basePrisma;
}
