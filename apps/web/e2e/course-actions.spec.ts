import { expect, test, type Page } from '@playwright/test';
import { paginated, userDetails } from './fixtures.js';

/**
 * The controls Phase 1 and Phase 5 added to the course page, measured at 375px.
 *
 * WHY THIS FILE EXISTS AT ALL, when `mobile-shell.spec.ts` already asserts 44px
 * on all twenty-two routes. Because that sweep cannot see any of them. Its stub
 * signs everyone in as `u-1`, the ADMIN, and its course fixture's teacher is
 * `u-1` — so on `/courses/c-1` the roster is empty (the Students tab is not
 * mounted), the "Your place" section never renders, and the Message button hides
 * itself because the viewer IS the teacher. Every control this work added is
 * absent from that run, and "300 passed" said nothing about any of them.
 *
 * So the stub here signs in a STUDIST who holds a seat, on a course taught by
 * somebody else — the only shape in which all three surfaces exist at once — and
 * measures both the page and the open dialog.
 *
 * The two rules are the ones ADR 0008 names: nothing scrolls sideways, and every
 * control is at least 44x44. The measurement deliberately repeats
 * `mobile-shell.spec.ts`'s rather than inventing a looser one, including its
 * exemptions: a control's pointer target is sometimes a `<label>` or a covering
 * `::after` rather than the element's own box, and reading the element alone
 * reports a 20px target for a 56px one. Both files have to agree or one of them
 * is measuring something the user cannot hit.
 */

const PHONE = { width: 375, height: 812 };
const nowIso = '2026-08-25T10:00:00.000Z';

const TEACHER_ID = 'u-1';
const STUDENT_ID = 'u-2';
const COURSE_ID = 'c-1';
const OFFERING_ID = 'off-1';
const ENROLLMENT_ID = 'e-1';
const CONVERSATION_ID = 'conv-9';

const student = { id: STUDENT_ID, name: 'Person 2', role: 'STUDENT', avatarUrl: null };
const teacher = { id: TEACHER_ID, name: 'Person 1', role: 'TEACHER', avatarUrl: null };

/**
 * A course taught by somebody else, on which the viewer holds a PENDING seat.
 *
 * PENDING rather than APPROVED because that is the state the plan's wording is
 * about — "a student cannot withdraw from a course they requested" — and because
 * it is the only one of the two that renders a control the APPROVED fixture would
 * also reach. `viewerEnrollmentStatus` is the field `courses.service.ts:329` serves
 * for STUDENT viewers only, and this stub's session is a student's.
 */
const courseDetail = {
  id: COURSE_ID,
  code: 'WELD-101',
  slug: 'welding-fundamentals',
  name: 'Welding Fundamentals',
  description: 'Strikes, beads and safety.',
  department: { id: 'dep-1', name: 'Welding', slug: 'welding' },
  teacher,
  duration: { value: 6, unit: 'WEEK' },
  publishedAt: nowIso,
  syllabusUploadId: null,
  syllabusUrl: null,
  resourceCount: 0,
  prerequisiteCourseId: null,
  prerequisite: null,
  offerings: [
    {
      id: OFFERING_ID,
      startDate: nowIso,
      endDate: null,
      capacity: 20,
      workshopCapacity: 8,
      approvedCount: 2,
      seatsRemaining: 18,
      isFull: false,
      workshopSeatsRemaining: 6,
      viewerEnrollmentStatus: 'PENDING',
    },
  ],
  createdAt: nowIso,
  updatedAt: nowIso,
};

/** The viewer's own request, as the self-scoped `GET /enrollments` serves it. */
const ownEnrollment = {
  id: ENROLLMENT_ID,
  status: 'PENDING',
  requestedAt: nowIso,
  decidedAt: null,
  decidedBy: null,
  decisionNote: null,
  completedAt: null,
  completedBy: null,
  student,
  course: {
    id: COURSE_ID,
    code: 'WELD-101',
    slug: 'welding-fundamentals',
    name: 'Welding Fundamentals',
    department: { id: 'dep-1', name: 'Welding', slug: 'welding' },
    teacher,
    duration: { value: 6, unit: 'WEEK' },
    publishedAt: nowIso,
  },
  offering: courseDetail.offerings[0],
};

