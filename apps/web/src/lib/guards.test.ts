/**
 * The four navigation decisions in `guards.ts`, driven through a REAL QueryClient
 * so the guard reads the session exactly as it does in the app — through
 * `sessionQueryOptions` and one shared cache entry, not through a stub.
 *
 * Why these are worth pinning rather than left to e2e:
 *
 * - Each branch is a security-relevant refusal whose failure mode is silent. A
 *   dropped `redirect` search param strands the user on /dashboard after signing
 *   in; a reordered check lets a half-authenticated session past. Nothing throws
 *   and nothing logs in either case.
 * - `requireRole` is documented as layering ON TOP of `requireAuth`, never
 *   instead of it — the exact shape of LESSONS-LEARNED #14, where one guard was
 *   the only place a session state was checked and its siblings inherited
 *   nothing. A `requireRole` that forgot to call `requireAuth` would admit an
 *   MFA_PENDING admin to /admin, and every other assertion here would still pass.
 * - `requireAuth` and `redirectIfAuthenticated` guard opposite sides of the same
 *   door, so a disagreement between them is an infinite redirect loop rather than
 *   a wrong screen. The MFA_PENDING pair below is that loop.
 *
 * `redirect()` returns a Response carrying `.options`; the guards throw it. These
 * tests assert on what was thrown, which is the only way to tell a guard that
 * decided from one that merely returned.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { isRedirect } from '@tanstack/react-router';
import type { Provenance, Role } from '@skillwright/shared/policy';
import type { SessionEnvelope } from './session.js';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn<ApiFetch>() }));

vi.mock('./api.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, api: { ...(actual.api as object), get: apiGet } };
});

// Imported after the mock so the session query resolves the stubbed client.
import { ApiError } from './problem.js';
import { redirectIfAuthenticated, requireAuth, requireRole, type RouterContext } from './guards.js';

const USER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';

/** What GET /auth/me serves. Two objects, and `provenance` lives only on the actor. */
function envelope(overrides: {
  role?: Role;
  status?: SessionEnvelope['user']['status'];
  provenance?: Provenance;
}): SessionEnvelope {
  const role = overrides.role ?? 'STUDENT';
  const status = overrides.status ?? 'ACTIVE';
  return {
    actor: { id: USER_ID, role, status, provenance: overrides.provenance ?? 'PASSWORD' },
    user: {
      id: USER_ID,
      email: 'ada@example.edu',
      name: 'Ada Okafor',
      role,
      status,
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
}

function unauthenticated(): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: 'Unauthenticated',
    status: 401,
    code: 'UNAUTHENTICATED',
    requestId: 'req-anon',
  });
}

