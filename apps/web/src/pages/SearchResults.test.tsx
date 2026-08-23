/**
 * Written FROM THE CONTRACT in the house style of Notifications.test.tsx: the
 * network is stubbed at `@/lib/api`, the session is seeded rather than fetched,
 * and the route module is mocked because what these tests pin is how the page
 * BEHAVES for given search values — navigation is observed through a spied
 * `useNavigate`.
 */
import type { SessionUser } from '@/lib/session';
import type { SearchSearch } from '@/routes/_app/search';
import type { SearchResult } from '@/lib/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { splitHeadline } from '@/lib/headline';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, searchMock, navigateSpy } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  searchMock: vi.fn<() => SearchSearch>(),
  navigateSpy: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

vi.mock('@/routes/_app/search', () => ({
  Route: { useSearch: () => searchMock(), fullPath: '/search' },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => navigateSpy };
});

// Imported after the mocks so the page resolves the stubbed client and route.
import { SearchResultsPage } from './SearchResults.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** ULIDs — `idSchema` accepts a cuid or a ULID and nothing else. */
const COURSE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';
const RESOURCE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD2';
const ANNOUNCEMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD3';

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

/*
 * Mirrors `GET /search` (apps/api search.schema.ts): three groups, each
 * `{ hits, total }`, each hit carrying the server-built `linkPath` and a
 * `ts_headline` fragment whose `<b>` markers are the whole reason
 * lib/headline.ts exists.
 */
const RESULTS: SearchResult = {
  courses: {
    total: 12,
    hits: [
      {
        id: COURSE_ID,
        code: 'WELD-201',
        name: 'Structural Welding',
        headline: 'Advanced <b>welding</b> practice for structural steel.',
        linkPath: `/courses/${COURSE_ID}`,
      },
    ],
  },
  resources: {
    total: 1,
    hits: [
      {
        id: RESOURCE_ID,
        title: 'Weld inspection photo set',
        type: 'DOCUMENT',
        courseName: 'Structural Welding',
        headline: 'Photographs of common <b>weld</b> defects.',
        linkPath: `/resources/${RESOURCE_ID}`,
      },
    ],
  },
  announcements: {
    total: 3,
    hits: [
      {
        id: ANNOUNCEMENT_ID,
        title: 'Spring intake applications open',
        type: 'NEWS',
        headline: 'Applications for the spring <b>welding</b> intake are open.',
        linkPath: `/announcements/${ANNOUNCEMENT_ID}`,
      },
    ],
  },
};

const EMPTY_RESULTS: SearchResult = {
  courses: { hits: [], total: 0 },
  resources: { hits: [], total: 0 },
  announcements: { hits: [], total: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue(RESULTS);
});

function renderPage(search: SearchSearch = {}): {
  rerenderWith: (next: SearchSearch) => void;
  container: HTMLElement;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(['session'], { user: VIEWER });
  searchMock.mockReturnValue(search);

  const utils = render(
    <QueryClientProvider client={client}>
      <SearchResultsPage />
    </QueryClientProvider>,
  );

  return {
    container: utils.container,
    // Simulates navigating to a new URL: same mounted tree, fresh search values.
    rerenderWith(next: SearchSearch) {
      searchMock.mockReturnValue(next);
      utils.rerender(
        <QueryClientProvider client={client}>
          <SearchResultsPage />
        </QueryClientProvider>,
      );
    },
  };
}

