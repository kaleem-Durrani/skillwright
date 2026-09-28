import { expect, test, type Page } from '@playwright/test';
import { courseDetail, department, paginated, userDetails } from './fixtures.js';

/**
 * The mobile-first contract, asserted rather than asserted-to.
 *
 * These run against the real build in the `mobile` project first, which is the
 * whole point: the baseline is what ships to a student on a phone in a workshop.
 *
 * ADR 0008 says mobile-first is a build constraint and not a design intention,
 * and it names two things the phone must be able to do: nothing scrolls
 * sideways, and every interactive control is at least 44x44 CSS px. Until this
 * file was generalised both of those were asserted on `/login` and nowhere else.
 * Seventeen of the twenty-two leaf routes — including every one inside the
 * authenticated shell, which is the chrome that has to work on a phone at all —
 * were unmeasured, and `fill-height.spec.ts` forces 1280x900, so nothing else in
 * the suite was covering the baseline either. A rule that is checked on one
 * screen out of twenty-two is a rule about that screen.
 *
 * So the list below is every leaf route in `src/routes`, and the two rules run
 * against all of them. The two screens named in the brief as the densest — the
 * dashboard, a course detail and the admin tables — get a second, stricter pass
 * that also counts how many controls it actually measured, because a page that
 * rendered nothing would otherwise sail through a 44px assertion vacuously.
 */

const PHONE = { width: 375, height: 812 };

/** Tailwind's `md`, which is where AppShell swaps the tab bar for a sidebar. */
const MD = 768;

/** 44px, with half a pixel of slack for subpixel layout. */
const TOUCH_MIN = 44;
const TOUCH_SLACK = 0.5;

const nowIso = '2026-08-25T10:00:00.000Z';

const resource = {
  id: 'r-1',
  title: 'Safety handbook',
  description: 'Read this before you touch anything.',
  type: 'DOCUMENT',
  courseId: 'c-1',
  courseName: courseDetail.name,
  author: { id: 'u-1', name: 'Person 1', role: 'TEACHER', avatarUrl: null },
  isPublic: false,
  uploadId: 'up-1',
  externalUrl: null,
  sizeBytes: 1024,
  contentType: 'application/pdf',
  commentCount: 0,
  createdAt: nowIso,
};

const announcement = {
  id: 'a-1',
  title: 'Workshop Saturday',
  slug: 'workshop-saturday',
  type: 'NEWS',
  excerpt: 'The workshop moves to 09:00.',
  content:
    'The workshop moves to 09:00 on Saturday. Bring your own protective equipment, and the handbook linked below.',
  author: { id: 'u-1', name: 'Person 1', role: 'ADMIN', avatarUrl: null },
  eventDate: null,
  publishedAt: nowIso,
  createdAt: nowIso,
  commentCount: 2,
  updatedAt: nowIso,
};

const departmentDetail = {
  ...department(1),
  description: 'Everything with a welding torch in it.',
  courseCount: 3,
  teacherCount: 4,
  studentCount: 61,
  createdAt: nowIso,
  updatedAt: nowIso,
};

/**
 * The two detail records Phase 5 added, built from the same exported helpers as
 * everything else above.
 *
 * `userDetails(n, role)` is `fixtures.ts`'s own factory and already carries every
 * field `userDetailSchema` declares, so the user detail page gets a real record
 * rather than a list envelope. The enrolment has to be hand-written: no fixture
 * exports one, and a catch-all `paginated([])` handed to a page that calls
 * `.student.name` renders its error state — which holds one button, and a
 * 44px assertion over one button is a rule about nothing.
 */
const userDetailRecord = {
  ...userDetails(2, 'STUDENT'),
  phoneNumber: '+44 161 555 0142',
  bio: 'Runs the Thursday evening workshop.',
  mfaEnabled: true,
  lastLoginAt: nowIso,
  studentProfile: {
    departmentId: 'dep-2',
    departmentName: 'Fabrication',
    enrollmentNo: 'ENR-0099',
    enrolledOn: nowIso,
  },
};

