import { expect, test, type Page } from '@playwright/test';
import { courseDetail, paginated, userDetails } from './fixtures.js';

/**
 * The Qualifications tab and the issue dialog, driven in a browser against the
 * PRODUCTION build, at 375px.
 *
 * `mobile-shell.spec.ts` sweeps every ROUTE for the two ADR 0008 rules and is still the
 * authority. It cannot reach either of the surfaces here, for the reason
 * `assignments.spec.ts` gives and which this file inherits: a tab is a CONTROLLED
 * PANEL, and Radix mounts its content only once the trigger has been activated. A route
 * sweep visits `/courses/c-1` and measures whatever the default panel rendered — the
 * Resources tab — so every control Phase 3 introduced went unmeasured, and a 44px
 * failure inside a dialog is invisible until the dialog is opened.
 *
 * So: open the tab, open the dialog, and measure inside both. The two rules themselves
 * are restated rather than imported, because turning `mobile-shell.spec.ts`'s helpers
 * into a shared module would mean editing that file, which belongs to another phase.
 *
 * The API is stubbed at the network layer, which is the only reason this suite can gate
 * a push with no database. Shapes come from `fixtures.ts` and from the response schemas
 * themselves, so a renamed field makes the page render an error state and this fails
 * loudly rather than passing against a stale stub.
 *
 * WHAT IS NOT HERE, and it is deliberate: nothing in this file asserts that a
 * certificate can be ISSUED. That is an integration suite's job — it needs a real
 * COMPLETED enrolment, a real catalogue row and a real object store, and stubbing those
 * would prove that the dialog posts a body the API has already been proved to accept.
 */

const PHONE = { width: 375, height: 812 };
const nowIso = '2026-08-25T10:00:00.000Z';
const ENROLLMENT_ID = 'en-1';
const CERTIFICATE_ID = 'cert-1';
const REFERENCE = '9F2A7C4B1D6E8A035C7B9D2E4K6P';
const OFFERING_ID = courseDetail.offerings[0]?.id ?? 'off-1';

/**
 * Two certificates, and the second one is the one this file is about.
 *
 * A revoked certificate is still a certificate: the PDF is still served for download
 * and the public verify route still answers for its reference with `revoked: true`. A
 * panel that filtered the row out would be the only place in the system claiming it
 * does not exist, and the one place an employer cannot check — so the row stays, says
 * `Revoked`, and carries the date and the reason.
 */
