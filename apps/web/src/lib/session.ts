import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Actor, ActorStatus, Provenance, Role } from '@skillwright/shared/policy';
import { api } from './api.js';
import { ApiError } from './problem.js';
import { qk } from './query.js';

/**
 * The wire shape the API actually serves, matching `sessionResponseSchema` in
 * packages/shared/src/schema/auth.ts.
 *
 * `actor` and `user` are two objects on purpose: `actor` is what the SESSION
 * proves (and the only thing `can()` reads), `user` is the profile record. In
 * particular `provenance` exists ONLY on the actor — it is a property of how you
 * signed in, not of who you are — so a DEMO and a PASSWORD session for the same
 * account differ in `actor` and not in `user`.
 */
interface SessionActorPayload {
  id: string;
  role: Role;
  status: ActorStatus;
  provenance: Provenance;
}

interface UserDetailPayload {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: ActorStatus;
  avatarUrl: string | null;
  /** The server's name for this. Flattened to `totpEnabled` below. */
  mfaEnabled: boolean;
}

export interface SessionEnvelope {
  actor: SessionActorPayload;
  user: UserDetailPayload;
  expiresAt: string;
}

/**
 * `POST /auth/login` and `POST /auth/demo` return a discriminated union, not a
 * session: a password may be correct and still not finish the login.
 */
export type LoginResult =
  | ({ status: 'AUTHENTICATED' } & SessionEnvelope)
  | { status: 'MFA_REQUIRED'; actor: SessionActorPayload };

/**
 * The flattened view model every screen reads. It is deliberately NOT the wire
 * shape: components should not have to remember which of two objects a field
 * lives on, and `provenance` is needed beside `role` on nearly every render.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: ActorStatus;
  provenance: Provenance;
  avatarUrl: string | null;
  totpEnabled: boolean;
}

export interface SessionResponse {
  user: SessionUser | null;
}

/** Collapse the two-object wire envelope into the flat view model. */
export function toSessionUser(envelope: SessionEnvelope): SessionUser {
  return {
    id: envelope.user.id,
    email: envelope.user.email,
    name: envelope.user.name,
    role: envelope.user.role,
    status: envelope.user.status,
    // From the actor: this is a fact about the session, not about the person.
    provenance: envelope.actor.provenance,
    avatarUrl: envelope.user.avatarUrl,
    totpEnabled: envelope.user.mfaEnabled,
  };
}

/**
 * The session query.
 *
 * WHY it resolves to `{ user: null }` instead of throwing on 401: an anonymous
 * visitor is a valid state of this app (published courses and announcements are
 * public), so "not signed in" must not be an error boundary event.
 */
export async function fetchSession(signal?: AbortSignal): Promise<SessionResponse> {
  try {
    // The endpoint is /auth/me — it returns the session for the CURRENT cookie
    // and 401s when there is none.
    const envelope = await api.get<SessionEnvelope>('/auth/me', signal ? { signal } : {});
    return { user: toSessionUser(envelope) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { user: null };
    throw error;
  }
}

export const sessionQueryOptions = {
  queryKey: qk.session,
  queryFn: ({ signal }: { signal: AbortSignal }) => fetchSession(signal),
  staleTime: 60_000,
  gcTime: 10 * 60_000,
  retry: false,
  refetchOnWindowFocus: true,
} as const;

export interface SessionState {
  user: SessionUser | null;
  /** The exact shape `can()` expects. Null for anonymous visitors. */
  actor: Actor | null;
  isPending: boolean;
  isAuthenticated: boolean;
  /** Password accepted, TOTP outstanding: the app is locked to the MFA step. */
  isMfaPending: boolean;
  isSuspended: boolean;
  needsEmailVerification: boolean;
  isDemo: boolean;
}

/** Derive the policy Actor from the session user. */
export function toActor(user: SessionUser | null): Actor | null {
  if (!user) return null;
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    provenance: user.provenance,
  };
}

export function useSession(): SessionState {
  const query = useQuery(sessionQueryOptions);
  const user = query.data?.user ?? null;

  // Stable identity: `can()` is called from useMemo/useCallback dependency
  // arrays all over the app, and a fresh actor object every render would
  // invalidate every one of them on every render.
  const actor = useMemo(() => toActor(user), [user]);

  return {
    user,
    actor,
    isPending: query.isPending,
    isAuthenticated: user !== null,
    isMfaPending: user?.provenance === 'MFA_PENDING',
    isSuspended: user?.status === 'SUSPENDED',
    needsEmailVerification: user?.status === 'PENDING_VERIFICATION',
    isDemo: user?.provenance === 'DEMO',
  };
}

export interface LoginInput {
  email: string;
  password: string;
}

/**
 * Writes whatever the login endpoints returned into the session cache.
 *
 * On the MFA_REQUIRED branch a cookie HAS already been issued — it is just
 * stamped MFA_PENDING — so the cache is seeded from the actor alone. That is what
 * makes `requireAuth` route the user to the MFA step instead of bouncing them
 * back to a login form they have already completed.
 */
function cacheLoginResult(client: ReturnType<typeof useQueryClient>, data: LoginResult): void {
  if (data.status === 'AUTHENTICATED') {
    client.setQueryData(qk.session, { user: toSessionUser(data) } satisfies SessionResponse);
    return;
  }
  client.setQueryData(qk.session, {
    user: {
      id: data.actor.id,
      email: '',
      name: '',
      role: data.actor.role,
      status: data.actor.status,
      provenance: data.actor.provenance,
      avatarUrl: null,
      totpEnabled: true,
    },
  } satisfies SessionResponse);
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<LoginResult>('/auth/login', input),
    onSuccess: (data) => cacheLoginResult(client, data),
  });
}

export function useDemoLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (role: Role) => api.post<LoginResult>('/auth/demo', { role }),
    onSuccess: (data) => cacheLoginResult(client, data),
  });
}

export interface MfaVerifyInput {
  /** Exactly one of these is sent. */
  code?: string;
  recoveryCode?: string;
}

export function useMfaVerify() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: MfaVerifyInput) => api.post<SessionEnvelope>('/auth/mfa/verify', input),
    onSuccess: (data) =>
      client.setQueryData(qk.session, { user: toSessionUser(data) } satisfies SessionResponse),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    // Drop everything: a cache entry that outlives its session is a data leak
    // the next user on a shared workshop machine would see.
    onSettled: async () => {
      client.setQueryData(qk.session, { user: null } satisfies SessionResponse);
      await client.resetQueries();
    },
  });
}
