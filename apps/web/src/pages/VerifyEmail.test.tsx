/**
 * Email verification, whose whole difficulty is that the ADDRESS is not obviously
 * present.
 *
 * `POST /auth/verify-email` takes `{ email, code }` — the pair is deliberate, so a
 * stolen code alone is not enough — and `POST /auth/resend-verification` takes
 * `{ email }`. Neither accepts null. But there is usually NO SESSION on this
 * screen: registration does not sign you in and login refuses a
 * PENDING_VERIFICATION account, so the address travels in the URL. When it does
 * not arrive, firing either endpoint is a guaranteed 422 — and the error branch
 * mistranslated that into "That code is not right", telling a user with a
 * perfectly good code that their code was wrong.
 *
 * So the assertions here are mostly about what does NOT happen: no request, an
 * inert control instead of a trap, and a held guard while the session may still
 * produce an address.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { VerifyEmailSearch } from '@/routes/_public/verify-email';
import type { SessionUser } from '@/lib/session';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;
type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, navigateSpy, searchMock, toastMock } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
  navigateSpy: vi.fn(),
  searchMock: vi.fn<() => VerifyEmailSearch>(),
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

vi.mock('@/routes/_public/verify-email', () => ({
  Route: { useSearch: () => searchMock(), fullPath: '/verify-email' },
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
import { qk } from '@/lib/query';
import { VerifyEmailPage } from './VerifyEmail.js';

const NO_ADDRESS = /We do not know which address to verify/;

const SIGNED_IN: SessionUser = {
  id: '01JGXDFAM0K2Z1GYCSNM5F5RCX',
  email: 'signed-in@example.edu',
  name: 'Ada Okafor',
  role: 'STUDENT',
  status: 'PENDING_VERIFICATION',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

/**
 * `session: 'anonymous'` seeds `{ user: null }` so nothing is pending;
 * `'pending'` leaves /auth/me unanswered, which is the state a cold load spends
 * one round trip in.
 */
function renderPage(
  search: VerifyEmailSearch,
  session: 'anonymous' | 'pending' | SessionUser = 'anonymous',
) {
  searchMock.mockReturnValue(search);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (session === 'pending') {
    apiGet.mockImplementation(() => new Promise(() => {}));
  } else {
    client.setQueryData(qk.session, { user: session === 'anonymous' ? null : session });
  }
  render(
    <QueryClientProvider client={client}>
      <VerifyEmailPage />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), client };
}

async function enterCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.click(screen.getByLabelText('Digit 1 of 6'));
  await user.paste(code);
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  navigateSpy.mockReset();
  toastMock.success.mockReset();
  toastMock.fromError.mockReset();
});

