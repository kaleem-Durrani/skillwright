/**
 * The session module: the wire envelope collapsing into the view model, the
 * anonymous state, and what each login branch writes into the cache.
 *
 * The two failure modes worth spending a file on:
 *
 * - `provenance` lives on the ACTOR, never on the user — it is a fact about how
 *   you signed in, not about who you are. A mapper that read `envelope.user.
 *   provenance` compiles against nothing and yields `undefined`, and an actor with
 *   an undefined provenance is not refused loudly: `can()` simply falls through to
 *   the role rule, so a DEMO session would quietly gain the destructive verbs it
 *   exists to be denied.
 * - The MFA_REQUIRED branch seeds a session from the actor ALONE. That seed is the
 *   only reason `requireAuth` sends a half-finished login to the TOTP step instead
 *   of back to the form the user has already completed — so the test that covers
 *   it runs the real guard against the cache this module wrote.
 * - Signing out UNMOUNTS the component that asked to sign out. The shell returns
 *   early the moment the cache says `user: null`, so anything a sign-out needs to
 *   do after that point cannot be left to a callback delivered by that
 *   component's MutationObserver. The harness at the bottom of this file is the
 *   shape that made that a blank screen; the first test in it was watched failing.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  isRedirect,
  Outlet,
  RouterProvider,
  useNavigate,
} from '@tanstack/react-router';
import type { Provenance, Role } from '@skillwright/shared/policy';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;
type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
}));

vi.mock('./api.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, api: { ...(actual.api as object), get: apiGet, post: apiPost } };
});

// Imported after the mock so both the query and the mutations resolve the stub.
import { api } from './api.js';
import { ApiError, type ErrorCode } from './problem.js';
import { qk } from './query.js';
import { requireAuth } from './guards.js';
import {
  fetchSession,
  toActor,
  toSessionUser,
  useDemoLogin,
  useLogin,
  useLogout,
  useMfaVerify,
  useSession,
  type SessionEnvelope,
  type SessionUser,
} from './session.js';

const USER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';

function envelope(overrides: {
  role?: Role;
  status?: SessionEnvelope['user']['status'];
  provenance?: Provenance;
  mfaEnabled?: boolean;
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
      phoneNumber: '+254700000000',
      bio: 'Welder.',
      avatarUrl: null,
      mfaEnabled: overrides.mfaEnabled ?? false,
      lastLoginAt: '2026-08-01T09:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      teacherProfile: null,
      studentProfile: null,
    },
    expiresAt: '2026-12-31T00:00:00.000Z',
  };
}

function apiError(status: number, code: ErrorCode): ApiError {
  return new ApiError({ type: 'about:blank', title: code, status, code, requestId: 'req-test' });
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

describe('toSessionUser', () => {
  it('takes provenance from the actor, which is the only object that carries it', () => {
    const flat = toSessionUser(envelope({ provenance: 'DEMO' }));

    // A DEMO session and a PASSWORD session for the same account differ in `actor`
    // and are identical in `user`, so this is the only place the difference exists.
    expect(flat.provenance).toBe('DEMO');
  });

  it('renames mfaEnabled to totpEnabled, because TOTP is the only factor implemented', () => {
    expect(toSessionUser(envelope({ mfaEnabled: true })).totpEnabled).toBe(true);
    // The false case is the one that matters more: a mapper that hardcoded `true`
    // would tell every account that has never turned TOTP on that it has.
    expect(toSessionUser(envelope({ mfaEnabled: false })).totpEnabled).toBe(false);
  });

  it('carries the eight fields the chrome renders and nothing else', () => {
    // The envelope's `user` serves fourteen. Everything beyond these eight belongs
    // to a profile fetched by the screen that shows it — putting `bio` or a
    // teacherProfile on the session means every screen re-renders when either
    // changes, and means the session query is answering questions it was not asked.
    expect(Object.keys(toSessionUser(envelope({}))).sort()).toEqual([
      'avatarUrl',
      'email',
      'id',
      'name',
      'provenance',
      'role',
      'status',
      'totpEnabled',
    ]);
  });
});

describe('toActor', () => {
  it('is null for an anonymous visitor', () => {
    expect(toActor(null)).toBeNull();
  });

  it('projects exactly the four fields can() reads', () => {
    const user: SessionUser = toSessionUser(envelope({ role: 'TEACHER', provenance: 'DEMO' }));

    // Every field of `Subject` is optional and so is never checked at runtime; the
    // Actor is not, and a missing one here changes a decision rather than failing.
    expect(toActor(user)).toEqual({
      id: USER_ID,
      role: 'TEACHER',
      status: 'ACTIVE',
      provenance: 'DEMO',
    });
  });
});

describe('fetchSession', () => {
  it('turns a 401 into the anonymous state rather than an error', async () => {
    apiGet.mockRejectedValue(apiError(401, 'UNAUTHENTICATED'));

    // Anonymous is a legitimate state of this app — published courses and
    // announcements are public — so "not signed in" must not reach an error
    // boundary and blank the page.
    await expect(fetchSession()).resolves.toEqual({ user: null });
  });

  it('lets a suspension through as an error, so the cache listener can see it', async () => {
    apiGet.mockRejectedValue(apiError(403, 'ACCOUNT_SUSPENDED'));

    // `query.ts` evicts a revoked session from the QueryCache's onError. Swallowing
    // this the way the 401 is swallowed would answer `{ user: null }` without ever
    // dropping the data fetched under the old identity.
    await expect(fetchSession()).rejects.toBeInstanceOf(ApiError);
  });

  it('lets a server fault through', async () => {
    apiGet.mockRejectedValue(apiError(500, 'INTERNAL'));

    await expect(fetchSession()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('useSession', () => {
  it('derives the flags the chrome branches on', async () => {
    apiGet.mockResolvedValue(envelope({ provenance: 'DEMO', status: 'ACTIVE', role: 'ADMIN' }));
    const queryClient = client();

    const { result } = renderHook(() => useSession(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    expect(result.current.isDemo).toBe(true);
    expect(result.current.isMfaPending).toBe(false);
    expect(result.current.isSuspended).toBe(false);
    expect(result.current.needsEmailVerification).toBe(false);
  });

  it('reports a half-authenticated and an unverified session distinctly', async () => {
    apiGet.mockResolvedValue(
      envelope({ provenance: 'MFA_PENDING', status: 'PENDING_VERIFICATION' }),
    );
    const queryClient = client();

    const { result } = renderHook(() => useSession(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    expect(result.current.isMfaPending).toBe(true);
    expect(result.current.needsEmailVerification).toBe(true);
  });

  it('keeps one actor identity across renders', async () => {
    apiGet.mockResolvedValue(envelope({}));
    const queryClient = client();

    const { result, rerender } = renderHook(() => useSession(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.actor).not.toBeNull());
    const first = result.current.actor;
    rerender();

    // `can()` is called from useMemo and useCallback dependency arrays all over the
    // app. A fresh actor object per render invalidates every one of them on every
    // render — no test fails, the app just recomputes everything continuously.
    expect(result.current.actor).toBe(first);
  });
});

describe('what a login writes into the cache', () => {
  it('seeds the full user on the AUTHENTICATED branch', async () => {
    apiPost.mockResolvedValue({ status: 'AUTHENTICATED', ...envelope({ role: 'TEACHER' }) });
    const queryClient = client();

    const { result } = renderHook(() => useLogin(), { wrapper: wrapper(queryClient) });
    result.current.mutate({ email: 'ada@example.edu', password: 'correct horse battery' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(qk.session)).toEqual({
      user: expect.objectContaining({ id: USER_ID, role: 'TEACHER', provenance: 'PASSWORD' }),
    });
  });

  it('seeds an MFA_PENDING session from the actor alone, and requireAuth then routes it', async () => {
    // MFA_REQUIRED is a SUCCESS branch of the union: the password was right and a
    // cookie has already been issued, stamped MFA_PENDING. There is no `user` on
    // this branch at all — the whole seed is built from the actor.
    apiPost.mockResolvedValue({
      status: 'MFA_REQUIRED',
      actor: { id: USER_ID, role: 'STUDENT', status: 'ACTIVE', provenance: 'MFA_PENDING' },
    });
    const queryClient = client();

    const { result } = renderHook(() => useLogin(), { wrapper: wrapper(queryClient) });
    result.current.mutate({ email: 'ada@example.edu', password: 'correct horse battery' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // There is no `user` on this branch of the wire response, so `email` and
    // `name` are placeholders rather than data — and they must be RECOGNISABLY
    // empty, not some other filler that would render as a name nobody has.
    expect(queryClient.getQueryData(qk.session)).toEqual({
      user: expect.objectContaining({ email: '', name: '' }),
    });

    // The seed only earns its place if the guard reads it the way this module
    // intends. Run the real guard against the real cache entry: no /auth/me call is
    // needed, and the answer must be the TOTP step rather than the login form the
    // user has just completed.
    const thrown = await requireAuth({
      context: { queryClient },
      location: { href: '/dashboard' },
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as Response & { options: { search: unknown } }).options.search).toEqual({
      step: 'mfa',
    });
    expect(apiGet).not.toHaveBeenCalled();
  });
});

describe('useDemoLogin', () => {
  it('seeds the session cache the same way a password login does', async () => {
    // `useDemoLogin` shares `cacheLoginResult` with `useLogin`; nothing in the
    // demo path calls `useLogin`, so this is the only exercise its own onSuccess
    // wiring gets.
    apiPost.mockResolvedValue({ status: 'AUTHENTICATED', ...envelope({ role: 'TEACHER' }) });
    const queryClient = client();

    const { result } = renderHook(() => useDemoLogin(), { wrapper: wrapper(queryClient) });
    result.current.mutate('TEACHER');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(qk.session)).toEqual({
      user: expect.objectContaining({ id: USER_ID, role: 'TEACHER', provenance: 'PASSWORD' }),
    });
  });
});

describe('useMfaVerify', () => {
  it('writes the newly-authenticated session into the cache', async () => {
    // This is the write that turns a just-verified TOTP session into an
    // authenticated one client-side: nothing else in this module or in
    // Login.test.tsx (which drives the hook through the real UI) ever inspects
    // what lands in the cache, only that navigate() fired.
    apiPost.mockResolvedValue(envelope({ role: 'TEACHER' }));
    const queryClient = client();

    const { result } = renderHook(() => useMfaVerify(), { wrapper: wrapper(queryClient) });
    result.current.mutate({ code: '123456' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(qk.session)).toEqual({
      user: expect.objectContaining({ id: USER_ID, role: 'TEACHER', provenance: 'PASSWORD' }),
    });
  });
});

/*
 * The smallest router that can reproduce the reported failure: a screen under a
 * shell, a bar that owns `useLogout`, and a /login to land on.
 *
 * The shape matters more than the markup. `Shell` is AppShell.tsx:64-72 in
 * miniature — the bar is a CHILD of the `!user` early return, so the cache write
 * that signs you out UNMOUNTS the component whose MutationObserver would
 * otherwise deliver the result — and `TopBar` passes the per-call `onSettled`
 * exactly as AppShell.tsx:252-256 does, so a regression here is the regression
 * the app had, not an approximation of it.
 *
 * The one thing a stub gets wrong, and it got this test wrong first time: an
 * `api` mock that resolves in a microtask makes `await resetQueries()` finish
 * before React can commit the unmount, and the per-call handler is then
 * delivered and the test passes against the broken code. The refetch has to take
 * a MACROTASK, which is what a real /auth/me does, so `roundTrip` is what makes
 * the race in the first test the race in the app.
 */
