/**
 * The one behaviour on this screen that is not obvious, and the one that would be
 * quietly "cleaned up" by anyone reading it fresh: success and failure are the
 * SAME outcome.
 *
 * The mutation handles `onSettled`, not `onSuccess`. If a missing account left the
 * user on the form while a real one moved on to /reset-password, this endpoint
 * becomes an account-existence oracle — type an address, watch which screen you
 * land on, and a mailing list of real students falls out of it. The two tests
 * below are the same flow with a 404 and a 200, asserted to be indistinguishable.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;

const { apiPost, navigateSpy, toastMock } = vi.hoisted(() => ({
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
    api: { get: vi.fn(), post: apiPost, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
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
import { ForgotPasswordPage } from './ForgotPassword.js';

function renderPage(): UserEvent {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ForgotPasswordPage />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

async function request(user: UserEvent, email: string): Promise<void> {
  await user.type(screen.getByLabelText(/^email/i), email);
  await user.click(screen.getByRole('button', { name: 'Send reset code' }));
}

beforeEach(() => {
  apiPost.mockReset();
  navigateSpy.mockReset();
  toastMock.success.mockReset();
});

describe('ForgotPasswordPage', () => {
  it('refuses an empty address without asking the server', async () => {
    const user = renderPage();

    await user.click(screen.getByRole('button', { name: 'Send reset code' }));

    expect(await screen.findByText('Enter your email address')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('refuses a malformed address', async () => {
    const user = renderPage();

    await request(user, 'ada@');

    expect(await screen.findByText('That is not a valid email address')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('sends the address and carries it to the reset screen', async () => {
    apiPost.mockResolvedValue(undefined);
    const user = renderPage();

    await request(user, 'ada@example.edu');

    expect(apiPost).toHaveBeenCalledWith('/auth/forgot-password', { email: 'ada@example.edu' });
    // The next screen posts `{ email, code, password }`; without this param it has
    // no address and every code typed there is a 422.
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({
        to: '/reset-password',
        search: { email: 'ada@example.edu' },
      }),
    );
  });

  it('answers an unknown address exactly as it answers a known one', async () => {
    // A 404 here is the server saying "no such account". The screen must not
    // repeat that: same sentence, same destination, same everything.
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

    await request(user, 'nobody@example.edu');

    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({
        to: '/reset-password',
        search: { email: 'nobody@example.edu' },
      }),
    );
    const [title, options] = toastMock.success.mock.calls[0] as [string, { description: string }];
    expect(title).toBe('Check your inbox');
    // "IF that address has an account" — the copy has to stay conditional, or the
    // sentence itself becomes the oracle the redirect no longer is.
    expect(options.description).toMatch(/If that address has an account/);
    // Nothing on screen says the request failed.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
