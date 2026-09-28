import { expect, test, type Page } from '@playwright/test';

/**
 * THE LEAVE ROUTE, driven against the built bundle.
 *
 * `apps/web/e2e/phase5-holes.spec.ts` is another slice's file and covers the ADD
 * half of this dialog; this one covers the two halves that had no affordance at all
 * until the leave route landed — a participant's way out of a thread, and the remove
 * that undoes a mis-seat.
 *
 * Its own stub, on the same argument `mobile-shell.spec.ts` and `phase5-holes.spec.ts`
 * each give for carrying one: `fixtures.ts` is shared, and a shared stub that grows a
 * conversation roster for one spec is a file the other specs have to be read against.
 * The stub here is also the only place the DIRECT-THREAD behaviour can be seen at
 * all, because the API's half of it — a thread whose only other participant has left
 * — is a database state no page reaches on its own.
 *
 * The layout rules are asserted here rather than delegated to `mobile-shell.spec.ts`'s
 * sweep, because the sweep measures a ROUTE and everything this spec is about lives
 * in a dialog, or behind a button that has to be pressed first.
 */

const PHONE = { width: 375, height: 812 };
const TOUCH_MIN = 44;
const TOUCH_SLACK = 0.5;

const nowIso = '2026-08-25T10:00:00.000Z';

type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';

const adminId = 'u-1';
const studentId = 'u-2';
const otherId = 'u-3';

function userSummary(id: string, name: string, role: Role) {
  return { id, name, role, avatarUrl: null };
}

function userDetail(id: string, name: string, role: Role) {
  return {
    id,
    name,
    role,
    email: `${id}@skillwright.dev`,
    status: 'ACTIVE',
    avatarUrl: null,
    phoneNumber: null,
    bio: null,
    mfaEnabled: false,
    lastLoginAt: nowIso,
    createdAt: nowIso,
    teacherProfile: null,
    studentProfile: null,
  };
}

const ADA = userDetail(studentId, 'Ada Okafor', 'STUDENT');
const PRIYA = userDetail(adminId, 'Priya Raman', 'ADMIN');

interface Participant {
  id: string;
  name: string;
  role: Role;
  leftAt?: string | null;
}

function conversation(participants: Participant[]) {
  return {
    id: 'conv-1',
    title: null,
    participants: participants.map((person) => ({
      user: userSummary(person.id, person.name, person.role),
      lastReadSeq: '0',
      lastReadAt: null,
      joinedAt: nowIso,
      leftAt: person.leftAt ?? null,
    })),
    lastMessage: { content: 'Are you still coming in on Thursday?' },
    unreadCount: 0,
    lastMessageAt: nowIso,
    createdAt: nowIso,
  };
}

interface StubOptions {
  role: Role;
  seen: string[];
  /** Everyone else in the thread has left — the direct thread nobody can reopen. */
  alone?: boolean;
}

