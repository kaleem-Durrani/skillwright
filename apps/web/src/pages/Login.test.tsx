/**
 * The sign-in screen, written against the CONTRACT: queries a user could make
 * (role plus accessible name), and the network stubbed at the one client this SPA
 * talks through.
 *
 * What this file exists to pin:
 *
 * - MFA_REQUIRED is a SUCCESS branch of `loginResponseSchema`, not an error. The
 *   password WAS correct and a cookie has already been issued, stamped
 *   MFA_PENDING. Handling it in `onError` — the obvious-looking mistake, since the
 *   login "failed" — tells a user with the right password that their password is
 *   wrong, and strands the session policy denies everything for.
 * - The MFA body sends exactly ONE of `code` and `recoveryCode`. `mfaVerifySchema`
 *   enforces that with a refinement, and the server rejects a body carrying both,
 *   so a recovery-code submit that also posts an empty `code` is a 422 on the one
 *   path a user reaches with a lost phone.
 * - `search.reason === 'suspended'` and `search.step === 'mfa'` are written by
 *   `guards.ts`. They are a two-file vocabulary: a rename on either side leaves
 *   the panel unrendered and nothing fails.
 * - A 401 gets its own sentence. The generic `ERROR_COPY.UNAUTHENTICATED` is
 *   "Please sign in to continue.", which on the sign-in screen says nothing.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LoginSearch } from '@/routes/_public/login';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;

const { apiPost, navigateSpy, searchMock, toastMock } = vi.hoisted(() => ({
  apiPost: vi.fn<ApiSend>(),
  navigateSpy: vi.fn(),
  searchMock: vi.fn<() => LoginSearch>(),
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

vi.mock('@/routes/_public/login', () => ({
  Route: { useSearch: () => searchMock(), fullPath: '/login' },
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
import { ApiError, type ErrorCode } from '@/lib/problem';
import { LoginPage } from './Login.js';

const USER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';

/** The AUTHENTICATED branch: a full envelope plus the discriminant. */
const AUTHENTICATED = {
  status: 'AUTHENTICATED',
  actor: { id: USER_ID, role: 'STUDENT', status: 'ACTIVE', provenance: 'PASSWORD' },
  user: {
    id: USER_ID,
    email: 'ada@example.edu',
    name: 'Ada Okafor',
    role: 'STUDENT',
    status: 'ACTIVE',
    phoneNumber: null,
    bio: null,
    avatarUrl: null,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    teacherProfile: null,
    studentProfile: null,
  },
  expiresAt: '2026-12-31T00:00:00.000Z',
};

/** The MFA_REQUIRED branch: an actor and nothing else. */
const MFA_REQUIRED = {
  status: 'MFA_REQUIRED',
  actor: { id: USER_ID, role: 'STUDENT', status: 'ACTIVE', provenance: 'MFA_PENDING' },
};

function apiError(status: number, code: ErrorCode, detail?: string): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: code,
    status,
    code,
    ...(detail === undefined ? {} : { detail }),
    requestId: 'req-test',
  });
}

function renderLogin(search: LoginSearch = {}) {
  searchMock.mockReturnValue(search);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <LoginPage />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^email/i), 'ada@example.edu');
  await user.type(screen.getByLabelText(/^password/i), 'correct horse battery');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

/** Types the six boxes by pasting, which is how a code arrives on a phone. */
async function enterCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.click(screen.getByLabelText('Digit 1 of 6'));
  await user.paste(code);
}

beforeEach(() => {
  apiPost.mockReset();
  navigateSpy.mockReset();
  toastMock.fromError.mockReset();
});

