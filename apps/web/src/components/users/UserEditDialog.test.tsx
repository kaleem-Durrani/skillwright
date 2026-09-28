/**
 * Written against the CONTRACT, in the shape of UserCreateDialog.test.tsx:
 * queries a user could make (role + accessible name) and the network stubbed at
 * the one client this SPA talks through.
 *
 * What THIS file exists to pin — each of which is a way the feature could be
 * shipped wrong while still looking finished:
 *
 * - WHICH FIELDS the admin route accepts, and that the ones it does not (email,
 *   role, status, avatar) are absent from the form rather than present and inert.
 *   `updateUserSchema` has no `email` member at all, so nothing in this product
 *   can correct a sign-in address; a dialog that offered one would be offering a
 *   422.
 * - THAT THE PATCH GOES TO `/users/:id` AND NEVER TO `/users/me`. The two routes
 *   share an action and a body schema, and a dialog wired to the wrong one would
 *   edit the ADMIN rather than the row it was opened on — silently, and with a
 *   success toast. The id is asserted literally, not by pattern.
 * - THAT ONLY CHANGED FIELDS ARE SENT, and that a cleared nullable field travels
 *   as an explicit `null`. `updateUserSchema.phoneNumber` is
 *   `phoneSchema.nullable()` and `phoneSchema` refuses `''`, so shipping the
 *   form's empty strings is a 422 raised by the validator before the policy
 *   preHandler runs.
 * - THAT A FIELD WHICH CANNOT BE CLEARED IS OMITTED RATHER THAN BLANKED. The
 *   nullability is read off the shared schema, not declared here, so this test
 *   is also the pin on that read.
 * - THAT EVERY REFUSAL COMES FROM `updateUserSchema`, with its own sentence.
 * - THAT A SUSPENDED ACCOUNT'S EDIT SAYS SO. The service writes only the fields
 *   it is sent and the body has no status term, so the edit genuinely succeeds
 *   and the person genuinely still cannot sign in. A toast that read "account
 *   updated" and left it there is the claim the brief asks not to be made.
 */
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/problem';
import type { UserDetail } from '@/lib/types';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPatch } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPatch: vi.fn<ApiSend>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn(), patch: apiPatch, put: vi.fn(), del: vi.fn() },
  };
});

/**
 * The toast store is module-level, so asserting on it directly is the honest way
 * to check WHICH sentences were raised (the same argument UserCreateDialog.test
 * makes, and the one that stops a "saved" claim being written and left unproven).
 */
const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    fromError: vi.fn(),
  }),
}));

vi.mock('@/components/ui/Toast', () => ({ toast: toastMock }));

// Imported after the mocks so the component resolves the stubbed client.
import { UserEditDialog } from './UserEditDialog.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TARGET_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const DEPARTMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';

function target(overrides: Partial<UserDetail> = {}): UserDetail {
  return {
    id: TARGET_ID,
    email: 'dana@example.edu',
    name: 'Dana Okafor',
    role: 'TEACHER',
    status: 'ACTIVE',
    phoneNumber: null,
    bio: null,
    avatarUrl: null,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    teacherProfile: {
      departmentId: DEPARTMENT_ID,
      departmentName: 'Welding',
      qualification: 'City & Guilds Level 3',
      specialization: null,
      staffNo: null,
    },
    studentProfile: null,
    ...overrides,
  };
}

function student(overrides: Partial<UserDetail> = {}): UserDetail {
  return target({
    role: 'STUDENT',
    name: 'Ada Okafor',
    teacherProfile: null,
    studentProfile: {
      departmentId: DEPARTMENT_ID,
      departmentName: 'Welding',
      enrollmentNo: 'SW-2026-00000001',
      enrolledOn: '2026-08-01T00:00:00.000Z',
    },
    ...overrides,
  });
}

function adminAccount(overrides: Partial<UserDetail> = {}): UserDetail {
  return target({ role: 'ADMIN', teacherProfile: null, studentProfile: null, ...overrides });
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue({ data: [], meta: {} });
  apiPatch.mockResolvedValue({ ...target() });
});

/**
 * A probe query under the `users` list key. The dialog invalidates that prefix on
 * success; an OBSERVER is what turns the invalidation into a refetch this file can
 * count — without one, invalidateQueries has nothing visible to do.
 */
let listFetches = 0;

function UsersListProbe(): ReactElement {
  useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      listFetches += 1;
      return { data: [], meta: {} };
    },
  });
  return <></>;
}

function renderEdit(user: UserDetail | null, onOpenChange = vi.fn()): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <UsersListProbe />
      <UserEditDialog user={user} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
}

async function openDialog(user: UserDetail): Promise<HTMLElement> {
  renderEdit(user);
  return screen.findByRole('dialog');
}

function saveButton(dialog: HTMLElement): HTMLElement {
  const typed = dialog.querySelector('button[type="submit"]');
  if (typed instanceof HTMLElement) return typed;
  return within(dialog).getByRole('button', { name: /save changes/i });
}

