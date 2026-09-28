import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REAL_STACK_DATABASE_URL } from './stack.js';

/**
 * Creates, migrates and seeds `REAL_STACK_DATABASE_URL` — one-time provisioning for
 * the `real-stack` Playwright project, the same way `pnpm db:test:setup`
 * (scripts/setup-test-db.ts) provisions `skillwright_test` for the integration suite.
 *
 * Not folded into that script: it refuses on purpose when a name does not end in
 * `_test` ("the suite deletes every row in it between files" — this one does not),
 * and it never seeds, because the integration suite fills its own fixtures per file.
 * This database needs the opposite of both: migrated AND seeded, kept AND reused.
 *
 * Run it once per machine, and again after a migration lands or `skillwright_e2e` is
 * dropped:
 *
 *     pnpm exec tsx apps/web/e2e/real/setup-db.ts
 *
 * Idempotent throughout — CREATE DATABASE tolerates "already exists" (42P04),
 * `migrate deploy` only applies what is pending, and seed.ts upserts every row on its
 * own stable key — so re-running this after the suite has already mutated and
 * cleaned up after itself converges rather than duplicating anything.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const e2eUrl = REAL_STACK_DATABASE_URL;
const e2eName = new URL(e2eUrl).pathname.replace(/^\//, '');

if (!e2eName.endsWith('_e2e')) {
  // Mirrors setup-test-db.ts's own refusal: a name this script did not derive itself
  // (E2E_DATABASE_URL) is a developer's explicit choice, but running CREATE DATABASE
  // and a full reseed against whatever it names is exactly what Step 1 exists to
  // prevent if that choice was a typo for the dev database.
  process.stderr.write(
    `refusing to provision "${e2eName}": REAL_STACK_DATABASE_URL must name a database ` +
      'ending in "_e2e" — see stack.ts. If you set E2E_DATABASE_URL yourself, point it ' +
      'at a dedicated database, never at "skillwright".\n',
  );
  process.exit(1);
}

/** The same server, but the maintenance database — CREATE DATABASE cannot run inside itself. */
const maintenanceUrl = (() => {
  const url = new URL(e2eUrl);
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
})();

/**
 * Prisma's (and tsx's) CLI resolved and invoked through node directly, not through a
 * pnpm/npx shim — see setup-test-db.ts for the Windows EINVAL this avoids
 * (CVE-2024-27980: spawning a .cmd shim without `shell: true` fails outright, and
 * `shell: true` would hand a DATABASE_URL that may legitimately contain `&` back to
 * cmd.exe for re-parsing).
 */
const require_ = createRequire(resolve(repoRoot, 'packages/db/package.json'));
const PRISMA_CLI = require_.resolve('prisma/build/index.js');
const TSX_CLI = require_.resolve('tsx/cli');

function run(cli: string, args: string[], env: NodeJS.ProcessEnv, input?: string): string {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: resolve(repoRoot, 'packages/db'),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    input,
    // When a stdin payload is being sent, BOTH output streams are piped, never
    // inherited — stdio is [stdin, stdout, stderr], so leaving the third slot on
    // 'inherit' sends the diagnostic straight to the terminal and leaves
    // `error.stderr` empty. The CREATE DATABASE step below depends on reading it.
    // With the streams inherited, the catch block saw only "Command failed: node.exe …"
    // and rejected a database that was already there. Prisma reports the condition
    // as P1009, wrapping the server's 42P04, so the message is what has to be read.
    stdio: input === undefined ? 'inherit' : ['pipe', 'pipe', 'pipe'],
  });
}

process.stdout.write(`real-stack database: ${e2eName}\n`);

try {
  // No IF NOT EXISTS for CREATE DATABASE in Postgres, so the second run is expected
  // to fail — with Prisma's P1009 wrapping the server's 42P04 — and that failure is
  // the success case. `run` captures stderr so the check below can see it.
  run(
    PRISMA_CLI,
    ['db', 'execute', '--url', maintenanceUrl, '--stdin'],
    {},
    `CREATE DATABASE "${e2eName}";`,
  );
  process.stdout.write('  created\n');
} catch (error) {
  // BOTH streams. Prisma's CLI reports "Database … already exists" (P1009) on
  // STDOUT, not stderr, and the "Command failed: …" line execFileSync puts on the
  // message is the only thing stderr carries — so a check reading stderr alone sees
  // a command line, never the reason, and cannot tell "already exists" from "the
  // server is down". Those two need opposite responses.
  const streams = error instanceof Error ? (error as { stdout?: string; stderr?: string }) : {};
  const text =
    error instanceof Error
      ? `${error.message}${String(streams.stdout ?? '')}${String(streams.stderr ?? '')}`
      : String(error);
  if (/already exists|42P04|P1009/i.test(text)) {
    process.stdout.write('  already exists\n');
  } else {
    process.stderr.write('  could not create it. Is the stack up? `pnpm infra:up`\n\n');
    process.stderr.write(`${text}\n`);
    process.exit(1);
  }
}

process.stdout.write('applying migrations...\n');
run(PRISMA_CLI, ['migrate', 'deploy'], { DATABASE_URL: e2eUrl });

process.stdout.write('seeding...\n');
run(TSX_CLI, ['prisma/seed.ts'], { DATABASE_URL: e2eUrl });