/** Every GET the page made to /search, reduced to its query string. */
function searchGets(): Array<Record<string, unknown>> {
  return apiGet.mock.calls
    .filter(([path]) => path === '/search')
    .map(([, options]) => {
      const query = (options as { query?: Record<string, unknown> } | undefined)?.query;
      return query ?? {};
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchResultsPage', () => {
  it('renders three groups from one request, with headlines, hrefs and totals', async () => {
    const { container } = renderPage({ q: 'welding' });

    expect(await screen.findByRole('heading', { name: 'Courses' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Resources' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Announcements' })).toBeInTheDocument();

    expect(searchGets()).toHaveLength(1);
    expect(searchGets()[0]).toEqual({ q: 'welding' });

    // Every hit links through its server-built linkPath as a real anchor. The
    // course query is anchored: the resource row's context line ("In Structural
    // Welding") would otherwise match the same name.
    const courseLink = screen.getByRole('link', { name: /^structural welding/i });
    expect(courseLink).toHaveAttribute('href', `/courses/${COURSE_ID}`);
    expect(screen.getByRole('link', { name: /weld inspection photo set/i })).toHaveAttribute(
      'href',
      `/resources/${RESOURCE_ID}`,
    );
    expect(screen.getByRole('link', { name: /spring intake applications open/i })).toHaveAttribute(
      'href',
      `/announcements/${ANNOUNCEMENT_ID}`,
    );

    // The matched term renders highlighted — as our own <mark>, with the API's
    // raw <b> markers nowhere in the DOM.
    expect(courseLink.querySelector('mark')?.textContent).toBe('welding');
    expect(container.innerHTML).not.toContain('<b>');

    // Totals: a capped group names its overflow, a complete one states itself.
    expect(screen.getByText(/best 1 of 12/i)).toBeInTheDocument();
    expect(screen.getByText('1 match')).toBeInTheDocument();

    // Overflow links through to the entity's own ranked list.
    expect(screen.getByRole('link', { name: /see all 12 matches/i })).toHaveAttribute(
      'href',
      '/courses?q=welding',
    );
    expect(screen.getByRole('link', { name: /see all 3 matches/i })).toHaveAttribute(
      'href',
      '/announcements?q=welding',
    );
    // Resources have no global list page to link to.
    expect(screen.queryByRole('link', { name: /see all.*resource/i })).toBeNull();
  });

  it('fires nothing until the query has a trimmed character', async () => {
    const page = renderPage({});
    expect(await screen.findByText(/search skillwright/i)).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();

    // Whitespace is the API's min(1)-after-trim refusal arriving early.
    page.rerenderWith({ q: '   ' });
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('shows the no-results state when every group comes back empty', async () => {
    apiGet.mockResolvedValue(EMPTY_RESULTS);
    renderPage({ q: 'zzzz' });

    expect(await screen.findByRole('heading', { name: /no matches/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows an error state with a retry when the request fails', async () => {
    apiGet.mockRejectedValue(new Error('boom'));
    renderPage({ q: 'welding' });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeEnabled();
  });

  it('updates the URL from the debounced input without pushing history', async () => {
    const user = userEvent.setup();
    renderPage({ q: 'welding' });
    await screen.findByRole('heading', { name: 'Courses' });

    const input = screen.getByRole('searchbox', {
      name: 'Search courses, resources and announcements',
    });
    await user.clear(input);
    await user.type(input, 'steel');

    await waitFor(
      () => {
        const navigations = navigateSpy.mock.calls.filter(
          ([arg]) =>
            typeof arg === 'object' &&
            arg !== null &&
            'search' in arg &&
            typeof (arg as { search: unknown }).search === 'function',
        );
        expect(navigations.length).toBeGreaterThan(0);
      },
      { timeout: 2_000 },
    );

    // The LAST debounced navigation wins; resolved against the previous URL the
    // way the router would, it carries exactly the typed term and replaces.
    const navigations = navigateSpy.mock.calls.filter(
      ([arg]) =>
        typeof arg === 'object' &&
        arg !== null &&
        'search' in arg &&
        typeof (arg as { search: unknown }).search === 'function',
    );
    const call = navigations.at(-1)?.[0] as {
      replace?: boolean;
      search: (previous?: unknown) => unknown;
    };
    expect(call.replace).toBe(true);
    expect(call.search({ q: 'welding' })).toEqual({ q: 'steel' });
  });

  it('follows a hit through its linkPath without a full page reload', async () => {
    const user = userEvent.setup();
    renderPage({ q: 'welding' });

    await user.click(await screen.findByRole('link', { name: /^structural welding/i }));

    expect(navigateSpy).toHaveBeenCalledWith({ href: `/courses/${COURSE_ID}` });
  });
});

describe('splitHeadline', () => {
  it('marks only the ts_headline spans and keeps everything else inert text', () => {
    expect(splitHeadline('a <b>hit</b> b')).toEqual([
      { text: 'a ', marked: false },
      { text: 'hit', marked: true },
      { text: ' b', marked: false },
    ]);
  });

  it('treats unbalanced markers and HTML-ish content as text, never markup', () => {
    const segments = splitHeadline('<script>alert(1)</script> <b>unclosed');
    // Rejoining the segments reproduces the payload MINUS the marker pair —
    // nothing was parsed into an element, so nothing can execute.
    expect(segments.map((segment) => segment.text).join('')).toBe(
      '<script>alert(1)</script> unclosed',
    );
    expect(segments.at(-1)).toEqual({ text: 'unclosed', marked: true });
  });
});
