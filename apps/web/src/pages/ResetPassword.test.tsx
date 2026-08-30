/**
 * Choosing a new password from a reset code.
 *
 * The screen composes two controls that validate in different places: the OTP
 * boxes are plain state with a hand-written guard, and the password pair is a
 * react-hook-form schema. Only the second is enforced by `handleSubmit`, so the
 * code guard has to run INSIDE the submit handler — and a body sent with a short
 * code is a 422 the user reads as "your new password is wrong".
 *
 * What is posted is the other half: `{ email, code, password }`. `confirmPassword`
 * is form-local and must not travel, and the address comes from the search param
 * ForgotPassword wrote — this screen has no session to read it from.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ResetPasswordSearch } from '@/routes/_public/reset-password';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;

const { apiPost, navigateSpy, searchMock, toastMock } = vi.hoisted(() => ({
  apiPost: vi.fn<ApiSend>(),
  navigateSpy: vi.fn(),
  searchMock: vi.fn<() => ResetPasswordSearch>(),
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
    api: { get: vi.fn(), post: apiPost, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

vi.mock('@/routes/_public/reset-password', () => ({
  Route: { useSearch: () => searchMock(), fullPath: '/reset-password' },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>,
  };
});

vi.mock('@/components/ui/Toast', () => ({ toast: toastMock }));

// Imported after the mocks so the page resolves the stubbed client and route.
import { ApiError } from '@/lib/problem';
import { ResetPasswordPage } from './ResetPassword.js';

const NEW_PASSWORD = 'a much longer passphrase';

function renderPage(search: ResetPasswordSearch = { email: 'ada@example.edu' }): UserEvent {
  searchMock.mockReturnValue(search);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ResetPasswordPage />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

async function enterCode(user: UserEvent, code: string): Promise<void> {
  await user.click(screen.getByLabelText('Digit 1 of 6'));
  await user.paste(code);
}

async function enterPasswords(
  user: UserEvent,
  password: string,
  confirm = password,
): Promise<void> {
  await user.type(screen.getByLabelText(/^new password/i), password);
  await user.type(screen.getByLabelText(/confirm new password/i), confirm);
}

function submit(user: UserEvent) {
  return user.click(screen.getByRole('button', { name: 'Change password' }));
}

beforeEach(() => {
  apiPost.mockReset();
  navigateSpy.mockReset();
  toastMock.success.mockReset();
  toastMock.fromError.mockReset();
});

describe('the reset code', () => {
  it('is prefilled from the link', () => {
    renderPage({ email: 'ada@example.edu', code: '123456' });

    expect(screen.getByLabelText('Digit 1 of 6')).toHaveValue('1');
    expect(screen.getByLabelText('Digit 6 of 6')).toHaveValue('6');
  });

  it('blocks a short code before anything is posted', async () => {
    const user = renderPage();

    await enterCode(user, '123');
    await enterPasswords(user, NEW_PASSWORD);
    await submit(user);

    // The guard lives inside the submit handler because `handleSubmit` only knows
    // about the zod schema, which the OTP state is not part of. A body carrying a
    // three-digit code comes back 422 and reads as "your password is wrong".
    expect(await screen.findByText('Enter the 6-digit code from your email')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe('the new password', () => {
  it('must be at least twelve characters', async () => {
    const user = renderPage();

    await enterCode(user, '123456');
    await enterPasswords(user, 'short');
    await submit(user);

    expect(await screen.findByText('Use at least 12 characters')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('must match its confirmation', async () => {
    const user = renderPage();

    await enterCode(user, '123456');
    await enterPasswords(user, NEW_PASSWORD, `${NEW_PASSWORD}!`);
    await submit(user);

    expect(await screen.findByText('Those passwords do not match')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe('a completed reset', () => {
  it('posts the address, the code and the password, and nothing else', async () => {
    apiPost.mockResolvedValue(undefined);
    const user = renderPage();

    await enterCode(user, '123456');
    await enterPasswords(user, NEW_PASSWORD);
    await submit(user);

    // `toEqual`: `confirmPassword` is form-local. The address is the one field the
    // user never sees, and it only exists because ForgotPassword put it in the URL.
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/auth/reset-password', {
        email: 'ada@example.edu',
        code: '123456',
        password: NEW_PASSWORD,
      }),
    );
  });

  it('sends the user to sign in and says the other sessions are gone', async () => {
    apiPost.mockResolvedValue(undefined);
    const user = renderPage();

    await enterCode(user, '123456');
    await enterPasswords(user, NEW_PASSWORD);
    await submit(user);

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith({ to: '/login' }));
    // A password change that silently left other sessions alive would be the more
    // dangerous outcome, so the copy is part of the contract, not decoration.
    const [title, options] = toastMock.success.mock.calls[0] as [string, { description: string }];
    expect(title).toBe('Password changed');
    expect(options.description).toMatch(/signed out/i);
  });
});

describe('when the server refuses', () => {
  it('blames the code for a 4xx, which is the field that expires', async () => {
    apiPost.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        code: 'NOT_FOUND',
        requestId: 'req-test',
      }),
    );
    const user = renderPage();

    await enterCode(user, '000000');
    await enterPasswords(user, NEW_PASSWORD);
    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code is not right, or it has expired.',
    );
    expect(navigateSpy).not.toHaveBeenCalled();
    // A 4xx here is about the code, not about the service — no toast.
    expect(toastMock.fromError).not.toHaveBeenCalled();
  });

  it('raises a toast for a 5xx, because nothing the user typed was wrong', async () => {
    apiPost.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Internal',
        status: 500,
        code: 'INTERNAL',
        requestId: 'req-test',
      }),
    );
    const user = renderPage();

    await enterCode(user, '123456');
    await enterPasswords(user, NEW_PASSWORD);
    await submit(user);

    await waitFor(() => expect(toastMock.fromError).toHaveBeenCalled());
    expect(
      screen.queryByText('That code is not right, or it has expired.'),
    ).not.toBeInTheDocument();
  });
});