async function stubApi(page: Page, options: StubOptions): Promise<void> {
  const { role, seen, alone = false } = options;
  const viewerId = role === 'STUDENT' ? studentId : adminId;
  const viewerName = role === 'STUDENT' ? 'Ada Okafor' : 'Priya Raman';

  // Mutable so the stub answers the way the server would AFTER the write, which is
  // the only way a client cache bug can be seen: a stub that always answers with the
  // pre-leave row makes a stale list look correct.
  let left = false;

  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const method = route.request().method();
    seen.push(`${method} ${path}`);

    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
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
      return json({
        actor: { id: viewerId, role, status: 'ACTIVE', provenance: 'PASSWORD' },
        user: role === 'STUDENT' ? ADA : PRIYA,
        expiresAt: '2026-12-31T00:00:00.000Z',
      });
    }

    // The roster the page renders, honouring a leave that has already happened.
    const roster = (): Participant[] => {
      const counterpart: Participant =
        viewerId === studentId
          ? { id: adminId, name: 'Priya Raman', role: 'ADMIN', leftAt: alone ? nowIso : null }
          : { id: studentId, name: 'Ada Okafor', role: 'STUDENT', leftAt: alone ? nowIso : null };
      return [{ id: viewerId, name: viewerName, role, leftAt: left ? nowIso : null }, counterpart];
    };

    if (path === '/conversations/conv-1/leave' && method === 'POST') {
      left = true;
      // `lastMessage: null` is what the service sends to somebody who is no longer a
      // `conversation:read` participant.
      return json({ ...conversation(roster()), lastMessage: null });
    }
    if (path === '/conversations/conv-1/participants/remove' && method === 'POST') {
      return json(conversation([{ id: viewerId, name: viewerName, role }]));
    }
    if (path === '/conversations/conv-1/participants' && method === 'POST') {
      return json(conversation([...roster(), { id: otherId, name: 'Bo Lindqvist', role }]));
    }
    if (path === '/conversations/conv-1/messages') {
      return json({ data: [], meta: { nextCursor: null, hasMore: false } });
    }
    if (path === '/conversations') {
      return json(paginated(left ? [] : [conversation(roster())]));
    }
    if (path === '/users') {
      return json(paginated([ADA, PRIYA, userDetail(otherId, 'Bo Lindqvist', 'STUDENT')]));
    }
    if (path === '/notifications/unread-count') return json({ unread: 0 });
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
  // LESSONS-LEARNED #21: a page sampled mid-fade reports interpolated values.
  await page.waitForTimeout(300);
}

/** Both mobile-first rules, measured on whatever is on screen right now. */
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
    ? [`a control measures ${measurement.tightest}px`]
    : [];
}