const enrollmentDetail = {
  id: 'e-1',
  status: 'APPROVED',
  student: { id: 'u-2', name: 'Person 2', role: 'STUDENT', avatarUrl: null },
  course: {
    id: 'c-1',
    code: 'WELD-101',
    slug: 'course-1',
    name: courseDetail.name,
    department,
    teacher: { id: 'u-1', name: 'Person 1', role: 'TEACHER', avatarUrl: null },
    duration: { value: 6, unit: 'WEEK' },
    publishedAt: nowIso,
  },
  offering: {
    id: 'off-1',
    startDate: nowIso,
    endDate: null,
    capacity: 20,
    workshopCapacity: 8,
    approvedCount: 2,
    seatsRemaining: 18,
    isFull: false,
    workshopSeatsRemaining: 6,
  },
  requestedAt: nowIso,
  decidedAt: nowIso,
  decidedBy: { id: 'u-1', name: 'Person 1', role: 'TEACHER', avatarUrl: null },
  decisionNote: 'Portfolio accepted in place of the certificate.',
  completedAt: null,
  completedBy: null,
};

/**
 * `fixtures.ts`' `stubApi`, plus the three detail endpoints it does not carry.
 *
 * The catch-all in the shared stub answers `paginated([])`, and a detail screen
 * handed a list renders its "unavailable" empty state — which has almost no
 * controls in it, so the 44px rule would pass on a screen that was never
 * measured. `fixtures.ts` is another agent's file and is not touched here; the
 * extra endpoints live in the spec that needs them, built from the same exported
 * shape helpers.
 */
async function stubApi(page: Page, signedIn: boolean): Promise<void> {
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    /*
     * An anonymous visitor is a real, valid state (guards.ts sends a 401 to
     * `{ user: null }` rather than treating it as an error), and `fixtures.ts`'s
     * stub signs everyone in. Answering `/auth/me` with 401 for the six
     * signed-out routes is what lets `/register`'s `redirectIfAuthenticated`
     * stay quiet instead of bouncing every one of them to `/dashboard`.
     */
    if (path === '/auth/me') {
      if (!signedIn) {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            code: 'UNAUTHENTICATED',
          }),
        });
      }
      return json({
        actor: { id: 'u-1', role: 'ADMIN', status: 'ACTIVE', provenance: 'LOCAL' },
        user: userDetails(1, 'ADMIN'),
        expiresAt: '2026-12-31T00:00:00.000Z',
      });
    }
    if (!signedIn) return json(paginated([]));

    if (path === '/dashboard/stats')
      return json({ courses: 3, pendingEnrollments: 1, unreadMessages: 0, resources: 5 });
    if (path === '/departments') return json(paginated([department(1), department(2)]));
    if (path === '/departments/dep-1') return json(departmentDetail);
    if (path === '/users')
      return json(paginated([userDetails(1, 'TEACHER'), userDetails(2, 'STUDENT')]));
    if (path === '/courses') return json(paginated([courseDetail]));
    if (path === '/courses/c-1') return json(courseDetail);
    if (path === '/courses/c-1/resources') return json(paginated([resource]));
    if (path === '/resources/r-1') return json(resource);
    /*
     * Phase 5's two new detail routes. They are here rather than only in
     * `phase5-holes.spec.ts` because this file is what the mobile-first contract
     * is measured by, and a new page that is not in `ROUTES` is a page nobody has
     * measured — which is the exact gap the ROUTES list exists to close.
     */
    if (path === '/users/u-1') return json(userDetailRecord);
    if (path === '/enrollments/e-1') return json(enrollmentDetail);
    if (path === '/enrollments/e-1/attendance') {
      return json({ counts: { PRESENT: 3, ABSENT: 1, LATE: 0 }, total: 4, recent: [] });
    }
    if (path === '/announcements') return json(paginated([announcement]));
    if (path === '/announcements/a-1') return json(announcement);

    // Everything else is a list the screen may ask for but no assertion reads.
    return json(paginated([]));
  });
}

interface LeafRoute {
  path: string;
  /** Whether the shell — and therefore the tab bar — renders for this route. */
  signedIn: boolean;
  /**
   * The fewest controls this screen may be measured against. A page that
   * rendered a skeleton, an error state or a redirect target would otherwise
   * satisfy both rules by measuring nothing.
   */
  minControls: number;
}

