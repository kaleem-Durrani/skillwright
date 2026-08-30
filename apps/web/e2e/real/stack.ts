import { expect, type Browser, type Page } from '@playwright/test';
import type { Paginated, UserDetail } from '@skillwright/shared/schema';
import { fileURLToPath } from 'node:url';

/**
 * Shared ground for the `real-stack` Playwright project: the one suite in this
 * repository that authenticates.
 *
 * The stubbed suite beside it (e2e/fixtures.ts) answers every `/api/v1/**` call from
 * a `page.route` handler and is always already signed in as an ADMIN. That is the
 * right trade for what it asserts — "does the bundle run", "is this dialog
 * accessible" — and it is why that suite can gate a push with no Postgres. But it
 * means nothing in CI had ever driven a login form, and none of the five golden
 * paths in docs/rebuild/00-REBUILD-PLAN.md Appendix D was covered by a browser.
 * This module is the other half: real API, real Postgres, real seed, real cookie.
 *
 * WHERE THE API IS, AND WHY IT IS THERE. This project does not use `vite preview`
 * at all — the SPA is served by the API process itself, out of `WEB_DIST_DIR`, on
 * one origin. That is not a workaround: it is the deployed topology (Dockerfile),
 * and it is the arrangement ADR 0004 argues for — same origin means the session
 * cookie needs no CORS and the CSRF hook can refuse on `Sec-Fetch-Site` alone
 * (csrf.plugin.ts). The alternative was measured rather than assumed; the finding
 * and the decision are written down in playwright.config.ts.
 */

/**
 * The port the real-stack API listens on, deliberately NOT 4000.
 *
 * 4000 is where `pnpm dev` puts the API and where `pnpm screenshots` expects to find
 * it. Sharing it would mean this suite either fights a running dev server for the
 * port or silently reuses one it did not configure — lesson 16's "long-lived dev
 * processes lie to you", which costs an hour every time it happens. A dedicated port
 * makes "is the thing I am testing the thing I started" a non-question.
 */
export const REAL_STACK_PORT = Number(process.env.E2E_STACK_PORT ?? 4010);
export const REAL_STACK_URL = `http://localhost:${REAL_STACK_PORT}`;

/** The built SPA the API serves. `pnpm --filter @skillwright/web build` writes it. */
export const WEB_DIST_DIR = fileURLToPath(new URL('../../dist', import.meta.url));

/**
 * The database this project's API talks to — never `skillwright`.
 *
 * `skillwright` is the dev database: seeded, and photographed verbatim by `pnpm
 * screenshots` (SCREENSHOTS.md). Every spec here mutates real rows — an enrolment
 * requested and approved, a user suspended — and even the ones that put their own
 * mutation back in a `finally` are one failed cleanup away from leaving the dev
 * database holding a seat or a lockout that was never supposed to exist. Pointing
 * `DATABASE_URL` at a dedicated `_e2e` database, the same way `TEST_DATABASE_URL`
 * points the integration suite at `_test` (scripts/setup-test-db.ts), makes that
 * failure mode blast-radius-zero instead of "the demo screenshots are wrong".
 *
 * Derivation, not a literal string, so a developer whose `.env` moved Postgres to a
 * different port or credentials still gets an e2e database on the SAME server —
 * `new URL(...)` only touches `pathname`. `E2E_DATABASE_URL` is the full override,
 * for anyone pointing this at a database `_e2e`-suffixing the default would not
 * reach. The default mirrors `.env.example` / `.env` exactly (see setup-db.ts),
 * because playwright.config.ts is evaluated before Node has read any `.env` file —
 * unlike apps/api/src/env.ts, nothing here calls `process.loadEnvFile`.
 */
export const REAL_STACK_DATABASE_URL = deriveE2eDatabaseUrl();

