/**
 * Written FROM THE CONTRACT, in the house style of ResourceFormDialog.test.tsx:
 * every query is a role and an accessible name, the network is stubbed at
 * `@/lib/api`, and the session is seeded into the cache rather than fetched.
 *
 * The route module is mocked instead of rendered inside a router: the page is a
 * consumer of `Route.useSearch()` (URL state), and what these tests pin is how it
 * BEHAVES for given search values — not that TanStack parses `?page=2` into a
 * number. The search stub stands in for the router; navigation is observed through
 * a spied `useNavigate`, so "the Unread tab resets to page 1 and carries
 * `unreadOnly`" is asserted against the actual navigate call.
 */
import type { SessionUser } from '@/lib/session';
import type { NotificationsSearch } from '@/routes/_app/notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';
import type { NotificationDto } from '@/lib/types';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, searchMock, navigateSpy } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
  searchMock: vi.fn<() => NotificationsSearch>(),
  navigateSpy: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

vi.mock('@/routes/_app/notifications', () => ({
  Route: { useSearch: () => searchMock(), fullPath: '/notifications' },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => navigateSpy };
});

// Imported after the mocks so the page resolves the stubbed client and route.
import { NotificationsPage } from './Notifications.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** ULIDs — `idSchema` accepts a cuid or a ULID and nothing else. */
const VIEWER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const UNREAD_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';
const READ_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';

const VIEWER: SessionUser = {
  id: VIEWER_ID,
  email: 'student@example.edu',
  name: 'Ada Okafor',
  role: 'STUDENT',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

const UNREAD_ROW: NotificationDto = {
  id: UNREAD_ID,
  type: 'ENROLLMENT_APPROVED',
  payload: {
    title: 'Enrolment approved',
    body: 'You were approved for Structural Analysis.',
  },
  linkPath: '/courses/01JGXDFAM0K2Z1GYCSNM5F5RD0',
  readAt: null,
  createdAt: '2026-08-22T09:30:00.000Z',
};

const READ_ROW: NotificationDto = {
  id: READ_ID,
  type: 'RESOURCE_PUBLISHED',
  payload: {
    title: 'Week 3 handbook published',
    body: 'A new document was published on Structural Analysis.',
  },
  linkPath: null,
  readAt: '2026-08-20T10:00:00.000Z',
  createdAt: '2026-08-19T10:00:00.000Z',
};

interface PageMetaOverrides {
  page?: number;
  total?: number;
}

function paginated(rows: NotificationDto[], overrides: PageMetaOverrides = {}) {
  const total = overrides.total ?? rows.length;
  const page = overrides.page ?? 1;
  const totalPages = Math.max(1, Math.ceil(total / 20));
  return {
    data: rows,
    meta: {
      page,
      limit: 20,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1 && total > 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((path) => {
    if (path === '/notifications') return Promise.resolve(paginated([UNREAD_ROW, READ_ROW]));
    return Promise.resolve({});
  });
  // Marking one row read answers with the RECOMPUTED count (notifications.service).
  apiPost.mockResolvedValue({ unread: 4 });
});

interface RenderOptions {
  /** What AppShell's badge query would have left in the cache. Defaults to 5. */
  unreadBadge?: number;
}

function renderPage(
  search: NotificationsSearch = { page: 1 },
  options: RenderOptions = {},
): { rerenderWith: (next: NotificationsSearch) => void; getBadge: () => unknown } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: VIEWER });
  /*
   * The badge count belongs to AppShell's query (`qk.notificationsUnread`); the
   * page reads it WITHOUT subscribing, so tests seed it exactly as the shell would
   * have left it after its last poll.
   */
  client.setQueryData(qk.notificationsUnread, { unread: options.unreadBadge ?? 5 });
  searchMock.mockReturnValue(search);

  const utils = render(
    <QueryClientProvider client={client}>
      <NotificationsPage />
    </QueryClientProvider>,
  );

  return {
    // Simulates navigating to a new URL: same mounted tree, fresh search values —
    // precisely what a TanStack search-param change hands the component. The JSX
    // is rebuilt each call: rerender() bails out entirely when handed an element
    // it has already seen.
    rerenderWith(next: NotificationsSearch) {
      searchMock.mockReturnValue(next);
      utils.rerender(
        <QueryClientProvider client={client}>
          <NotificationsPage />
        </QueryClientProvider>,
      );
    },
    getBadge: () => client.getQueryData(qk.notificationsUnread),
  };
}