describe('credentials step', () => {
  it('refuses an empty form client-side and sends nothing', async () => {
    const user = renderLogin();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter your email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    // A round trip to be told what the form already knew is a round trip that logs
    // a failed sign-in attempt against an address nobody typed properly.
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('rejects a malformed address before the network sees it', async () => {
    const user = renderLogin();

    await user.type(screen.getByLabelText(/^email/i), 'ada@');
    await user.type(screen.getByLabelText(/^password/i), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('That is not a valid email address')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('sends the credentials and goes where the guard asked to return to', async () => {
    apiPost.mockResolvedValue(AUTHENTICATED);
    const user = renderLogin({ redirect: '/settings' });

    await signIn(user);

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith({ to: '/settings' }));
    expect(apiPost).toHaveBeenCalledWith('/auth/login', {
      email: 'ada@example.edu',
      password: 'correct horse battery',
    });
  });

  it('falls back to the dashboard when no return path was carried', async () => {
    apiPost.mockResolvedValue(AUTHENTICATED);
    const user = renderLogin();

    await signIn(user);

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith({ to: '/dashboard' }));
  });

  it('answers a 401 with a sentence about the sign-in, not the generic copy', async () => {
    apiPost.mockRejectedValue(apiError(401, 'UNAUTHENTICATED'));
    const user = renderLogin();

    await signIn(user);

    // ERROR_COPY.UNAUTHENTICATED is "Please sign in to continue." — true, and
    // useless on the screen whose whole job is signing in.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email and password do not match an account.',
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('renders the code-mapped copy for any other refusal', async () => {
    // LESSONS-LEARNED #25: the SPA renders `problem.code`, never `problem.detail`.
    // A server that puts the real sentence in `detail` and reaches for a generic
    // code ships a string nothing can display — so the code has to be what decides.
    apiPost.mockRejectedValue(
      apiError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended'),
    );
    const user = renderLogin();

    await signIn(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('This account has been suspended.');
  });

  it('puts field errors from a 422 onto the fields they name', async () => {
    apiPost.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Validation failed',
        status: 422,
        code: 'VALIDATION_FAILED',
        errors: [{ path: 'email', message: 'That address is not registered here' }],
        requestId: 'req-test',
      }),
    );
    const user = renderLogin();

    await signIn(user);

    expect(await screen.findByText('That address is not registered here')).toBeInTheDocument();
  });

  it('explains a suspension the guard already decided on', async () => {
    // `requireAuth` redirects a suspended session with exactly this search value.
    renderLogin({ reason: 'suspended' });

    expect(screen.getByText('This account is suspended')).toBeInTheDocument();
  });

  it('takes a demo account straight into the app', async () => {
    apiPost.mockResolvedValue(AUTHENTICATED);
    const user = renderLogin();

    await user.click(screen.getByRole('button', { name: /Continue as Teacher/ }));

    expect(apiPost).toHaveBeenCalledWith('/auth/demo', { role: 'TEACHER' });
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith({ to: '/dashboard' }));
  });

  it('raises a toast, not a form error, when the demo account is unavailable', async () => {
    // Nothing the user typed is at fault, so nothing on the form should turn red.
    apiPost.mockRejectedValue(apiError(503, 'INTERNAL'));
    const user = renderLogin();

    await user.click(screen.getByRole('button', { name: /Continue as Admin/ }));

    await waitFor(() => expect(toastMock.fromError).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('toggles the password between hidden and readable', async () => {
    const user = renderLogin();

    expect(screen.getByLabelText(/^password/i)).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText(/^password/i)).toHaveAttribute('type', 'text');
    // The accessible name has to follow the state, or a screen-reader user is told
    // "show" while the password is already on screen.
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText(/^password/i)).toHaveAttribute('type', 'password');
  });
});

describe('the second factor', () => {
  it('moves to the TOTP step instead of reporting a failure', async () => {
    apiPost.mockResolvedValue(MFA_REQUIRED);
    const user = renderLogin();

    await signIn(user);

    expect(
      await screen.findByRole('heading', { name: 'Two-factor authentication' }),
    ).toBeInTheDocument();
    // The password was accepted. Navigating here would land on a screen policy
    // refuses everything on; showing an error would contradict the server.
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens straight on the TOTP step after a reload mid-login', () => {
    renderLogin({ step: 'mfa' });

    expect(screen.getByRole('heading', { name: 'Two-factor authentication' })).toBeInTheDocument();
  });

  it('submits the code the moment the last box is filled', async () => {
    apiPost.mockResolvedValue(AUTHENTICATED);
    const user = renderLogin({ step: 'mfa' });

    await enterCode(user, '123456');

    // Auto-submit is the point of a six-box control: the code is already complete
    // and hunting for a button is the only remaining step.
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/auth/mfa/verify', { code: '123456' }),
    );
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith({ to: '/dashboard' }));
  });

  it('sends a recovery code alone, never alongside an empty code', async () => {
    // `mfaVerifySchema` refines "exactly one of these", so a body carrying both is
    // a 422 — on the one path a user reaches precisely because they cannot produce
    // a TOTP code.
    apiPost.mockResolvedValue(AUTHENTICATED);
    const user = renderLogin({ step: 'mfa' });

    await user.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    await user.type(screen.getByLabelText(/recovery code/i), '  a1b2c-3d4e5  ');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    // Trimmed, too: a code pasted out of a saved list carries whitespace, and the
    // schema's regex has no room for it.
    expect(apiPost).toHaveBeenCalledWith('/auth/mfa/verify', { recoveryCode: 'a1b2c-3d4e5' });
  });

  it('says a rejected code is a code problem, and keeps the user on the step', async () => {
    apiPost.mockRejectedValue(apiError(401, 'UNAUTHENTICATED'));
    const user = renderLogin({ step: 'mfa' });

    await enterCode(user, '000000');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code is not right. Codes expire after 30 seconds.',
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('clears the error when the user switches to the other method', async () => {
    apiPost.mockRejectedValue(apiError(401, 'UNAUTHENTICATED'));
    const user = renderLogin({ step: 'mfa' });

    await enterCode(user, '000000');
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));

    // A stale "that code is not right" sitting above the recovery-code field is
    // about the previous attempt on the previous method.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('goes back to the credentials form', async () => {
    const user = renderLogin({ step: 'mfa' });

    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
