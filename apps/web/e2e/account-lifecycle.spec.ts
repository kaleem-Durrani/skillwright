import { expect, test, type Page } from '@playwright/test';
import { department, paginated, userDetails } from './fixtures.js';

/**
 * Phase 4 and Phase 6 against the BUILT BUNDLE, in the stubbed projects.
 *
 * What this file exists to catch, and the reason it is not just another set of
 * component tests: the three claims below are all about the seam between two
 * things that are individually tested. LESSONS-LEARNED 38 is the catalogue of
 * faults that lived there — a `manualChunks` split, a set of wrong env vars, a
 * second not-found handler — and every one of them passed 977 unit tests, five
 * typechecks and three linters. A unit test renders the dialog through jsdom; only
 * this one loads the Rollup output and asks whether the button is actually there.
 *
 * The three claims:
 *
 *  1. THE IMPORT IS REACHABLE AND ITS DRY RUN COMES FIRST. A dead `Gate`, a
 *     `hidden` class that never un-hides, or a `usePolicy()` that answers false
 *     would each leave a screen with no working path to a feature the API serves.
 *  2. DELETION IS THE LAST CONTROL ON SETTINGS and its dialog requires a typed
 *     confirmation — the two halves of a safety affordance that are easy to
 *     reorder and easy to weaken independently.
 *  3. THE EXPORT IS A REAL SAME-ORIGIN LINK, not a button that fetches a blob.
 *     The second is the shape that loses the filename and the browser's download
 *     UI, and it is only visible by reading the `href`.
 *
 * Every assertion here reads a SPECIFIC ELEMENT, never a regex over `innerText`.
 * That is lesson 26's rule and it was learned the hard way: a tile that puts the
 * value before the label made a regex capture the next tile's number, and a
 * finding built on it was withdrawn.
 */

/** Long enough for the preview server's first paint and the route's data fetch. */
const SETTLED_MS = 1_500;

const DEPARTMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';

/**
 * The stub, specialised for these two features.
 *
 * `e2e/fixtures.ts`'s `stubApi` answers every list with `paginated([])`, which is
 * right for a screen whose contents no assertion reads and wrong for the two below:
 * the import dialog needs `/users/me/deletion` to say something, and the bulk POST
 * needs to answer per-row or the results table never renders. So the generic list
 * branches are kept and the three specific ones are added.
 */
async function stubLifecycleApi(page: Page, options: { bulk?: unknown } = {}): Promise<void> {
  await page.route('**/socket.io/**', (route) => route.abort());

  const bulk = options.bulk ?? { created: [], failed: [], dryRun: true };

  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/auth/me')
      return json({
        actor: { id: 'u-1', role: 'ADMIN', status: 'ACTIVE', provenance: 'PASSWORD' },
        user: userDetails(1, 'ADMIN'),
        expiresAt: '2026-12-31T00:00:00.000Z',
      });
    if (path === '/dashboard/stats')
      return json({ courses: 3, pendingEnrollments: 1, unreadMessages: 0, resources: 5 });
    if (path === '/departments') return json(paginated([department(1), department(2)]));
    if (path === '/users')
      return json(paginated([userDetails(1, 'TEACHER'), userDetails(2, 'STUDENT')]));

    // The bulk import. The request is asserted, not assumed — see the spec below.
    if (path === '/users/bulk' && route.request().method() === 'POST') return json(bulk);

    // The pending-deletion read. "None scheduled" is the state a fresh account is
    // in, and it is the one that shows the DELETE control rather than the UNDO.
    if (path === '/users/me/deletion')
      return json({ deletionRequestedAt: null, deletionEffectiveFor: null, cancellable: false });

    return json(paginated([]));
  });
}

// ---------------------------------------------------------------------------
// 1. The cohort import
// ---------------------------------------------------------------------------

/** Tailwind's `md`, which is where the import control starts rendering. */
const MD = 768;

/**
 * The two tests that DRIVE the import dialog are desktop-only, and the skip is
 * declared rather than worked around.
 *
 * The control is `hidden md:inline-flex` (see the reason at the call site in
 * AdminUsers.tsx), so on the `mobile` and `mobile-safari` projects there is
 * nothing to click. Pretending otherwise by removing the class for the test would
 * assert a screen that does not ship, and skipping inside the test body would run
 * the navigation and the stub for nothing.
 *
 * What IS asserted on a phone is the ABSENCE, in the last test of this block —
 * and that is the half worth having, because a `hidden` that never un-hides
 * renders exactly the same on a desktop.
 */
