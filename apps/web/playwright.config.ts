import { defineConfig, devices } from '@playwright/test';
import {
  REAL_STACK_DATABASE_URL,
  REAL_STACK_PORT,
  REAL_STACK_URL,
  WEB_DIST_DIR,
} from './e2e/real/stack.js';

/**
 * Two suites live here, and they answer different questions.
 *
 * The STUBBED suite (`mobile`, `mobile-safari`, `desktop`) drives the built bundle
 * with every `/api/v1/**` call answered by `e2e/fixtures.ts`. It needs no Postgres,
 * no Redis and no seed, which is exactly why it can gate every push: it asks "did
 * Rollup produce something that runs" and "is this dialog reachable and accessible".
 *
 * The REAL-STACK suite (`real-stack`) authenticates. It runs the API against a real
 * database with the real seed, signs in through the real login form, and walks the
 * golden paths of docs/rebuild/00-REBUILD-PLAN.md Appendix D end to end. It is
 * opt-in — see the gate below — because it costs containers and minutes.
 *
 * The mobile project runs FIRST and is not optional. A suite that only runs at
 * 1280px certifies the enhancement and never the baseline, which is the exact
 * inversion of how this app is built.
 */

/**
 * Whether this run wants the real stack.
 *
 * Playwright has ONE `webServer` list for the whole run — it is not a per-project
 * option — so an unconditional API entry would boot Postgres-dependent processes for
 * the fast stubbed suite as well, and CI's `e2e` job has no database at all: the API
 * would exit 1 on `env.ts`'s missing `DATABASE_URL` and take a green job with it.
 * The projects are gated for the same reason in reverse: `pnpm --filter
 * @skillwright/web test:e2e` with no `--project` runs everything defined here, and
 * that command is what CONTRIBUTING.md tells people to run and what CI's `e2e` job
 * executes. So the real-stack project is added only when it is asked for by name.
 *
 * argv is the only place that intent is visible: a config is evaluated before
 * Playwright resolves projects and is told nothing about the selection. `E2E_REAL_STACK`
 * is the escape hatch for anyone driving the runner another way.
 */
function realStackRequested(): boolean {
  if (process.env.E2E_REAL_STACK === '1') return true;

  const argv = process.argv.slice(2);
  const asked = argv.some(
    (arg, index) =>
      arg === '--project=real-stack' ||
      arg === '--project=real-stack-setup' ||
      (arg === '--project' && argv[index + 1]?.startsWith('real-stack') === true),
  );

  /*
   * Stamped into the environment, not just returned — and this is not optional.
   * Playwright re-evaluates this config inside every WORKER process, and a worker's
   * argv does NOT carry `--project`, so an argv-only gate builds the projects in the
   * runner and drops them again in the worker. Measured: every test failed with
   * `Error: Project "real-stack-setup" not found in the worker process`. Workers
   * inherit `process.env` at fork time, so the decision survives the boundary.
   */
  if (asked) process.env.E2E_REAL_STACK = '1';
  return asked;
}

const REAL_STACK = realStackRequested();

