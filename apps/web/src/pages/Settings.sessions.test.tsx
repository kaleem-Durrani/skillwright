/**
 * `POST /auth/logout-all` — the fourth of Phase 5's holes, and the only one that
 * was a LIE rather than a silence.
 *
 * The Settings screen's Sessions card read "Sign out everywhere if you have used
 * a shared workshop machine" above a button labelled **Sign out**, which calls
 * `POST /auth/logout` and destroys exactly one session: this browser's. The
 * sentence described a capability the button did not have, which is the same class
 * of defect the roadmap records for the `/messages` empty state ("Start one from a
 * course page" — no course page had the affordance). The fix there was to build
 * the affordance rather than to reword the sentence, and it is the fix here too:
 * the endpoint existed, with a gate and a body that reports how many sessions it
 * removed.
 *
 * The second thing this file pins is that "everywhere" and "here" are DIFFERENT
 * requests, and that both empty this browser. A second copy of the sign-out
 * teardown is how one of them ends up leaving the app's cache standing over the
 * login form — which is the bug `useLogout`'s own comment records at length.
 */
import type { SessionUser } from '@/lib/session';
import type { SettingsSearch } from '@/routes/_app/settings';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, searchMock, navigate } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
  searchMock: vi.fn<() => SettingsSearch>(),
  navigate: vi.fn(),
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
  return { ...actual, useNavigate: () => navigate };
});

import { SettingsPage } from './Settings.js';

const VIEWER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';

const VIEWER: SessionUser = {
  id: VIEWER_ID,
  email: 'ada@skillwright.dev',
  name: 'Ada Okafor',
  role: 'STUDENT',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

const PROFILE = {
  id: VIEWER_ID,
  name: 'Ada Okafor',
  email: 'ada@skillwright.dev',
  role: 'STUDENT',
  status: 'ACTIVE',
  phoneNumber: null,
  bio: null,
  avatarUrl: null,
  mfaEnabled: false,
  lastLoginAt: null,
  createdAt: '2026-01-05T09:00:00.000Z',
  teacherProfile: null,
  studentProfile: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  searchMock.mockReturnValue({ tab: 'security' });
  apiGet.mockImplementation((path) => {
    if (path === '/users/me') return Promise.resolve(PROFILE);
    return Promise.resolve({});
  });
  apiPost.mockResolvedValue({ revoked: 3 });
});

function renderSettings(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.session, { user: VIEWER });
  render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
  return client;
}

describe('Settings — the Sessions card keeps the promise its sentence makes', () => {
  it('names both acts, and the sentence is the promise for both', async () => {
    renderSettings();

    // The sentence, split into the two claims it was really making. If this ever
    // goes back to promising "everywhere" beside one button, the test says so.
    expect(
      await screen.findByText(/Sign out on this device only, or everywhere/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Sign out$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out everywhere' })).toBeInTheDocument();
  });

  it('signs out everywhere through the endpoint that revokes every session', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/auth/logout-all'));
    // And the single-session endpoint is NOT what this button reaches for.
    expect(apiPost).not.toHaveBeenCalledWith('/auth/logout');
  });

  it('leaves the single sign-out revoking this session only', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: /^Sign out$/ }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/auth/logout'));
    expect(apiPost).not.toHaveBeenCalledWith('/auth/logout-all');
  });

  it('empties this browser and navigates, whichever button was used', async () => {
    const user = userEvent.setup();
    const client = renderSettings();
    // Something fetched under this session, so the sweep has something to sweep.
    client.setQueryData(['courses', {}], { data: [] });

    await user.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }));
    /*
     * A cache entry that outlives its session is the data leak the next person on
     * a shared workshop machine sees — which is the entire reason this screen
     * exists. The session entry is KEPT carrying the anonymous sentinel, because
     * that is the value `fetchSession` resolves to on a 401 and the guard reads it
     * out of the cache.
     */
    expect(client.getQueryData(['courses', {}])).toBeUndefined();
    expect(client.getQueryData(qk.session)).toEqual({ user: null });
  });

  it('still empties this browser when the request fails on the way out', async () => {
    const user = userEvent.setup();
    const client = renderSettings();
    client.setQueryData(['courses', {}], { data: [] });
    apiPost.mockRejectedValue(new Error('network down'));

    await user.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));

    // `onSettled`, not `onSuccess`: a blip must not leave the person sitting in a
    // signed-in shell over a session the server has already ended.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }));
    expect(client.getQueryData(['courses', {}])).toBeUndefined();
  });
});
