import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 5's remaining holes, driven against the built bundle.
 *
 * Four endpoints that existed, were gated, and had no caller in the SPA:
 *
 *   POST /conversations/:conversationId/participants
 *   GET  /users/:id
 *   GET  /enrollments/:id
 *   POST /auth/logout-all
 *
 * `apps/web/e2e/fixtures.ts` is another slice's file and is not touched here, so
 * this spec carries its own stub — the same argument `mobile-shell.spec.ts` makes
 * for carrying its own three detail endpoints. The difference is that this stub is
 * ROLE-AWARE: two of the four gaps are about who is refused, and a stub that signs
 * everybody in as an admin cannot express a refusal at all. That is the whole
 * reason these four pages were worth writing tests for rather than counting on
 * `mobile-shell.spec.ts`'s sweep, which measures layout and deliberately asserts
 * nothing about who sees what.
 *
 * The layout rules are asserted here too, and the duplication of
 * `mobile-shell.spec.ts`'s measuring code is deliberate: that file measures EVERY
 * route with a shared `ROUTES` list, and a second copy of the list would be one
 * more place for a new page to be forgotten. This spec measures the things the
 * sweep cannot reach — a dialog that has to be OPENED, and a screen a
 * non-admin must be refused — and the two new routes are added to that sweep
 * separately.
 */

const PHONE = { width: 375, height: 812 };
const TOUCH_MIN = 44;
const TOUCH_SLACK = 0.5;

const nowIso = '2026-08-25T10:00:00.000Z';

type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';

const adminId = 'u-1';
const studentId = 'u-2';
const colleagueId = 'u-9';

function userSummary(id: string, name: string, role: Role) {
  return { id, name, role, avatarUrl: null };
}

function userDetail(id: string, name: string, role: Role, email: string) {
  return {
    id,
    name,
    role,
    avatarUrl: null,
    email,
    status: 'ACTIVE',
    phoneNumber: '+44 161 555 0142',
    bio: 'Runs the Thursday evening workshop.',
    mfaEnabled: true,
    lastLoginAt: nowIso,
    createdAt: nowIso,
    teacherProfile:
      role === 'TEACHER'
        ? {
            departmentId: 'dep-1',
            departmentName: 'Welding',
            qualification: 'City & Guilds Level 3',
            specialization: 'MIG',
            staffNo: 'STF-0042',
          }
        : null,
    studentProfile:
      role === 'STUDENT'
        ? {
            departmentId: 'dep-2',
            departmentName: 'Fabrication',
            enrollmentNo: 'ENR-0099',
            enrolledOn: nowIso,
          }
        : null,
  };
}

const teacherId = 'u-3';
const teacher = userDetail(teacherId, 'Dana Whitfield', 'TEACHER', 'dana@skillwright.dev');

const student = userDetail(studentId, 'Ada Okafor', 'STUDENT', 'ada@skillwright.dev');
const colleague = userDetail(colleagueId, 'Bo Lindqvist', 'STUDENT', 'bo@skillwright.dev');

const offering = {
  id: 'off-1',
  startDate: '2026-09-01T09:00:00.000Z',
  endDate: '2026-10-10T17:00:00.000Z',
  capacity: 20,
  workshopCapacity: 8,
  approvedCount: 11,
  seatsRemaining: 9,
  isFull: false,
  workshopSeatsRemaining: 2,
};

const courseSummary = {
  id: 'c-1',
  code: 'WELD-101',
  slug: 'course-1',
  name: 'Welding Fundamentals 1',
  department: { id: 'dep-1', name: 'Welding', slug: 'welding' },
  teacher: userSummary(adminId, 'Priya Raman', 'TEACHER'),
  duration: { value: 6, unit: 'WEEK' },
  publishedAt: nowIso,
};

/**
 * The FULL `courseDetailSchema`, not the summary. A course DETAIL page reads
 * `syllabusUrl`, `prerequisite` and `offerings`, and a stub that omits them
 * produces a page that renders its own error state — which then fails whatever
 * assertion was written about the thing under test, at one remove.
 */