/** Every `POST /conversations` body this run sent, for the find-or-create pin. */
const conversationBodies: unknown[] = [];

/**
 * A signed-in STUDENT, and a capture of what `POST /conversations` was sent.
 *
 * The capture is here rather than a route assertion because the payload is the
 * contract: `conversations.service.ts:449-455` only deduplicates a direct thread
 * when `title` is `undefined`, so a title that reached the server would create a
 * SECOND conversation with the same two people on every click — a defect no screen
 * would show, because both of them open and both of them are a thread with the
 * teacher.
 */
async function stubAsStudent(page: Page): Promise<void> {
  conversationBodies.length = 0;
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/auth/me') {
      return json({
        actor: { id: STUDENT_ID, role: 'STUDENT', status: 'ACTIVE', provenance: 'PASSWORD' },
        user: userDetails(2, 'STUDENT'),
        expiresAt: '2026-12-31T00:00:00.000Z',
      });
    }
    if (path === `/courses/${COURSE_ID}`) return json(courseDetail);
    // The self-scoped list, and the one that decides whether "Your place" renders.
    if (path === '/enrollments') return json(paginated([ownEnrollment]));
    if (path === `/courses/${COURSE_ID}/enrollments`) return json(paginated([]));

    if (path === '/conversations' && route.request().method() === 'POST') {
      conversationBodies.push(route.request().postDataJSON());
      return json({
        id: CONVERSATION_ID,
        title: null,
        participants: [student, teacher],
        lastMessage: null,
        unreadCount: 0,
        lastMessageAt: nowIso,
        createdAt: nowIso,
      });
    }

    return json(paginated([]));
  });
}

interface Offender {
  tag: string;
  label: string;
  width: number;
  height: number;
}

interface Measurement {
  measured: number;
  tightest: number;
  offenders: Offender[];
  documentWidth: number;
  viewportWidth: number;
}

/**
 * The measurement, carried over from `mobile-shell.spec.ts` so the two files
 * cannot disagree about what a "control" is. The exemptions, restated because
 * they are the whole reason the rest of the number is trustworthy:
 *
 *   - nothing hidden, including by an ancestor (`getClientRects().length`);
 *   - nothing inside an `aria-hidden` subtree, which is how Radix's form proxies
 *     (a 1x1 `<select>`, an opacity-0 `<input>`) are excluded;
 *   - an inline `<a>`, which inherits its line box and would be ruined by padding
 *     it to 44px — a different case from a control that should have had a target;
 *   - a control's target is its `<label>` when it has one, and its positioned
 *     ancestor when it paints a covering `::after`. `Card interactive` makes a
 *     whole card clickable exactly that way, and measuring the link inside it
 *     reports 18px for a 64px target.
 */
async function measure(page: Page): Promise<Measurement> {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('button, a, input, select, textarea');
    const offenders: Offender[] = [];
    let measured = 0;
    let tightest = Number.POSITIVE_INFINITY;

    for (const element of nodes) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (element.getClientRects().length === 0) continue;
      if (element.closest('[aria-hidden="true"]')) continue;
      if (element.tagName === 'A' && style.display === 'inline') continue;

      const own = element.getBoundingClientRect();
      const labelBox = element.closest('label')?.getBoundingClientRect();
      const after = getComputedStyle(element, '::after');
      const paintsOverlay =
        after.content !== 'none' &&
        after.position === 'absolute' &&
        (after.inset === '0px' || after.insetBlock === '0px');
      const overlayBox = paintsOverlay
        ? (element as HTMLElement).offsetParent?.getBoundingClientRect()
        : undefined;

      const candidates = [own, labelBox, overlayBox].filter(
        (box): box is DOMRect => box !== undefined && box.width > 0 && box.height > 0,
      );
      const width = Math.max(...candidates.map((box) => box.width));
      const height = Math.max(...candidates.map((box) => box.height));

      measured += 1;
      tightest = Math.min(tightest, Math.min(width, height));
      if (width < 44 - 0.5 || height < 44 - 0.5) {
        offenders.push({
          tag: element.tagName,
          label: (element.getAttribute('aria-label') ?? element.textContent ?? '')
            .trim()
            .slice(0, 40),
          width: Math.round(width),
          height: Math.round(height),
        });
      }
    }

    return {
      measured,
      tightest: Number.isFinite(tightest) ? tightest : 0,
      offenders,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
}