function deriveE2eDatabaseUrl(): string {
  const override = process.env.E2E_DATABASE_URL;
  if (override !== undefined && override !== '') return override;

  const DEFAULT_DEV_URL =
    'postgresql://skillwright:skillwright@localhost:5433/skillwright?schema=public';
  const url = new URL(process.env.DATABASE_URL ?? DEFAULT_DEV_URL);
  const name = url.pathname.replace(/^\//, '');
  url.pathname = `/${name.endsWith('_e2e') ? name : `${name}_e2e`}`;
  return url.toString();
}

/**
 * Saved sessions live under `.playwright/`, which the root .gitignore already covers
 * at any depth — a session cookie must never be committable. Deliberately NOT under
 * `test-results/`: Playwright empties that directory at the start of every run, so a
 * state written there could never survive to the next one.
 */
const AUTH_DIR = fileURLToPath(new URL('../../.playwright/auth', import.meta.url));

/** packages/db/prisma/seed.ts — `DEMO_PASSWORD` and the three `isDemo` rows. */
export const DEMO_PASSWORD = 'demo-password-123';

export const DEMO_EMAIL = {
  student: 'demo.student@skillwright.dev',
  teacher: 'demo.teacher@skillwright.dev',
  admin: 'demo.admin@skillwright.dev',
} as const;

export type DemoRole = keyof typeof DEMO_EMAIL;

/**
 * seed.ts's `BULK_PASSWORD`: the other 92 seeded accounts share one argon2 digest.
 * The suspension path needs a victim that is NOT one of the three demo accounts, and
 * that distinction is the whole safety design — see suspension.spec.ts.
 */
export const SEED_BULK_PASSWORD = 'skillwright-dev';

/** Where `auth.setup.ts` writes a role's session and the project reads it back. */
export function storageStateFor(role: DemoRole): string {
  return `${AUTH_DIR}/${role}.json`;
}

/**
 * A second person, already signed in, in their own browser context.
 *
 * Every golden path in this project is a conversation between two accounts — a
 * student and a teacher, an admin and their victim — so the specs cannot lean on
 * the one `page` fixture. `browser.newContext()` applies none of the project's `use`
 * options, which is why `baseURL` is passed here explicitly rather than inherited:
 * without it every `page.goto('/courses')` in a spec would fail on a relative URL,
 * and the failure would name the URL rather than the missing option.
 *
 * It LANDS ON THE APP before returning, and that is not a convenience. A fresh page
 * sits on `about:blank`, where a relative URL has no base and `fetch('/api/v1/...')`
 * throws `Failed to parse URL` — so `apiFromPage` would fail on any context a spec
 * had not navigated first, in a way that names the URL rather than the omission.
 * `/dashboard` also fails loudly and immediately if the banked session is stale,
 * which is the only interesting way `storageState` can be wrong.
 *
 * The caller owns the context and must close it — `page.context().close()`.
 */
export async function openAs(browser: Browser, role: DemoRole): Promise<Page> {
  const context = await browser.newContext({
    baseURL: REAL_STACK_URL,
    storageState: storageStateFor(role),
  });
  const page = await context.newPage();
  await page.goto('/dashboard');
  await page.waitForURL('**/dashboard');
  await settle(page);
  return page;
}

/**
 * The same, signed in as nobody — for the accounts no setup step banks a session for.
 * It stays on `about:blank`: the caller's next move is `signIn`, which navigates.
 */
export async function openSignedOut(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: REAL_STACK_URL });
  return context.newPage();
}

/**
 * The router's own route-level fallback (`router.tsx` `defaultPendingComponent`,
 * `role="status"` named "Loading") can still be on screen after the network has gone
 * quiet — a lazily imported route chunk resolving is not a network event
 * `waitForLoadState` sees. Waiting it out first is what stops a navigation being read
 * as "arrived" while a bare spinner is on screen. Lifted from scripts/screenshots.ts,
 * which learned it by photographing spinners.
 */
export async function settle(page: Page): Promise<void> {
  await page
    .getByRole('status', { name: 'Loading' })
    .waitFor({ state: 'hidden', timeout: 15_000 })
    .catch(() => {
      /* never appeared, which is the common case */
    });
  await page.waitForLoadState('networkidle');
}

/**
 * Sign in through the real form, with real credentials, against the real API.
 *
 * Every sign-in in this suite goes through here, and every one costs a slot in the
 * per-account bucket — `RATE_LIMIT_AUTH_ACCOUNT_MAX`, 10 per 15 minutes
 * (ratelimit.plugin.ts `perAccountRateLimit`). That budget is what the project's
 * shape is for. Five logins per run: three in auth.setup.ts, one per demo account,
 * whose `storageState` every spec then reuses, and two more for the ordinary seeded
 * students the mutating specs borrow. The three demo accounts are therefore hit
 * exactly once per run — ten consecutive runs inside one window before the limit
 * bites — and the other two land on a different account almost every time, because
 * `seededStudents` picks whoever is eligible today. A spec that signed in for itself
 * instead of reusing a state would spend that budget to assert nothing the setup
 * does not already assert.
 */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  // Not getByLabel: the "Show password" IconButton's aria-label also contains the
  // substring "Password", so that query resolves to two elements. The role narrows it
  // to the one actual textbox — scripts/screenshots.ts carries the same note.
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/dashboard');
  await settle(page);
}

