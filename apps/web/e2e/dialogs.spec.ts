import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { stubApi } from './fixtures.js';

/**
 * The dialog contract, as Phase 1 left it.
 *
 * Phase 1 set out to make dialog open/close animate at full frame rate. It
 * measured first, and the measurement changed the phase: against the production
 * preview build, opening the three heaviest dialogs already cost **0 ms of total
 * blocking time and 0 long tasks**. There was nothing to speed up. The "5fps
 * dialog" was dev-mode axe, StrictMode double-mounts and unminified chunks.
 *
 * Two of the fixes drafted for it were tried and measured worse, so they are not
 * in the tree — and the two tests at the top of this file are what stop them
 * coming back, because both regressions were invisible to every other gate:
 *
 *   - Deferring the dialog BODY until the enter animation finished moved
 *     time-to-usable from ~110 ms to ~910 ms and raised dropped frames, to save
 *     blocking time that was already zero.
 *   - Making the footer `inert` for that window left a delete-confirmation
 *     dialog whose Cancel and Delete buttons did nothing for ~340 ms.
 *
 * The rest of the file pins what the phase did keep: reduced motion really is
 * motionless, the dialog surfaces are axe-clean in both themes, and the toast
 * stack still works. Frame timings are not asserted here — they belong to the
 * machine that measured them, and the numbers live in docs/PROGRESS.md.
 */

/** Long enough for any entrance animation on the page to have finished. */
const SETTLED_MS = 1_500;

/*
 * axe-core arrives transitively with @axe-core/react. Resolving it from THAT
 * package's own location works under pnpm's nested store and under a flat
 * node_modules alike, and survives a version bump — unlike walking up a fixed
 * number of `..` segments, which encodes one package manager's layout.
 */
const axeReactRequire = createRequire(createRequire(import.meta.url).resolve('@axe-core/react'));
const AXE_SOURCE = readFileSync(axeReactRequire.resolve('axe-core/axe.min.js'), 'utf8');

interface DialogScenario {
  name: RegExp;
  path: string;
  /** A control that exists only once the dialog's body has rendered. */
  bodyProbe: RegExp;
}

const SCENARIOS: DialogScenario[] = [
  { name: /new course/i, path: '/dashboard', bodyProbe: /^code/i },
  { name: /add a resource/i, path: '/courses/c-1', bodyProbe: /^title/i },
  { name: /add a user/i, path: '/admin/users', bodyProbe: /^name/i },
];

/**
 * Wait for an overlay's entrance to finish before auditing its colours.
 *
 * `waitFor()` resolves the instant an element is visible, which for anything that
 * fades in is the instant it starts — at opacity 0. axe then samples a
 * half-transparent surface and computes each colour BLENDED with whatever sits
 * behind it, so a palette that is fine reads as a contrast failure.
 *
 * This is not hypothetical. The notification panel was audited on WebKit at
 * opacity 0.583, which turned `--text-tertiary` (#505d70, 8.2:1 on white) into
 * #88919e at 3.1:1 and failed `color-contrast`. Chromium finished the same fade
 * before axe ran, so the identical suite was green on two projects and red on the
 * third — the worst shape a gate can take, because the red one looks like a real
 * regression in the palette and is not.
 *
 * Polling opacity rather than awaiting `getAnimations()`: motion drives springs on
 * the main thread, and those never appear in the WAAPI animation list.
 */
async function settled(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel) => {
    let node = document.querySelector(sel);
    if (!node) return false;
    for (; node; node = node.parentElement) {
      if (getComputedStyle(node).opacity !== '1') return false;
    }
    return true;
  }, selector);
}

async function openDialog(page: Page, scenario: DialogScenario): Promise<void> {
  await page.goto(scenario.path);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: scenario.name }).first().click();
  await page.getByRole('dialog').waitFor();
  await settled(page, 'body > [role="dialog"]');
}

interface AxeViolation {
  impact: string | null;
  id?: string;
}

/**
 * Run axe against the open overlay only.
 *
 * Scoped to the body-level portal because the gallery page carries static demo
 * markup that is not what any of these tests is about, and an unscoped run would
 * attribute it to the dialog.
 */
