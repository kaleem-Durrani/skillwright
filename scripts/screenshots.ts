#!/usr/bin/env tsx
/**
 * Every user-facing screen, captured from the real app.
 *
 * WHY a script and not a folder of hand-taken PNGs: hand-taken screenshots go stale
 * the first time a screen changes, and nobody remembers to retake them. This drives
 * the real dev server as each demo role, from a cold session every time, and
 * overwrites `docs/screenshots/*.png` in place — so `pnpm screenshots` after a UI
 * change is the only step needed to keep the README and SCREENSHOTS.md honest about
 * what the app currently looks like.
 *
 * COVERAGE CONTRACT: every .tsx file under apps/web/src/routes/ must be either mapped
 * to the captures that show it (ROUTE_CAPTURES below) or listed with a reason in
 * NOT_SCREENS (layouts, redirect-only routes). The check runs before the browser
 * launches and exits 1 on any gap, so adding a screen without a capture breaks the
 * build instead of drifting silently. The reverse holds too: a capture no route file
 * asks for is a rename that was not propagated.
 *
 * One login per role (not per screenshot): a session signs in once and then
 * navigates, same as a person would, rather than re-authenticating for every
 * capture — which also keeps this comfortably under the per-account login rate
 * limit (RATE_LIMIT_AUTH_ACCOUNT_MAX in .env.example) on a re-run.
 *
 * Screens behind interactions are reached the way a person reaches them — clicking
 * the dashboard's course card, a catalogue row's announcement link, a conversation —
 * not by pasting URLs. The one exception is `/resources/:id`, which no UI element
 * links to yet (the Resources tab renders titles as plain text, CourseDetail.tsx);
 * the script discovers an id over the same-origin API and navigates, and says so at
 * that shot.
 *
 * Demo credentials are the seed's own (packages/db/prisma/seed.ts) — the same three
 * accounts a reader of the README is told to sign in with, not a fixture invented for
 * this script.
 *
 * Requires the dev server reachable at SCREENSHOTS_BASE_URL (default
 * http://localhost:5173) and the Compose stack up with the seed applied.
 *
 * Exit 0 = every capture written, exit 1 = a route is unmapped or a page failed to
 * reach the state it was supposed to screenshot.
 */

import { mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'screenshots');

const BASE_URL = process.env.SCREENSHOTS_BASE_URL ?? 'http://localhost:5173';

// 1440x900 @2x per the plan (B5): large enough to read a data table, small enough
// that the PNG is still a README-sized asset once compressed.
const VIEWPORT = { width: 1440, height: 900 } as const;
const DEVICE_SCALE_FACTOR = 2;

// One phone-width capture, because mobile-first is a build constraint here (ADR 0008)
// and a gallery that only ever shows 1440px cannot show it. 390px is the iPhone
// class the Playwright projects already run (apps/web/e2e/mobile-shell.spec.ts),
// where DataList shows cards instead of tables and AppShell shows the bottom tab bar.
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

/** packages/db/prisma/seed.ts — DEMO_PASSWORD, and the three isDemo/demo:true rows. */
const DEMO_PASSWORD = 'demo-password-123';
const DEMO_EMAIL = {
  student: 'demo.student@skillwright.dev',
  teacher: 'demo.teacher@skillwright.dev',
  admin: 'demo.admin@skillwright.dev',
} as const;

type Role = keyof typeof DEMO_EMAIL;

interface Shot {
  /** Output filename, without extension. */
  name: string;
  /** Runs after sign-in (or after landing on /login, for the anonymous session). */
  arrive: (page: Page) => Promise<void>;
}

interface Session {
  role: Role | 'anonymous';
  theme?: 'light' | 'dark';
  /** Overrides the desktop viewport for every shot in this session (mobile capture). */
  viewport?: { width: number; height: number };
  shots: Shot[];
}

const noNav = async (): Promise<void> => {
  /* already on the right screen after sign-in */
};

/** A screen reached by plain navigation from anywhere — no row to click, nothing to arrange. */
const gotoShot = (name: string, urlPath: string): Shot => ({
  name,
  arrive: async (page) => {
    await page.goto(`${BASE_URL}${urlPath}`);
    await settle(page);
  },
});

/**
 * Waits for a DataList to have swapped its skeleton for rows. A list page's query
 * starts in a mount effect, so `networkidle` can already be satisfied in the gap
 * before the first request even fires — admin-users.png was once captured as four
 * skeleton rows exactly this way, with settle() green. The table rendering is the
 * only honest signal that data arrived.
 */