function TopBar() {
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <button
      type="button"
      onClick={() => logout.mutate(undefined, { onSettled: () => void navigate({ to: '/login' }) })}
    >
      Sign out
    </button>
  );
}

/** A round trip that takes a macrotask, which is what a real request does. */
function roundTrip(value: unknown) {
  return new Promise((resolve) => setTimeout(() => resolve(value), 0));
}

/** An observed non-session entry: the sweep has to cope with a live observer. */
function CourseList() {
  useQuery({
    queryKey: qk.courses({ page: 1 }),
    queryFn: async () => ({ data: (await api.get('/courses')) as unknown[] }),
  });
  return null;
}

function Shell() {
  const { user } = useSession();
  // `if (!user) return <>{children}</>` — the children still render, which is why
  // the sign-out lands on a page with no chrome rather than on a blank document.
  if (!user)
    return (
      <>
        <p>no shell</p>
        <Outlet />
      </>
    );
  return (
    <>
      <TopBar />
      <CourseList />
      <Outlet />
    </>
  );
}

const logoutRoot = createRootRoute({ component: Shell });
const logoutRouteTree = logoutRoot.addChildren([
  createRoute({
    getParentRoute: () => logoutRoot,
    path: '/app',
    component: () => <p>app screen</p>,
  }),
  createRoute({
    getParentRoute: () => logoutRoot,
    path: '/login',
    component: () => <p>login screen</p>,
  }),
]);