async function seriousViolations(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe?: {
          run: (
            context?: unknown,
            options?: unknown,
          ) => Promise<{ violations: Array<{ impact: string | null; id: string }> }>;
        };
      }
    ).axe;
    const { violations } = await axe!.run(
      { include: [['body > [role="dialog"]']] },
      { resultTypes: ['violations'] },
    );
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ impact: v.impact, id: v.id }));
  });
}

test.describe('a dialog is whole the moment it exists', () => {
  for (const scenario of SCENARIOS) {
    test(`"${scenario.name.source}" renders its body in the same commit as its chrome`, async ({
      page,
    }, testInfo) => {
      testInfo.setTimeout(20_000);
      await stubApi(page);
      await openDialog(page, scenario);

      /*
       * No `await expect(...).toBeVisible()` here, deliberately: that would
       * retry, and retrying is exactly what would hide a deferred body. The
       * dialog element already exists, so a synchronous count is the honest
       * question — is the form there YET, or does it arrive later?
       */
      const bodyControls = await page.getByRole('textbox', { name: scenario.bodyProbe }).count();
      expect(bodyControls, 'the body must not be deferred behind the enter animation').toBe(1);
    });
  }
});

test('a destructive confirm dialog can be answered immediately', async ({ page }, testInfo) => {
  testInfo.setTimeout(20_000);
  await stubApi(page);
  await page.goto('/admin/departments');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /Actions for Department 1/i }).click();
  await page.getByRole('menuitem', { name: /delete department/i }).click();

  const dialog = page.getByRole('dialog');
  await dialog.waitFor();

  // The whole point of a confirm dialog is its two buttons. Neither may be
  // disabled, nor sitting under an `inert` ancestor, at the moment it opens.
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] button')].map((button) => ({
      label: (button.textContent || button.getAttribute('aria-label') || '').trim(),
      unreachable: Boolean(button.closest('[inert]')) || (button as HTMLButtonElement).disabled,
    })),
  );

  expect(buttons.map((b) => b.label)).toEqual(
    expect.arrayContaining(['Close dialog', 'Cancel', 'Delete department']),
  );
  expect(buttons.filter((b) => b.unreachable)).toEqual([]);
});

test('prefers-reduced-motion leaves the dialog genuinely motionless', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubApi(page);
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');
  // Let the page's own entrance finish so it cannot pollute the sample — the
  // lesson from measuring accessibility mid-animation (docs/LESSONS-LEARNED #21).
  await page.waitForTimeout(SETTLED_MS);

  await page
    .getByRole('button', { name: /new course/i })
    .first()
    .click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(SETTLED_MS);

  const state = await page.evaluate(() => ({
    running: document.getAnimations().filter((a) => a.playState === 'running').length,
    transform: getComputedStyle(document.querySelector('[role="dialog"]') as Element).transform,
  }));
  expect(state.running).toBe(0);
  // Tailwind v4 emits `-translate-x-1/2` as the standalone `translate` property,
  // which composes with — and does not become — `transform`. So a card that is
  // centred but not animating still reports `none` here.
  expect(state.transform).toBe('none');
});

test.describe('accessibility of every dialog surface, in both themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const scenario of SCENARIOS) {
      test(`"${scenario.name.source}" (${theme}) has no serious or critical violations`, async ({
        page,
      }, testInfo) => {
        testInfo.setTimeout(30_000);
        await page.addInitScript((t) => localStorage.setItem('sw.theme', t), theme);
        await stubApi(page);
        await openDialog(page, scenario);
        await expect(page.getByRole('textbox', { name: scenario.bodyProbe })).toBeVisible();

        expect(await seriousViolations(page)).toEqual([]);
      });
    }

    test(`the design-gallery sheet (${theme}) has no serious or critical violations`, async ({
      page,
    }, testInfo) => {
      testInfo.setTimeout(30_000);
      await page.addInitScript((t) => localStorage.setItem('sw.theme', t), theme);
      await stubApi(page);
      await page.goto('/design');
      await page.waitForLoadState('networkidle');
      await page
        .getByRole('button', { name: /open sheet/i })
        .first()
        .click();
      await page.getByRole('dialog').waitFor();

      expect(await seriousViolations(page)).toEqual([]);
    });
  }
});