const courseDetailFixture = {
  ...courseSummary,
  description: 'A course.',
  syllabusUploadId: null,
  syllabusUrl: null,
  resourceCount: 0,
  prerequisiteCourseId: null,
  prerequisite: null,
  offerings: [{ ...offering, viewerEnrollmentStatus: null }],
  createdAt: nowIso,
  updatedAt: nowIso,
};

const enrollment = {
  id: 'e-1',
  status: 'APPROVED',
  student: userSummary(studentId, 'Ada Okafor', 'STUDENT'),
  course: courseSummary,
  offering,
  requestedAt: nowIso,
  decidedAt: nowIso,
  decidedBy: userSummary(adminId, 'Priya Raman', 'TEACHER'),
  decisionNote: 'Portfolio accepted in place of the certificate.',
  completedAt: null,
  completedBy: null,
};

function conversation(participants: Array<{ id: string; name: string }>, lastMessageAt = nowIso) {
  return {
    id: 'conv-1',
    title: null,
    participants: participants.map((person, index) => ({
      user: userSummary(person.id, person.name, 'STUDENT'),
      lastReadSeq: '0',
      lastReadAt: null,
      joinedAt: nowIso,
      leftAt: null,
      // `lastReadSeq` is a string bigint on the wire; the index only exists so the
      // fixture rows are not byte-identical, and nothing here reads it.
      __i: index,
    })),
    lastMessage: null,
    unreadCount: 0,
    lastMessageAt,
    createdAt: nowIso,
  };
}

interface StubOptions {
  role: Role;
  signedIn?: boolean;
  /** Requests the page made, in order, as `METHOD /path`. */
  seen: string[];
}

