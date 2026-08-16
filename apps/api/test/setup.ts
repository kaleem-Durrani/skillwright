/**
 * Runs before every test module. Sets the environment BEFORE anything imports
 * `src/env.ts`, because that module parses `process.env` once at load and exits the
 * process on a bad value — which in a test run reads as a silent, confusing hang.
 */

function fallback(key: string, value: string): void {
  process.env[key] ??= value;
}

process.env.NODE_ENV = 'test';
fallback('DEPLOY_ENV', 'ci');
fallback('PORT', '4010');
fallback('HOST', '127.0.0.1');
fallback(
  'DATABASE_URL',
  'postgresql://skillwright:skillwright@localhost:5432/skillwright?schema=public',
);
fallback('REDIS_URL', 'redis://localhost:6379');
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
fallback('LOG_LEVEL', 'silent');

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
 * Deleting users cascades to sessions, verifications, recovery codes and profiles in
 * the database, so the fixture never has to know the FK graph. Departments go second
 * because a StudentProfile holds a Restrict reference to one.
 */
export async function resetDatabase(): Promise<void> {
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
