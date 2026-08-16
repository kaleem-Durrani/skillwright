import { redirect } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import type { Role } from '@skillwright/shared/policy';
import { sessionQueryOptions, toActor, type SessionResponse } from './session.js';

export interface RouterContext {
  queryClient: QueryClient;
}

interface GuardArgs {
  context: RouterContext;
  location: { href: string };
}

/**
 * Resolve the session once per navigation.
 *
 * `ensureQueryData` deduplicates: the guard, the shell and every screen below it
 * read the same cache entry, so a navigation costs at most one /auth/session
 * round trip and usually zero.
 */
async function loadSession(context: RouterContext): Promise<SessionResponse> {
  return context.queryClient.ensureQueryData(sessionQueryOptions);
}

/**
 * Authenticated area guard.
 *
 * WHY `beforeLoad` + `throw redirect()` and not a `useEffect` in a layout: an
 * effect runs AFTER the protected component has rendered, which means the
 * protected UI paints — with whatever stale data was in the cache — before it is
 * torn down. A thrown redirect never renders the route at all.
 */
export async function requireAuth({ context, location }: GuardArgs): Promise<void> {
  const { user } = await loadSession(context);

  if (!user) {
    throw redirect({ to: '/login', search: { redirect: location.href } });
  }

  // A half-authenticated session may go exactly one place.
  if (user.provenance === 'MFA_PENDING') {
    throw redirect({ to: '/login', search: { step: 'mfa' } });
  }

  if (user.status === 'SUSPENDED') {
    throw redirect({ to: '/login', search: { reason: 'suspended' } });
  }

  if (user.status === 'PENDING_VERIFICATION') {
    throw redirect({ to: '/verify-email' });
  }
}

/**
 * Role guard, layered ON TOP of requireAuth (never instead of it).
 *
 * The server enforces the same rule through `can()`; this exists so the user is
 * redirected instead of being shown a screen that will 403 on every request.
 */
export function requireRole(...roles: Role[]) {
  return async ({ context, location }: GuardArgs): Promise<void> => {
    await requireAuth({ context, location });
    const { user } = await loadSession(context);
    if (!user || !roles.includes(user.role)) {
      throw redirect({ to: '/dashboard' });
    }
  };
}

/** Keeps a signed-in user out of the login and register screens. */
export async function redirectIfAuthenticated({ context }: GuardArgs): Promise<void> {
  const { user } = await loadSession(context);
  const actor = toActor(user);
  if (actor && actor.provenance !== 'MFA_PENDING' && actor.status === 'ACTIVE') {
    throw redirect({ to: '/dashboard' });
  }
}
