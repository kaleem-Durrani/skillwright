import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Creates and migrates the database the integration suite runs against.
 *
 * CONTRIBUTING tells you to run `pnpm test` before you push. `pnpm test` runs
 * `turbo run test`, which includes apps/api's integration suite, which connects to
 * `skillwright_test` — a database nothing in this repository ever created. The
 * string appeared in exactly one place: the service-container name in ci.yml. So
 * the only working path to a green test run was CI's, and CI's does not exist on a
 * laptop. Every contributor's first `pnpm test` died with
 * `PrismaClientInitializationError: Database "skillwright_test" does not exist`,
 * and there was no documented command to fix it.
 *
 * This is that command. It is idempotent: run it again after adding a migration.
 *
 *     pnpm db:test:setup
 *
 * The name is derived the same way `apps/api/test/setup.ts` derives it — append
 * `_test` unless the name already ends in it — because the two disagreeing is
 * precisely the kind of thing that produces a database named `skillwright_test_test`
 * and an afternoon of confusion. TEST_DATABASE_URL wins if set, which is how
 * parallel agents get their own database (NEXT.md).
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootEnv = resolve(repoRoot, '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const DEFAULT_URL = 'postgresql://skillwright:skillwright@localhost:5433/skillwright?schema=public';

function deriveTestUrl(raw: string | undefined): string {
  const url = new URL(raw ?? DEFAULT_URL);
  const name = url.pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) url.pathname = `/${name}_test`;
  return url.toString();
}

const testUrl = process.env.TEST_DATABASE_URL ?? deriveTestUrl(process.env.DATABASE_URL);
const testName = new URL(testUrl).pathname.replace(/^\//, '');

if (!testName.endsWith('_test')) {
  // The same refusal apps/api/test/setup.ts makes, for the same reason: this
  // database gets truncated between test files.
  console.error(
    `refusing to create "${testName}": the test database's name must end in "_test", ` +
      'because the suite deletes every row in it between files.',
  );
  process.exit(1);
}

/** The same server, but the maintenance database — you cannot CREATE a database from inside itself. */
const maintenanceUrl = (() => {
  const url = new URL(testUrl);
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
})();

/**
 * Prisma's CLI is invoked through node directly, not through `pnpm exec`.
 *
 * On Windows the pnpm shim is a .cmd, and since Node 20 spawning one without a
 * shell fails with EINVAL (the CVE-2024-27980 hardening). Turning `shell: true` on
 * would fix the spawn and hand every argument back to cmd.exe for re-parsing —
 * which matters here because a DATABASE_URL may legitimately carry `&`. Resolving
 * the CLI's own entry point and running it with process.execPath avoids the shell
 * entirely, so the connection string is passed through untouched.
 */
const require_ = createRequire(resolve(repoRoot, 'packages/db/package.json'));
const PRISMA_CLI = require_.resolve('prisma/build/index.js');

function prisma(args: string[], env: NodeJS.ProcessEnv = {}, input?: string): string {
  return execFileSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: resolve(repoRoot, 'packages/db'),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    input,
    stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
  });
}

console.log(`test database: ${testName}`);

try {
  // No IF NOT EXISTS for CREATE DATABASE in Postgres, so the second run is expected
  // to fail with 42P04 and that failure is the success case.
  prisma(
    ['db', 'execute', '--url', maintenanceUrl, '--stdin'],
    {},
    `CREATE DATABASE "${testName}";`,
  );
  console.log('  created');
} catch (error) {
  const text =
    error instanceof Error
      ? `${error.message}${String((error as { stderr?: string }).stderr ?? '')}`
      : String(error);
  if (/already exists|42P04/i.test(text)) {
    console.log('  already exists');
  } else {
    console.error('  could not create it. Is the stack up? `pnpm infra:up`\n');
    console.error(text);
    process.exit(1);
  }
}

console.log('applying migrations...');
execFileSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
  cwd: resolve(repoRoot, 'packages/db'),
  env: { ...process.env, DATABASE_URL: testUrl },
  stdio: 'inherit',
});