export default defineConfig({
  testDir: './e2e',
  /*
   * `testDir: './e2e'` matches recursively, so without this the three stubbed
   * projects would collect e2e/real/*.spec.ts too and run the authenticated specs
   * against the stub. The real projects below opt back in with `testIgnore: []`.
   */
  testIgnore: '**/real/**',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Two reporters under CI, not one. 'github' writes the inline annotations; the
  // HTML report is what the workflow uploads on failure, and a single 'github'
  // reporter replaces the default list entirely — so playwright-report/ was never
  // written and the artifact promised a trace viewer that did not exist.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    ...(REAL_STACK
      ? [
          {
            name: 'real-stack-setup',
            testDir: './e2e/real',
            testIgnore: [],
            // The default testMatch only collects *.spec.ts, so the setup file has
            // to be named explicitly or it would never run and every dependent
            // project would fail on a missing storageState.
            testMatch: /auth\.setup\.ts$/,
            /*
             * `baseURL: REAL_STACK_URL`, not the top-level default. Without an
             * override here this project inherits `use.baseURL` from the OUTER
             * `defineConfig` — `http://localhost:4173`, the stub server — and
             * `auth.setup.ts` would sign in against whatever is actually answering
             * :4173/api (in dev, Vite's proxy, forwarding to :4000). The session row
             * that mints lands in THAT process's database, not `skillwright_e2e`, and
             * every dependent spec then gets 401 UNAUTHENTICATED the moment it
             * presents the banked cookie to :4010 — a real database, a real login, a
             * real cookie, all pointed at the wrong server. Reproduced on the first
             * run of this suite before this line existed.
             */
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1280, height: 900 },
              baseURL: REAL_STACK_URL,
            },
          },
          {
            name: 'real-stack',
            testDir: './e2e/real',
            testIgnore: [],
            dependencies: ['real-stack-setup'],
            /*
             * Three times the 30s default, because these tests are three times the
             * shape: each drives two or three browser CONTEXTS through a cold SPA
             * load and a sign-in before it asserts anything, where a stubbed spec
             * drives one page against a `page.route` handler. Measured on this
             * machine, warm: 3.3s (cross-teacher), 5.7s (suspension), 9.3s
             * (enrollment). The timeout should bound a hang, not a slow-but-working
             * test — the same argument vite.config.ts makes for vitest's.
             */
            timeout: 90_000,
            /*
             * Chromium at 1280 only, and deliberately not the three-viewport sweep
             * the stubbed suite runs. These specs assert domain behaviour — a policy
             * refusal, a revoked session, a seat that changed hands — none of which
             * is viewport-dependent, while every extra project would triple both the
             * wall clock and the logins spent against `RATE_LIMIT_AUTH_ACCOUNT_MAX`.
             * Layout at 390px is what mobile-shell.spec.ts is for.
             *
             * 1280 specifically, because these specs address rosters and the user
             * table BY ROW: `DataList` renders a real table only from `md` up and a
             * card list below it, so a narrower viewport would need every locator
             * written twice.
             */
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1280, height: 900 },
              baseURL: REAL_STACK_URL,
            },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: 'pnpm preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    ...(REAL_STACK
      ? [
          {
            /*
             * HOW THE BUILT SPA TALKS TO THE API — the decision this project turns on.
             *
             * Option A was to keep `vite preview` on :4173 and let it proxy /api to
             * the API. That does work: Vite 6 resolves `preview.proxy` as
             * `preview?.proxy ?? server.proxy` (vite/dist/node/chunks,
             * `resolvePreviewOptions`), so the dev proxy in vite.config.ts IS applied
             * by `vite preview` — worth stating plainly, because the opposite is
             * widely assumed and it is easy to write a workaround for a problem that
             * does not exist.
             *
             * It was still not chosen, for three reasons. That proxy's target is
             * `http://localhost:${PORT}` read from the repo-root .env — a file CI does
             * not have, so the two environments would disagree about where the API is.
             * It would also pin the API to :4000, the port `pnpm dev` and
             * `pnpm screenshots` already use, so a local run would either collide with
             * a dev server or silently reuse one it did not configure (lesson 16).
             * And it is the DEVELOPMENT topology: two origins with a proxy between
             * them, which is not how this application is deployed.
             *
             * Option B, which this is: the API serves the built SPA itself out of
             * `WEB_DIST_DIR`, one process, one origin, on a port nothing else claims.
             * That is the Dockerfile's arrangement exactly, and it is the arrangement
             * ADR 0004 chose the session cookie for — same origin means no CORS
             * surface and a CSRF hook that can refuse on `Sec-Fetch-Site` alone. It
             * also puts the static-serving seam under test, which is where four of
             * lesson 38's six faults lived: `/` answering 403, the SPA fallback, the
             * cache headers on the shell.
             *
             * `vite preview` above still starts. It costs about a second, it is what
             * the stubbed projects use, and making its entry conditional too would
             * mean two independent gates in a file whose whole difficulty is already
             * that Playwright has one webServer list for every project.
             */
            command: 'pnpm --filter @skillwright/api dev',
            /*
             * `/readyz`, not `/healthz`: it answers 200 only when Postgres AND Redis
             * both respond, and Playwright treats anything from 400 up as not-ready
             * (`isURLAvailable`), so its 503 keeps the runner waiting instead of
             * starting the suite against a process that is listening but cannot
             * serve. `/healthz` would go green the instant the port opened.
             */
            url: `${REAL_STACK_URL}/readyz`,
            reuseExistingServer: !process.env.CI,
            // tsx has to compile the API's whole module graph, and on a cold Windows
            // filesystem that is comfortably past the 60s default.
            timeout: 180_000,
            env: {
              PORT: String(REAL_STACK_PORT),
              WEB_DIST_DIR,
              /*
               * NEVER the dev database. `skillwright` is seeded, and `pnpm screenshots`
               * photographs whatever it holds — every spec in this project mutates real
               * rows, so this process gets its own database explicitly rather than
               * inheriting `.env`'s DATABASE_URL. Playwright merges `webServer.env` on
               * TOP OF `process.env` (`...process.env, ...this._options.env` in
               * playwright's own webServerPlugin, confirmed by reading it — not assumed),
               * so setting the key here wins over anything the child process would
               * otherwise pick up from a shell-exported DATABASE_URL, and `env.ts`'s own
               * `process.loadEnvFile` never overwrites a key that already has a value
               * (confirmed the same way) — so it is safe from the root `.env` too. See
               * `REAL_STACK_DATABASE_URL` in stack.ts for how the name is derived and
               * `setup-db.ts` for how the database gets created, migrated and seeded.
               */
              DATABASE_URL: REAL_STACK_DATABASE_URL,
              /*
               * The GLOBAL bucket is raised for the harness, and only the global one.
               *
               * It is keyed on `request.ip` (ratelimit.plugin.ts) — a dimension that
               * is degenerate here by construction: every worker, every browser
               * context and every retry is 127.0.0.1. And because the limiter is
               * registered `global: true` while this same process serves the SPA, the
               * bucket is also billed for every chunk, font and stylesheet. Both
               * halves were measured rather than assumed: `x-ratelimit-remaining`
               * decrements on `GET /assets/index-*.js` exactly as it does on an API
               * call, and one cold load of `/login` is 15 requests. At 300 per 60s
               * that is twenty page loads a minute for the entire suite, and the
               * first full run spent it: the last spec rendered a BLANK page — its
               * chunks 429'd — timed out, and passed on its own a minute later.
               *
               * The two AUTH buckets are deliberately left alone. They are the ones
               * this project is shaped around (one login per role, banked as
               * storageState), and raising them would retire the constraint instead
               * of respecting it.
               */
              RATE_LIMIT_GLOBAL_MAX: '5000',
            },
          },
        ]
      : []),
  ],
});