const waitForListRows = (page: Page): Promise<void> =>
  page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 10_000 });

/** A list screen: navigate, then wait until its table actually has rows. */
const listShot = (name: string, urlPath: string): Shot => ({
  name,
  arrive: async (page) => {
    await page.goto(`${BASE_URL}${urlPath}`);
    await settle(page);
    await waitForListRows(page);
  },
});

const SESSIONS: Session[] = [
  {
    // The public surface needs no account at all, so these cost zero logins. /login is
    // the arrival screen; the rest are plain navigations within the same visit, which
    // is exactly how an anonymous visitor moves between them.
    role: 'anonymous',
    shots: [
      { name: 'login', arrive: noNav },
      gotoShot('register', '/register'),
      gotoShot('forgot-password', '/forgot-password'),
      gotoShot('reset-password', '/reset-password'),
      {
        name: 'verify-email',
        arrive: async (page) => {
          // Without an address the screen refuses to work — it renders a "we do not
          // know which address to verify" warning (VerifyEmail.tsx NO_ADDRESS_MESSAGE),
          // because in real life nobody types this URL: they arrive from an email link
          // that carries ?email=. Navigating with one shows the screen a person sees.
          await page.goto(`${BASE_URL}/verify-email?email=${DEMO_EMAIL.student}`);
          await settle(page);
        },
      },
      // Unguarded by design ("a component gallery containing no data is not a leak",
      // routes/_design.tsx) — reachable signed out, so it belongs to this session.
      gotoShot('design-system', '/design'),
    ],
  },
  {
    role: 'student',
    shots: [
      { name: 'student-dashboard', arrive: noNav },
      listShot('course-catalogue', '/courses'),
      // Students get the announcements pair because their feed is deterministic: the
      // visibility WHERE clause fixes STUDENT to published rows only
      // (announcements.service.ts listWhere), while TEACHER/ADMIN also see drafts, and
      // whichever draft happens to sort first would decide what the click opens.
      listShot('announcements', '/announcements'),
      {
        name: 'announcement-detail',
        arrive: async (page) => {
          await page.goto(`${BASE_URL}/announcements`);
          await settle(page);
          // Click the row like a person. DataList renders the card list AND the table
          // into the DOM and switches them with `display` (DataList.tsx:75-103); scoping
          // to the table selects the md-up rendering a 1440px viewport actually shows.
          await page.locator('table a[href^="/announcements/"]').first().click();
          await page.waitForURL(/\/announcements\/[^/?#]+$/);
          // The URL flips before the router commits the new route (the lazy detail
          // chunk resolves through Vite's dev module graph), and settle()'s two
          // signals can both fire inside that gap. The detail screen's own
          // Discussion heading is the marker that the swap actually happened.
          await page.getByRole('heading', { name: 'Discussion' }).waitFor({
            state: 'visible',
            timeout: 10_000,
          });
          await settle(page);
        },
      },
      {
        name: 'notifications',
        arrive: async (page) => {
          await page.goto(`${BASE_URL}/notifications`);
          await settle(page);
          // The archive list is a plain ul inside the app shell's main, so the rows
          // themselves are the marker that the query landed. (The pagination control
          // hides on a single page of results, so it is no use as a signal here.)
          // The seed gives the demo student three notifications, so the default tab
          // is never empty.
          await page.locator('#main-content ul li').first().waitFor({
            state: 'visible',
            timeout: 10_000,
          });
        },
      },
    ],
  },
  {
    // The dark-mode pair: same screen and account as student-dashboard, only
    // `sw.theme` differs — a separate session because the theme is read from
    // localStorage before the first paint, which means before sign-in.
    role: 'student',
    theme: 'dark',
    shots: [{ name: 'student-dashboard-dark', arrive: noNav }],
  },
  {
    // One phone-width pass, kept deliberately cheap: a single capture of the catalogue
    // as cards with the bottom tab bar, which is the ADR 0008 claim made visible.
    role: 'student',
    viewport: MOBILE_VIEWPORT,
    shots: [gotoShot('course-catalogue-mobile', '/courses')],
  },
  {
    // Dashboard.tsx's "Enrolment requests" section — a teacher's pending queue.
    role: 'teacher',
    shots: [
      { name: 'teacher-approval-queue', arrive: noNav },
      {
        name: 'course-detail-resources',
        arrive: async (page) => {
          // The demo student is only ever PENDING, never APPROVED, on the seed's
          // courses, so `resource:read` narrows what THEY see to public resources
          // only — and which of those a given course has is a coin flip. The demo
          // teacher owns their courses outright (`ownsCourse`), so this reliably
          // lands on a Resources tab with real rows rather than an empty state.
          // "Your courses" (dashboard-courses) is scoped to that section because
          // the enrolment-requests list above it links to /courses/:id too.
          await page
            .locator('section[aria-labelledby="dashboard-courses"] a[href^="/courses/"]')
            .first()
            .click();
          await page.waitForURL(/\/courses\/[^/]+$/);
          // `defaultValue="resources"` (CourseDetail.tsx) makes this a no-op when
          // the tab is already showing; asserting it explicitly keeps the capture
          // correct even if that default ever changes.
          await page.getByRole('tab', { name: 'Resources' }).click();
          await settle(page);
        },
      },
      {
        name: 'resource-detail',
        arrive: async (page) => {
          // WHY by URL and not by clicking: nothing links here yet. The Resources tab
          // renders each title as plain text (CourseDetail.tsx, column "Resource") and
          // offers Download/Open actions instead, so there is no row a person could
          // click onto this screen. When an inbound link appears, replace this with a
          // click — the guard above will not remind you, this comment is the reminder.
          //
          // The id is discovered over the SAME ORIGIN the browser is already using:
          // the Vite proxy forwards /api to the API (vite.config.ts) and carries the
          // __Host-sw_session cookie, so the answer is what THIS viewer may see rather
          // than a second, privileged client.
          const courseId = page.url().match(/\/courses\/([^/?#]+)/)?.[1];
          if (!courseId) {
            throw new Error('resource-detail must run directly after course-detail-resources');
          }
          const resourceId = await page.evaluate(async (courseId: string) => {
            const list = (await fetch(`/api/v1/courses/${courseId}/resources`).then((r) =>
              r.json(),
            )) as { data?: Array<{ id: string }> };
            const rows = list.data ?? [];
            // Prefer a row that carries part of its seed discussion (seedComments
            // covers the first 24 resources), so the capture shows the comment thread
            // rather than the empty state under it.
            for (const row of rows.slice(0, 5)) {
              const comments = (await fetch(`/api/v1/comments?resourceId=${row.id}`).then((r) =>
                r.json(),
              )) as { meta?: { total?: number } };
              if ((comments.meta?.total ?? 0) > 0) return row.id;
            }
            return rows[0]?.id ?? null;
          }, courseId);
          if (!resourceId) throw new Error(`no visible resource on course ${courseId}`);
          await page.goto(`${BASE_URL}/resources/${resourceId}`);
          await settle(page);
        },
      },
      {
        name: 'messages',
        arrive: async (page) => {
          await page.goto(`${BASE_URL}/messages`);
          await settle(page);
          // The conversation list is not a DataList table (Messages.tsx renders its
          // own ul), so the row marker is the list's own buttons.
          await page
            .locator('section[aria-label="Conversations"] li button')
            .first()
            .waitFor({ state: 'visible', timeout: 10_000 });
        },
      },
      {
        name: 'messages-thread',
        arrive: async (page) => {
          await page.goto(`${BASE_URL}/messages`);
          await settle(page);
          // The demo teacher is seated in two seeded conversations
          // (seedConversations: c=0 and c=12 pick teachers[c % 12]), so the list has
          // real rows. Opening one is a button press, and the thread pane replaces
          // its "Pick a conversation" placeholder once the messages arrive.
          await page.locator('section[aria-label="Conversations"] li button').first().click();
          await page.getByRole('textbox', { name: 'Message' }).waitFor({
            state: 'visible',
            timeout: 10_000,
          });
          await settle(page);
        },
      },
      gotoShot('settings-profile', '/settings'),
    ],
  },
  {
    role: 'admin',
    shots: [
      listShot('admin-console', '/admin'),
      // The user table is admin-only (routes/_app/admin.tsx `requireRole`) and never
      // empty on the seed: 95 accounts across three roles, including the deliberate
      // SUSPENDED and PENDING_VERIFICATION students the status chips exist to show.
      listShot('admin-users', '/admin/users'),
      // The admin workspaces for departments and courses; both lists are never empty
      // on the seed (6 departments, 18 courses).
      listShot('admin-departments', '/admin/departments'),
      listShot('admin-courses', '/admin/courses'),
      {
        name: 'department-detail',
        arrive: async (page) => {
          // The only inbound link to /departments/:id is a department's name on the
          // admin list (AdminDepartments.tsx), so this screen is an admin
          // click-through by construction. The list is navigated to explicitly
          // rather than inherited from the previous shot, so the shot does not
          // depend on its neighbours' order.
          await page.goto(`${BASE_URL}/admin/departments`);
          await settle(page);
          await waitForListRows(page);
          await page.locator('table a[href^="/departments/"]').first().click();
          await page.waitForURL(/\/departments\/[^/?#]+$/);
          // Same URL-flips-before-commit gap as announcement-detail: the three
          // head-count cards render only once the fetch has landed.
          await page
            .getByText('Teachers', { exact: true })
            .waitFor({ state: 'visible', timeout: 10_000 });
          await settle(page);
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Staleness guard: routes without captures are a build error, not drift.
// ---------------------------------------------------------------------------

/**
 * Route file -> the captures that show it. Keys are repo-relative paths with forward
 * slashes; the mapping is mechanical because route paths mirror URLs
 * (`_app/courses.$courseId.tsx` IS `/courses/:courseId`), so a new route file has no
 * excuse for staying unmapped: name what the new session shot(s) show it.
 */
const ROUTE_CAPTURES: Record<string, readonly string[]> = {
  'apps/web/src/routes/_public/login.tsx': ['login'],
  'apps/web/src/routes/_public/register.tsx': ['register'],
  'apps/web/src/routes/_public/forgot-password.tsx': ['forgot-password'],
  'apps/web/src/routes/_public/reset-password.tsx': ['reset-password'],
  'apps/web/src/routes/_public/verify-email.tsx': ['verify-email'],
  'apps/web/src/routes/_design.tsx': ['design-system'],
  'apps/web/src/routes/_app/dashboard.tsx': [
    'student-dashboard',
    'student-dashboard-dark',
    // The same dashboard route as the teacher, whose "Enrolment requests" section
    // (Dashboard.tsx) is that role's approval queue.
    'teacher-approval-queue',
  ],
  'apps/web/src/routes/_app/courses.tsx': ['course-catalogue', 'course-catalogue-mobile'],
  'apps/web/src/routes/_app/courses.$courseId.tsx': ['course-detail-resources'],
  'apps/web/src/routes/_app/resources.$resourceId.tsx': ['resource-detail'],
  'apps/web/src/routes/_app/announcements.tsx': ['announcements'],
  'apps/web/src/routes/_app/announcements.$announcementId.tsx': ['announcement-detail'],
  'apps/web/src/routes/_app/messages.tsx': ['messages', 'messages-thread'],
  'apps/web/src/routes/_app/settings.tsx': ['settings-profile'],
  'apps/web/src/routes/_app/notifications.tsx': ['notifications'],
  'apps/web/src/routes/_app/admin.index.tsx': ['admin-console'],
  'apps/web/src/routes/_app/admin.users.tsx': ['admin-users'],
  'apps/web/src/routes/_app/admin.departments.tsx': ['admin-departments'],
  'apps/web/src/routes/_app/admin.courses.tsx': ['admin-courses'],
  'apps/web/src/routes/_app/departments.$id.tsx': ['department-detail'],
};

/**
 * Route files that render no screen of their own, each with the reason. Anything
 * added here must genuinely paint nothing — this list is the escape hatch that keeps
 * the guard honest.
 */
const NOT_SCREENS: Record<string, string> = {
  // Root layout (tooltip singleton, toast viewport, 404 fallback) — mounts under every URL.
  'apps/web/src/routes/__root.tsx': 'layout',
  // Pathless layouts: an `id` route guards or wraps children, owns no URL.
  'apps/web/src/routes/_app.tsx': 'authenticated layout (requireAuth)',
  'apps/web/src/routes/_public.tsx': 'anonymous layout',
  // `/admin` is a guard-only layout rendering <Outlet />; the screen AT /admin belongs
  // to admin.index and is captured as admin-console.
  'apps/web/src/routes/_app/admin.tsx': 'admin guard layout (requireRole)',
  // `/` never paints: beforeLoad redirects to /dashboard or /login (routes/_public/index.tsx).
  'apps/web/src/routes/_public/index.tsx': 'redirect-only',
};

function collectRouteFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const child = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(child) : [child];
    });
  return (
    walk(path.join(REPO_ROOT, 'apps', 'web', 'src', 'routes'))
      .map((file) => path.relative(REPO_ROOT, file).split(path.sep).join('/'))
      // Only components can be screens. Generated router code (routeTree.ts) and
      // helpers are .ts files and never match this glob.
      .filter((file) => file.endsWith('.tsx'))
      .sort()
  );
}

function routeCoverageProblems(shotNames: readonly string[]): string[] {
  const problems: string[] = [];

  for (const file of collectRouteFiles()) {
    const expected = ROUTE_CAPTURES[file];
    if (expected !== undefined) {
      for (const name of expected) {
        if (!shotNames.includes(name)) {
          problems.push(`${file} expects "${name}.png" but no session takes it`);
        }
      }
      continue;
    }
    if (NOT_SCREENS[file] === undefined) {
      problems.push(
        `${file} maps to no capture — add a shot to SESSIONS and list it in ROUTE_CAPTURES, or justify the omission in NOT_SCREENS`,
      );
    }
  }

  // The mirror direction catches the quieter failure: a route file renamed or deleted
  // while its capture kept running, quietly photographing a 404 forever.
  const mapped = new Set(Object.values(ROUTE_CAPTURES).flat());
  for (const name of shotNames) {
    if (!mapped.has(name)) {
      problems.push(
        `"${name}.png" is required by no route file — update ROUTE_CAPTURES or drop it`,
      );
    }
  }

  return problems;
}

/**
 * `lib/theme.ts` reads `localStorage['sw.theme']` before the first paint (see
 * `apps/web/e2e/mobile-shell.spec.ts`, "the theme is applied before the first
 * paint") — setting it via `addInitScript` is how the app itself is driven into
 * dark mode, rather than clicking through the appearance menu on every capture.
 */
async function openSession(browser: Browser, session: Session): Promise<Page> {
  const theme = session.theme ?? 'light';
  const context = await browser.newContext({
    viewport: session.viewport ?? VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    colorScheme: theme,
  });
  if (theme === 'dark') {
    await context.addInitScript(() => window.localStorage.setItem('sw.theme', 'dark'));
  }
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`);
  if (session.role === 'anonymous') return page;

  // Real credential sign-in — the same form and the same account a reader is told
  // to use.
  await page.getByLabel('Email').fill(DEMO_EMAIL[session.role]);
  // Not getByLabel: the "Show password" icon button's aria-label also contains the
  // substring "Password", so that query is ambiguous. The role narrows it to the
  // one actual textbox.
  await page.getByRole('textbox', { name: 'Password' }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(`${BASE_URL}/dashboard`);
  await settle(page);
  return page;
}

/**
 * The router's own route-level fallback (router.tsx `defaultPendingComponent`,
 * `role="status"` name "Loading") can still be on screen a moment after the
 * network itself goes idle — a lazy route chunk resolving is not a network event
 * `waitForLoadState` sees on its own. Waiting for it to clear first is what stops
 * a navigation from being read as "arrived" while a bare spinner is on screen.
 */
async function settle(page: Page): Promise<void> {
  await page
    .getByRole('status', { name: 'Loading' })
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => {
      /* never appeared, which is the common case */
    });
  await page.waitForLoadState('networkidle');
}

/** Freezes Framer Motion / CSS transitions so a capture never lands mid-animation. */
async function shoot(page: Page, name: string): Promise<void> {
  await settle(page);
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  const { size } = statSync(file);
  console.log(`  ${name}.png  (${(size / 1024).toFixed(0)} KB)`);
}

/** One retry: dev servers under concurrent load occasionally drop a single request. */
async function withRetry(attempt: () => Promise<void>): Promise<void> {
  try {
    await attempt();
  } catch {
    await attempt();
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const shotNames = SESSIONS.flatMap((session) => session.shots.map((shot) => shot.name));

  // Fail before the browser launches: a stale mapping needs no dev server to prove.
  const problems = routeCoverageProblems(shotNames);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      `\n${problems.length} screenshot-coverage problem(s) — fix SESSIONS/ROUTE_CAPTURES.`,
    );
    process.exitCode = 1;
    return;
  }

  const total = SESSIONS.reduce((sum, session) => sum + session.shots.length, 0);
  console.log(
    `Capturing ${total} screens against ${BASE_URL} -> ${path.relative(REPO_ROOT, OUT_DIR)}/`,
  );

  const browser = await chromium.launch();
  let failures = 0;

  try {
    for (const session of SESSIONS) {
      await withRetry(async () => {
        const page = await openSession(browser, session);
        try {
          for (const shot of session.shots) {
            await shot.arrive(page);
            await shoot(page, shot.name);
          }
        } finally {
          await page.context().close();
        }
      }).catch((error: unknown) => {
        failures += session.shots.length;
        const names = session.shots.map((shot) => shot.name).join(', ');
        console.error(`  [${names}] FAILED: ${(error as Error).message}`);
      });
    }
  } finally {
    await browser.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} of ${total} captures failed.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n${total} captures written.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
