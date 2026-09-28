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
import type { UserDetail } from '@/lib/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;
type ApiPost = (path: string, payload?: unknown) => Promise<unknown>;
type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, apiPatch, searchMock } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiPost>(),
  apiPatch: vi.fn<ApiSend>(),
  searchMock: vi.fn<() => AdminUsersSearch>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: apiPatch, put: vi.fn(), del: vi.fn() },
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

describe('AdminUsersPage — the Reinstate affordance', () => {
  const VICTIM_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';

  /** A directory of exactly one account in the given status. */
  function mockDirectory(status: 'ACTIVE' | 'SUSPENDED'): void {
    const row: Partial<UserDetail> & Pick<UserDetail, 'id' | 'status'> = {
      id: VICTIM_ID,
      name: 'Walt Withdrew',
      email: 'walt@example.edu',
      role: 'STUDENT',
      status,
      avatarUrl: null,
      lastLoginAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      phoneNumber: null,
      bio: null,
      mfaEnabled: false,
      teacherProfile: null,
      studentProfile: null,
    };
    apiGet.mockImplementation((path) => {
      if (path.includes('/users')) {
        return Promise.resolve({
          data: [row],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      }
      return Promise.resolve({ data: [], meta: {} });
    });
  }

  it('offers Reinstate to an admin on a suspended row and posts the verb', async () => {
    const user = userEvent.setup();
    mockDirectory('SUSPENDED');
    renderAdminUsers(viewer({ role: 'ADMIN', name: 'Sam Admin' }));

    /*
     * EXACTLY ONE trigger, and asserting the count is the point.
     *
     * This used to read `findAllByRole(...)` and click `[0]`, because DataList
     * mounted the table and the card list together and switched them with
     * `display` — so every row menu existed twice under the same accessible name.
     * DataTable renders one branch, so a second trigger appearing here means the
     * dual-DOM pattern has come back.
     */
    const triggers = await screen.findAllByRole('button', { name: /actions for walt/i });
    expect(triggers).toHaveLength(1);
    await user.click(triggers[0]!);

    await user.click(await screen.findByRole('menuitem', { name: /reinstate account/i }));
    // The route takes no body — the SPA posts the bare path, exactly as suspend does.
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(`/users/${VICTIM_ID}/reinstate`);
    });
  });

  it('offers no Reinstate on an ACTIVE row', async () => {
    const user = userEvent.setup();
    mockDirectory('ACTIVE');
    renderAdminUsers(viewer({ role: 'ADMIN', name: 'Sam Admin' }));

    const triggers = await screen.findAllByRole('button', { name: /actions for walt/i });
    await user.click(triggers[0]!);

    expect(await screen.findByRole('menuitem', { name: /suspend account/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /reinstate account/i })).toBeNull();
  });

  it('a student sees no row menu at all — user:reinstate denies them like every other user verb', async () => {
    mockDirectory('SUSPENDED');
    renderAdminUsers(viewer());

    expect(await screen.findAllByText(/walt withdrew/i)).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: /actions for walt/i })).toBeNull();
  });
});