async function stubApi(page: Page, options: StubOptions): Promise<void> {
  const { role, seen } = options;
  const signedIn = options.signedIn ?? true;
  const viewerId = role === 'STUDENT' ? studentId : adminId;
  const viewerName = role === 'STUDENT' ? 'Ada Okafor' : 'Priya Raman';
  const viewerEmail = role === 'STUDENT' ? 'ada@skillwright.dev' : 'priya@skillwright.dev';

  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const method = route.request().method();
    seen.push(`${method} ${path}${url.search}`);

    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const problem = (status: number, code: string, detail: string) =>
      route.fulfill({
        status,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Forbidden',
          status,
          code,
          detail,
          requestId: 'req-e2e',
        }),
      });
    const paginated = (data: unknown[]) => ({
      data,
      meta: {
        page: 1,
        limit: 50,
        total: data.length,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });

    if (path === '/auth/me') {
      if (!signedIn) return problem(401, 'UNAUTHENTICATED', 'No session');
      return json({
        actor: { id: viewerId, role, status: 'ACTIVE', provenance: 'LOCAL' },
        user: userDetail(viewerId, viewerName, role, viewerEmail),
        expiresAt: '2026-12-31T00:00:00.000Z',
      });
    }
    if (!signedIn) return json(paginated([]));

    // --- the four gaps -----------------------------------------------------
    if (method === 'POST' && path === '/auth/logout-all') return json({ revoked: 3 });
    if (path === `/users/${studentId}`) return json(student);
    if (path === '/users/me') return json(userDetail(viewerId, viewerName, role, viewerEmail));
    if (path === '/users/me/deletion') {
      return json({ deletionRequestedAt: null, deletionEffectiveFor: null, cancellable: false });
    }
    if (path === `/users/${teacherId}`) return json(teacher);
    if (path === `/users/${colleagueId}`) {
      // The server's own gate: `user:read` is `isSelf` for STUDENT and TEACHER, so
      // this record exists for an admin and for Bo, and for nobody else.
      return role === 'ADMIN' ? json(colleague) : problem(403, 'FORBIDDEN', 'rule: STUDENT:isSelf');
    }
    if (path === '/enrollments/e-1') {
      // `enrollment:read` is `isEnrolledStudent` for a student, `ownsCourse` for a
      // teacher and `allow` for an admin.
      if (role === 'ADMIN') return json(enrollment);
      if (role === 'STUDENT' && viewerId === enrollment.student.id) return json(enrollment);
      return problem(403, 'FORBIDDEN', 'rule: TEACHER:ownsCourse');
    }
    if (path === `/conversations/${'conv-1'}/participants` && method === 'POST') {
      return json(
        conversation([
          { id: viewerId, name: viewerName },
          { id: studentId, name: 'Ada Okafor' },
          { id: colleagueId, name: 'Bo Lindqvist' },
        ]),
      );
    }
    if (path === '/conversations/conv-1/messages') {
      return json({ data: [], meta: { nextCursor: null, hasMore: false } });
    }
    if (path === '/conversations') {
      return json(
        paginated([
          conversation([
            { id: adminId, name: 'Priya Raman' },
            { id: studentId, name: 'Ada Okafor' },
          ]),
        ]),
      );
    }
    if (path === '/users') {
      return json(
        paginated([
          student,
          colleague,
          userDetail(adminId, 'Priya Raman', 'ADMIN', 'priya@skillwright.dev'),
        ]),
      );
    }

    if (path === '/dashboard/stats')
      return json({ courses: 3, pendingEnrollments: 1, unreadMessages: 0, resources: 5 });
    if (path === '/departments')
      return json(paginated([{ id: 'dep-1', name: 'Welding', slug: 'welding' }]));
    if (path === `/courses/${courseSummary.id}`) return json(courseDetailFixture);
    if (path === '/courses') return json(paginated([courseDetailFixture]));
    if (path === `/courses/${courseSummary.id}/enrollments`) return json(paginated([enrollment]));
    // The teaching register, which the course page renders for anyone `can
    // ('attendance:mark')` — an ADMIN among them. It is NOT a paged envelope: a
    // page that calls `.rows.map` on one renders its own error state, and that
    // then fails whatever assertion was written about the thing under test, one
    // remove away and pointing at the wrong file.
    if (path === `/courses/${courseSummary.id}/attendance`) {
      return json({ date: '2026-09-28', rows: [] });
    }
    if (path === '/notifications/unread-count') return json({ unread: 0 });
    // Two array-shaped responses, which the catch-all below would have answered
    // with a paged ENVELOPE — and a page that calls `.map` on one renders its own
    // error state, which then fails the assertion written about the thing under
    // test at one remove.
    if (path === '/assignments/mine') return json({ data: [] });
    if (path.endsWith('/assignments') && path.startsWith('/offerings/')) return json([]);
    if (path === `/enrollments/e-1/attendance`) {
      return json({ counts: { PRESENT: 3, ABSENT: 1, LATE: 0 }, total: 4, recent: [] });
    }
    return json(paginated([]));
  });
}

async function open(page: Page, path: string, options: StubOptions): Promise<void> {
  await stubApi(page, options);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  // `networkidle` is not a commit (build-smoke.spec.ts). Poll rather than read.
  await expect
    .poll(() => page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? 0), {
      timeout: 10_000,
      message: `#root stayed empty on ${path}`,
    })
    .toBeGreaterThan(300);
  // Settle before measuring. LESSONS-LEARNED #21: a page sampled mid-fade reports
  // interpolated values, not the ones a user ends up looking at.
  await page.waitForTimeout(300);
}

/**
 * The two mobile-first rules, measured on whatever is on screen right now — which
 * is how a DIALOG gets measured, since `mobile-shell.spec.ts`'s sweep can only
 * ever see the page behind it.
 */
async function measureMobile(
  page: Page,
): Promise<{ overflow: number; measured: number; tightest: number }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;
    let measured = 0;
    let tightest = Number.POSITIVE_INFINITY;

    for (const element of document.querySelectorAll('button, a, input, select, textarea')) {
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

      const boxes = [own, labelBox, overlayBox].filter(
        (box): box is DOMRect => box !== undefined && box !== null,
      );
      const width = Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.left));
      const height = Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top));
      measured += 1;
      tightest = Math.min(tightest, Math.min(width, height));
    }
    return { overflow, measured, tightest: Math.round(tightest * 10) / 10 };
  });
}