/** Every GET the page made to the list endpoint, reduced to its query string. */
function listGets(): Array<Record<string, unknown>> {
  return apiGet.mock.calls
    .filter(([path]) => path === '/notifications')
    .map(([, options]) => {
      const query = (options as { query?: Record<string, unknown> } | undefined)?.query;
      return query ?? {};
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationsPage', () => {
  it('renders rows from the API with links, unread markers and relative timestamps', async () => {
    renderPage();

    // findBy*: the query resolves a tick AFTER the fetch it drives, so every
    // first assertion waits for the DOM, not for the network call.
    const linkedRow = await screen.findByRole('link', { name: /enrolment approved/i });

    // The unread row's server-built linkPath is followed through a real anchor.
    expect(linkedRow).toHaveAttribute('href', UNREAD_ROW.linkPath);

    // A row WITHOUT a linkPath must not become one.
    expect(screen.queryByRole('link', { name: /week 3 handbook/i })).toBeNull();
    expect(screen.getByText(/week 3 handbook published/i)).toBeInTheDocument();

    // Unread state is stated in words for assistive technology, not just colour.
    expect(screen.getByText(/unread\./i)).toBeInTheDocument();

    // Relative timestamps match the bell and Messages: formatRelative over an ISO
    // wire value, rendered human — never the raw string.
    const time = linkedRow.querySelector('time');
    expect(time).not.toBeNull();
    expect(time).toHaveAttribute('datetime', UNREAD_ROW.createdAt);
    expect(time?.textContent ?? '').not.toBe(UNREAD_ROW.createdAt);

    // Per-row mark-read exists where the state allows it: one control, on the
    // unread row only.
    expect(
      screen.getByRole('button', { name: /mark 'enrolment approved' as read/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark 'week 3 handbook/i })).toBeNull();
  });

  it('filters by read state through the URL, resetting to page 1', async () => {
    const user = userEvent.setup();
    const page = renderPage();
    await screen.findByRole('link', { name: /enrolment approved/i });

    // Initial load asks for EVERYTHING — no unreadOnly param at all.
    expect(listGets()).toHaveLength(1);
    expect(listGets()[0]?.unreadOnly).toBeUndefined();

    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: 'Unread' }));

    // Filter state is a SEARCH PARAM, not component state, so it is shareable:
    // switching tabs navigates, resets pagination, and names the API's own flag.
    expect(navigateSpy).toHaveBeenCalledWith({ search: { page: 1, unreadOnly: true } });

    // And once the router hands back the filtered search, the refetch carries it.
    apiGet.mockClear();
    page.rerenderWith({ page: 1, unreadOnly: true });

    await waitFor(() => expect(listGets()).toHaveLength(1));
    expect(listGets()[0]).toMatchObject({ page: 1, limit: 20, unreadOnly: 'true' });
    expect(screen.getByRole('tab', { name: 'Unread' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'false');
  });

  it('marks one row read and updates the badge count through the shared query key', async () => {
    const user = userEvent.setup();
    const page = renderPage();
    expect(page.getBadge()).toEqual({ unread: 5 });

    await user.click(
      await screen.findByRole('button', { name: /mark 'enrolment approved' as read/i }),
    );

    // The ONE bulk verb the API exposes, addressed by id.
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/notifications/read', { ids: [UNREAD_ID] }),
    );

    /*
     * THE SHARED KEY, written from the mutation's RESPONSE — not refetched into,
     * not a second cache path. Whatever renders the badge (AppShell, feeding the
     * bell) reads this entry, so page and panel cannot disagree.
     */
    await waitFor(() => expect(page.getBadge()).toEqual({ unread: 4 }));

    // The ROWS still come back from the server: the active list was invalidated.
    await waitFor(() => expect(listGets().length).toBeGreaterThan(1));
  });

  it('offers Mark all read only while something is unread, and sends no ids', async () => {
    const user = userEvent.setup();
    // Badge at zero: whether the control is offered rests on the ROWS alone here,
    // so waiting for an unread ROW is what makes the enabled assertion mean
    // something.
    renderPage({ page: 1, unreadOnly: true }, { unreadBadge: 0 });
    await screen.findByRole('button', { name: /mark 'enrolment approved' as read/i });

    const markAll = screen.getByRole('button', { name: /mark all read/i });
    expect(markAll).toBeEnabled();

    // What the server will serve once everything is read — mocked BEFORE the
    // click, because the mutation's own invalidation triggers the refetch that
    // brings these rows back. The recomputed count answers ZERO: anything else
    // would re-arm the control through the badge half of hasUnread.
    apiGet.mockResolvedValue(
      paginated([{ ...UNREAD_ROW, readAt: '2026-08-23T00:00:00.000Z' }, READ_ROW]),
    );
    apiPost.mockResolvedValue({ unread: 0 });

    await user.click(markAll);
    // The bulk form sends NO ids: omitting them is how the API says "everything".
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/notifications/read', {}));

    await waitFor(() => expect(markAll).toBeDisabled());
  });

  it('shows the empty states: never-notified on All, caught-up on Unread', async () => {
    apiGet.mockResolvedValue(paginated([], { total: 0 }));
    const page = renderPage({ page: 1 }, { unreadBadge: 0 });

    expect(
      await screen.findByRole('heading', { name: /no notifications yet/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark all read/i })).toBeDisabled();

    page.rerenderWith({ page: 1, unreadOnly: true });
    await waitFor(() => expect(listGets().length).toBe(2));

    expect(await screen.findByRole('heading', { name: /all caught up/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark all read/i })).toBeDisabled();
  });

  it('answers a deep link past the end of the list with a way back, not a blank page', async () => {
    // Nine pages requested, two exist, zero rows served: "no results", not "empty".
    apiGet.mockResolvedValue(paginated([], { page: 9, total: 21 }));
    renderPage({ page: 9 });

    expect(
      await screen.findByRole('heading', { name: /nothing on this page/i }),
    ).toBeInTheDocument();

    // The offered fix is real: it goes back to page 1 as a search-param change.
    // setPage uses the FUNCTIONAL search form, so the assertion resolves what the
    // router would compute from the previous location.
    await userEvent.click(screen.getByRole('button', { name: /back to first page/i }));
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const call = navigateSpy.mock.calls[0]?.[0] as {
      search: (previous?: unknown) => unknown;
    };
    expect(call.search({ page: 9 })).toEqual({ page: 1 });
  });
});