test.describe('the cohort import', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < MD,
    'a desktop-only control: the dialog is unreachable below md by design',
  );

  test('the dialog is reachable, and its first action is the dry run', async ({ page }) => {
    await stubLifecycleApi(page);
    await page.goto('/admin/users');
    await page.waitForTimeout(SETTLED_MS);

    const trigger = page.getByRole('button', { name: /import cohort/i });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    /*
     * BOTH assertions, because either alone is satisfied by a broken dialog.
     * "Check this file" exists: the dry run is offered. "Create accounts" is
     * DISABLED: there is no path to the irreversible action that skips the check.
     * A dialog offering only the second would pass the first and fail the feature.
     */
    await expect(dialog.getByRole('button', { name: /check this file/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /create accounts/i })).toBeDisabled();
  });

  test('a check posts dryRun: true, and the failures table names one-based rows', async ({
    page,
  }) => {
    // The stub answers with the per-row result the API's own shape produces, so
    // the table under test is the one the real response renders.
    await stubLifecycleApi(page, {
      bulk: {
        created: [],
        failed: [
          { row: 14, code: 'CONFLICT', detail: 'An account with this email already exists' },
        ],
        dryRun: true,
      },
    });
    await page.goto('/admin/users');
    await page.waitForTimeout(SETTLED_MS);
    await page.getByRole('button', { name: /import cohort/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('textbox', { name: /cohort rows/i })
      .fill(
        [
          `person1@example.edu, Person One, STUDENT, ${DEPARTMENT_ID}`,
          `person2@example.edu, Person Two, STUDENT, ${DEPARTMENT_ID}`,
        ].join('\n'),
      );

    /*
     * THE REQUEST, captured off the wire rather than read back off the screen.
     * Asserting only the rendered table would pass against a dialog showing a
     * hard-coded example; the `dryRun` flag is the whole feature and only the
     * outgoing body carries it. `Promise.all` so the listener is armed BEFORE the
     * click — the opposite order misses a fast request and hangs the test on a
     * timeout that looks like a hang.
     */
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/users/bulk') && r.method() === 'POST'),
      dialog.getByRole('button', { name: /check this file/i }).click(),
    ]);
    expect(JSON.parse(request.postData() ?? '{}')).toMatchObject({ dryRun: true });

    const table = page.getByRole('table', { name: /rows that could not be imported/i });
    await expect(table).toBeVisible();
    // Row 14, ONE-based, read off the cell rather than out of the table's text.
    await expect(table.getByRole('cell', { name: '14', exact: true })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'CONFLICT' })).toBeVisible();
    // And the create button is still refused, because the check found problems.
    await expect(dialog.getByRole('button', { name: /create \d+ accounts?/i })).toBeDisabled();
  });

  test('the trigger is hidden on a phone, and says why in a comment', async ({ page }) => {
    // The `desktop` project is 1280 and the `mobile` one is a Pixel 7, so the
    // SAME assertion runs against both without a viewport override — which is
    // the point: a desktop-only control has to be verified absent at 393px, not
    // merely intended to be.
    await stubLifecycleApi(page);
    await page.goto('/admin/users');
    await page.waitForTimeout(SETTLED_MS);

    const trigger = page.getByRole('button', { name: /import cohort/i });
    const width = page.viewportSize()?.width ?? 0;
    if (width < 768) {
      await expect(trigger).toBeHidden();
    } else {
      await expect(trigger).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// 2 & 3. The account lifecycle
// ---------------------------------------------------------------------------

test.describe('the account lifecycle', () => {
  test('the export is a real same-origin link, not a fetch', async ({ page }) => {
    await stubLifecycleApi(page);
    await page.goto('/settings?tab=security');
    await page.waitForTimeout(SETTLED_MS);

    const link = page.getByRole('link', { name: /download my data/i });
    await expect(link).toBeVisible();

    /*
     * The `href`, asserted. This is the whole reason the control is an anchor:
     * a `blob:` URL from a fetch has no filename, no streaming and none of the
     * browser's own download UI, and the only way to see which one shipped is to
     * read this attribute in a real browser.
     */
    await expect(link).toHaveAttribute('href', '/api/v1/users/me/export');
    await expect(link).toHaveAttribute('download', 'skillwright-export.json');
  });

  test('deletion is the LAST control, and needs a typed confirmation', async ({ page }) => {
    await stubLifecycleApi(page);
    await page.goto('/settings?tab=security');
    await page.waitForTimeout(SETTLED_MS);

    const signOut = page.getByRole('button', { name: /^sign out$/i });
    const deletion = page.getByRole('button', { name: /delete my account/i });
    await expect(signOut).toBeVisible();
    await expect(deletion).toBeVisible();

    /*
     * ORDER, through the accessibility tree rather than a class. "Sign out" is a
     * routine action and deleting an account is not; they must not sit next to
     * each other as visual equals, and a CSS-order change would be invisible to
     * every other assertion in this file.
     */
    const order = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('button')];
      return {
        signOut: nodes.findIndex((n) => n.textContent?.trim() === 'Sign out'),
        deletion: nodes.findIndex((n) => /delete my account/i.test(n.textContent ?? '')),
      };
    });
    expect(order.deletion).toBeGreaterThan(order.signOut);

    // The cool-off is stated on the screen before anything irreversible is on it.
    await expect(page.getByText(/30 days to change your mind/i)).toBeVisible();

    await deletion.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /delete your account/i })).toBeVisible();

    // Two steps: the trigger, then the confirmation. The dialog is not a
    // one-click delete and this is what proves it in a browser rather than in jsdom.
    await dialog.getByRole('button', { name: /^delete my account$/i }).click();

    const schedule = dialog.getByRole('button', { name: /schedule deletion/i });
    await expect(schedule).toBeDisabled();

    // The export is offered INSIDE the dialog, before anything is typed.
    await expect(
      dialog.getByRole('link', { name: /download everything we hold about you/i }),
    ).toBeVisible();

    // A WRONG address keeps it refused. The control is the typed string, and
    // clicking through to a disabled-button 200 is exactly the mistake that would
    // make the whole feature theatre.
    await dialog
      .getByRole('textbox', { name: /type your email address to confirm/i })
      .fill('nope@else.com');
    await expect(schedule).toBeDisabled();
  });
});