/** Every leaf route in `src/routes`, with a real id where the route takes one. */
const ROUTES: LeafRoute[] = [
  { path: '/', signedIn: false, minControls: 1 },
  { path: '/login', signedIn: false, minControls: 3 },
  { path: '/register', signedIn: false, minControls: 2 },
  { path: '/verify-email', signedIn: false, minControls: 1 },
  { path: '/forgot-password', signedIn: false, minControls: 2 },
  { path: '/reset-password', signedIn: false, minControls: 2 },
  { path: '/design', signedIn: false, minControls: 1 },
  { path: '/dashboard', signedIn: true, minControls: 4 },
  { path: '/courses', signedIn: true, minControls: 4 },
  { path: '/courses/c-1', signedIn: true, minControls: 4 },
  { path: '/resources/r-1', signedIn: true, minControls: 3 },
  { path: '/announcements', signedIn: true, minControls: 4 },
  { path: '/announcements/a-1', signedIn: true, minControls: 3 },
  { path: '/messages', signedIn: true, minControls: 4 },
  { path: '/notifications', signedIn: true, minControls: 4 },
  { path: '/search', signedIn: true, minControls: 2 },
  { path: '/settings', signedIn: true, minControls: 4 },
  { path: '/departments/dep-1', signedIn: true, minControls: 4 },
  /*
   * Phase 5's two detail pages, on exactly the same two rules as every other
   * route above — which is the point of this list being every leaf route rather
   * than a selection: a new page that is not in it is a page nobody measured.
   *
   * `minControls` COUNTED, not guessed, from the rendered accessibility tree at
   * 375px: the shell's own controls plus this page's. Five here against four for
   * the enrolment is the difference between a page that has an Edit action and
   * one that does not, and it is the number that stops the 44px rule passing
   * vacuously over an error state — which holds one button and would satisfy both
   * rules with nothing measured.
   */
  { path: '/users/u-1', signedIn: true, minControls: 5 },
  { path: '/enrollments/e-1', signedIn: true, minControls: 4 },
  { path: '/admin', signedIn: true, minControls: 4 },
  { path: '/admin/users', signedIn: true, minControls: 4 },
  { path: '/admin/courses', signedIn: true, minControls: 4 },
  { path: '/admin/departments', signedIn: true, minControls: 4 },
];

/**
 * The densest screens, called out separately.
 *
 * Not because they are exempt from the sweep above — they are in it — but
 * because they are where a regression would land first: a stat tile, a course
 * header with three actions, and a card list standing in for a table. Each one
 * also asserts the number of controls it measured, so "the page rendered an
 * error state and there was nothing to check" cannot pass.
 */
/**
 * The dense screens and how many controls each is expected to render, counted
 * by hand against the real screens. The counts are what make the 44px assertion
 * on a dense screen mean something: a table that has collapsed to its error
 * state still satisfies "no control is under 44px", because there are none.
 */
const DENSE: Array<{ path: string; count: number }> = [
  { path: '/dashboard', count: 4 },
  { path: '/courses/c-1', count: 6 },
  { path: '/admin/users', count: 8 },
  { path: '/admin/courses', count: 8 },
  { path: '/admin/departments', count: 8 },
];

async function openPhone(page: Page, route: LeafRoute): Promise<void> {
  await stubApi(page, route.signedIn);
  await page.setViewportSize(PHONE);
  await page.goto(route.path);
  // The route chunk lands after the load event; `networkidle` is what proves it
  // arrived and executed.
  await page.waitForLoadState('networkidle');
  // And `networkidle` is not a commit. See build-smoke.spec.ts for why this is
  // a poll rather than a read.
  await expect
    .poll(() => page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? 0), {
      timeout: 10_000,
      message: `#root stayed empty on ${route.path}`,
    })
    .toBeGreaterThan(300);
  // Settle before measuring. LESSONS-LEARNED #21: sampling a page mid-fade
  // measures interpolated values, not the ones a user ends up looking at.
  await page.waitForTimeout(300);
}

interface Offender {
  tag: string;
  label: string;
  width: number;
  height: number;
}

interface Measurement {
  /** How many controls were actually measured — the anti-vacuity number. */
  measured: number;
  /** The smallest side of any of them, in px. */
  tightest: number;
  /** The ones under the floor. */
  offenders: Offender[];
}

