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
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, apiPatch, searchMock } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
  apiPatch: vi.fn<ApiSend>(),
  searchMock: vi.fn<() => SettingsSearch>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: apiPatch, put: vi.fn(), del: vi.fn() },
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
import { ApiError } from '@/lib/problem';
import { SettingsPage } from './Settings.js';

const VIEWER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';
const DEPARTMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';

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

const TEACHER_VIEWER: SessionUser = {
  ...VIEWER,
  id: TEACHER_ID,
  email: 'teacher@example.edu',
  name: 'Dana Okafor',
  role: 'TEACHER',
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

/** A teacher record with the Phase 4b satellite attached. */
const TEACHER_PROFILE = {
  id: TEACHER_ID,
  name: 'Dana Okafor',
  email: 'teacher@example.edu',
  role: 'TEACHER',
  status: 'ACTIVE',
  phoneNumber: null,
  bio: null,
  teacherProfile: {
    departmentId: DEPARTMENT_ID,
    departmentName: 'Welding',
    qualification: 'City & Guilds Level 3',
    specialization: 'Fabrication',
    staffNo: 'T-0091',
  },
  studentProfile: null,
};

/** A student record with the Phase 4b satellite attached. */
const STUDENT_PROFILE = {
  ...PROFILE,
  teacherProfile: null,
  studentProfile: {
    departmentId: DEPARTMENT_ID,
    departmentName: 'Welding',
    enrollmentNo: 'S-2026-0042',
    enrolledOn: '2026-08-01T09:00:00.000Z',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((path) => {
    if (path === '/users/me') return Promise.resolve(PROFILE);
    return Promise.resolve({});
  });
  apiPost.mockResolvedValue({});
  // A save answers with the updated record and the page writes THAT into its
  // caches; `{}` here would have AvatarPicker render a nameless avatar.
  apiPatch.mockResolvedValue({ ...TEACHER_PROFILE });
});

function renderSettings(
  search: SettingsSearch = {},
  options: { viewer?: SessionUser; profile?: unknown } = {},
): void {
  const viewer = options.viewer ?? VIEWER;
  apiGet.mockImplementation((path) => {
    if (path === '/users/me') return Promise.resolve(options.profile ?? PROFILE);
    return Promise.resolve({});
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: viewer });
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

// ---------------------------------------------------------------------------
// Phase 4b — the editable profile columns
//
// The pairing they follow is the SERVER's (PROFILE_FIELD_ROLES,
// users.service.ts): a teacher's PATCH may carry qualification/specialization/
// staffNo, a student's enrollmentNo, and role-mismatched fields are a field-level
// 422. The form renders exactly that pairing and saves through the ONE
// profile-save path this page already had.
// ---------------------------------------------------------------------------

describe('SettingsPage — profile fields by role', () => {
  it('shows a teacher the teaching details seeded from /me, and never a student field', async () => {
    renderSettings({}, { viewer: TEACHER_VIEWER, profile: TEACHER_PROFILE });

    // The controls mount blank and fill when /me lands; waiting for the seed is
    // what makes the assertion about VALUES rather than about timing.
    const qualification = screen.getByLabelText(/qualification/i);
    await waitFor(() => expect(qualification).toHaveValue('City & Guilds Level 3'));

    expect(screen.getByLabelText(/specialization/i)).toHaveValue('Fabrication');
    expect(screen.getByLabelText(/staff number/i)).toHaveValue('T-0091');
    expect(screen.getByRole('heading', { name: /teaching details/i })).toBeInTheDocument();

    expect(screen.queryByLabelText(/enrolment number/i)).toBeNull();
  });

  it('shows a student their enrolment number seeded from /me, and none of the teaching fields', async () => {
    renderSettings({}, { profile: STUDENT_PROFILE });

    const enrolment = screen.getByLabelText(/enrolment number/i);
    await waitFor(() => expect(enrolment).toHaveValue('S-2026-0042'));

    expect(screen.queryByLabelText(/qualification/i)).toBeNull();
    expect(screen.queryByLabelText(/specialization/i)).toBeNull();
    expect(screen.queryByLabelText(/staff number/i)).toBeNull();
  });

  it('shows an admin neither section — there is no satellite for their role', async () => {
    renderSettings(
      {},
      {
        viewer: { ...VIEWER, role: 'ADMIN' },
        profile: { ...PROFILE, role: 'ADMIN', teacherProfile: null, studentProfile: null },
      },
    );

    await screen.findByLabelText(/full name/i);
    expect(screen.queryByLabelText(/qualification/i)).toBeNull();
    expect(screen.queryByLabelText(/enrolment number/i)).toBeNull();
    expect(screen.queryByRole('heading', { name: /teaching details/i })).toBeNull();
  });

  it('says so honestly when a legacy account has no profile record behind its fields', async () => {
    renderSettings(
      {},
      { viewer: TEACHER_VIEWER, profile: { ...TEACHER_PROFILE, teacherProfile: null } },
    );

    expect(await screen.findByText(/no teaching record yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/qualification/i)).toHaveValue('');
  });
});

describe('SettingsPage — saving the profile fields', () => {
  it('PATCHes only what changed, through the same save path as the personal details', async () => {
    const user = userEvent.setup();
    renderSettings({}, { viewer: TEACHER_VIEWER, profile: TEACHER_PROFILE });

    const staffNo = screen.getByLabelText(/staff number/i);
    // Seeded AND enabled: /me has landed, so fieldsDisabled has lifted.
    await waitFor(() => expect(staffNo).toHaveValue('T-0091'));
    await user.clear(staffNo);
    await user.type(staffNo, 'T-0092');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    // Exactly the edited column: untouched fields are omitted, so saving a staff
    // number can never blank a qualification.
    expect(apiPatch).toHaveBeenCalledWith('/users/me', { staffNo: 'T-0092' });
  });

  it('lands a 422 naming a profile column on that field', async () => {
    apiPatch.mockRejectedValueOnce(
      new ApiError({
        type: 'about:blank',
        title: 'Request validation failed',
        status: 422,
        code: 'VALIDATION_FAILED',
        requestId: 'req-1',
        errors: [{ path: 'staffNo', message: 'That staff number is not acceptable.' }],
      }),
    );

    const user = userEvent.setup();
    renderSettings({}, { viewer: TEACHER_VIEWER, profile: TEACHER_PROFILE });

    const staffNo = screen.getByLabelText(/staff number/i);
    await waitFor(() => expect(staffNo).toHaveValue('T-0091'));
    await user.clear(staffNo);
    await user.type(staffNo, 'T-0092');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    // The server's message appears under ITS field — the isProfileField gate in
    // the mutation's onError, extended to the new columns.
    expect(await screen.findByText(/that staff number is not acceptable/i)).toBeInTheDocument();
  });

  it('refuses to clear a NOT NULL column inline, before any PATCH', async () => {
    const user = userEvent.setup();
    renderSettings({}, { viewer: TEACHER_VIEWER, profile: TEACHER_PROFILE });

    const qualification = screen.getByLabelText(/qualification/i);
    await waitFor(() => expect(qualification).toHaveValue('City & Guilds Level 3'));
    await user.clear(qualification);

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    // `updateUserSchema.qualification` accepts neither '' nor null, so clearing
    // cannot be sent; the form says so rather than silently keeping the old value.
    expect(await screen.findByText(/cannot be cleared/i)).toBeInTheDocument();
    expect(apiPatch).not.toHaveBeenCalled();
  });
});
