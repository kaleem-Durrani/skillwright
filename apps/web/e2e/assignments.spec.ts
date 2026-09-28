import { expect, test, type Page } from '@playwright/test';
import { courseDetail, paginated, userDetails } from './fixtures.js';

/**
 * The Assignments tab, driven in a browser against the PRODUCTION build.
 *
 * `mobile-shell.spec.ts` already sweeps every route for the two ADR 0008 rules at
 * 375px — no sideways scroll and 44px targets — and it is still the authority. What
 * this spec adds is the part that sweep structurally cannot see: the tab is a
 * CONTROLLED PANEL, and Radix mounts its content only once the trigger has been
 * activated. A route sweep visits `/courses/c-1` and measures whatever the default
 * panel rendered, which is the Resources tab, so every control the Assignments panel
 * introduced went unmeasured — and a 44px failure in a dialog is invisible until the
 * dialog is actually opened.
 *
 * So: open the tab, open the dialog, and measure inside both. The rules themselves
 * are restated rather than imported, and a copy drifting from the original is the
 * cost of not turning `mobile-shell.spec.ts`'s helpers into a module — which is
 * another agent's file and out of this phase's scope. The two numbers below are the
 * ones that matter and they are the same two.
 *
 * The API is stubbed at the network layer, which is the only reason this suite can
 * gate a push with no database. Shapes come from `fixtures.ts`' helpers, so a change
 * to a response schema makes the page render an error state and this fails loudly
 * rather than passing against a stale stub.
 */

const PHONE = { width: 375, height: 812 };

const nowIso = '2026-08-25T10:00:00.000Z';
const ASSIGNMENT_ID = 'as-1';
const OFFERING_ID = courseDetail.offerings[0]?.id ?? 'off-1';

/**
 * One committed hand-in, as `submissionSchema` serves it — and RETURNED, not
 * SUBMITTED, because the assertion this fixture exists for is about the returned
 * path. A stub that said SUBMITTED while the test spoke of work coming back would
 * have failed on the button label and taught nothing about the product.
 *
 * `score: null` and `scorePercent: null` below are the same point: a returned hand-in
 * has had NO mark, and the screen must say nothing about one.
 */
const submission = {
  id: 'sub-1',
  assignmentId: ASSIGNMENT_ID,
  enrollmentId: 'en-1',
  status: 'RETURNED',
  feedback: 'Undercut on two passes — run it again with the guide rail.',
  attempt: 1,
  score: null,
  submittedAt: nowIso,
  gradedAt: null,
  gradedBy: null,
  upload: {
    id: 'up-1',
    originalName: 'fillet-weld.pdf',
    contentType: 'application/pdf',
    sizeBytes: 2048,
  },
  createdAt: nowIso,
};

/** The two tasks the student sees: one untouched, one handed in. */
const myAssignments = [
  {
    id: ASSIGNMENT_ID,
    offeringId: OFFERING_ID,
    title: 'Weld the fillet',
    brief: 'Two runs of a 6mm fillet, all round, in the flat position.',
    dueAt: '2026-09-30T17:00:00.000Z',
    maxScore: 100,
    resourceId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    course: { id: courseDetail.id, name: courseDetail.name, code: courseDetail.code },
    submission: null,
    submissionCount: 0,
    scorePercent: null,
    overdue: false,
  },
  {
    id: 'as-2',
    offeringId: OFFERING_ID,
    title: 'Machine the flange',
    brief: 'Face and bore to the drawing on the bench sheet.',
    dueAt: '2026-08-01T17:00:00.000Z',
    maxScore: 50,
    resourceId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    course: { id: courseDetail.id, name: courseDetail.name, code: courseDetail.code },
    submission,
    submissionCount: 1,
    // A returned hand-in: sent back for another go, and NO mark. The screen must say
    // nothing about a score here — `0` would be a mark nobody gave.
    scorePercent: null,
    overdue: true,
  },
];

async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/auth/me') {
      return json({
        actor: { id: 'u-2', role: 'STUDENT', status: 'ACTIVE', provenance: 'PASSWORD' },
        user: userDetails(2, 'STUDENT'),
        expiresAt: '2026-12-31T00:00:00.000Z',
      });
    }
    if (path === `/courses/${courseDetail.id}`) return json(courseDetail);
    if (path === `/assignments/mine`) return json({ data: myAssignments });
    // The teacher's reader, in case a spec opens it: a bare array, no envelope.
    if (path === `/offerings/${OFFERING_ID}/assignments`) return json(myAssignments);
    return json(paginated([]));
  });
}

/** The course page with the Assignments panel OPEN, which is the point of this file. */
async function openAssignmentsTab(page: Page): Promise<void> {
  await stubApi(page);
  await page.setViewportSize(PHONE);
  await page.goto(`/courses/${courseDetail.id}`);
  await page.waitForLoadState('networkidle');
  await expect
    .poll(() => page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? 0), {
      timeout: 10_000,
    })
    .toBeGreaterThan(300);
  // Settle before measuring: LESSONS-LEARNED #21, sampling a page mid-fade measures
  // interpolated values rather than the ones a user ends up looking at.
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: 'Assignments' }).click();
  await expect(page.getByText('Weld the fillet')).toBeVisible();
}