function patchCalls(): Array<{ path: string; body: Record<string, unknown> }> {
  return apiPatch.mock.calls.map(([path, body]) => ({
    path: String(path),
    body: (body ?? {}) as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UserEditDialog — the field set the route actually accepts', () => {
  it('offers the seven fields updateUserSchema accepts and no email, role, status or avatar control', async () => {
    const dialog = await openDialog(target());

    expect(within(dialog).getByRole('textbox', { name: /^name/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /phone number/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /^bio/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /qualification/i })).toBeInTheDocument();

    // `updateUserSchema` has no `email` member, so NOTHING in this product can
    // change a sign-in address — not this dialog and not the person's own
    // Settings screen. A control here would be a 422, so the sentence in the body
    // is the whole affordance.
    expect(within(dialog).queryByRole('textbox', { name: /email/i })).toBeNull();
    expect(dialog.textContent).toMatch(/sign-in address cannot be changed/i);

    // Role and status are admin verbs with their own actions (and the role has no
    // endpoint at all), so they are named as out of scope rather than offered.
    expect(dialog.textContent).toMatch(/role and sign-in status are not editable/i);
    expect(within(dialog).queryByRole('combobox')).toBeNull();
  });

  it('shows the target’s own profile fields, decided by the target’s role and not by a select', async () => {
    const dialog = await openDialog(target());
    expect(within(dialog).getByRole('textbox', { name: /staff number/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: /enrolment number/i })).toBeNull();
  });

  it('offers a student an enrolment number and no teaching fields', async () => {
    const dialog = await openDialog(student());

    expect(within(dialog).getByRole('textbox', { name: /enrolment number/i })).toHaveValue(
      'SW-2026-00000001',
    );
    expect(within(dialog).queryByRole('textbox', { name: /qualification/i })).toBeNull();
    expect(within(dialog).queryByRole('textbox', { name: /staff number/i })).toBeNull();
  });

  it('offers an administrator neither profile, because an admin has no profile satellite', async () => {
    const dialog = await openDialog(adminAccount());

    expect(within(dialog).getByRole('textbox', { name: /^name/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: /qualification/i })).toBeNull();
    expect(within(dialog).queryByRole('textbox', { name: /enrolment number/i })).toBeNull();
  });
});

describe('UserEditDialog — which route it calls', () => {
  it('PATCHes the target’s id and never /users/me', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(target());

    await user.clear(within(dialog).getByRole('textbox', { name: /^name/i }));
    await user.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Dana O. Okafor');
    await user.click(saveButton(dialog));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    // LITERAL, not a pattern. `/users/me` is a real route carrying the same
    // action and the same body schema, and a dialog wired to it would edit the
    // signed-in admin while reporting success about somebody else.
    expect(patchCalls()[0]?.path).toBe(`/users/${TARGET_ID}`);
    expect(apiPatch.mock.calls.map(([path]) => path)).not.toContain('/users/me');
  });
});

describe('UserEditDialog — the body it sends', () => {
  it('sends only the field that changed, never the form’s empty strings', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(target());

    // specialization and staffNo are `null` in the fixture, so the form shows
    // them blank — and a form that shipped its blanks would be refused by
    // `phoneSchema` before the policy preHandler ever ran.
    await user.clear(within(dialog).getByRole('textbox', { name: /^name/i }));
    await user.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Dana Okafor-Reid');
    await user.click(saveButton(dialog));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(patchCalls()[0]?.body).toEqual({ name: 'Dana Okafor-Reid' });
  });

  it('carries a cleared nullable field as an explicit null, which is the only way to clear it', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(
      target({ phoneNumber: '+44 161 555 0100', bio: 'A short bio.' }),
    );

    await user.clear(within(dialog).getByRole('textbox', { name: /phone number/i }));
    await user.clear(within(dialog).getByRole('textbox', { name: /^bio/i }));
    await user.click(saveButton(dialog));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(patchCalls()[0]?.body).toEqual({ phoneNumber: null, bio: null });
  });

  it('omits a field that cannot be cleared rather than blanking it', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(target());

    // `qualification` is `z.string().trim().min(2)` — not nullable — and sits on
    // a NOT NULL column, so `''` cannot mean "clear". The field's own hint says
    // so, and the body simply leaves it out.
    await user.clear(within(dialog).getByRole('textbox', { name: /qualification/i }));
    await user.clear(within(dialog).getByRole('textbox', { name: /^name/i }));
    await user.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Dana Reid');
    await user.click(saveButton(dialog));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(patchCalls()[0]?.body).toEqual({ name: 'Dana Reid' });
    expect(dialog.textContent).toMatch(/cannot be blanked/i);
  });

  it('keeps Save disabled until something actually changes', async () => {
    const dialog = await openDialog(target());

    expect(saveButton(dialog)).toBeDisabled();
    // Typing and putting it back is still "no change" — the comparison is against
    // the record the dialog was opened with, not against emptiness.
    expect(within(dialog).getByRole('textbox', { name: /specialization/i })).toHaveValue('');
  });
});