describe('with no address to verify', () => {
  it('says so, and leaves nothing to type into', () => {
    renderPage({});

    expect(screen.getByRole('alert')).toHaveTextContent(NO_ADDRESS);
    // Inert rather than a trap: a code typed here could not be checked against
    // anything, and the endpoint would answer 422 about the missing address.
    expect(screen.getByLabelText('Digit 1 of 6')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeDisabled();
  });

  it('never fires a request, even with a full code in the URL', async () => {
    // The auto-submit path has an address check of its own. Without it, a link
    // carrying a code but no address 422s on arrival and the user is told the code
    // from their own email is wrong — which is the mistranslation this screen's
    // NO_ADDRESS_MESSAGE was written to replace.
    renderPage({ code: '123456' });

    await waitFor(() =>
      expect(
        screen
          .getAllByRole('alert')
          .map((node) => node.textContent)
          .join(' '),
      ).toMatch(NO_ADDRESS),
    );
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('holds the accusation while the session might still supply one', () => {
    // Nothing in the URL and /auth/me unanswered: the address may yet arrive, so
    // accusing the user of a broken link now would be wrong half the time.
    renderPage({}, 'pending');

    expect(screen.queryByText(NO_ADDRESS)).not.toBeInTheDocument();
  });
});

describe('with an address', () => {
  it('takes it from the URL that registration wrote', async () => {
    apiPost.mockResolvedValue({ ok: true });
    const { user } = renderPage({ email: 'ada@example.edu' });

    await enterCode(user, '123456');

    // Both fields, always: `{ email, code }` is what pairs a code to an account.
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/auth/verify-email', {
        email: 'ada@example.edu',
        code: '123456',
      }),
    );
  });

  it("prefers a signed-in visitor's own address over the one in the URL", async () => {
    apiPost.mockResolvedValue({ ok: true });
    const { user } = renderPage({ email: 'stale@example.edu' }, SIGNED_IN);

    await enterCode(user, '123456');

    // A shared or forwarded link must not verify the address of whoever is
    // actually signed in against a code sent to somebody else.
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/auth/verify-email', {
        email: 'signed-in@example.edu',
        code: '123456',
      }),
    );
  });

  it('submits a code that arrived in the link with no button press', async () => {
    apiPost.mockResolvedValue({ ok: true });
    renderPage({ email: 'ada@example.edu', code: '123456' });

    // The user clicked the link in the email; asking them to press a button as
    // well is theatre.
    await waitFor(() => expect(apiPost).toHaveBeenCalled());

    // EVERY call, not just the first: the assertion is over the whole body of each
    // one, because the address is the field that goes missing.
    //
    // The COUNT is deliberately not pinned here. Measured on 2026-08-30, this
    // renders two identical POSTs for one link click: `OtpInput` fires its own
    // `onComplete` on mount (the `code` state is seeded from `search.code`, so it
    // is already six digits) and the page's link effect then fires as well. The
    // `autoSubmitted` ref guards only the second of those two paths, so the
    // comment in VerifyEmail.tsx — "the ref keeps it to one attempt" — is true of
    // the effect and not of the screen. Asserting 2 would pin a defect and go red
    // the day it is fixed; asserting 1 would be red today.
    for (const [path, body] of apiPost.mock.calls) {
      expect(path).toBe('/auth/verify-email');
      expect(body).toEqual({ email: 'ada@example.edu', code: '123456' });
    }
  });

  it('ignores a truncated code in the link', async () => {
    renderPage({ email: 'ada@example.edu', code: '123' });

    await waitFor(() => expect(screen.getByLabelText('Digit 1 of 6')).toHaveValue('1'));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('sends an anonymous visitor to sign in, because verifying issues no session', async () => {
    apiPost.mockResolvedValue({ ok: true });
    const { user, client } = renderPage({ email: 'ada@example.edu' });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await enterCode(user, '123456');

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith({ to: '/login' }));
    // Refetch rather than assume: an already-signed-in user has just changed
    // status from PENDING_VERIFICATION to ACTIVE, and the cached session says
    // otherwise until something asks again.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.session });
  });

  it('sends a signed-in visitor to the dashboard instead', async () => {
    apiPost.mockResolvedValue({ ok: true });
    const { user } = renderPage({}, SIGNED_IN);

    await enterCode(user, '123456');

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith({ to: '/dashboard' }));
  });

  it('blames the code, not the address, for a 4xx', async () => {
    apiPost.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        code: 'NOT_FOUND',
        requestId: 'req-test',
      }),
    );
    const { user } = renderPage({ email: 'ada@example.edu' });

    await enterCode(user, '000000');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code is not right, or it has expired.',
    );
  });

  it('says something went wrong for a 5xx, which is not the user’s fault', async () => {
    apiPost.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Internal',
        status: 500,
        code: 'INTERNAL',
        requestId: 'req-test',
      }),
    );
    const { user } = renderPage({ email: 'ada@example.edu' });

    await enterCode(user, '123456');

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });

  it('resends to the same address and then makes the user wait', async () => {
    apiPost.mockResolvedValue({ ok: true });
    const { user } = renderPage({ email: 'ada@example.edu' });

    await user.click(screen.getByRole('button', { name: 'Send a new code' }));

    expect(apiPost).toHaveBeenCalledWith('/auth/resend-verification', {
      email: 'ada@example.edu',
    });
    // The cooldown is the only thing standing between an impatient user and the
    // rate limiter, and the countdown is what tells them the button is not broken.
    // The LITERAL 60 is asserted, not a `\d+s` pattern: `RESEND_COOLDOWN_SECONDS`
    // is module-private, so a regex here would pass just as well against a
    // constant quietly changed to 5 — the label would still be "N seconds" shaped.
    expect(await screen.findByRole('button', { name: 'Send a new code in 60s' })).toBeDisabled();
  });
});