/**
 * Measure every visible control on the page.
 *
 * One `evaluate` rather than a `boundingBox()` per control: this runs 22 routes
 * across three projects, and a per-element round trip is what turned the
 * original single-page version from a second into a minute.
 *
 * The inline-`<a>` exemption is carried over verbatim and is deliberately NOT
 * widened. An inline text link inside a paragraph inherits the line box, and
 * padding it to 44px would break the paragraph — that is a different case from a
 * control that should have had a real target, and the exemption is the reason
 * the rest of the assertion is trustworthy. `test.skip()` was the alternative
 * once, and PROGRESS.md records why that one was wrong.
 *
 * Two things the original selector got wrong once it was pointed at twenty-two
 * routes instead of one. Both were found by dumping the DOM rather than by
 * reading the code, which is the only way to tell them from a defect:
 *
 *   1. Playwright's `:visible` is "has a non-empty bounding box", which is true
 *      of the 1x1 `<select>` and the opacity-0 `<input>` that Radix renders
 *      BESIDE a `<SelectTrigger>` so the control still submits with a real form.
 *      Both are `aria-hidden="true" tabindex="-1"`: plumbing that no user can
 *      see, focus or tap. Measuring them reports a 1x1 target for a control the
 *      finger can only ever reach as its 44px trigger.
 *   2. A control's target is not always the control. `Checkbox` draws a 20px box
 *      and puts it inside a `<label class="tap">` that is 56px tall; clicking the
 *      label toggles it, which is the whole design and is documented on the
 *      component. Measuring the box reports 20px for a 56px target.
 *
 * Neither is a licence to pass: every control the user can actually aim at is
 * still measured on its own box, and the two exemptions cannot cover a button,
 * a card row or a tab — the offenders they removed were both inside other
 * elements.
 */
async function measureControls(page: Page): Promise<Measurement> {
  return page.evaluate(
    ({ min, slack }) => {
      const nodes = document.querySelectorAll('button, a, input, select, textarea');
      const offenders: Array<{
        tag: string;
        label: string;
        width: number;
        height: number;
      }> = [];
      let measured = 0;
      let tightest = Number.POSITIVE_INFINITY;

      for (const element of nodes) {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        // `getClientRects` is empty for anything hidden by an ancestor too,
        // which is what `:visible` meant in the original selector.
        if (element.getClientRects().length === 0) continue;
        // Not rendered to anyone: Radix's form proxies, which exist to be
        // submitted rather than tapped.
        if (element.closest('[aria-hidden="true"]')) continue;
        if (element.tagName === 'A' && style.display === 'inline') continue;

        /*
         * The pointer target, which is the control OR something else that activates
         * it. `DOMRect.prototype.union` is spelled out because WebKit does not have
         * it, and `mobile-safari` is a project this file runs in.
         *
         * Two families, and both are "the control is a label for a larger target"
         * wearing different clothes:
         *
         *   1. The `<label>` that activates it. A label is its control's target by
         *      definition in HTML, so the union of the two boxes is what a thumb can
         *      land on. `Checkbox` draws a 20px box inside a 56px `.tap` label.
         *
         *   2. The `::after` overlay that covers a larger ancestor. `Card
         *      interactive` makes the whole card clickable by hanging
         *      `after:absolute after:inset-0` off a text link inside it, so the
         *      link's own box is one line of `text-xs` while the target is the card.
         *      Measuring the link alone reports an 18px target for a 64px one. This
         *      is the same defect as (1) wearing a different hat, and the admin
         *      overview's stat tiles are its proof: the correct fix is to measure
         *      the ancestor, not to pad the label and break the tile.
         */
        const own = element.getBoundingClientRect();
        const labelBox = element.closest('label')?.getBoundingClientRect();

        /*
         * The overlay target, when the control paints a covering pseudo-element.
         * `inset: 0` on an absolutely-positioned ::after means it fills its
         * containing block, so the containing block IS the target — found by
         * asking for the pseudo-element's own computed position rather than by
         * walking the tree for a guessed class.
         */
        const after = getComputedStyle(element, '::after');
        const paintsOverlay =
          after.content !== 'none' &&
          after.position === 'absolute' &&
          (after.inset === '0px' || after.insetBlock === '0px');
        const overlayBox = paintsOverlay
          ? // `offsetParent` is the nearest POSITIONED ancestor, which is exactly
            // the containing block an absolutely-positioned `inset: 0` ::after
            // fills. It is on `HTMLElement`, and the query above is typed as
            // `Element`, so the narrowing is spelled out rather than asserted.
            (element as HTMLElement).offsetParent?.getBoundingClientRect()
          : undefined;

        const boxes = [own, labelBox, overlayBox].filter(
          (box): box is DOMRect => box !== undefined && box !== null,
        );
        const width =
          Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.left));
        const height =
          Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top));
        const small = Math.min(width, height);
        measured += 1;
        tightest = Math.min(tightest, small);
        if (small >= min - slack) continue;

        const name =
          element.getAttribute('aria-label') ??
          element.getAttribute('title') ??
          (element.textContent ?? '').trim().slice(0, 40);
        offenders.push({
          tag: element.tagName.toLowerCase(),
          label: name || element.className.toString().slice(0, 40),
          width: Math.round(width * 10) / 10,
          height: Math.round(height * 10) / 10,
        });
      }
      return {
        measured,
        tightest: Math.round(tightest * 10) / 10,
        offenders,
      };
    },
    { min: TOUCH_MIN, slack: TOUCH_SLACK },
  );
}

