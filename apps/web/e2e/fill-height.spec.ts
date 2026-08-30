import { expect, test, type Page } from '@playwright/test';
import { courseDetail, department, userDetails } from './fixtures.js';

/**
 * The Phase 3 contract: a register fills the viewport and its pagination stays on
 * screen, instead of the document growing and the pager landing below the fold.
 *
 * This is a browser test because it cannot be anything else. `fillHeight` is a
 * chain of `flex-1 min-h-0` from `main` down through every route wrapper to the
 * table's scroll container, and a single link missing anywhere makes the whole
 * thing INERT — not broken, inert. It silently did nothing on the first migrated
 * screen because `routes/_app/admin.tsx` was a plain `flex flex-col`: bounded
 * grandparent, unbounded parent, so the table sized to its content and overflowed
 * `main` invisibly. The document went to 2842px against a 900px viewport with the
 * pager three screens down, and every unit test, typecheck and lint stayed green.
 *
 * So the assertions are the numbers, not the classes:
 *   - the document does not scroll;
 *   - the element that overflows is the table's OWN wrapper, not an ancestor;
 *   - the pagination's bottom edge is inside the viewport.
 *
 * Desktop only, deliberately. Below `md` there is no bound — AppShell's layout
 * contract stops at the breakpoint, because a phone viewport is short enough that
 * a table filling it would show three rows.
 */

const ROWS = 40;

/** Enough rows that the body must overflow a 900px viewport. */
function many<T>(make: (n: number) => T): T[] {
  return Array.from({ length: ROWS }, (_, i) => make(i + 1));
}

const PAGED_META = { page: 1, limit: 20, total: 95, totalPages: 5, hasNext: true, hasPrev: false };

async function stubBigLists(page: Page): Promise<void> {
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const paged = (data: unknown[]) => json({ data, meta: PAGED_META });

    if (path === '/auth/me')
      return json({
        actor: { id: 'u-1', role: 'ADMIN', status: 'ACTIVE', provenance: 'LOCAL' },
        user: userDetails(1, 'ADMIN'),
        expiresAt: '2026-12-31T00:00:00.000Z',
      });
    if (path === '/users') return paged(many((n) => userDetails(n, n % 2 ? 'TEACHER' : 'STUDENT')));
    if (path === '/departments') return paged(many((n) => department(n)));
    if (path === '/courses')
      return paged(
        many((n) => ({ ...courseDetail, id: `c-${n}`, code: `WELD-${n}`, slug: `course-${n}` })),
      );
    if (path === '/announcements')
      return paged(
        many((n) => ({
          id: `a-${n}`,
          title: `Announcement ${n}`,
          body: 'Body.',
          author: { id: 'u-1', name: 'Person 1', role: 'ADMIN', avatarUrl: null },
          publishedAt: '2026-08-25T10:00:00.000Z',
          createdAt: '2026-08-25T10:00:00.000Z',
          updatedAt: '2026-08-25T10:00:00.000Z',
          commentCount: 0,
        })),
      );
    if (path === '/dashboard/stats')
      return json({ courses: 3, pendingEnrollments: 1, unreadMessages: 0, resources: 5 });
    return paged([]);
  });
}

/** Every screen whose list is the screen — the ones that pass `fillHeight`. */
const SCREENS = [
  '/admin/users',
  '/admin/courses',
  '/admin/departments',
  '/courses',
  '/announcements',
];

for (const path of SCREENS) {
  test(`${path} bounds its table and keeps pagination on screen`, async ({ page }, testInfo) => {
    testInfo.setTimeout(30_000);
    await stubBigLists(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.getByRole('table').first().waitFor();
    await page.waitForTimeout(400);

    const measured = await page.evaluate(() => {
      const table = document.querySelector('table');
      // The scroll container is the nearest ancestor that actually overflows.
      let node: HTMLElement | null = table?.parentElement ?? null;
      let scroller: HTMLElement | null = null;
      while (node) {
        if (node.scrollHeight > node.clientHeight + 1) {
          scroller = node;
          break;
        }
        node = node.parentElement;
      }
      const doc = document.documentElement;
      const nav = document.querySelector('[aria-label$="pagination"]');
      const navRect = nav?.getBoundingClientRect();
      return {
        documentScrolls: doc.scrollHeight > doc.clientHeight + 1,
        scrollerHoldsTheTable: Boolean(scroller && scroller.contains(table)),
        scrollerIsNotMain: scroller?.tagName !== 'MAIN',
        paginationBottom: navRect ? Math.round(navRect.bottom) : -1,
        viewportHeight: window.innerHeight,
      };
    });

    expect(measured.documentScrolls, `${path}: the document must not scroll`).toBe(false);
    expect(measured.scrollerHoldsTheTable, `${path}: the table's own wrapper must scroll`).toBe(
      true,
    );
    expect(measured.scrollerIsNotMain).toBe(true);
    expect(measured.paginationBottom).toBeGreaterThan(0);
    expect(
      measured.paginationBottom,
      `${path}: pagination must be inside the viewport`,
    ).toBeLessThanOrEqual(measured.viewportHeight);
  });
}