function context(): RouterContext {
  return { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
}

/**
 * Runs a guard and returns the redirect it threw, or null when it let the
 * navigation through. Anything else is re-thrown — a guard that throws a plain
 * Error is a bug, not a decision.
 */
async function outcome(run: Promise<void>): Promise<{ to?: string; search?: unknown } | null> {
  try {
    await run;
    return null;
  } catch (thrown) {
    if (isRedirect(thrown)) return thrown.options as { to?: string; search?: unknown };
    throw thrown;
  }
}

const AT_SETTINGS = { href: '/settings' };

beforeEach(() => {
  apiGet.mockReset();
});

describe('requireAuth', () => {
  it('sends an anonymous visitor to /login carrying where they were going', async () => {
    apiGet.mockRejectedValue(unauthenticated());

    const result = await outcome(requireAuth({ context: context(), location: AT_SETTINGS }));

    // The href is the whole point: without it, signing in lands on /dashboard and
    // the user has to find /settings again themselves.
    expect(result?.to).toBe('/login');
    expect(result?.search).toEqual({ redirect: '/settings' });
  });

  it('lets an active password session through', async () => {
    apiGet.mockResolvedValue(envelope({}));

    await expect(
      requireAuth({ context: context(), location: AT_SETTINGS }),
    ).resolves.toBeUndefined();
  });

  it('sends a suspended session to /login stamped with the reason', async () => {
    apiGet.mockResolvedValue(envelope({ status: 'SUSPENDED' }));

    const result = await outcome(requireAuth({ context: context(), location: AT_SETTINGS }));

    // LoginPage renders its "This account is suspended" panel off exactly this
    // value; the two spellings have to agree or the panel never appears.
    expect(result?.to).toBe('/login');
    expect(result?.search).toEqual({ reason: 'suspended' });
  });

  it('sends an unverified account to /verify-email', async () => {
    apiGet.mockResolvedValue(envelope({ status: 'PENDING_VERIFICATION' }));

    const result = await outcome(requireAuth({ context: context(), location: AT_SETTINGS }));

    expect(result?.to).toBe('/verify-email');
  });

  it('sends a half-authenticated session to the MFA step and nowhere else', async () => {
    // Both flags are set: this account has not verified its email AND has not
    // finished TOTP. The provenance check runs first on purpose — "a
    // half-authenticated session may go exactly one place" — so a
    // PENDING_VERIFICATION user mid-TOTP must not be sent to /verify-email, where
    // every code they type would be checked against a session that cannot act.
    apiGet.mockResolvedValue(
      envelope({ provenance: 'MFA_PENDING', status: 'PENDING_VERIFICATION' }),
    );

    const result = await outcome(requireAuth({ context: context(), location: AT_SETTINGS }));

    expect(result?.to).toBe('/login');
    expect(result?.search).toEqual({ step: 'mfa' });
  });
});

describe('requireRole', () => {
  it('admits the named role', async () => {
    apiGet.mockResolvedValue(envelope({ role: 'ADMIN' }));

    await expect(
      requireRole('ADMIN')({ context: context(), location: { href: '/admin' } }),
    ).resolves.toBeUndefined();
  });

  it('admits any of several named roles, not only the first one listed', async () => {
    // The signature is variadic (`...roles: Role[]`), and every other test in
    // this file calls it with exactly one role — so a guard that only ever
    // compared against `roles[0]` would pass them all while silently locking
    // every role but the first out of a route meant to admit several.
    apiGet.mockResolvedValue(envelope({ role: 'TEACHER' }));

    await expect(
      requireRole('ADMIN', 'TEACHER')({ context: context(), location: { href: '/admin' } }),
    ).resolves.toBeUndefined();
  });

  it('sends the wrong role to the dashboard rather than a screen that would 403', async () => {
    apiGet.mockResolvedValue(envelope({ role: 'STUDENT' }));

    const result = await outcome(
      requireRole('ADMIN')({ context: context(), location: { href: '/admin' } }),
    );

    expect(result?.to).toBe('/dashboard');
  });

  it('runs requireAuth first, so a half-authenticated admin never reaches the role check', async () => {
    // The regression this exists for: `requireRole` deciding on `user.role` alone.
    // The role IS admin, so a role-only guard admits this session — and the whole
    // point of MFA_PENDING is that the password alone has proved nothing yet.
    apiGet.mockResolvedValue(envelope({ role: 'ADMIN', provenance: 'MFA_PENDING' }));

    const result = await outcome(
      requireRole('ADMIN')({ context: context(), location: { href: '/admin' } }),
    );

    expect(result?.search).toEqual({ step: 'mfa' });
  });

  it('resolves the session once for the whole navigation', async () => {
    apiGet.mockResolvedValue(envelope({ role: 'ADMIN' }));

    // requireRole calls requireAuth and then reads the session again. Both go
    // through `ensureQueryData`, so the claim in the file — "a navigation costs at
    // most one /auth/session round trip" — holds only while they share the cache
    // entry. Switching either read to `fetchQuery` doubles this number.
    await requireRole('ADMIN')({ context: context(), location: { href: '/admin' } });

    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});

describe('redirectIfAuthenticated', () => {
  it('bounces a real session off the login screen', async () => {
    apiGet.mockResolvedValue(envelope({}));

    const result = await outcome(
      redirectIfAuthenticated({ context: context(), location: { href: '/login' } }),
    );

    expect(result?.to).toBe('/dashboard');
  });

  it('leaves an anonymous visitor alone', async () => {
    apiGet.mockRejectedValue(unauthenticated());

    await expect(
      redirectIfAuthenticated({ context: context(), location: { href: '/login' } }),
    ).resolves.toBeUndefined();
  });

  it('leaves a half-authenticated session on /login, because that is where the TOTP step lives', async () => {
    // This pair is a redirect LOOP if the two guards disagree: requireAuth sends
    // MFA_PENDING to /login?step=mfa, so a redirectIfAuthenticated that read "has
    // a cookie" as "signed in" would send it straight back to /dashboard.
    apiGet.mockResolvedValue(envelope({ provenance: 'MFA_PENDING' }));

    await expect(
      redirectIfAuthenticated({ context: context(), location: { href: '/login' } }),
    ).resolves.toBeUndefined();
  });

  it('leaves a suspended session on /login, so the explanation is readable', async () => {
    apiGet.mockResolvedValue(envelope({ status: 'SUSPENDED' }));

    await expect(
      redirectIfAuthenticated({ context: context(), location: { href: '/login' } }),
    ).resolves.toBeUndefined();
  });
});