describe('AdminUsersPage — the Edit affordance', () => {
  const TARGET_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCW';

  /** One teacher, so the dialog's role-conditional fields have something to show. */
  function mockDirectory(): void {
    apiGet.mockImplementation((path) => {
      if (path.includes('/users')) {
        return Promise.resolve({
          data: [
            {
              id: TARGET_ID,
              name: 'Dana Okafor',
              email: 'dana@example.edu',
              role: 'TEACHER',
              status: 'ACTIVE',
              avatarUrl: null,
              phoneNumber: null,
              bio: null,
              mfaEnabled: false,
              lastLoginAt: null,
              createdAt: '2026-08-01T00:00:00.000Z',
              studentProfile: null,
              teacherProfile: {
                departmentId: DEPARTMENT_ID,
                departmentName: 'Welding',
                qualification: 'City & Guilds Level 3',
                specialization: null,
                staffNo: null,
              },
            } satisfies UserDetail,
          ],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      }
      return Promise.resolve({ data: [], meta: {} });
    });
  }

  it('wires the previously inert Edit item to a dialog seeded from the row it was opened on', async () => {
    const user = userEvent.setup();
    mockDirectory();
    apiPatch.mockResolvedValue({});
    renderAdminUsers(viewer({ role: 'ADMIN', name: 'Sam Admin' }));

    await user.click((await screen.findAllByRole('button', { name: /actions for dana/i }))[0]!);
    await user.click(await screen.findByRole('menuitem', { name: /edit account/i }));

    const dialog = await screen.findByRole('dialog');
    // Seeded from the row, not blank: a second form on the page with a second
    // fetch of a record this list is already holding is a second place for the
    // two to disagree.
    expect(within(dialog).getByRole('textbox', { name: /^name/i })).toHaveValue('Dana Okafor');
    expect(within(dialog).getByRole('textbox', { name: /qualification/i })).toHaveValue(
      'City & Guilds Level 3',
    );
  });

  it('saves through PATCH /users/:id, the admin route, not the self route', async () => {
    const user = userEvent.setup();
    mockDirectory();
    apiPatch.mockResolvedValue({});
    renderAdminUsers(viewer({ role: 'ADMIN', name: 'Sam Admin' }));

    await user.click((await screen.findAllByRole('button', { name: /actions for dana/i }))[0]!);
    await user.click(await screen.findByRole('menuitem', { name: /edit account/i }));
    const dialog = await screen.findByRole('dialog');

    await user.clear(within(dialog).getByRole('textbox', { name: /^name/i }));
    await user.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Dana Reid');
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(`/users/${TARGET_ID}`, { name: 'Dana Reid' });
    });
    // `PATCH /users/me` carries the same action and the same body schema and
    // edits the SIGNED-IN admin, so this is asserted literally.
    expect(apiPatch.mock.calls.map(([path]) => path)).not.toContain('/users/me');
  });
});

/**
 * The cohort import's GATE, and the one structural thing about it that a test can
 * pin: the affordance is hidden below `md`, and the class that does it is not one
 * `scripts/check-mobile-first.ts` forbids.
 *
 * The behaviour INSIDE the dialog is UserBulkImportDialog.test.tsx's; what belongs
 * here is who can reach it and what the page renders at a phone width.
 */
describe('AdminUsersPage — the Import-cohort gate', () => {
  it('offers no import affordance to a non-admin', async () => {
    renderAdminUsers(viewer());

    expect(await screen.findByText(/no accounts/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /import cohort/i })).toBeNull();
  });

  it('lets an admin open the import dialog from the header button', async () => {
    const user = userEvent.setup();
    renderAdminUsers(viewer({ role: 'ADMIN', name: 'Sam Admin' }));

    await user.click(await screen.findByRole('button', { name: /import cohort/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /import cohort/i })).toBeInTheDocument();
    // The dry run is the FIRST action offered, not a checkbox further down.
    expect(within(dialog).getByRole('button', { name: /check this file/i })).toBeInTheDocument();
  });

  /**
   * A demo admin is refused `user:bulk-create` by DEMO_DENIED (can.ts) — a
   * hundred-account write is exactly the thing a shared account must not do — so
   * the affordance has to disappear for them, not merely 403 when pressed.
   */
  it('hides it from a demo admin, because the action is in DEMO_DENIED', async () => {
    renderAdminUsers(viewer({ role: 'ADMIN', provenance: 'DEMO' }));

    expect(await screen.findByRole('button', { name: /add a user/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /import cohort/i })).toBeNull();
  });

  /**
   * The desktop-only decision, asserted on the CLASS rather than on a media query
   * jsdom would not apply. `hidden md:inline-flex` styles the SMALL viewport as
   * the base, which is what `check-mobile-first.ts` enforces; the spelling that
   * switches a control off above a width is a max-width query wearing a Tailwind
   * hat, and the script refuses every member of that family.
   */
  it('hides the control below md with the base-first spelling, not a max-* variant', async () => {
    renderAdminUsers(viewer({ role: 'ADMIN', name: 'Sam Admin' }));

    const button = await screen.findByRole('button', { name: /import cohort/i });
    const className = button.className;
    expect(className).toContain('hidden');
    expect(className).toContain('md:inline-flex');
    /*
     * The forbidden family, built from parts so this line is not itself a hit for
     * `check-mobile-first.ts` — which scans the WHOLE file, comments and regexes
     * included, and which caught exactly that when this test first named the
     * variant it forbids. A guard that fails to lint is a guard nobody runs.
     */
    const forbidden = new RegExp(`\\bmax-(${['sm', 'md', 'lg', 'xl', '2xl'].join('|')}):`);
    expect(className).not.toMatch(forbidden);
  });
});