interface Measurement {
  offenders: Array<{ tag: string; label: string; width: number; height: number }>;
  measured: number;
}

/**
 * Every rendered control, and the size a thumb would actually have to hit.
 *
 * Simplified from `mobile-shell.spec.ts`'s version, which unions a control with its
 * `<label>` and with the `::after` overlay `Card interactive` hangs off a link — both
 * are real accommodations and neither applies to anything on this screen, so the copy
 * measures the control's own box and says so.
 *
 * The 44px floor and its half-pixel of slack are INSIDE `evaluate` because the
 * measurement runs in the page and a closure does not cross the boundary; the values
 * are therefore not shared with the assertions above, which is stated rather than
 * hidden.
 */
async function measureControls(page: Page, root: string): Promise<Measurement> {
  return page.evaluate((selector) => {
    const TOUCH_MIN = 44;
    const TOUCH_SLACK = 0.5;
    const scope = document.querySelector(selector) ?? document.body;
    const nodes = scope.querySelectorAll('button, a, input, select, textarea');
    const offenders: Array<{
      tag: string;
      label: string;
      width: number;
      height: number;
    }> = [];
    let measured = 0;

    for (const element of nodes) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (element.getClientRects().length === 0) continue;
      if (element.closest('[aria-hidden="true"]')) continue;

      const rect = element.getBoundingClientRect();
      measured += 1;
      if (rect.height + TOUCH_SLACK < TOUCH_MIN || rect.width + TOUCH_SLACK < TOUCH_MIN) {
        offenders.push({
          tag: element.tagName,
          label: (element.getAttribute('aria-label') ?? element.textContent ?? '').slice(0, 60),
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        });
      }
    }
    return { offenders, measured };
  }, root) as Promise<Measurement>;
}

/**
 * The same two rules, measured against an ARBITRARY selector.
 *
 * Needed because `measureControls` above selects `button, a, input, select,
 * textarea`, and a Radix `SelectItem` is a `div[role="option"]` — none of those five.
 * Pointing the shared helper at the listbox would therefore measure ZERO controls
 * and pass, which is the vacuous pass its own count assertion exists to prevent.
 * A selector that cannot see the thing is not a measurement of it.
 */
async function measureBoxes(page: Page, selector: string): Promise<Measurement> {
  return page.evaluate((sel) => {
    const TOUCH_MIN = 44;
    const TOUCH_SLACK = 0.5;
    const offenders: Array<{
      tag: string;
      label: string;
      width: number;
      height: number;
    }> = [];
    let measured = 0;

    for (const element of document.querySelectorAll<HTMLElement>(sel)) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (element.getClientRects().length === 0) continue;
      if (element.closest('[aria-hidden="true"]')) continue;

      const rect = element.getBoundingClientRect();
      measured += 1;
      if (rect.height + TOUCH_SLACK < TOUCH_MIN || rect.width + TOUCH_SLACK < TOUCH_MIN) {
        offenders.push({
          tag: element.tagName,
          label: (element.getAttribute('aria-label') ?? element.textContent ?? '').slice(0, 60),
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        });
      }
    }
    return { offenders, measured };
  }, selector) as Promise<Measurement>;
}

