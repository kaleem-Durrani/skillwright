/**
 * Focused on the Phase 3 slice: the debounced text filter. The page is tested in
 * the house style of Notifications.test.tsx — network stubbed at `@/lib/api`,
 * session seeded into the cache, route module mocked so `Route.useSearch()`
 * stands in for the router and navigation is observed through a spied
 * `useNavigate`.
 */
import type { SessionUser } from '@/lib/session';
import type { AnnouncementsSearch } from '@/routes/_app/announcements';
import type { AnnouncementSummary } from '@/lib/types';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, searchMock, navigateSpy } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  searchMock: vi.fn<() => AnnouncementsSearch>(),
  navigateSpy: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

vi.mock('@/routes/_app/announcements', () => ({
  Route: { useSearch: () => searchMock(), fullPath: '/announcements' },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    /*
     * Unlike Notifications (plain anchors), this page renders real TanStack
     * Links inside its rows, and a Link demands router context these tests do
     * not mount. The stub degrades it to the anchor it would have produced —
     * same href, interpolated from the route's params — so row links stay
     * assertable without standing up a whole router.
     */
    Link: ({
      to,
      params,
      children,
    }: {
      to: string;
      params?: Record<string, string>;
      children?: ReactNode;
    }) => <a href={to.replace(/\$(\w+)/g, (_, key: string) => params?.[key] ?? '')}>{children}</a>,
  };
});

// Imported after the mocks so the page resolves the stubbed client and route.
import { AnnouncementsPage } from './Announcements.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VIEWER: SessionUser = {
  id: '01JGXDFAM0K2Z1GYCSNM5F5RCX',
  email: 'student@example.edu',
  name: 'Ada Okafor',
  role: 'STUDENT',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

/** ULIDs — `idSchema` accepts a cuid or a ULID and nothing else. */
const ROW_A_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD4';
const ROW_B_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD5';

function row(id: string, overrides: Partial<AnnouncementSummary> = {}): AnnouncementSummary {
  return {
    id,
    title: 'PPE sign-off deadline Friday',
    slug: 'ppe-sign-off-deadline-friday',
    type: 'ANNOUNCEMENT',
    excerpt: 'Two students still need PPE sign-off before the workshop opens.',
    author: { id: VIEWER.id, name: 'Priya Nair', role: 'ADMIN', avatarUrl: null },
    eventDate: null,
    publishedAt: '2026-08-20T09:00:00.000Z',
    createdAt: '2026-08-19T09:00:00.000Z',
    ...overrides,
  };
}

interface PageMetaOverrides {
  page?: number;
  total?: number;
}

function paginated(rows: AnnouncementSummary[], overrides: PageMetaOverrides = {}) {
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

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue(
    paginated([
      row(ROW_A_ID),
      // A distinct title: DataList renders every row in BOTH its mobile card and
      // its md+ table, so identical titles would collide under getByRole.
      row(ROW_B_ID, { title: 'Workshop closed Monday', slug: 'workshop-closed-monday' }),
    ]),
  );
});

function renderPage(search: AnnouncementsSearch = { page: 1 }): {
  rerenderWith: (next: AnnouncementsSearch) => void;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: VIEWER });
  searchMock.mockReturnValue(search);

  const utils = render(
    <QueryClientProvider client={client}>
      <AnnouncementsPage />
    </QueryClientProvider>,
  );

  return {
    rerenderWith(next: AnnouncementsSearch) {
      searchMock.mockReturnValue(next);
      utils.rerender(
        <QueryClientProvider client={client}>
          <AnnouncementsPage />
        </QueryClientProvider>,
      );
    },
  };
}

/** Every GET the page made to the list endpoint, reduced to its query string. */
function listGets(): Array<Record<string, unknown>> {
  return apiGet.mock.calls
    .filter(([path]) => path === '/announcements')
    .map(([, options]) => {
      const query = (options as { query?: Record<string, unknown> } | undefined)?.query;
      return query ?? {};
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnnouncementsPage text filter', () => {
  it('renders rows from the API with links', async () => {
    renderPage();

    // DataList keeps BOTH surfaces in the DOM (mobile cards, md+ table), so a
    // row yields two anchors carrying the same href.
    const links = await screen.findAllByRole('link', { name: /ppe sign-off deadline/i });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute('href', `/announcements/${ROW_A_ID}`);
    }
    expect(screen.getAllByRole('link', { name: /workshop closed monday/i })[0]).toHaveAttribute(
      'href',
      `/announcements/${ROW_B_ID}`,
    );
  });

  it('lands on ?q= after the debounce, resetting to page 1', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByRole('link', { name: /ppe sign-off deadline/i });

    // Initial load asks for everything — no q at all.
    expect(listGets()[0]?.q).toBeUndefined();

    const input = screen.getByRole('searchbox', { name: 'Search announcements' });
    await user.type(input, 'welding');

    await waitFor(() => expect(navigateSpy).toHaveBeenCalled(), { timeout: 2_000 });

    // The debounced navigation REPLACES (no history entry per keystroke) and its
    // functional search resets pagination on top of whatever filters were set.
    const call = navigateSpy.mock.calls.at(-1)?.[0] as {
      replace?: boolean;
      search: (previous?: unknown) => unknown;
    };
    expect(call.replace).toBe(true);
    expect(call.search({ page: 3, type: 'NEWS' })).toEqual({
      page: 1,
      type: 'NEWS',
      q: 'welding',
    });
  });

  it('sends q to the API once the router hands it back', async () => {
    const page = renderPage();
    await screen.findAllByRole('link', { name: /ppe sign-off deadline/i });

    apiGet.mockClear();
    page.rerenderWith({ page: 1, q: 'welding' });

    await waitFor(() => expect(listGets()).toHaveLength(1));
    expect(listGets()[0]).toMatchObject({ page: 1, limit: 20, q: 'welding' });
  });

  it('clears both filters — term and URL — with one control', async () => {
    const user = userEvent.setup();
    renderPage({ page: 1, q: 'welding', type: 'EVENT' });
    await screen.findAllByRole('link', { name: /ppe sign-off deadline/i });

    const input = screen.getByRole('searchbox', { name: 'Search announcements' });
    expect(input).toHaveValue('welding');

    await user.click(screen.getByRole('button', { name: /clear filters/i }));

    expect(input).toHaveValue('');
    expect(navigateSpy).toHaveBeenCalledWith({ search: { page: 1 } });
  });

  it('shows the no-results state when a filtered list comes back empty', async () => {
    apiGet.mockResolvedValue(paginated([], { total: 0 }));
    renderPage({ page: 1, q: 'zzzz' });

    expect(
      await screen.findByText(/no announcement matched that search or filter/i),
    ).toBeInTheDocument();
  });
});