function describe(offenders: Offender[]): string {
  return offenders.map((o) => `<${o.tag}> "${o.label}" ${o.width}x${o.height}`).join(', ');
}

test.describe('mobile-first shell', () => {
  for (const route of ROUTES) {
    test(`${route.path} never scrolls sideways at ${PHONE.width}px`, async ({ page }, testInfo) => {
      testInfo.setTimeout(30_000);
      await openPhone(page, route);

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth - doc.clientWidth;
      });
      expect(overflow, `${route.path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
    });

    test(`${route.path} keeps every control at ${TOUCH_MIN}px`, async ({ page }, testInfo) => {
      testInfo.setTimeout(30_000);
      await openPhone(page, route);

      const { measured, offenders } = await measureControls(page);
      expect(
        measured,
        `${route.path} rendered ${measured} controls, below the ${route.minControls} it should have — this would pass vacuously`,
      ).toBeGreaterThanOrEqual(route.minControls);

      expect(offenders, `${route.path}: ${describe(offenders)}`).toEqual([]);
    });
  }

  /*
   * The tab bar is the shell's whole mobile-first argument, and nothing asserted
   * it. ADR 0008 is explicit — "a bottom tab bar on mobile and a sidebar from md
   * up, not a sidebar that collapses into a hamburger" — and `AppShell` does
   * carry the `pb-[calc(var(--shell-tabbar-h)+var(--shell-safe-bottom)+1.5rem)]`
   * that is supposed to keep content clear of it. A comment on a class is not a
   * test: this file's whole subject is the difference between a rule that is
   * asserted and one that is asserted-to.
   *
   * Below `md` only, and skipped above it, because from `md` up the sidebar takes
   * over and `md:pb-6` is the correct value. The project's own viewport decides,
   * so this runs in `mobile` and `mobile-safari` and is skipped in `desktop`.
   */
  test.describe('below md', () => {
    for (const route of ROUTES.filter((r) => r.signedIn)) {
      test(`${route.path} shows the tab bar and keeps content clear of it`, async ({
        page,
        viewport,
      }, testInfo) => {
        testInfo.setTimeout(30_000);
        // `viewport` is `ViewportSize | null` in Playwright's fixtures, and null
        // here would mean the project declared no viewport at all — which is not
        // a reason to skip.
        test.skip(
          (viewport?.width ?? 0) >= MD,
          `the tab bar is a below-md affordance; this project runs at ${viewport?.width}px`,
        );
        await openPhone(page, route);

        // The document is the scroller below md (AppShell's comment says so), so
        // "the last thing on the page" only exists at the bottom of it.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(200);

        const measured = await page.evaluate(() => {
          // Both `Sidebar` and `BottomTabs` carry aria-label="Primary"; below md
          // the sidebar is `hidden`, so it has no client rects and cannot be
          // mistaken for the bar.
          let bar: HTMLElement | null = null;
          for (const nav of document.querySelectorAll<HTMLElement>('nav[aria-label="Primary"]')) {
            if (nav.getClientRects().length > 0) {
              bar = nav;
              break;
            }
          }
          const main = document.getElementById('main-content');
          const barRect = bar?.getBoundingClientRect();
          const mainStyle = main ? getComputedStyle(main) : null;

          // The lowest edge of anything `main` actually rendered. Padding belongs
          // to no element, so this is content-only — which is the point.
          let lowestContent = 0;
          for (const element of main?.querySelectorAll<HTMLElement>('*') ?? []) {
            if (element.getClientRects().length === 0) continue;
            lowestContent = Math.max(lowestContent, element.getBoundingClientRect().bottom);
          }

          return {
            found: Boolean(bar),
            tabs: bar?.querySelectorAll('a').length ?? 0,
            barTop: barRect ? Math.round(barRect.top) : -1,
            barHeight: barRect ? Math.round(barRect.height) : -1,
            barBottom: barRect ? Math.round(barRect.bottom) : -1,
            viewportHeight: window.innerHeight,
            mainPaddingBottom: mainStyle ? Number.parseFloat(mainStyle.paddingBottom) : -1,
            lowestContent: Math.round(lowestContent),
            scrolled: Math.round(window.scrollY),
          };
        });

        expect(measured.found, `${route.path}: no bottom tab bar rendered below md`).toBe(true);
        expect(
          measured.tabs,
          `${route.path}: the tab bar rendered no destinations`,
        ).toBeGreaterThan(1);
        // Fixed `bottom-0`, so it is pinned to the foot of the viewport and not
        // merely somewhere on the page.
        expect(measured.barBottom, `${route.path}: the tab bar is not pinned to the bottom`).toBe(
          measured.viewportHeight,
        );
        expect(
          measured.barHeight,
          `${route.path}: the tab bar is shorter than 44px`,
        ).toBeGreaterThanOrEqual(TOUCH_MIN);

        // The padding the clearance depends on, measured rather than read off the
        // class list — `pb-[calc(...)]` is not verifiable by looking at it.
        expect(
          measured.mainPaddingBottom,
          `${route.path}: main's bottom padding does not clear a ${measured.barHeight}px tab bar`,
        ).toBeGreaterThanOrEqual(measured.barHeight);

        expect(
          measured.lowestContent,
          `${route.path}: content ends at ${measured.lowestContent}px, under a tab bar starting at ${measured.barTop}px`,
        ).toBeLessThanOrEqual(measured.barTop);
      });
    }
  });

  /*
   * The dense screens, by name.
   *
   * Every route in the sweep above is measured at 375px; this is the part of the
   * phase that is not redundant. The 44px floor is the rule most likely to be
   * broken by a later change to a stat tile, a header action row or a card-list
   * row, and the sweep's failure message already names the control — but a sweep
   * that has drifted into measuring three `<a>` elements on a screen that used
   * to hold thirty would not notice. So these assert the COUNT as well as the
   * floor, and they report the worst offender found even when they pass, which
   * is the number worth watching between runs.
   */
  test.describe('the dense screens', () => {
    for (const { path, count } of DENSE) {
      const route = ROUTES.find((r) => r.path === path);
      if (!route) throw new Error(`DENSE names ${path}, which ROUTES does not`);
      test(`${path} holds 44px on its controls, and holds enough of them`, async ({
        page,
      }, testInfo) => {
        testInfo.setTimeout(30_000);
        await openPhone(page, route);

        const { offenders, measured, tightest } = await measureControls(page);

        expect(
          measured,
          `${path} measured only ${measured} controls — below the ${count} it should have`,
        ).toBeGreaterThanOrEqual(count);
        expect(offenders, `${path}: ${describe(offenders)}`).toEqual([]);
        // Reported, not asserted: a screen whose tightest target is 44.2px is one
        // class away from failing, and that is worth seeing before it is a
        // regression rather than after.
        testInfo.annotations.push({
          type: 'tightest-control',
          description: `${path}: ${tightest}px`,
        });
      });
    }
  });

  test('the theme is applied before the first paint', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('sw.theme', 'dark'));
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('the design gallery renders both themes', async ({ page }) => {
    await page.goto('/design');
    await expect(page.locator('[data-theme-preview="light"]')).toBeVisible();
    await expect(page.locator('[data-theme-preview="dark"]')).toBeVisible();
  });
});

test.describe('login', () => {
  test('offers the three demo accounts', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /Continue as Student/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue as Teacher/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue as Admin/i })).toBeVisible();
  });

  test('validates before it ever reaches the network', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Enter your email address')).toBeVisible();
  });
});
