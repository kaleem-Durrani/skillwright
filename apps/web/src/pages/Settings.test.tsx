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
import { BRAND } from '@skillwright/shared/brand';
import { qk } from '@/lib/query';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;
type ApiDelete = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, apiPatch, apiDel, searchMock } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
  apiPatch: vi.fn<ApiSend>(),
  apiDel: vi.fn<ApiDelete>(),
  searchMock: vi.fn<() => SettingsSearch>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: apiPatch, put: vi.fn(), del: apiDel },
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
    if (path === '/auth/me') return Promise.resolve(sessionEnvelope(false));
    return Promise.resolve({});
  });
  apiPost.mockResolvedValue({});
  apiDel.mockResolvedValue(undefined);
  // A save answers with the updated record and the page writes THAT into its
  // caches; `{}` here would have AvatarPicker render a nameless avatar.
  apiPatch.mockResolvedValue({ ...TEACHER_PROFILE });
});

/**
 * What GET /auth/me serves, in the envelope `fetchSession` collapses — built per call
 * because activation flips `mfaEnabled`, and the tab invalidates the session query to
 * re-read exactly that field. Only the fields `toSessionUser` projects are populated.
 */
function sessionEnvelope(totpEnabled: boolean): unknown {
  return {
    actor: { id: VIEWER_ID, provenance: 'PASSWORD', role: 'STUDENT', status: 'ACTIVE' },
    user: {
      id: VIEWER_ID,
      email: 'student@example.edu',
      name: 'Ada Okafor',
      role: 'STUDENT',
      status: 'ACTIVE',
      avatarUrl: null,
      mfaEnabled: totpEnabled,
    },
  };
}

