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
function deriveTestRedisUrl(source: string | undefined): string {
  const url = new URL(source ?? 'redis://localhost:6379');
  url.pathname = '/1';
  return url.toString();
}

process.env.NODE_ENV = 'test';
fallback('DEPLOY_ENV', 'ci');
fallback('PORT', '4010');
fallback('HOST', '127.0.0.1');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? deriveTestUrl(process.env.DATABASE_URL);
process.env.REDIS_URL = deriveTestRedisUrl(process.env.REDIS_URL);

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
 * Deleting users cascades to sessions, verifications, recovery codes, profiles,
 * enrollments, uploads, conversations and messages — but NOT through the three
 * `Restrict` edges that point at a User: `Course.teacherId`, `Resource.authorId` and
 * `Announcement.authorId` (schema.prisma:321, :430, :463). Restrict is deliberate —
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
