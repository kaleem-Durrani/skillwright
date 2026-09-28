/**
 * Runs before every test module. Sets the environment BEFORE anything imports
 * `src/env.ts`, because that module parses `process.env` once at load and exits the
 * process on a bad value — which in a test run reads as a silent, confusing hang.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function fallback(key: string, value: string): void {
  process.env[key] ??= value;
}

/**
 * The repository-root .env carries this machine's published ports, which are not the
 * defaults whenever another project's container already owns one. Node does not
 * overwrite variables that are already set, so an explicit shell value still wins and
 * CI — which sets everything explicitly and ships no .env — is unaffected.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const rootEnv = resolve(repoRoot, '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/**
 * `resetDatabase()` deletes every user and every department. Sharing a database with
 * development would therefore make `pnpm test` destroy the seed, silently and
 * completely. The test database is derived from DATABASE_URL instead of shared with
 * it, and the derived name is asserted below before a single test runs.
 */
function deriveTestUrl(source: string | undefined): string {
  if (source === undefined) {
    return 'postgresql://skillwright:skillwright@localhost:5432/skillwright_test?schema=public';
  }
  const url = new URL(source);
  const name = url.pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) url.pathname = `/${name}_test`;
  return url.toString();
}

/** Rate-limit keys live in Redis db 1 so `resetRateLimits` cannot clear development's. */
/**
 * Redis has sixteen databases and every API suite in this directory was pointed at
 * database 1 — so the suite that partitions Postgres by name did NOT partition Redis,
 * and any two runs in parallel deleted each other's rate-limit counters.
 *
 * The failure it produces is a lie. `resetRateLimits` does `KEYS rl:*` then `DEL`, so
 * a concurrent run empties the buckets a sibling is asserting on mid-test, and the
 * assertion reports that a rate limit did not apply. It passes in isolation every
 * time. Observed twice while three agents worked in this tree, each time on a test
 * that touched none of the other agent's code.
 *
 * Derived from the test DATABASE name for the same reason `deriveTestUrl` derives the
 * database: one identity, two resources, and a name that says which run it belongs to.
 * A name does not map cleanly to 0-15, so it is hashed — the requirement is that two
 * different names give two different buckets and the same name gives the same one
 * every run, not that any particular name lands anywhere meaningful.
 */
function deriveTestRedisUrl(source: string | undefined, database: string): string {
  const url = new URL(source ?? 'redis://localhost:6379');
  let hash = 0;
  for (let i = 0; i < database.length; i += 1) {
    hash = (hash * 31 + database.charCodeAt(i)) | 0;
  }
  url.pathname = `/${Math.abs(hash) % 16}`;
  return url.toString();
}

process.env.NODE_ENV = 'test';
fallback('DEPLOY_ENV', 'ci');
fallback('PORT', '4010');
fallback('HOST', '127.0.0.1');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? deriveTestUrl(process.env.DATABASE_URL);
process.env.REDIS_URL = deriveTestRedisUrl(
  process.env.REDIS_URL,
  new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ''),
);

const targetDatabase = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '');
if (!targetDatabase.endsWith('_test')) {
  throw new Error(
    `Refusing to run against database "${targetDatabase}". resetDatabase() deletes every ` +
      'user and department, so the target name must end in "_test". Set TEST_DATABASE_URL ' +
      'explicitly if you need a different one.',
  );
}

fallback('SESSION_COOKIE_NAME', '__Host-sw_session');
fallback('ENCRYPTION_KEY', 'ZGV2LW9ubHktMzItYnl0ZS1rZXktY2hhbmdlLW1lISE=');
fallback('ALLOWED_ORIGINS', 'http://localhost:5173');
fallback('S3_ENDPOINT', 'http://localhost:9000');
fallback('S3_REGION', 'us-east-1');
fallback('S3_BUCKET', 'skillwright-uploads');
fallback('S3_ACCESS_KEY_ID', 'skillwright');
fallback('S3_SECRET_ACCESS_KEY', 'skillwright-dev-secret');
fallback('S3_FORCE_PATH_STYLE', 'true');
fallback('SMTP_HOST', 'localhost');
fallback('SMTP_PORT', '1025');
fallback('MAIL_FROM', 'no-reply@test.local');
fallback('DEMO_MODE', 'true');

