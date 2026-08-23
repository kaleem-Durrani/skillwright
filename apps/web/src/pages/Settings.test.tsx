/**
 * Pins the REMOVAL of the fake "Notifications" tab from Settings.
 *
 * That tab was four uncontrolled checkboxes and a Save button wired to nothing,
 * promising email preferences that no endpoint backs (Phase 1 of the feature plan
 * removes it before real in-app events start landing under controls that lie).
 * The regression this test guards is the lie coming BACK: a tab, a heading or a
 * save affordance for preferences that do not exist.
 *
 * Harness as in Notifications.test.tsx: route module mocked down to
 * `Route.useSearch`, network stubbed at `@/lib/api`, session seeded into the cache.
 */
import type { SessionUser } from '@/lib/session';
import type { SettingsSearch } from '@/routes/_app/settings';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, searchMock } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
  searchMock: vi.fn<() => SettingsSearch>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

vi.mock('@/routes/_app/settings', () => ({
  Route: { useSearch: () => searchMock(), fullPath: '/settings' },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// Imported after the mocks so the page resolves the stubbed client and route.
import { SettingsPage } from './Settings.js';

const VIEWER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';

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

/** What GET /users/me serves; only the fields ProfileTab reads are populated. */
const PROFILE = {
  id: VIEWER_ID,
  name: 'Ada Okafor',
  email: 'student@example.edu',
  role: 'STUDENT',
  status: 'ACTIVE',
  phoneNumber: null,
  bio: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((path) => {
    if (path === '/users/me') return Promise.resolve(PROFILE);
    return Promise.resolve({});
  });
  apiPost.mockResolvedValue({});
});

function renderSettings(search: SettingsSearch = {}): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: VIEWER });
  searchMock.mockReturnValue(search);
  render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

describe('SettingsPage', () => {
  it('keeps the real tabs and renders nothing that promises notification preferences', async () => {
    renderSettings();

    // The tabs that DO exist keep existing.
    expect(screen.getByRole('tab', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Security' })).toBeInTheDocument();

    // Every artefact of the removed fake is gone — the trigger, its panel's
    // heading and copy, and the Save button wired to nothing.
    expect(screen.queryByRole('tab', { name: /notifications/i })).toBeNull();
    expect(screen.queryByText(/email notifications/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /save preferences/i })).toBeNull();

    // And so are the four checkboxes it used to promise with.
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('no longer accepts ?tab=notifications as a settings tab value', async () => {
    /*
     * The retirement has two halves: the UI above, and the route's own search
     * contract. The real `validateSearch` must reduce the legacy value to `{}` —
     * an old bookmarked /settings?tab=notifications lands on the default tab
     * rather than selecting a tab that is gone. The mocked module stands in for
     * the page render, so the REAL route definition is loaded here explicitly.
     * `options.validateSearch` is a union of validator shapes at the type level;
     * this route sets a plain function.
     */
    const actual = await vi.importActual<{
      Route: { options: { validateSearch: unknown } };
    }>('@/routes/_app/settings');
    const validate = actual.Route.options.validateSearch as (
      search: Record<string, unknown>,
    ) => SettingsSearch;

    expect(validate({ tab: 'notifications' })).toEqual({});
    expect(validate({})).toEqual({});
    // The values that remain are still honoured.
    expect(validate({ tab: 'security' })).toEqual({ tab: 'security' });
    expect(validate({ tab: 'profile' })).toEqual({ tab: 'profile' });
  });
});