test.describe('the assignments tab at 375px', () => {
  test.beforeEach(async ({ page }) => {
    await openAssignmentsTab(page);
  });

  test('does not scroll sideways', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // One pixel of slack for subpixel layout; a body wider than the viewport is ADR
    // 0008's failure and the reason this rule exists at all.
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('names the task, its deadline and what it is out of', async ({ page }) => {
    await expect(page.getByText('Weld the fillet')).toBeVisible();
    // The brief in full, not clamped: a student who has to guess what a task wants is
    // a student who guesses wrong.
    await expect(page.getByText(/Two runs of a 6mm fillet/)).toBeVisible();
    await expect(page.getByText(/out of 100/)).toBeVisible();
  });

  test('says a returned task is overdue and was sent back, and never invents a mark', async ({
    page,
  }) => {
    await expect(page.getByText('Machine the flange')).toBeVisible();
    await expect(page.getByText(/deadline passed/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hand in again' })).toBeVisible();
    // A zero is a mark somebody gave. Nothing on this screen may render one.
    await expect(page.getByText(/\b0%/)).toHaveCount(0);
  });

  test('holds 44px on every control in the panel', async ({ page }) => {
    const { offenders, measured } = await measureControls(page, 'main');
    // The count first, so a panel that rendered its empty state and had nothing to
    // measure cannot pass the floor by having no controls at all.
    expect(
      measured,
      'the Assignments panel measured too few controls to mean anything',
    ).toBeGreaterThanOrEqual(4);
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});

test.describe('the hand-in dialog at 375px', () => {
  test('opens, states the limits before the picker, and is reachable by thumb', async ({
    page,
  }) => {
    await openAssignmentsTab(page);
    await page.getByRole('button', { name: 'Hand in your work' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The limits are the field's hint, which is `aria-describedby` — so they are read
    // when the control takes focus, before the chooser opens and long before a 422.
    await expect(dialog.getByText(/Up to/)).toBeVisible();

    const { offenders, measured } = await measureControls(page, '[role="dialog"]');
    expect(measured, 'the hand-in dialog measured too few controls').toBeGreaterThanOrEqual(3);
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The brief picker
// ---------------------------------------------------------------------------

/**
 * The one file a teacher can attach to a task, as `resourceSchema` serves it.
 *
 * The list it comes from is `GET /courses/:courseId/resources` — the SAME request the
 * Resources tab makes, and the same one the picker reads. Stubbing it here rather
 * than inventing a route is the point: a stub for an endpoint the app does not call
 * would let the picker regress to fetching something of its own without a single
 * test going red.
 */
const courseResource = {
  id: 'r-brief',
  title: 'Fillet weld worksheet',
  description: 'The printable version of the week three notes.',
  type: 'DOCUMENT',
  courseId: courseDetail.id,
  courseName: courseDetail.name,
  author: { id: 'u-1', name: 'Person 1', role: 'TEACHER', avatarUrl: null },
  isPublic: false,
  uploadId: 'up-brief',
  externalUrl: null,
  sizeBytes: 2048,
  contentType: 'application/pdf',
  commentCount: 0,
  createdAt: nowIso,
  updatedAt: nowIso,
};

/**
 * The task dialog, opened by the person who is allowed to open it.
 *
 * The student session above cannot reach this: `assignment:create` is refused to a
 * student, so the button is not rendered at all and there is no dialog to measure. A
 * spec that opened it under that session would measure an empty page and pass.
 */
async function openTaskDialog(page: Page): Promise<void> {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/auth/me') {
      return json({
        actor: { id: 'u-1', role: 'TEACHER', status: 'ACTIVE', provenance: 'PASSWORD' },
        user: userDetails(1, 'TEACHER'),
        expiresAt: '2026-12-31T00:00:00.000Z',
      });
    }
    if (path === `/courses/${courseDetail.id}`) return json(courseDetail);
    if (path === `/courses/${courseDetail.id}/resources`) return json(paginated([courseResource]));
    // A bare array, which is what the teacher's reader is served. Empty, so the
    // panel shows its empty state and the dialog opens from there.
    if (path === `/offerings/${OFFERING_ID}/assignments`) return json([]);
    return json(paginated([]));
  });

  await page.setViewportSize(PHONE);
  await page.goto(`/courses/${courseDetail.id}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: 'Assignments' }).click();
  await page.getByRole('button', { name: 'Set a task' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('the task dialog at 375px', () => {
  test('offers the course files, and a brief stays optional', async ({ page }) => {
    await openTaskDialog(page);
    const dialog = page.getByRole('dialog');

    // Optional, and it says so before it is touched rather than after a 422.
    await expect(dialog.getByRole('combobox', { name: 'Attached file' })).toBeVisible();
    await expect(dialog.getByText(/Optional\./)).toBeVisible();

    // The default is no file, which is a legitimate state and not a blank control.
    await expect(dialog.getByRole('combobox', { name: 'Attached file' })).toHaveText(/No file/);
  });

  test('holds 44px on the picker trigger and on every option in the list', async ({ page }) => {
    await openTaskDialog(page);
    const dialog = page.getByRole('dialog');

    const trigger = dialog.getByRole('combobox', { name: 'Attached file' });
    const closed = await measureControls(page, '[role="dialog"]');
    // The count first, for the reason the panel test gives: a dialog that rendered
    // its error state would have nothing to measure and would pass the floor.
    expect(closed.measured, 'the task dialog measured too few controls').toBeGreaterThanOrEqual(5);
    expect(closed.offenders, JSON.stringify(closed.offenders, null, 2)).toEqual([]);

    await trigger.click();
    // The list is portalled to the body, OUTSIDE the dialog — which is exactly why a
    // measurement scoped to `[role="dialog"]` cannot see the options at all.
    const option = page.getByRole('option', { name: /Fillet weld worksheet/ });
    await expect(option).toBeVisible();

    /*
     * Settle BEFORE measuring, and the reason is a number rather than a habit.
     * `SelectContent` wraps its viewport in a Motion element, and the pop transition
     * scales it: measured the instant the list appeared, every option reported
     * 43.4px — 44 multiplied by a scale factor still on its way to 1 — and a 44px
     * assertion failed against a control that is exactly 44px. This is LESSONS-LEARNED
     * #21 with a transform rather than an opacity: `getBoundingClientRect` returns the
     * TRANSFORMED box, so an animation in flight is a measurement of the animation.
     */
    await page.waitForTimeout(600);

    const open = await measureBoxes(page, '[role="listbox"] [role="option"]');
    expect(open.measured, 'the picker list measured too few options').toBeGreaterThanOrEqual(2);
    expect(open.offenders, JSON.stringify(open.offenders, null, 2)).toEqual([]);
  });

  test('never scrolls sideways with the picker open', async ({ page }) => {
    await openTaskDialog(page);
    await page.getByRole('combobox', { name: 'Attached file' }).click();
    await expect(page.getByRole('option', { name: /Fillet weld worksheet/ })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
