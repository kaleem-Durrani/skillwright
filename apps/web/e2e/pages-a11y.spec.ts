import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { stubApi } from './fixtures.js';

/**
 * Whole-page accessibility, on the screens a signed-in person actually uses.
 *
 * The README claims axe-clean screens in both themes. Until this file existed
 * that claim rested on a manual pass driven by hand in August — `dialogs.spec.ts`
 * scopes its run to the open overlay, deliberately, so nothing in the suite had
 * ever audited a whole page. A claim on the front page of a repository should
 * have a test under it.
 *
 * It also guards a specific structural change. Phase 2 moved every screen's `<h1>`
 * out of `<main>` and into the top bar's `banner` landmark, which is exactly the
 * kind of edit that produces `heading-order`, `landmark-unique` or a page with no
 * level-one heading at all. It did not — but only because it was checked.
 *
 * Serious and critical only. axe's `moderate` and `minor` findings on this app are
 * dominated by colour-contrast judgements on decorative borders, and a gate that
 * cries about those is a gate people learn to skip.
 */

const axeReactRequire = createRequire(createRequire(import.meta.url).resolve('@axe-core/react'));
const AXE_SOURCE = readFileSync(axeReactRequire.resolve('axe-core/axe.min.js'), 'utf8');

/** One per layout shape: dashboard, list, admin sub-nav, detail, feed. */
const PAGES = ['/dashboard', '/courses', '/admin/users', '/courses/c-1', '/announcements'];

for (const path of PAGES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${path} has no serious or critical violations (${theme})`, async ({ page }, testInfo) => {
      testInfo.setTimeout(30_000);
      await page.addInitScript((t) => localStorage.setItem('sw.theme', t), theme);
      await stubApi(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      /*
       * Settle before sampling. Measuring accessibility mid-animation is
       * LESSONS-LEARNED #21: an early run reported ~40 contrast violations
       * including impossible ones — 1.12:1 between colours nobody chose — because
       * it caught elements halfway through a fade.
       */
      await page.waitForTimeout(600);

      await page.addScriptTag({ content: AXE_SOURCE });
      const violations = await page.evaluate(async () => {
        const axe = (
          window as unknown as {
            axe?: {
              run: (
                context: unknown,
                options?: unknown,
              ) => Promise<{ violations: Array<{ impact: string | null; id: string }> }>;
            };
          }
        ).axe;
        const { violations } = await axe!.run(document, { resultTypes: ['violations'] });
        return violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => ({ id: v.id, impact: v.impact }));
      });

      expect(violations).toEqual([]);
    });
  }
}