const certificates = [
  {
    id: CERTIFICATE_ID,
    reference: REFERENCE,
    issuedAt: '2026-08-20T10:00:00.000Z',
    issuedBy: { id: 'u-1', name: 'Person 1', role: 'TEACHER', avatarUrl: null },
    qualification: {
      id: 'q-1',
      code: 'cswip-31',
      name: 'CSWIP 3.1 Welding Inspector',
      level: '3',
      awardingBody: 'BSI',
    },
    enrollmentId: ENROLLMENT_ID,
    revokedAt: null,
    revokedBy: null,
    revokedReason: null,
    artifact: {
      id: 'up-1',
      originalName: `certificate-${REFERENCE}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 3854,
    },
  },
  {
    id: 'cert-2',
    reference: '3B7C1D9E5F2A8C40B6D3E1F9A7C5B2D4',
    issuedAt: '2026-07-14T10:00:00.000Z',
    issuedBy: { id: 'u-1', name: 'Person 1', role: 'TEACHER', avatarUrl: null },
    qualification: {
      id: 'q-2',
      code: 'fgas-cat-i',
      name: 'F-Gas Category I Certification',
      level: 'I',
      awardingBody: 'CITB',
    },
    enrollmentId: 'en-2',
    revokedAt: '2026-09-02T10:00:00.000Z',
    revokedBy: { id: 'u-1', name: 'Person 1', role: 'ADMIN', avatarUrl: null },
    revokedReason: 'Issued against the wrong intake record by the registrar.',
    artifact: {
      id: 'up-2',
      originalName: 'certificate-3B7C1D9E5F2A8C40B6D3E1F9A7C5B2D4.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3811,
    },
  },
];

const catalogue = [
  {
    id: 'q-1',
    code: 'cswip-31',
    name: 'CSWIP 3.1 Welding Inspector',
    level: '3',
    awardingBody: 'BSI',
  },
];

/** A COMPLETED seat, which is the only state the issue control appears on. */
const completedEnrollment = {
  id: ENROLLMENT_ID,
  status: 'COMPLETED',
  requestedAt: '2026-08-01T10:00:00.000Z',
  decidedAt: '2026-08-02T10:00:00.000Z',
  decidedBy: null,
  decisionNote: null,
  completedAt: '2026-08-19T10:00:00.000Z',
  completedBy: { id: 'u-1', name: 'Person 1', role: 'TEACHER', avatarUrl: null },
  student: { id: 'u-2', name: 'Person 2', role: 'STUDENT', avatarUrl: null },
  course: {
    id: courseDetail.id,
    code: courseDetail.code,
    slug: courseDetail.slug,
    name: courseDetail.name,
    department: courseDetail.department,
    teacher: courseDetail.teacher,
    duration: courseDetail.duration,
    publishedAt: courseDetail.publishedAt,
  },
  offering: {
    id: OFFERING_ID,
    startDate: nowIso,
    endDate: null,
    capacity: 20,
    workshopCapacity: 8,
    approvedCount: 2,
    seatsRemaining: 18,
    isFull: false,
    workshopSeatsRemaining: 6,
    viewerEnrollmentStatus: null,
  },
};

async function stubApi(page: Page, viewer: 'STUDENT' | 'TEACHER'): Promise<void> {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/auth/me') {
      return json({
        actor: {
          id: viewer === 'STUDENT' ? 'u-2' : 'u-1',
          role: viewer,
          status: 'ACTIVE',
          provenance: 'PASSWORD',
        },
        user: userDetails(viewer === 'STUDENT' ? 2 : 1, viewer),
        expiresAt: '2026-12-31T00:00:00.000Z',
      });
    }
    if (path === `/courses/${courseDetail.id}`) return json(courseDetail);
    if (path === '/certificates') return json({ data: certificates });
    // The catalogue is a BARE ARRAY — no envelope, no pager — and stubbing it as one is
    // the point: a stub that returned `{ data: [] }` here would make the dialog's empty
    // state the only reachable one.
    if (path === '/qualifications') return json(catalogue);
    if (path === `/courses/${courseDetail.id}/enrollments`)
      return json(paginated([completedEnrollment]));
    /*
     * The register, which the Students tab mounts ABOVE the roster whether or not this
     * spec is about it.
     *
     * Stubbed with the real `attendanceRegisterSchema` shape — `{ date, rows }` — and
     * not with a plausible guess, because the first version of this file returned
     * `{ date, roster, counts, total, recent }` and the register read `.rows.map` on
     * `undefined`. The page answered "That didn't load / Cannot read properties of
     * undefined (reading 'map')" and every assertion after it timed out: the stub was
     * the thing under test. `rows` is the roster so the two lists agree about who is on
     * this course.
     */
    if (path === `/courses/${courseDetail.id}/attendance`) {
      return json({
        date: '2026-08-25',
        rows: [
          {
            enrollmentId: ENROLLMENT_ID,
            student: { id: 'u-2', name: 'Person 2', role: 'STUDENT', avatarUrl: null },
            status: null,
            note: null,
            markedBy: null,
          },
        ],
      });
    }
    if (path === '/enrollments') return json(paginated([]));
    if (path === '/assignments/mine') return json({ data: [] });
    if (path.startsWith('/offerings/') && path.endsWith('/assignments')) return json([]);
    return json(paginated([]));
  });
}

interface Measurement {
  offenders: Array<{ tag: string; label: string; width: number; height: number }>;
  measured: number;
}

/**
 * Every rendered control, and the size a thumb would actually have to hit.
 *
 * The 44px floor and its half-pixel of slack are INSIDE `evaluate` because the
 * measurement runs in the page and a closure does not cross the boundary; the values
 * are therefore not shared with the assertions outside it, which is stated rather than
 * hidden.
 */
async function measureControls(page: Page, root: string): Promise<Measurement> {
  return page.evaluate((selector) => {
    const TOUCH_MIN = 44;
    const TOUCH_SLACK = 0.5;
    const scope = document.querySelector(selector) ?? document.body;
    const nodes = scope.querySelectorAll('button, a, input, select, textarea');
    const offenders: Array<{ tag: string; label: string; width: number; height: number }> = [];
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

async function openQualificationsTab(page: Page, viewer: 'STUDENT' | 'TEACHER'): Promise<void> {
  await stubApi(page, viewer);
  await page.setViewportSize(PHONE);
  await page.goto(`/courses/${courseDetail.id}`);
  await page.waitForLoadState('networkidle');
  // The build, not a dev server: an empty `#root` here is lesson 39's white screen and
  // every assertion below would pass vacuously against a blank page.
  await expect
    .poll(() => page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? 0), {
      timeout: 10_000,
    })
    .toBeGreaterThan(300);
  // Settle before measuring: LESSONS-LEARNED #21, sampling a page mid-fade measures
  // interpolated values rather than the ones a user ends up looking at.
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: 'Qualifications' }).click();
  await expect(page.getByText('CSWIP 3.1 Welding Inspector')).toBeVisible();
}

