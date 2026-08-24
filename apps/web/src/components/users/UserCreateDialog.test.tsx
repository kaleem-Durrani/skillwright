/**
 * Written against the CONTRACT, in the shape of CourseFormDialog.test.tsx:
 * queries a user could make (role + accessible name) and the network stubbed at
 * the one client this SPA talks through.
 *
 * What THIS file exists to pin:
 * - which controls exist is decided by the selected ROLE, matching what
 *   `createUserSchema` + `users.service.create` accept for each one — an admin
 *   gets neither a department nor profile fields, because carrying either is a 422;
 * - every rule, including the role-conditionals (a department for teachers and
 *   students, a qualification for teachers), is enforced client-side BY THE SHARED
 *   `createUserSchema` — so a refusal carries the schema's own sentence, and no
 *   POST leaves before it passes;
 * - the success copy says the account has NO password yet and names the reset
 *   flow — provisioning invents no second credential path;
 * - a successful create sweeps the `users` prefix, so the admin list re-reads and
 *   surfaces the new row.
 */
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/problem';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

/**
 * The toast store is module-level, so asserting on it directly is the honest way
 * to check WHICH sentences were raised (same argument AvatarPicker.test.tsx makes).
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
import { UserCreateDialog } from './UserCreateDialog.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEPARTMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';
const CREATED_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';

/** What POST /users answers with — only the fields these tests read are filled. */
const CREATED = {
  id: CREATED_ID,
  email: 'dana@example.edu',
  name: 'Dana Okafor',
  role: 'TEACHER',
  status: 'PENDING_VERIFICATION',
};

function departmentsPage(): unknown {
  return {
    data: [
      { id: DEPARTMENT_ID, name: 'Welding', slug: 'welding' },
      { id: '01JGXDFAM0K2Z1GYCSNM5F5RD2', name: 'Motor Vehicle', slug: 'motor-vehicle' },
    ],
    meta: {},
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((path: string) => {
    if (path.includes('/departments')) return Promise.resolve(departmentsPage());
    return Promise.resolve({});
  });
  apiPost.mockResolvedValue({ ...CREATED });
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

async function openDialog(): Promise<HTMLElement> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <UsersListProbe />
      <UserCreateDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  const dialog = await screen.findByRole('dialog');
  // The department options come from a fetch; wait for the query to land before any
  // test drives the select, or an option click races the departments query.
  await waitFor(() =>
    expect(apiGet).toHaveBeenCalledWith('/departments', { query: { limit: 200 } }),
  );
  return dialog;
}

/** Drive a Radix Select from the keyboard (the ResourceFormDialog.test arrangement). */
async function chooseOption(user: UserEvent, trigger: HTMLElement, label: string): Promise<void> {
  trigger.focus();
  await user.keyboard('{Enter}');
  const option = await screen.findByRole('option', { name: label });
  await user.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

function submitButton(dialog: HTMLElement): HTMLElement {
  const typed = dialog.querySelector('button[type="submit"]');
  if (typed instanceof HTMLElement) return typed;
  return within(dialog).getByRole('button', { name: /add/i });
}

function bodiesOf(pattern: RegExp): Array<Record<string, unknown>> {
  return apiPost.mock.calls
    .filter(([path]) => pattern.test(String(path)))
    .map(([, body]) => body as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UserCreateDialog — role-conditional fields', () => {
  it('swaps the form’s controls as the role changes, never offering a field the wire refuses for that role', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog();

    // STUDENT default: a department (mandatory off ADMIN) and an enrolment number,
    // but no teaching fields.
    expect(within(dialog).getByRole('combobox', { name: /department/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /enrolment number/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: /qualification/i })).toBeNull();

    await chooseOption(user, within(dialog).getByRole('combobox', { name: /role/i }), 'Teacher');

    expect(within(dialog).getByRole('textbox', { name: /qualification/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /specialization/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /staff number/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: /enrolment number/i })).toBeNull();

    await chooseOption(
      user,
      within(dialog).getByRole('combobox', { name: /role/i }),
      'Administrator',
    );

    // An ADMIN carries neither satellite nor department; the select is replaced by
    // a sentence saying so rather than a control that could only ever 422.
    expect(within(dialog).queryByRole('combobox', { name: /department/i })).toBeNull();
    expect(dialog.textContent).toMatch(/outside the department structure/i);
    expect(within(dialog).queryByRole('textbox', { name: /qualification/i })).toBeNull();
    expect(within(dialog).queryByRole('textbox', { name: /staff number/i })).toBeNull();
  });
});

describe('UserCreateDialog — validation through the shared schema', () => {
  it('refuses a teacher without a department in the schema’s own words, before any POST', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog();

    await chooseOption(user, within(dialog).getByRole('combobox', { name: /role/i }), 'Teacher');
    await user.type(within(dialog).getByRole('textbox', { name: /name/i }), 'Dana Okafor');
    await user.type(within(dialog).getByRole('textbox', { name: /email/i }), 'dana@example.edu');
    await user.type(
      within(dialog).getByRole('textbox', { name: /qualification/i }),
      'City & Guilds Level 3',
    );

    await user.click(submitButton(dialog));

    // The sentence is createUserSchema's own superRefine message — proof the rule
    // was not restated client-side but delegated verbatim.
    expect(await within(dialog).findByText(/must belong to a department/i)).toBeInTheDocument();
    expect(bodiesOf(/\/users/)).toHaveLength(0);
  });

  it('refuses a teacher without a qualification, the other superRefine rule', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog();

    await chooseOption(user, within(dialog).getByRole('combobox', { name: /role/i }), 'Teacher');
    await user.type(within(dialog).getByRole('textbox', { name: /name/i }), 'Dana Okafor');
    await user.type(within(dialog).getByRole('textbox', { name: /email/i }), 'dana@example.edu');
    const department = within(dialog).getByRole('combobox', { name: /department/i });
    await chooseOption(user, department, 'Welding');

    await user.click(submitButton(dialog));

    expect(await within(dialog).findByText(/requires a qualification/i)).toBeInTheDocument();
    expect(bodiesOf(/\/users/)).toHaveLength(0);
  });
});