async function openCourse(page: Page): Promise<void> {
  await stubAsStudent(page);
  await page.setViewportSize(PHONE);
  await page.goto(`/courses/${COURSE_ID}`);
  await page.waitForLoadState('networkidle');
  // A poll, not a read: `networkidle` is not a commit (build-smoke.spec.ts).
  await expect
    .poll(() => page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? 0), {
      timeout: 10_000,
    })
    .toBeGreaterThan(300);
  // Settle before measuring — LESSONS-LEARNED #21, sampling mid-fade measures
  // interpolated values rather than the ones a user ends up looking at.
  await page.waitForTimeout(300);
}

test.describe('course detail — the controls Phase 1 and Phase 5 added', () => {
  test('a withdrawn seat and a message to the teacher are both 44px at 375px', async ({ page }) => {
    await openCourse(page);

    // Anti-vacuity: both surfaces have to be on screen or nothing below means
    // anything. A page that rendered its error state has no controls and would
    // satisfy "nothing is under 44px" perfectly.
    await expect(page.getByRole('button', { name: 'Withdraw' })).toBeVisible();
    await expect(page.getByRole('button', { name: /message person 1/i })).toBeVisible();

    const onPage = await measure(page);
    expect(
      onPage.offenders,
      `controls under 44px on the course page: ${JSON.stringify(onPage.offenders)}`,
    ).toEqual([]);
    expect(onPage.measured).toBeGreaterThanOrEqual(5);
    // And the page does not scroll sideways — the other half of ADR 0008.
    expect(onPage.documentWidth).toBeLessThanOrEqual(onPage.viewportWidth);
  });

  test('the withdrawal dialog is 44px too, measured while it is open', async ({ page }) => {
    await openCourse(page);

    await page.getByRole('button', { name: 'Withdraw' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(300);

    const inDialog = await measure(page);
    expect(
      inDialog.offenders,
      `controls under 44px with the dialog open: ${JSON.stringify(inDialog.offenders)}`,
    ).toEqual([]);

    /*
     * Radix marks everything OUTSIDE an open modal `aria-hidden="true"`, so the
     * measurement — which skips any `aria-hidden` subtree, because that is how it
     * excludes Radix's 1x1 form proxies — narrows to the dialog itself. That is the
     * correct reading and a better assertion than counting up from the page: with a
     * modal up, these four ARE the only controls a thumb can reach. Four is the
     * close button, the reason textarea, "Keep my place" and "Withdraw".
     */
    expect(inDialog.measured).toBe(4);
  });

  test('the reason is optional on screen, and an empty one sends no key at all', async ({
    page,
  }) => {
    await openCourse(page);

    const posts: Array<{ path: string; body: unknown }> = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.includes('/enrollments/') && request.method() === 'POST') {
        posts.push({ path: url.pathname.replace('/api/v1', ''), body: request.postDataJSON() });
      }
    });

    await page.getByRole('button', { name: 'Withdraw' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // The dialog is not a form, so pressing Enter in the textarea would not submit
    // it; the button is the only route out, and this pins the copy that tells the
    // student the reason is optional.
    await expect(page.getByText(/optional, up to 500 characters/i)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Withdraw' }).click();

    await expect.poll(() => posts.length).toBe(1);
    const [sent] = posts;
    expect(sent?.path).toBe(`/enrollments/${ENROLLMENT_ID}/withdraw`);
    // `{ reason: '' }` would store an empty string in `decisionNote`, where every
    // other reasonless withdrawal has a null.
    expect(sent?.body).toEqual({});
  });

  test('the Message button sends a find-or-create body and lands on the thread', async ({
    page,
  }) => {
    await openCourse(page);

    await page.getByRole('button', { name: /message person 1/i }).click();

    await expect.poll(() => conversationBodies.length).toBe(1);
    /*
     * NO `title`. The server only deduplicates a direct thread when `title` is
     * `undefined` (conversations.service.ts:449-455), so a title here is a new
     * conversation on every click — invisible in the UI, because each of them
     * opens and each of them is a thread with the teacher.
     */
    expect(conversationBodies[0]).toEqual({ participantIds: [TEACHER_ID] });

    await page.waitForURL(`**/messages?conversationId=${CONVERSATION_ID}`);
  });
});