test.describe('the notification panel, which is a menu holding non-menu content', () => {
  /*
   * NEXT.md carries this as an open a11y debt, and it is worth a measurement rather
   * than another opinion.
   *
   * The panel is a Radix DropdownMenu — chosen for its roving arrow-key focus — and
   * its empty, loading and error branches are not menuitems. They are wrapped in
   * `role="none"`, which the component's own comment calls "the minimal fix". It is
   * not a complete one: presentation/none strips the WRAPPER's semantics and then
   * re-parents its children to the nearest ancestor with a role, which is still the
   * `menu`. The correct fix is a Popover, and it costs the roving focus — which is
   * why the trade was deferred rather than taken.
   *
   * So it was measured, and the measurement settled it: axe reports
   * `aria-required-children` at CRITICAL impact, in both themes —
   * "Element has children which are not allowed: [role=status]", pointing at
   * EmptyState's live region. The debt is real and axe can see it.
   *
   * This test therefore asserts the violation EXACTLY rather than asserting none.
   * A red test is not a gate, it is a thing people learn to ignore; an exact
   * characterisation is a ratchet in both directions. A NEW violation fails it, and
   * so does FIXING this one — which is the only reliable way to make the panel's
   * comment and NEXT.md's entry get deleted on the day they stop being true.
   */
  for (const theme of ['light', 'dark'] as const) {
    test(`has no serious or critical violations (${theme})`, async ({ page }, testInfo) => {
      testInfo.setTimeout(30_000);
      await page.addInitScript((t) => localStorage.setItem('sw.theme', t), theme);
      await stubApi(page);
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: /^Notifications/ }).click();
      const panel = page.getByRole('menu', { name: 'Notifications' });
      await panel.waitFor();
      await settled(page, '[role="menu"][aria-label="Notifications"]');

      // Scoped to the panel's own portal, so the shell behind it cannot be blamed
      // for — or absorb — anything the panel does.
      await page.addScriptTag({ content: AXE_SOURCE });
      const violations = await page.evaluate(async () => {
        const axe = (
          window as unknown as {
            axe?: {
              run: (
                context?: unknown,
                options?: unknown,
              ) => Promise<{ violations: Array<{ impact: string | null; id: string }> }>;
            };
          }
        ).axe;
        const { violations } = await axe!.run(
          { include: [['[role="menu"][aria-label="Notifications"]']] },
          { resultTypes: ['violations'] },
        );
        return violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => ({ impact: v.impact, id: v.id }));
      });

      /*
       * Exactly this, and only this. Written as the whole array so an additional
       * violation cannot hide behind a `toContainEqual`.
       */
      expect(violations).toEqual([{ id: 'aria-required-children', impact: 'critical' }]);
    });
  }
});

test('the toast stack still raises and dismisses', async ({ page }, testInfo) => {
  testInfo.setTimeout(20_000);
  await stubApi(page);
  await page.route('**/api/v1/users', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Internal error',
        status: 500,
        code: 'INTERNAL',
        requestId: 't-1',
      }),
    }),
  );
  await page.goto('/admin/users');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /add a user/i }).click();
  await page.getByRole('textbox', { name: /^name/i }).fill('Dana Okafor');
  await page.getByRole('textbox', { name: /email/i }).fill('dana@example.edu');
  await page.getByRole('combobox', { name: /role/i }).click();
  await page.getByRole('option', { name: /administrator/i }).click();
  await page.getByRole('button', { name: /add user/i }).click();

  // While the modal is open Radix aria-hides everything outside it, so a role
  // query cannot see the toast — a DOM-scoped locator is the honest probe.
  const dismiss = page.locator('button[aria-label="Dismiss notification"]').first();
  await dismiss.waitFor({ timeout: 10_000 });
  await dismiss.click();
  await expect(page.locator('button[aria-label="Dismiss notification"]')).toHaveCount(0);
});
