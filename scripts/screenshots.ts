#!/usr/bin/env tsx
/**
 * README screenshots.
 *
 * WHY a script and not a folder of hand-taken PNGs: hand-taken screenshots go stale
 * the first time a screen changes, and nobody remembers to retake all seven. This
 * drives the real dev server as each demo role, from a cold session every time, and
 * overwrites `docs/screenshots/*.png` in place — so `pnpm screenshots` after a UI
 * change is the only step needed to keep the README honest about what the app
 * currently looks like.
 *
 * One login per role (not per screenshot): a session signs in once and then
 * navigates, same as a person would, rather than re-authenticating for every
 * capture — which also keeps this comfortably under the per-account login rate
 * limit (RATE_LIMIT_AUTH_ACCOUNT_MAX in .env.example) on a re-run.
 *
 * Demo credentials are the seed's own (packages/db/prisma/seed.ts) — the same three
 * accounts a reader of the README is told to sign in with, not a fixture invented for
 * this script.
 *
 * Requires the dev server reachable at SCREENSHOTS_BASE_URL (default
 * http://localhost:5173) and the Compose stack up with the seed applied.
 *
 * Exit 0 = every capture written, exit 1 = a page failed to reach the state it was
 * supposed to screenshot.
 */

import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'screenshots');

const BASE_URL = process.env.SCREENSHOTS_BASE_URL ?? 'http://localhost:5173';

// 1440x900 @2x per the plan (B5): large enough to read a data table, small enough
// that the PNG is still a README-sized asset once compressed.
const VIEWPORT = { width: 1440, height: 900 } as const;
const DEVICE_SCALE_FACTOR = 2;

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
  shots: Shot[];
}

const noNav = async (): Promise<void> => {
  /* already on the right screen after sign-in */
};

const SESSIONS: Session[] = [
  {
    role: 'anonymous',
    shots: [{ name: 'login', arrive: noNav }],
  },
  {
    role: 'student',
    shots: [
      { name: 'student-dashboard', arrive: noNav },
      {
        name: 'course-catalogue',
        arrive: async (page) => {
          await page.goto(`${BASE_URL}/courses`);
          await settle(page);
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
    ],
  },
  {
    role: 'admin',
    shots: [
      {
        name: 'admin-console',
        arrive: async (page) => {
          await page.goto(`${BASE_URL}/admin`);
          await settle(page);
        },
      },
    ],
  },
];

/**
 * `lib/theme.ts` reads `localStorage['sw.theme']` before the first paint (see
 * `apps/web/e2e/mobile-shell.spec.ts`, "the theme is applied before the first
 * paint") — setting it via `addInitScript` is how the app itself is driven into
 * dark mode, rather than clicking through the appearance menu on every capture.
 */
async function openSession(browser: Browser, session: Session): Promise<Page> {
  const theme = session.theme ?? 'light';
  const context = await browser.newContext({
    viewport: VIEWPORT,
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

  const total = SESSIONS.reduce((sum, session) => sum + session.shots.length, 0);
  console.log(`Capturing against ${BASE_URL} -> ${path.relative(REPO_ROOT, OUT_DIR)}/`);

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