/** Boots the harness on a seeded session and hands back the sign-out button. */
async function renderShell(queryClient: QueryClient) {
  const router = createRouter({
    routeTree: logoutRouteTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/app'] }),
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { router, signOut: await view.findByRole('button', { name: 'Sign out' }), ...view };
}

describe('useLogout', () => {
  it('reaches /login even though the sign-out unmounts the bar that started it', async () => {
    apiPost.mockResolvedValue(undefined);
    // The session query is refetched by whichever sweep runs; answering it on a
    // macrotask is what gives React time to commit the unmount while the
    // mutation is still settling, which is the window the report is about.
    apiGet.mockImplementation(() => roundTrip(undefined));
    const queryClient = client();
    queryClient.setQueryData(qk.session, { user: toSessionUser(envelope({})) });

    const { router, signOut, findByText, queryByRole } = await renderShell(queryClient);
    fireEvent.click(signOut);

    // The premise, asserted rather than assumed: the button that owns the
    // mutation is gone before the result is dispatched, so the per-call
    // `onSettled` above can never be delivered. `navigate({to:'/login'})` is
    // passed to every `mutate()` in the app and it still lands on the login
    // screen — which is the whole fix, and this test was watched passing
    // against the code without it.
    await waitFor(() => expect(queryByRole('button', { name: 'Sign out' })).toBeNull());
    expect(await findByText('login screen')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('empties every cache entry, not only the session', async () => {
    apiPost.mockResolvedValue(undefined);
    const queryClient = client();
    queryClient.setQueryData(qk.session, { user: toSessionUser(envelope({})) });
    queryClient.setQueryData(qk.courses({ page: 1 }), { data: [{ id: 'c1' }] });

    const { signOut } = await renderShell(queryClient);
    fireEvent.click(signOut);
    await waitFor(() => expect(queryClient.getQueryData(qk.session)).toEqual({ user: null }));

    // A cache entry that outlives its session is what the next person on a shared
    // workshop machine sees. The assertion is over the WHOLE cache rather than the
    // keys seeded above, because naming keys is how a sweep quietly stops covering
    // the list nobody remembered, and the marker is the seeded VALUE: nothing
    // readable after a sign-out may still be what was fetched under the old
    // identity.
    expect(
      queryClient
        .getQueryCache()
        .findAll()
        .map((query) => query.state.data),
    ).not.toContainEqual({ data: [{ id: 'c1' }] });

    // The session entry is the one thing that SURVIVES, and it survives holding
    // the anonymous sentinel: `ensureQueryData` in the guard reads it there, and
    // `{user: null}` is what `fetchSession` resolves to on a 401 anyway.
    expect(queryClient.getQueryData(qk.session)).toEqual({ user: null });

    // Measured, and the reason the comment on `useLogout` claims no more than it
    // does: removing an entry a component is still observing makes that observer
    // build a fresh query and refetch, so the entry comes back — as the anonymous
    // visitor's answer, since the cookie went with the sign-out. `resetQueries`
    // does exactly the same. What `removeQueries` does NOT do is await it.
    expect(apiGet).toHaveBeenCalledWith('/courses');
  });

  it('signs out locally even when the logout request fails', async () => {
    // `onSettled`, not `onSuccess`. A network blip on the way out must still empty
    // this browser — leaving a full cache behind because the server never answered
    // is the same shared-machine leak, arrived at by a different route.
    apiPost.mockRejectedValue(apiError(500, 'INTERNAL'));
    const queryClient = client();
    queryClient.setQueryData(qk.session, { user: toSessionUser(envelope({})) });

    const { signOut, findByText } = await renderShell(queryClient);
    fireEvent.click(signOut);

    // The failure path is the one that has to navigate too: it is a case where the
    // mutation settles with no data, and a navigation left to a caller would be
    // waiting on an unmount just the same.
    expect(await findByText('login screen')).toBeTruthy();
    expect(queryClient.getQueryData(qk.session)).toEqual({ user: null });
  });
});
