/**
 * Pins the GATE, not the dialog's insides — UserCreateDialog.test.tsx owns those.
 *
 * `user:create` is subject-free (every cell is a terminal allow/deny decided by
 * role alone), which is what makes it lawful to gate an affordance that has no
 * target yet. This file proves the two cells that matter to this screen: a
 * non-admin never sees the affordance at all — a disabled button would still
 * advertise a capability the API refuses (Gate.tsx's own argument) — and an admin
 * sees it and can open the dialog from it.
 *
 * Harness as in Settings.test.tsx: route module mocked down to `Route.useSearch`,
 * network stubbed at `@/lib/api`, session seeded into the cache.
 */
import type { SessionUser } from '@/lib/session';
import type { AdminUsersSearch } from '@/routes/_app/admin.users';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, searchMock } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  searchMock: vi.fn<() => AdminUsersSearch>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

vi.mock('@/routes/_app/admin.users', () => ({
  Route: { useSearch: () => searchMock(), fullPath: '/admin/users' },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// Imported after the mocks so the page resolves the stubbed client and route.
import { AdminUsersPage } from './AdminUsers.js';

const DEPARTMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';

function viewer(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: '01JGXDFAM0K2Z1GYCSNM5F5RCX',
    email: 'student@example.edu',
    name: 'Ada Okafor',
    role: 'STUDENT',
    status: 'ACTIVE',
    provenance: 'PASSWORD',
    avatarUrl: null,
    totpEnabled: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((path) => {
    if (path.includes('/users')) {
      return Promise.resolve({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    }
    if (path.includes('/departments')) {
      return Promise.resolve({
        data: [{ id: DEPARTMENT_ID, name: 'Welding', slug: 'welding' }],
        meta: {},
      });
    }
    return Promise.resolve({});
  });
});

function renderAdminUsers(session: SessionUser): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: session });
  searchMock.mockReturnValue({ page: 1 });
  render(
    <QueryClientProvider client={client}>
      <AdminUsersPage />
    </QueryClientProvider>,
  );
}

describe('AdminUsersPage — the Add-a-user gate', () => {
  it('offers no Add affordance to a non-admin', async () => {
    renderAdminUsers(viewer());

    // The page itself has rendered (its empty state is up) before the absence
    // means anything.
    expect(await screen.findByText(/no accounts/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add a user/i })).toBeNull();
    expect(apiGet).not.toHaveBeenCalledWith('/departments', expect.anything());
  });

  it('lets an admin open the provisioning dialog from the header button', async () => {
    const user = userEvent.setup();
    renderAdminUsers(viewer({ role: 'ADMIN', name: 'Sam Admin' }));

    const button = await screen.findByRole('button', { name: /add a user/i });
    await user.click(button);

    // The dialog is the provisioning one — its title says so, and it opens the
    // form whose controls UserCreateDialog.test.tsx pins in detail.
    expect(await screen.findByRole('heading', { name: /add a user/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('dialog').querySelector('form')).not.toBeNull();
    });
  });

  it('a demo admin — DEMO_DENIED does not cover user:create — still sees the affordance', async () => {
    renderAdminUsers(viewer({ role: 'ADMIN', provenance: 'DEMO' }));

    // `user:create` is absent from DEMO_DENIED (can.ts:24-31), so the gate asks
    // the role and nothing else; the button must not hide on provenance.
    expect(await screen.findByRole('button', { name: /add a user/i })).toBeInTheDocument();
  });
});