test.describe('POST /conversations/:conversationId/leave', () => {
  test('a participant is offered the way out, and it takes a confirmation', async ({ page }) => {
    const seen: string[] = [];
    await open(page, '/messages?conversationId=conv-1', { role: 'STUDENT', seen });

    const leave = page.getByRole('button', { name: 'Leave conversation' });
    await expect(leave).toBeVisible();
    await leave.click();

    // The confirm step, and it says what actually happens — "leave" on its own
    // invites a reader to assume the messages go with it. They do not.
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Leave this conversation?')).toBeVisible();
    await expect(dialog.getByText(/stop receiving/i)).toBeVisible();
    expect(seen).not.toContain('POST /conversations/conv-1/leave');

    await dialog.getByRole('button', { name: 'Leave conversation' }).click();

    await expect
      .poll(() => seen.filter((e) => e === 'POST /conversations/conv-1/leave'))
      .toHaveLength(1);
    /*
     * Scoped to the LIST, because a name matcher that loose matches the shell's own
     * user control — the viewer here is Ada Okafor and the thread row is about her
     * too. The point being asserted is the row, not the absence of a string.
     */
    await expect(page.getByLabel('Conversations').getByRole('button')).toHaveCount(0);
    await expect(page.getByText('No conversations')).toBeVisible();
  });

  test('cancelling the confirmation asks the server for nothing', async ({ page }) => {
    const seen: string[] = [];
    await open(page, '/messages?conversationId=conv-1', { role: 'STUDENT', seen });

    await page.getByRole('button', { name: 'Leave conversation' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Stay' }).click();

    await page.waitForTimeout(400);
    expect(seen.filter((e) => e.startsWith('POST /conversations/conv-1/leave'))).toEqual([]);
    await expect(page.getByRole('button', { name: 'Leave conversation' })).toBeVisible();
  });

  /*
   * THE DIRECT THREAD, which the API half of this feature argues about at length:
   * a one-to-one is deduplicated on a LIVE participant count, so when one side
   * leaves, the thread they were both in cannot be reopened — the next message
   * opens a new one. The survivor is left holding this one, alone, and a composer.
   *
   * The screen says so. A survivor composing into a thread nobody can read is not a
   * bug the user can work out; it is one the screen has to state.
   */
  test('a survivor is told they are the only one left, rather than left guessing', async ({
    page,
  }) => {
    const seen: string[] = [];
    await open(page, '/messages?conversationId=conv-1', { role: 'STUDENT', seen, alone: true });

    await expect(page.getByText(/Everybody else has left this conversation/)).toBeVisible();
    // The thread label falls back to the FULL roster once nobody active is left in
    // it, so the header still says whose conversation this was — the counterpart's
    // name is in it, joined to the viewer's own.
    await expect(
      page.getByLabel('Conversation', { exact: true }).getByText(/Priya Raman/),
    ).toBeVisible();
  });

  test('the leave control and its confirmation are 44px-clean at 375px', async ({ page }) => {
    const seen: string[] = [];
    await page.setViewportSize(PHONE);
    await open(page, '/messages?conversationId=conv-1', { role: 'STUDENT', seen });

    const box = await page.getByRole('button', { name: 'Leave conversation' }).boundingBox();
    expect(box, 'the leave control has no box at 375px').not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_MIN - TOUCH_SLACK);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(TOUCH_MIN - TOUCH_SLACK);

    await page.getByRole('button', { name: 'Leave conversation' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const measurement = await measureMobile(page);
    expect(measurement.overflow, 'the confirmation scrolls sideways by 375px').toBeLessThanOrEqual(
      0,
    );
    expect(measurement.measured).toBeGreaterThanOrEqual(3);
    expect(offendersOf(measurement)).toEqual([]);
  });
});

test.describe('POST /conversations/:conversationId/participants/remove', () => {
  test('an admin can unsit somebody, and not on the first tap', async ({ page }) => {
    const seen: string[] = [];
    await open(page, '/messages?conversationId=conv-1', { role: 'ADMIN', seen });

    await page.getByRole('button', { name: /Add someone to/ }).click();
    const dialog = page.getByRole('dialog');
    const remove = dialog.getByRole('button', {
      name: 'Remove Ada Okafor from this conversation',
    });
    await expect(remove).toBeVisible();
    await remove.click();

    // A 44px control in a list of names, on a phone, is a mis-tap waiting to happen.
    expect(seen).not.toContain('POST /conversations/conv-1/participants/remove');
    await expect(dialog.getByText('Remove Ada Okafor?')).toBeVisible();

    await dialog.getByRole('button', { name: 'Remove from conversation' }).click();
    await expect
      .poll(() => seen.filter((e) => e === 'POST /conversations/conv-1/participants/remove'))
      .toHaveLength(1);
  });

  test('a student is offered no way to unsit anybody', async ({ page }) => {
    const seen: string[] = [];
    await open(page, '/messages?conversationId=conv-1', { role: 'STUDENT', seen });

    // The trigger is `conversation:join`, so a student cannot open the dialog at all —
    // and neither they nor a teacher sees a remove control anywhere.
    await expect(page.getByRole('button', { name: /Add someone to/ })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /Remove .* from this conversation/ }),
    ).toHaveCount(0);
  });

  test('the roster and the remove control are 44px-clean at 375px', async ({ page }) => {
    const seen: string[] = [];
    await page.setViewportSize(PHONE);
    await open(page, '/messages?conversationId=conv-1', { role: 'ADMIN', seen });
    await page.getByRole('button', { name: /Add someone to/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Remove Ada Okafor from this conversation' }),
    ).toBeVisible();

    const measurement = await measureMobile(page);
    expect(
      measurement.overflow,
      `the roster scrolls sideways by ${measurement.overflow}px`,
    ).toBeLessThanOrEqual(0);
    expect(
      measurement.measured,
      `the dialog measured only ${measurement.measured} controls, so this would pass vacuously`,
    ).toBeGreaterThanOrEqual(4);
    expect(offendersOf(measurement)).toEqual([]);
  });
});
