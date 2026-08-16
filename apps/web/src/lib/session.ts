import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Actor, ActorStatus, Provenance, Role } from '@skillwright/shared/policy';
import type {
  LoginInput,
  LoginResponse,
  MfaVerifyInput,
  SessionResponse as SessionEnvelope,
} from '@skillwright/shared/schema';
import { api } from './api.js';
import { ApiError } from './problem.js';
import { qk } from './query.js';

/**
 * Every wire shape this module reads or sends, taken from the schemas the API
 * validates against — `sessionResponseSchema`, `loginResponseSchema`, `loginSchema`
 * and `mfaVerifySchema` (packages/shared/src/schema/auth.ts:56-101, :191-200).
 *
 * They used to be hand-declared here as `SessionEnvelope`, `SessionActorPayload`,
 * `UserDetailPayload`, `LoginResult`, `LoginInput` and `MfaVerifyInput`, and the
 * profile copy was wrong in the way a hand-written type is always wrong: it listed
 * six fields where `userDetailSchema` serves fourteen (user.ts:52-66), so
 * `phoneNumber`, `bio`, `lastLoginAt`, `createdAt`, `teacherProfile` and
 * `studentProfile` arrived on every `/auth/me` response while the compiler insisted
 * they did not exist. CONTRIBUTING.md:51 makes a client-side re-declaration of a
 * shape the schema already owns an automatic send-back.
 *
 * `SessionResponse` is imported under the local name `SessionEnvelope` because this
 * module already exports a `SessionResponse` of its own — the CACHED shape, below —
 * and the two are different things: the envelope is what the server sends, the
 * cached shape is what the query holds. Renaming at the import keeps both honest.
 *
 * On the envelope, `actor` and `user` are two objects on purpose: `actor` is what
 * the SESSION proves (and the only thing `can()` reads), `user` is the profile
 * record. `provenance` exists ONLY on the actor — it is a property of how you signed
 * in, not of who you are — so a DEMO and a PASSWORD session for the same account
 * differ in `actor` and not in `user`.
 *
 * `LoginResponse` is a discriminated union, not a session: a password may be correct
 * and still not finish the login. `MfaVerifyInput` sends exactly one of `code` and
 * `recoveryCode`; the schema enforces that with a refinement no local interface can
 * express, and the server rejects a body carrying both.
 */
export type { LoginInput, LoginResponse, MfaVerifyInput, SessionEnvelope };

/**
 * SPA-LOCAL VIEW MODEL — deliberately not a wire shape, and so not something
 * `@skillwright/shared/schema` could own.
 *
 * It flattens the envelope's two objects into the one record every screen reads:
 * components should not have to remember which of the two a field lives on, and
 * `provenance` (actor) is needed beside `role` and `status` (user) on nearly every
 * render. It also renames the server's `mfaEnabled` to `totpEnabled`, because TOTP
 * is the only second factor this app implements.
 *
 * It carries the eight fields the chrome actually renders. Anything else on
 * `userDetailSchema` — the profiles, `phoneNumber`, `bio`, the timestamps — belongs
 * to a `UserDetail` fetched for a screen that shows it, not to the session.
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

/**
 * What the session QUERY resolves to — also SPA-local, and not to be confused with
 * the schema's `SessionResponse` (imported above as `SessionEnvelope`). `user: null`
 * is the anonymous state, which the wire has no representation for: the server
 * answers 401 there and never sends an envelope at all.
 */
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

/**
 * Writes whatever the login endpoints returned into the session cache.
 *
 * On the MFA_REQUIRED branch a cookie HAS already been issued — it is just
 * stamped MFA_PENDING — so the cache is seeded from the actor alone. That is what
 * makes `requireAuth` route the user to the MFA step instead of bouncing them
 * back to a login form they have already completed.
 */
function cacheLoginResult(client: ReturnType<typeof useQueryClient>, data: LoginResponse): void {
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
    mutationFn: (input: LoginInput) => api.post<LoginResponse>('/auth/login', input),
    onSuccess: (data) => cacheLoginResult(client, data),
  });
}

export function useDemoLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (role: Role) => api.post<LoginResponse>('/auth/demo', { role }),
    onSuccess: (data) => cacheLoginResult(client, data),
  });
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