function renderSettings(
  search: SettingsSearch = {},
  options: {
    viewer?: SessionUser;
    profile?: unknown;
    totpEnabled?: boolean;
    /** Overrides what GET /auth/me serves — e.g. stateful mocks that flip after activate. */
    authMe?: () => unknown;
  } = {},
): void {
  const viewer = options.viewer ?? VIEWER;
  const totpEnabled = options.totpEnabled ?? viewer.totpEnabled;
  apiGet.mockImplementation((path) => {
    if (path === '/users/me') return Promise.resolve(options.profile ?? PROFILE);
    if (path === '/auth/me') {
      return Promise.resolve(options.authMe ? options.authMe() : sessionEnvelope(totpEnabled));
    }
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
    // cannot be SENT; the form says so rather than silently keeping the old value.
    expect(await screen.findByText(/cannot be cleared/i)).toBeInTheDocument();
    expect(apiPatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — the MFA enrolment flow (TODO(mfa-ui) deleted)
//
// The enrol endpoint always worked; the screen threw its response away. These tests
// pin the finished flow end to end against the mocked client: QR + secret rendered
// from the enrol response, a 6-digit confirmation posted to /auth/mfa/activate, the
// recovery codes shown exactly once, and the enabled state offering the disable form
// that DELETEs /auth/mfa with BOTH the password and a code.
// ---------------------------------------------------------------------------

// The issuer in the URI comes from BRAND, the one place the product name is spelled
// (check:brand fails any literal outside it) — so the fixture interpolates it too.
const ENROLMENT = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUri: `otpauth://totp/${BRAND.name}:student@example.edu?secret=JBSWY3DPEHPK3PXP`,
  qrDataUrl: 'data:image/png;base64,qr',
};

async function typeConfirmationCode(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  // One keystroke per box: auto-advance walks the six inputs, and onComplete fires
  // when the sixth digit lands.
  await user.type(screen.getByLabelText('Digit 1 of 6'), '123456');
}

describe('SettingsPage — MFA enrolment', () => {
  it('renders the QR and secret from enrol and confirms with a 6-digit code', async () => {
    const user = userEvent.setup();
    // The fake server keeps state the way the real one does: once activate has
    // answered, GET /auth/me reports the account with two-factor on — which is the
    // refetch the tab triggers by invalidating the session query.
    let activated = false;
    apiPost.mockImplementation((path) => {
      if (path === '/auth/mfa/enroll') return Promise.resolve(ENROLMENT);
      activated = true;
      return Promise.resolve({ recoveryCodes: ['RESCUE-1111', 'RESCUE-2222'] });
    });

    renderSettings(
      { tab: 'security' },
      { viewer: { ...VIEWER, totpEnabled: false }, authMe: () => sessionEnvelope(activated) },
    );

    await user.click(await screen.findByRole('button', { name: /set up two-factor/i }));

    // The enrolment panel: the QR (an empty-alt decorative image, so it is queried
    // by that empty alt rather than by role), the base32 secret for manual entry,
    // then the confirmation boxes.
    expect(screen.getByAltText('')).toHaveAttribute('src', ENROLMENT.qrDataUrl);
    expect(screen.getByText(ENROLMENT.secret)).toBeInTheDocument();
    await typeConfirmationCode(user);

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/auth/mfa/activate', { code: '123456' }),
    );

    // Activation succeeded: recovery codes are on screen exactly once, and the card
    // now reads as enabled from the refreshed session.
    expect(await screen.findByText(/save these recovery codes now/i)).toBeInTheDocument();
    expect(screen.getByText('RESCUE-1111')).toBeInTheDocument();
    expect(await screen.findByText(/enabled\. you will be asked/i)).toBeInTheDocument();

    // "I have saved them" is the only way to dismiss them — there is no read-back.
    await user.click(screen.getByRole('button', { name: /i have saved them/i }));
    expect(screen.queryByText(/save these recovery codes now/i)).toBeNull();
  });

  it('clears the boxes and shows the server sentence when a code is refused', async () => {
    const user = userEvent.setup();
    apiPost.mockImplementation((path) => {
      if (path === '/auth/mfa/enroll') return Promise.resolve(ENROLMENT);
      return Promise.reject(
        new ApiError({
          type: 'about:blank',
          title: 'Request validation failed',
          status: 422,
          code: 'VALIDATION_FAILED',
          requestId: 'req-1',
          errors: [{ path: 'code', message: 'That code is not valid' }],
        }),
      );
    });

    renderSettings({ tab: 'security' }, { viewer: { ...VIEWER, totpEnabled: false } });
    await user.click(await screen.findByRole('button', { name: /set up two-factor/i }));
    await screen.findByText(ENROLMENT.secret);
    await typeConfirmationCode(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(/that code is not valid/i);
    // The first box is empty again — a refused code is retyped, not edited.
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveValue('');
  });

  it('offers the disable form when enabled and DELETEs password plus code together', async () => {
    const user = userEvent.setup();
    apiDel.mockResolvedValue(undefined);

    renderSettings({ tab: 'security' }, { viewer: { ...VIEWER, totpEnabled: true } });

    await user.click(await screen.findByRole('button', { name: /turn off two-factor/i }));

    const password = screen.getByLabelText(/^password/i);
    await user.type(password, 'correct-horse-battery-staple');
    await user.type(screen.getByLabelText('Digit 1 of 6'), '654321');

    await user.click(screen.getByRole('button', { name: /^turn off two-factor$/i }));

    await waitFor(() =>
      expect(apiDel).toHaveBeenCalledWith('/auth/mfa', {
        password: 'correct-horse-battery-staple',
        code: '654321',
      }),
    );
    // The confirm button refuses an incomplete pair before any request.
    expect(apiDel).toHaveBeenCalledTimes(1);
  });

  it('offers no enrolment to a demo session, saying so instead of hiding the card', async () => {
    renderSettings(
      { tab: 'security' },
      { viewer: { ...VIEWER, provenance: 'DEMO', totpEnabled: false } },
    );

    expect(
      await screen.findByText(/demo sessions cannot change two-factor settings/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set up two-factor/i })).toBeNull();
  });
});