/** What the API answered, flattened to the three things an assertion ever reads. */
export interface ApiAnswer<T> {
  status: number;
  /**
   * `problem.code`, when the body was a Problem. The SPA renders errors BY CODE and
   * never by `detail` (lesson 25), so the code is the half of a refusal that is part
   * of the contract.
   */
  code: string | null;
  /** `problem.detail` — diagnostics, and where a policy refusal names its rule. */
  detail: string | null;
  body: T | null;
}

/**
 * Ask the API a question as the person currently signed in, from inside the page.
 *
 * `page.evaluate` + `fetch`, NOT Playwright's `APIRequestContext`, and the reason is
 * the CSRF hook. `csrf.plugin.ts` lets a state-changing request through on
 * `Sec-Fetch-Site: same-origin` or on an `Origin` that is in `ALLOWED_ORIGINS`, and
 * an `APIRequestContext` sends neither — so every POST made through it would be
 * refused `403 csrf.sameOrigin`. In a spec asserting "teacher B is refused teacher
 * A's course with 403" that is a false pass: the right status for the wrong reason,
 * which is worse than a failure because it reads as coverage.
 *
 * A fetch issued by the page is the request the SPA itself makes — the browser sets
 * `Sec-Fetch-Site` and attaches the session cookie, and nothing here has to be told
 * which origin it is on.
 */
export async function apiFromPage<T>(
  page: Page,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiAnswer<T>> {
  return page.evaluate(
    async ({ method: verb, path: target, body: payload }) => {
      const response = await fetch(`/api/v1${target}`, {
        method: verb,
        credentials: 'include',
        ...(payload === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }),
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text === '' ? null : JSON.parse(text);
      } catch {
        parsed = null;
      }
      const problem = parsed as { code?: unknown; detail?: unknown } | null;
      return {
        status: response.status,
        code: typeof problem?.code === 'string' ? problem.code : null,
        detail: typeof problem?.detail === 'string' ? problem.detail : null,
        body: parsed as T | null,
      };
    },
    { method, path, body },
  );
}

/**
 * The same call, asserted to have succeeded — for the reads a spec makes to FIND its
 * fixture rather than to test anything. A discovery query that quietly answered 401
 * would otherwise surface fifty lines later as an unreadable "cannot read properties
 * of null", pointing at the assertion instead of at the sign-in.
 */
export async function apiOk<T>(
  page: Page,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const answer = await apiFromPage<T>(page, method, path, body);
  expect(
    answer.status,
    `${method} ${path} answered ${answer.status} ${answer.code ?? ''}`,
  ).toBeLessThan(300);
  expect(answer.body, `${method} ${path} returned no body`).not.toBeNull();
  return answer.body as T;
}

/**
 * Which half of the seeded student body a spec is allowed to touch.
 *
 * Two specs in this project take a seeded student and do something to them —
 * enrollment.spec.ts signs one in and applies for a seat, suspension.spec.ts signs
 * one in and gets them suspended — and Playwright runs spec FILES in parallel
 * workers by default. Both scanning one list for "the first ordinary student" would
 * eventually pick the same person, and the failure would be a suspended applicant
 * halfway through an enrolment: a contention bug that reproduces rarely and reads
 * like a product defect. That is lesson 30's shape, one level up from the database.
 *
 * So the split lives HERE, once, where both callers can see it — a structural
 * guarantee rather than a comment in each spec asking the other to keep its distance
 * (lesson 28).
 */
export type StudentPool = 'applicant' | 'victim';

/**
 * The seeded ordinary students a spec may use, in the API's own order.
 *
 * ADMIN-only: `user:list` is a bare allow for ADMIN and a bare deny for everyone
 * else (policy.ts), so `page` must be an admin's. Demo accounts are excluded because
 * they are the ones the README hands to strangers and `pnpm screenshots` drives —
 * a run killed at the wrong moment must never be able to lock one of them out.
 */
export async function seededStudents(page: Page, pool: StudentPool): Promise<UserDetail[]> {
  /*
   * `status=ACTIVE` is not decoration: the seed deliberately leaves two students in
   * other states (one SUSPENDED, one PENDING_VERIFICATION) so the rules that gate on
   * status stay reachable, and either would fail a sign-in for an unrelated reason.
   */
  const listed = await apiOk<Paginated<UserDetail>>(
    page,
    'GET',
    '/users?role=STUDENT&status=ACTIVE&limit=100',
  );
  const ordinary = listed.data.filter((student) => !student.email.startsWith('demo.'));
  const half = Math.floor(ordinary.length / 2);
  return pool === 'applicant' ? ordinary.slice(0, half) : ordinary.slice(half);
}