test.describe('the qualifications tab at 375px', () => {
  test.beforeEach(async ({ page }) => {
    await openQualificationsTab(page, 'STUDENT');
  });

  test('does not scroll sideways', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // One pixel of slack for subpixel layout; a body wider than the viewport is ADR
    // 0008's failure and the reason this rule exists at all.
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('names the qualification, its standard, its date and its reference', async ({ page }) => {
    // The reference is what the holder is CHECKED by, so it is on the screen and not
    // only inside the PDF. The PDF is the document; this is the number on it.
    await expect(page.getByText(REFERENCE)).toBeVisible();
    await expect(page.getByText('cswip-31 · Level 3 · BSI')).toBeVisible();
    // Anchored, because the REVOKED row below also contains the word — its text reads
    // "Revoked on … — Issued against the wrong intake record". A bare `/Issued/`
    // matched both and this spec failed on a strict-mode violation rather than on
    // anything about the product.
    await expect(page.getByText(/^Issued /)).toBeVisible();
  });

  test('keeps a revoked certificate visible and says when and why', async ({ page }) => {
    await expect(page.getByText('F-Gas Category I Certification')).toBeVisible();
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
    await expect(page.getByText(/Issued against the wrong intake record/)).toBeVisible();
    // The document behind it is still offered: the artefact is the record of what was
    // issued, and hiding it would hide the revocation's evidence.
    await expect(
      page.getByRole('button', { name: 'Download the issued certificate' }),
    ).toBeVisible();
  });

  test('holds 44px on every control in the panel', async ({ page }) => {
    const { offenders, measured } = await measureControls(page, 'main');
    // The count first, so a panel that rendered its empty state and had nothing to
    // measure cannot pass the floor by having no controls at all.
    expect(
      measured,
      'the Qualifications panel measured too few controls to mean anything',
    ).toBeGreaterThanOrEqual(2);
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});

test.describe('the issue-certificate dialog at 375px', () => {
  test('opens from a COMPLETED row and is reachable by thumb', async ({ page }) => {
    await stubApi(page, 'TEACHER');
    await page.setViewportSize(PHONE);
    await page.goto(`/courses/${courseDetail.id}`);
    await page.waitForLoadState('networkidle');
    await expect
      .poll(() => page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? 0), {
        timeout: 10_000,
      })
      .toBeGreaterThan(300);
    await page.waitForTimeout(300);

    await page.getByRole('tab', { name: /students/i }).click();
    await page.getByRole('button', { name: 'Issue certificate' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // It says who and what BEFORE it asks for the one input, because the row it was
    // opened from is not visible from inside a modal on a phone.
    await expect(dialog.getByText(/Person 2 completed/)).toBeVisible();
    // And it says the act cannot be undone from here, above the button rather than
    // apologising afterwards — `certificate:revoke` is an admin-only verb.
    await expect(dialog.getByText(/An admin can revoke it later/)).toBeVisible();

    const { offenders, measured } = await measureControls(page, '[role="dialog"]');
    expect(measured, 'the issue dialog measured too few controls').toBeGreaterThanOrEqual(3);
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  test('does not offer the control on a seat that is not completed', async ({ page }) => {
    await stubApi(page, 'TEACHER');
    await page.route('**/api/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      if (path === `/courses/${courseDetail.id}/enrollments`) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            paginated([
              { ...completedEnrollment, status: 'APPROVED', completedAt: null, completedBy: null },
            ]),
          ),
        });
      }
      return route.fallback();
    });
    await page.setViewportSize(PHONE);
    await page.goto(`/courses/${courseDetail.id}`);
    await page.waitForLoadState('networkidle');
    await expect
      .poll(() => page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? 0), {
        timeout: 10_000,
      })
      .toBeGreaterThan(300);

    await page.getByRole('tab', { name: /students/i }).click();
    // The API refuses a certificate from a seat that is not COMPLETED with a 409, so a
    // button here would be a guarantee of failure. The control is simply not there.
    await expect(page.getByRole('button', { name: 'Issue certificate' })).toHaveCount(0);
  });
});
