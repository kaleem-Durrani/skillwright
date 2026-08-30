/**
 * Student self-registration.
 *
 * Two things here are worth a test rather than an e2e pass:
 *
 * - WHAT IS POSTED. The form holds six fields and the endpoint accepts four:
 *   `confirmPassword` and `accepted` exist for the user, not for the server. A
 *   body carrying a field the schema does not describe is the recorded way this
 *   whole flow turns into a 422 nobody can read — the shape of LESSONS-LEARNED
 *   #17, where a producer and a consumer of the same contract lived in different
 *   packages. The assertion is `toEqual`, deliberately, so an extra key fails.
 * - THE ADDRESS TRAVELLING. `POST /auth/register` answers 202 with an ack and NO
 *   session, and `POST /auth/verify-email` requires `{ email, code }`. Without the
 *   search param on the navigate, the next screen has no address to verify and
 *   every code the user types 422s — with the whole flow otherwise looking fine.
 *
 * The department select reads the PAGINATED envelope (`{ data, meta }`). A local
 * `interface Department { id; name }` used to stand in for it here and matched
 * neither; the option list below is what makes a re-introduction visible.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;
type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, navigateSpy, toastMock } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
  navigateSpy: vi.fn(),
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    fromError: vi.fn(),
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>,
  };
});

vi.mock('@/components/ui/Toast', () => ({ toast: toastMock }));

// Imported after the mocks so the page resolves the stubbed client.
import { ApiError } from '@/lib/problem';
import { RegisterPage } from './Register.js';

const WELDING_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';
const JOINERY_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';

/** The paginated envelope `GET /departments` actually serves. */
const DEPARTMENTS = {
  data: [
    { id: WELDING_ID, name: 'Welding & Fabrication', slug: 'welding-fabrication' },
    { id: JOINERY_ID, name: 'Joinery', slug: 'joinery' },
  ],
  meta: { total: 2, page: 1, limit: 20, totalPages: 1 },
};

const PASSWORD = 'correct horse battery';

async function renderPage() {
  apiGet.mockResolvedValue(DEPARTMENTS);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RegisterPage />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  // The select is a skeleton until the departments query lands; clicking before
  // then races the fetch rather than testing anything.
  await screen.findByRole('combobox', { name: /department/i });
  return user;
}