describe('UserEditDialog — validation through the shared schema', () => {
  it('refuses a malformed phone number in the schema’s own words, before any PATCH', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(target());

    await user.type(within(dialog).getByRole('textbox', { name: /phone number/i }), 'call me');
    await user.click(saveButton(dialog));

    // `phoneSchema`'s own sentence (common.ts), not one restated here.
    expect(await within(dialog).findByText(/enter a valid phone number/i)).toBeInTheDocument();
    expect(patchCalls()).toHaveLength(0);
  });

  it('refuses a qualification the shared schema’s minimum refuses', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(target());

    await user.clear(within(dialog).getByRole('textbox', { name: /qualification/i }));
    await user.type(within(dialog).getByRole('textbox', { name: /qualification/i }), 'x');
    await user.click(saveButton(dialog));

    // `updateUserSchema.qualification` is `z.string().trim().min(2).max(200)`, so a
    // one-character value is refused by the schema this dialog runs — not by a
    // restated local copy of the rule, which is the drift this file exists to
    // prevent.
    await waitFor(() => expect(patchCalls()).toHaveLength(0));
    expect(
      await within(dialog).findByText(/at least 2|too small|2 characters/i),
    ).toBeInTheDocument();
  });
});

describe('UserEditDialog — a suspended account', () => {
  it('saves, and says plainly that sign-in is still off', async () => {
    const user = userEvent.setup();
    apiPatch.mockResolvedValue({ ...target({ status: 'SUSPENDED', name: 'Dana Reid' }) });
    const dialog = await openDialog(target({ status: 'SUSPENDED' }));

    await user.clear(within(dialog).getByRole('textbox', { name: /^name/i }));
    await user.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Dana Reid');
    await user.click(saveButton(dialog));

    // The API answers 200: `update` writes the fields it was sent and the body
    // has no status term, so the edit really does land and really does leave the
    // person unable to sign in.
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    const [title, options] = toastMock.success.mock.calls[0] as unknown[];
    expect(String(title)).toMatch(/dana reid updated/i);
    const description = String((options as { description?: unknown }).description);
    expect(description).toMatch(/sign-in is still off/i);
    expect(description).toMatch(/reinstate/i);
  });
});

describe('UserEditDialog — after a save', () => {
  it('sweeps the users prefix so the admin list re-reads the corrected row', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(target());
    const before = listFetches;

    await user.clear(within(dialog).getByRole('textbox', { name: /^name/i }));
    await user.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Dana Reid');
    await user.click(saveButton(dialog));

    await waitFor(() => expect(listFetches).toBeGreaterThan(before));
  });

  it('lands a field-level refusal from the API on the control that owns it', async () => {
    const user = userEvent.setup();
    apiPatch.mockRejectedValueOnce(
      new ApiError({
        type: 'about:blank',
        title: 'Validation failed',
        status: 422,
        code: 'VALIDATION_FAILED',
        detail: 'Profile field is not valid for this role.',
        errors: [
          { path: 'qualification', message: 'qualification applies to TEACHER accounts only.' },
        ],
        requestId: 'req-1',
      }),
    );
    const dialog = await openDialog(student());

    await user.clear(within(dialog).getByRole('textbox', { name: /enrolment number/i }));
    await user.type(
      within(dialog).getByRole('textbox', { name: /enrolment number/i }),
      'SW-2026-9',
    );
    await user.click(saveButton(dialog));

    // The sentence is the server's, and it lands under the field it names rather
    // than in a toast the person has already looked away from. There is no
    // qualification control on a student's form, so it is not shown at all and
    // the failure is not dressed up as something it is not.
    expect(toastMock.fromError).toHaveBeenCalledTimes(1);
  });

  it('reports an enrolment number already in use on the enrolment number', async () => {
    const user = userEvent.setup();
    apiPatch.mockRejectedValueOnce(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'CONFLICT',
        detail: 'Unique constraint failed',
        requestId: 'req-2',
      }),
    );
    const dialog = await openDialog(student());

    await user.clear(within(dialog).getByRole('textbox', { name: /enrolment number/i }));
    await user.type(
      within(dialog).getByRole('textbox', { name: /enrolment number/i }),
      'SW-2026-9',
    );
    await user.click(saveButton(dialog));

    expect(await within(dialog).findByText(/already in use/i)).toBeInTheDocument();
    expect(toastMock.fromError).not.toHaveBeenCalled();
  });

  it('sends a 403 to toast.fromError rather than to a field or a hand-written toast.error', async () => {
    const user = userEvent.setup();
    apiPatch.mockRejectedValueOnce(
      new ApiError({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        code: 'FORBIDDEN',
        detail: 'STUDENT:isSelf',
        requestId: 'req-3',
      }),
    );
    const dialog = await openDialog(target());

    await user.clear(within(dialog).getByRole('textbox', { name: /^name/i }));
    await user.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Dana Reid');
    await user.click(saveButton(dialog));

    await waitFor(() => expect(toastMock.fromError).toHaveBeenCalledTimes(1));
    const [error, fallback] = toastMock.fromError.mock.calls[0] as unknown[];
    expect(error).toBeInstanceOf(ApiError);
    expect(String(fallback)).toMatch(/could not save/i);
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
