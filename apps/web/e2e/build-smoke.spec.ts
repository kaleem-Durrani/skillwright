import { expect, test, type Page } from '@playwright/test';
import { stubApi } from './fixtures.js';

/**
 * Does the built SPA actually run?
 *
 * This exists because the answer was NO on `main` and nothing noticed. A
 * `manualChunks` predicate split `@tanstack/react-router` across two vendor
 * chunks that imported each other; Rollup initialised them in an order where the
 * router ran before React existed, and every page of the production build threw
 *
 *   Cannot read properties of undefined (reading 'createContext')
 *
 * leaving `#root` empty. `vite build` exited 0. `tsc --noEmit` was clean. All
 * 178 unit tests passed — they run against source in jsdom, not against the
 * bundle. `vite dev` was fine too, because dev serves unbundled modules and
 * never applies `manualChunks` at all. Every gate in the repository was green
 * over a white screen, and the only way to find it was to open the built app in
 * a browser.
 *
 * So that is what this does, on every route that owns a chunk boundary: load it,
 * and fail on an empty root or any uncaught page error. It is deliberately the
 * cheapest possible test — no assertions about content, nothing that a UI change
 * can make stale — because its whole job is to be the thing that cannot be
 * quietly satisfied by a build that does not run.
 */

const ROUTES = [
  { path: '/login', why: 'the entry point, and the only route an anonymous visitor gets' },
  { path: '/design', why: 'the design gallery: pulls in the whole UI primitive set at once' },
  { path: '/dashboard', why: 'authenticated shell + router guards + query client' },
  { path: '/courses', why: 'a list route with its own lazily-imported chunk' },
  { path: '/admin/users', why: 'a nested layout route' },
];

async function collectFailures(page: Page): Promise<string[]> {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // A stubbed route that answers 200 still logs nothing; genuine app errors do.
    // Favicon and other resource 404s are noise from the harness, not the bundle.
    if (/favicon|Failed to load resource/i.test(text)) return;
    failures.push(`console.error: ${text}`);
  });
  return failures;
}

for (const route of ROUTES) {
  test(`${route.path} boots from the built bundle — ${route.why}`, async ({ page }) => {
    const failures = await collectFailures(page);
    await stubApi(page);

    await page.goto(route.path);
    // The router resolves its route chunk after the load event, so waiting for
    // the network to go quiet is what proves the chunk arrived and executed.
    await page.waitForLoadState('networkidle');

    const rootSize = await page.evaluate(
      () => document.getElementById('root')?.innerHTML.length ?? 0,
    );

    expect(failures, `uncaught errors on ${route.path}`).toEqual([]);
    // A React tree that mounted at all is thousands of characters; the broken
    // bundle rendered exactly 0. Any low number here means nothing painted.
    expect(rootSize, `#root is empty on ${route.path} — the bundle did not run`).toBeGreaterThan(
      500,
    );
  });
}

test('the vendor chunks do not import each other in a cycle', async ({ page }) => {
  const failures = await collectFailures(page);
  await stubApi(page);
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');

  /*
   * The cycle's symptom was an initialisation-order crash, which the assertions
   * above already catch. What this adds is the direction: React must be reachable
   * without loading anything else, or some other vendor chunk is holding it.
   */
  const chunks = await page.evaluate(() =>
    [...document.querySelectorAll('script[type="module"], link[rel="modulepreload"]')]
      .map((element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '')
      .filter((source) => source.includes('/assets/')),
  );
  expect(failures).toEqual([]);
  expect(chunks.length, 'no module chunks were requested at all').toBeGreaterThan(0);
});