// Assigned, not defaulted: the root .env sets LOG_LEVEL=debug for development, and
// inheriting it here buries 16 test results under several thousand query logs.
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';

// The rate limiters are exercised by their own assertions, not incidentally by every
// other test; a low ceiling here would make unrelated suites flaky as they grow.
fallback('RATE_LIMIT_GLOBAL_MAX', '100000');
fallback('RATE_LIMIT_AUTH_IP_MAX', '100000');
fallback('RATE_LIMIT_AUTH_ACCOUNT_MAX', '100000');

const { prisma } = await import('@skillwright/db');
const { buildApp } = await import('../src/app.js');
const { testOutbox } = await import('../src/lib/mailer.js');

export { prisma, buildApp, testOutbox };

/** The single origin the CSRF guard accepts in tests. */
export const ORIGIN = 'http://localhost:5173';
export const COOKIE_NAME = process.env.SESSION_COOKIE_NAME as string;

/**
 * Empties the audit table between tests.
 *
 * It exists because migration 0012 made `AuditEvent` genuinely append-only: `DELETE` is
 * refused by a trigger, so the `prisma.auditEvent.deleteMany({})` that three suites used
 * to run in their `beforeEach` began failing with 'AuditEvent is append-only; DELETE is
 * not permitted'. That failure is the guarantee working, not a regression — the trail is
 * supposed to outlive the test that created it.
 *
 * The flag is the one escape hatch the trigger accepts, set with `set_config(..., true)`
 * so it is scoped to this transaction and cannot leak to the next statement on this pooled
 * connection. A suite that reaches for a raw `deleteMany` here instead is testing a
 * database without the trigger on it, and would go on passing after the guarantee was
 * quietly removed.
 */
export async function clearAuditEvents(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('skillwright.audit_prune', 'on', true)`;
    await tx.auditEvent.deleteMany({});
  });
}

/**
 * Deleting users cascades to sessions, verifications, recovery codes, profiles,
 * enrollments, uploads, conversations and messages — but NOT through the three
 * `Restrict` edges that point at a User: `Course.teacherId`, `Resource.authorId` and
 * `Announcement.authorId` (all three declared `onDelete: Restrict` in schema.prisma).
 * Restrict is deliberate —
 * losing a teacher must not silently delete their courses — so the fixture has to
 * unwind those three itself, deepest first, or the first suite that creates a course
 * makes every later suite fail on a foreign-key error rather than its own assertion.
 *
 * Departments go last: Course and both profile tables hold Restrict references to one.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.comment.deleteMany({});
  await prisma.announcement.deleteMany({});
  await prisma.resource.deleteMany({});
  await prisma.enrollment.deleteMany({});
  await prisma.course.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.department.deleteMany({});
  testOutbox.clear();
}

/** Registration requires a real department; every suite needs exactly one. */
export async function createDepartment(slug = 'welding'): Promise<string> {
  const department = await prisma.department.create({
    data: { name: `Department ${slug}`, slug },
  });
  return department.id;
}

export async function resetRateLimits(redis: {
  keys: (pattern: string) => Promise<string[]>;
  del: (...keys: string[]) => Promise<number>;
}): Promise<void> {
  const keys = [...(await redis.keys('rl:*')), ...(await redis.keys('rl:global:*'))];
  if (keys.length > 0) await redis.del(...new Set(keys));
}

export interface InjectedCookie {
  name: string;
  value: string;
}

/** Pulls the session cookie out of an inject() response, or null if none was set. */
export function sessionCookie(response: {
  cookies: Array<Partial<InjectedCookie>>;
}): string | null {
  const found = response.cookies.find((cookie) => cookie.name === COOKIE_NAME);
  return found?.value && found.value.length > 0 ? found.value : null;
}

export function cookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}`;
}

/** Every mutation must look same-origin or the CSRF guard rejects it before the route. */
export const originHeaders = { origin: ORIGIN } as const;