/** Drive a Radix Select from the keyboard, as the dialog tests do. */
async function chooseDepartment(user: UserEvent, label: string): Promise<void> {
  screen.getByRole('combobox', { name: /department/i }).focus();
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('option', { name: label }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

/** Fills every field with something the client-side schema accepts. */
async function fillValidForm(user: UserEvent): Promise<void> {
  await user.type(screen.getByLabelText(/full name/i), 'Ada Okafor');
  await user.type(screen.getByLabelText(/^email/i), 'ada@example.edu');
  await chooseDepartment(user, 'Joinery');
  await user.type(screen.getByLabelText(/^new password|^password/i), PASSWORD);
  await user.type(screen.getByLabelText(/confirm password/i), PASSWORD);
  await user.click(screen.getByRole('checkbox'));
}

function submit(user: UserEvent) {
  return user.click(screen.getByRole('button', { name: 'Create account' }));
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  navigateSpy.mockReset();
  toastMock.success.mockReset();
  toastMock.fromError.mockReset();
});

describe('the department select', () => {
  it('reads the paginated envelope the endpoint serves', async () => {
    const user = await renderPage();

    screen.getByRole('combobox', { name: /department/i }).focus();
    await user.keyboard('{Enter}');

    // Reading `data` off the envelope instead of `data.data` renders an empty
    // select — a screen with no error and no way forward.
    expect(
      await screen.findByRole('option', { name: 'Welding & Fabrication' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Joinery' })).toBeInTheDocument();
  });

  it('asks anonymously, because there is no session yet to gate on', async () => {
    await renderPage();

    // `department:list` is a bare allow for anonymous precisely so this select can
    // fill before anyone has an account. A `can()` gate here would be a
    // subject-free check on a screen with no actor: permanently false.
    expect(apiGet).toHaveBeenCalledWith('/departments');
  });
});

describe('what the form refuses before the network sees it', () => {
  it('names every empty required field at once', async () => {
    const user = await renderPage();

    await submit(user);

    // Read from the field messages themselves rather than by text: "Choose a
    // department" is also the select's PLACEHOLDER, so a plain text query matches
    // an element that is on screen before anything is wrong.
    const messages = (await screen.findAllByRole('status')).map((node) => node.textContent);
    expect(messages).toEqual(
      expect.arrayContaining([
        'Enter your full name',
        'Enter your email address',
        'Choose a department',
        'Use at least 12 characters',
      ]),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('You need to accept the terms to continue');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('refuses a password under twelve characters', async () => {
    const user = await renderPage();

    await user.type(screen.getByLabelText(/^password/i), 'short');
    await submit(user);

    // 12 rather than 8: this is the only credential between a stranger and a
    // student record, and length is the term that reliably helps.
    expect(await screen.findByText('Use at least 12 characters')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('refuses two passwords that do not match, and says which field is wrong', async () => {
    const user = await renderPage();

    await user.type(screen.getByLabelText(/^password/i), PASSWORD);
    await user.type(screen.getByLabelText(/confirm password/i), `${PASSWORD}!`);
    await submit(user);

    expect(await screen.findByText('Those passwords do not match')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('refuses an unaccepted checkbox even when everything else is filled', async () => {
    const user = await renderPage();

    await user.type(screen.getByLabelText(/full name/i), 'Ada Okafor');
    await user.type(screen.getByLabelText(/^email/i), 'ada@example.edu');
    await chooseDepartment(user, 'Joinery');
    await user.type(screen.getByLabelText(/^password/i), PASSWORD);
    await user.type(screen.getByLabelText(/confirm password/i), PASSWORD);
    await submit(user);

    expect(await screen.findByText('You need to accept the terms to continue')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe('a successful registration', () => {
  it('posts exactly the four fields the endpoint accepts', async () => {
    apiPost.mockResolvedValue(undefined);
    const user = await renderPage();

    await fillValidForm(user);
    await submit(user);

    // `toEqual`, not `objectContaining`: `confirmPassword` and `accepted` are
    // form-local and must not travel. The registration schema describes four
    // fields, and a fifth is how a whole flow becomes an unreadable 422.
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/auth/register', {
        name: 'Ada Okafor',
        email: 'ada@example.edu',
        password: PASSWORD,
        departmentId: JOINERY_ID,
      }),
    );
  });

  it('carries the address to the verification screen', async () => {
    apiPost.mockResolvedValue(undefined);
    const user = await renderPage();

    await fillValidForm(user);
    await submit(user);

    // Registration issues no session, so this search param is the ONLY way the
    // next screen learns which address to verify. Drop it and every code the user
    // types comes back 422 while the rest of the flow looks perfectly healthy.
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({
        to: '/verify-email',
        search: { email: 'ada@example.edu' },
      }),
    );
    expect(toastMock.success).toHaveBeenCalled();
  });
});

describe('when the server refuses', () => {
  it('says the address is taken, on the field that holds it', async () => {
    apiPost.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'CONFLICT',
        requestId: 'req-test',
      }),
    );
    const user = await renderPage();

    await fillValidForm(user);
    await submit(user);

    // A conflict is about one field, so it belongs on that field — and it must not
    // also raise a toast, which would tell the user twice and neither time usefully.
    expect(await screen.findByText('An account already uses that address')).toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(toastMock.fromError).not.toHaveBeenCalled();
  });

  it('places a 422 on the field the server named', async () => {
    apiPost.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Validation failed',
        status: 422,
        code: 'VALIDATION_FAILED',
        errors: [{ path: 'password', message: 'That password appears in a breach list' }],
        requestId: 'req-test',
      }),
    );
    const user = await renderPage();

    await fillValidForm(user);
    await submit(user);

    expect(await screen.findByText('That password appears in a breach list')).toBeInTheDocument();
  });

  it('falls back to a toast for a failure that names no field', async () => {
    apiPost.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Internal',
        status: 500,
        code: 'INTERNAL',
        requestId: 'req-test',
      }),
    );
    const user = await renderPage();

    await fillValidForm(user);
    await submit(user);

    await waitFor(() => expect(toastMock.fromError).toHaveBeenCalled());
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