describe('UserCreateDialog — creating', () => {
  it('POSTs exactly the fields the chosen role carries, omitting untouched optionals', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog();

    await chooseOption(user, within(dialog).getByRole('combobox', { name: /role/i }), 'Teacher');
    await user.type(within(dialog).getByRole('textbox', { name: /name/i }), 'Dana Okafor');
    await user.type(within(dialog).getByRole('textbox', { name: /email/i }), 'dana@example.edu');
    await chooseOption(
      user,
      within(dialog).getByRole('combobox', { name: /department/i }),
      'Welding',
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: /qualification/i }),
      'City & Guilds Level 3',
    );
    // specialization and staffNo left blank.

    await user.click(submitButton(dialog));

    await waitFor(() => expect(bodiesOf(/\/users/)).toHaveLength(1));
    expect(apiPost).toHaveBeenCalledWith('/users', {
      email: 'dana@example.edu',
      name: 'Dana Okafor',
      role: 'TEACHER',
      departmentId: DEPARTMENT_ID,
      qualification: 'City & Guilds Level 3',
    });
    // No empty strings shipped as values: an absent optional means the server
    // stores null, not ''.
    expect(Object.keys(bodiesOf(/\/users/)[0] ?? {})).not.toContain('specialization');
    expect(Object.keys(bodiesOf(/\/users/)[0] ?? {})).not.toContain('staffNo');
  });

  it('lets a student leave the enrolment number blank — the server generates one', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog();

    await user.type(within(dialog).getByRole('textbox', { name: /name/i }), 'Ada Okafor');
    await user.type(within(dialog).getByRole('textbox', { name: /email/i }), 'ada@example.edu');
    await chooseOption(
      user,
      within(dialog).getByRole('combobox', { name: /department/i }),
      'Welding',
    );

    await user.click(submitButton(dialog));

    await waitFor(() => expect(bodiesOf(/\/users/)).toHaveLength(1));
    expect(apiPost).toHaveBeenCalledWith('/users', {
      email: 'ada@example.edu',
      name: 'Ada Okafor',
      role: 'STUDENT',
      departmentId: DEPARTMENT_ID,
    });
    expect(Object.keys(bodiesOf(/\/users/)[0] ?? {})).not.toContain('enrollmentNo');
  });

  it('says the account has no password yet and names the reset flow as the way it gets one', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog();

    await user.type(within(dialog).getByRole('textbox', { name: /name/i }), 'Ada Okafor');
    await user.type(within(dialog).getByRole('textbox', { name: /email/i }), 'ada@example.edu');
    await chooseOption(
      user,
      within(dialog).getByRole('combobox', { name: /department/i }),
      'Welding',
    );

    await user.click(submitButton(dialog));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    const [title, options] = toastMock.success.mock.calls[0] as unknown[];
    expect(String(title)).toMatch(/added|created/i);
    const description = String((options as { description?: unknown }).description);
    expect(description).toMatch(/no password yet/i);
    expect(description).toMatch(/forgot password/i);
    expect(toastMock.fromError).not.toHaveBeenCalled();
  });

  it('sweeps the users prefix on success, so the admin list refetches and surfaces the new row', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog();
    const before = listFetches;

    await user.type(within(dialog).getByRole('textbox', { name: /name/i }), 'Ada Okafor');
    await user.type(within(dialog).getByRole('textbox', { name: /email/i }), 'ada@example.edu');
    await chooseOption(
      user,
      within(dialog).getByRole('combobox', { name: /department/i }),
      'Welding',
    );

    await user.click(submitButton(dialog));

    await waitFor(() => expect(listFetches).toBeGreaterThan(before));
  });

  it('lands an email collision on the email field and keeps the dialog open', async () => {
    apiPost.mockRejectedValueOnce(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'CONFLICT',
        detail: 'An account with this email already exists',
        requestId: 'req-1',
      }),
    );

    const user = userEvent.setup();
    const dialog = await openDialog();

    await user.type(within(dialog).getByRole('textbox', { name: /name/i }), 'Ada Okafor');
    await user.type(within(dialog).getByRole('textbox', { name: /email/i }), 'ada@example.edu');
    await chooseOption(
      user,
      within(dialog).getByRole('combobox', { name: /department/i }),
      'Welding',
    );

    await user.click(submitButton(dialog));

    expect(await within(dialog).findByText(/already exists/i)).toBeInTheDocument();
    await waitFor(() => expect(toastMock.success).not.toHaveBeenCalled());
  });
});