function offendersOf(measurement: { tightest: number }): string[] {
  return measurement.tightest < TOUCH_MIN - TOUCH_SLACK
    ? [`tightest control is ${measurement.tightest}px`]
    : [];
}

test.describe('GET /users/:id', () => {
  test('an admin opening a row sees the record the DTO carries', async ({ page }) => {
    const seen: string[] = [];
    await open(page, `/users/${studentId}`, { role: 'ADMIN', seen });

    await expect(page.getByRole('heading', { name: 'Ada Okafor', level: 1 })).toBeVisible();
    // Every one of these is a field on `userDetailSchema`, and each of them is
    // here because the API serves it for `user:read` — not because the page
    // wanted it.
    await expect(page.getByText('ada@skillwright.dev').first()).toBeVisible();
    await expect(page.getByText('+44 161 555 0142')).toBeVisible();
    await expect(page.getByText('Turned on')).toBeVisible();
    await expect(page.getByText('Fabrication')).toBeVisible();
    await expect(page.getByText('ENR-0099')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit account' })).toBeVisible();
  });

  test('a student is refused another account, and no request is made for it', async ({ page }) => {
    const seen: string[] = [];
    await open(page, `/users/${colleagueId}`, { role: 'STUDENT', seen });

    await expect(page.getByText('Not available to you')).toBeVisible();
    /*
     * The strongest half of the assertion. `user:read` is `isSelf` for a student,
     * so the page must not even ASK: a disabled query that still fired would be a
     * 403 in the network tab and a row of a colleague's data in a proxy log, and
     * the refusal would be the server's rather than the client's.
     */
    expect(
      seen.filter((entry) => entry.endsWith(`/users/${colleagueId}`)),
      'a request left the browser for a record the policy denies',
    ).toEqual([]);
  });

  test('a record with a teacher profile renders that profile, not a student one', async ({
    page,
  }) => {
    // The profile block is a `teacherProfile` / `studentProfile` fork, and an
    // implementation that read the wrong one would render "No department" or a
    // blank staff number rather than fail — which is why it is asserted here and
    // not left to the type checker.
    const seen: string[] = [];
    await open(page, `/users/${teacherId}`, { role: 'ADMIN', seen });
    await expect(page.getByRole('heading', { name: 'Dana Whitfield', level: 1 })).toBeVisible();
    await expect(page.getByText('City & Guilds Level 3')).toBeVisible();
    await expect(page.getByText('STF-0042')).toBeVisible();
    await expect(page.getByText('MIG')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Teaching profile' })).toBeVisible();
  });

  test('an admin view is no wider than the DTO', async ({ page }) => {
    const seen: string[] = [];
    await open(page, `/users/${studentId}`, { role: 'ADMIN', seen });

    // No request the page was not entitled to make, and none for a surface the
    // DTO does not carry. `GET /users/:id` is the whole contract; an admin's view
    // is not allowed to become quietly wider than it.
    expect(seen.filter((entry) => entry.includes('/audit'))).toEqual([]);
    await expect(page.getByText('Runs the Thursday evening workshop.')).toBeVisible();
  });
});

test.describe('GET /enrollments/:id', () => {
  test('renders the seat, the intake and how it was decided', async ({ page }) => {
    const seen: string[] = [];
    await open(page, '/enrollments/e-1', { role: 'ADMIN', seen });

    await expect(page.getByRole('heading', { name: 'Ada Okafor', level: 1 })).toBeVisible();
    await expect(page.getByText('Portfolio accepted in place of the certificate.')).toBeVisible();
    await expect(page.getByText('11 of 20 taken')).toBeVisible();
    await expect(page.getByText('WELD-101')).toBeVisible();
    await expect(page.getByText('Priya Raman', { exact: true })).toBeVisible();
    // The back link, gated on `course:read` with the course subject.
    await expect(page.getByRole('link', { name: 'Welding Fundamentals 1' })).toBeVisible();
    // The attendance summary is the reason the page is worth having rather than
    // a second copy of a roster row.
    await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible();
  });

  test('a student sees their own seat', async ({ page }) => {
    const seen: string[] = [];
    await open(page, '/enrollments/e-1', { role: 'STUDENT', seen });
    await expect(page.getByRole('heading', { name: 'Ada Okafor', level: 1 })).toBeVisible();
  });

  test('a teacher refused somebody else’s seat is told so, not shown a spinner', async ({
    page,
  }) => {
    const seen: string[] = [];
    await open(page, '/enrollments/e-1', { role: 'TEACHER', seen });
    await expect(page.getByText('Not available to you')).toBeVisible();
  });

  test('the roster row on a course page links to it', async ({ page }) => {
    const seen: string[] = [];
    await open(page, '/courses/c-1', { role: 'ADMIN', seen });
    // The roster is a tab; open it and click the student's name.
    await page.getByRole('tab', { name: /students/i }).click();
    await page.getByRole('link', { name: 'Ada Okafor' }).first().click();
    await expect(page).toHaveURL(/\/enrollments\/e-1$/);
    await expect(page.getByRole('heading', { name: 'Ada Okafor', level: 1 })).toBeVisible();
  });
});

test.describe('POST /conversations/:conversationId/participants', () => {
  test('an admin can put a third person in a thread that already has two', async ({ page }) => {
    const seen: string[] = [];
    await open(page, '/messages?conversationId=conv-1', { role: 'ADMIN', seen });

    // The header names the thread rather than saying the word "Conversation", and
    // for an admin it is the control that opens the dialog.
    const trigger = page.getByRole('button', { name: /Add someone to Ada Okafor/ });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Search for a person').fill('Bo');
    await expect(dialog.getByRole('button', { name: /Bo Lindqvist/ })).toBeVisible();

    await dialog.getByRole('button', { name: /Bo Lindqvist/ }).click();
    await dialog.getByRole('button', { name: 'Add to conversation' }).click();

    await expect
      .poll(() =>
        seen.filter((entry) => entry.startsWith('POST /conversations/conv-1/participants')),
      )
      .toHaveLength(1);
    expect(
      seen.filter((entry) => entry.startsWith('POST /conversations/conv-1/participants'))[0],
    ).toBe('POST /conversations/conv-1/participants');
  });

  test('the confirm control is disabled until somebody is chosen', async ({ page }) => {
    const seen: string[] = [];
    await open(page, '/messages?conversationId=conv-1', { role: 'ADMIN', seen });
    await page.getByRole('button', { name: /Add someone to/ }).click();

    const dialog = page.getByRole('dialog');
    // A mis-tap that seats the wrong person in a thread has no undo anywhere in
    // this app — there is no leave route and no remove route.
    await expect(dialog.getByRole('button', { name: 'Add to conversation' })).toBeDisabled();
  });

  test('a student is offered no way to add anybody', async ({ page }) => {
    const seen: string[] = [];
    await open(page, '/messages?conversationId=conv-1', { role: 'STUDENT', seen });
    await expect(page.getByRole('button', { name: /Add someone to/ })).toHaveCount(0);
    // The header still names the thread for them, by its other participant — and
    // it is the HEADER's copy, not the list row's, that this is about.
    await expect(
      page.getByLabel('Conversation', { exact: true }).getByText('Priya Raman', { exact: true }),
    ).toBeVisible();
  });
});

test.describe('POST /auth/logout-all', () => {
  test('the Sessions card offers what its sentence promised', async ({ page }) => {
    const seen: string[] = [];
    // The Sessions card is on the SECURITY tab, which is not the default — a
    // missing affordance and a hidden tab look identical in a screenshot.
    await open(page, '/settings?tab=security', { role: 'STUDENT', seen });

    // The copy the screen used to carry — "Sign out everywhere if you have used a
    // shared workshop machine" — above a button that revoked one session. The
    // affordance now exists, so the promise is kept rather than reworded.
    await expect(page.getByText(/shared workshop machine/)).toBeVisible();
    const everywhere = page.getByRole('button', { name: 'Sign out everywhere' });
    await expect(everywhere).toBeVisible();
    await everywhere.click();

    await expect.poll(() => seen.filter((e) => e === 'POST /auth/logout-all')).toHaveLength(1);
    await expect(page).toHaveURL(/\/login/);
  });

  test('the single sign-out still only revokes this session', async ({ page }) => {
    const seen: string[] = [];
    await open(page, '/settings?tab=security', { role: 'STUDENT', seen });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect.poll(() => seen.filter((e) => e === 'POST /auth/logout')).toHaveLength(1);
    expect(seen.filter((e) => e === 'POST /auth/logout-all')).toEqual([]);
  });
});

test.describe('mobile-first, on the new surfaces', () => {
  const cases: Array<{ path: string; role: Role; name: string; minControls: number }> = [
    { path: `/users/${studentId}`, role: 'ADMIN', name: 'the user detail page', minControls: 6 },
    { path: '/enrollments/e-1', role: 'ADMIN', name: 'the enrolment detail page', minControls: 4 },
  ];

  for (const item of cases) {
    test(`${item.name} never scrolls sideways at 375px`, async ({ page }) => {
      const seen: string[] = [];
      await page.setViewportSize(PHONE);
      await open(page, item.path, { role: item.role, seen });
      const measurement = await measureMobile(page);
      expect(
        measurement.overflow,
        `${item.name} scrolls sideways by ${measurement.overflow}px`,
      ).toBeLessThanOrEqual(0);
    });

    test(`${item.name} keeps every control at 44px`, async ({ page }) => {
      const seen: string[] = [];
      await page.setViewportSize(PHONE);
      await open(page, item.path, { role: item.role, seen });
      const measurement = await measureMobile(page);
      expect(
        measurement.measured,
        `${item.name} measured only ${measurement.measured} controls — below the ${item.minControls} it should have, so this would pass vacuously`,
      ).toBeGreaterThanOrEqual(item.minControls);
      expect(
        offendersOf(measurement),
        `${item.name}: ${offendersOf(measurement).join(', ')}`,
      ).toEqual([]);
    });
  }

  test('the add-participant dialog is 44px-clean at 375px', async ({ page }) => {
    const seen: string[] = [];
    await page.setViewportSize(PHONE);
    await open(page, '/messages?conversationId=conv-1', { role: 'ADMIN', seen });
    await page.getByRole('button', { name: /Add someone to/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Search for a person').fill('Bo');
    await expect(dialog.getByRole('button', { name: /Bo Lindqvist/ })).toBeVisible();

    const measurement = await measureMobile(page);
    expect(
      measurement.overflow,
      `the add-participant dialog scrolls sideways by ${measurement.overflow}px`,
    ).toBeLessThanOrEqual(0);
    expect(
      measurement.measured,
      `the dialog measured only ${measurement.measured} controls`,
    ).toBeGreaterThanOrEqual(3);
    expect(offendersOf(measurement)).toEqual([]);
  });

  test('the sign-out-everywhere control is 44px-clean at 375px', async ({ page }) => {
    const seen: string[] = [];
    await page.setViewportSize(PHONE);
    await open(page, '/settings?tab=security', { role: 'STUDENT', seen });
    const box = await page.getByRole('button', { name: 'Sign out everywhere' }).boundingBox();
    expect(box, 'the control has no box at 375px').not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_MIN - TOUCH_SLACK);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(TOUCH_MIN - TOUCH_SLACK);
  });
});

/**
 * A route-level guard, kept out of the describes above because it is about the
 * ROUTE rather than about any one screen: `/users/$id` and `/enrollments/$id` hang
 * off the `_app` layout, so an anonymous visitor is sent to the login form instead
 * of being offered a page whose every request would 401.
 */
test('an anonymous visitor is sent to the login form from the new detail routes', async ({
  page,
}) => {
  const seen: string[] = [];
  for (const path of [`/users/${studentId}`, '/enrollments/e-1']) {
    await open(page, path, { role: 'ADMIN', signedIn: false, seen });
    await expect(page).toHaveURL(/\/login/);
  }
});
