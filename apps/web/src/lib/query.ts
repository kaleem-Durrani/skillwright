import { MutationCache, QueryCache, QueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError } from './problem.js';

/**
 * Never retry something the server already told us is our fault.
 *
 * WHY: the default exponential retry turns one 403 into four 403s, quadruples
 * the audit log noise, and delays the error UI by ~7 seconds for no benefit.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status === 0) return failureCount < 2; // transport blip
    if (error.status >= 400 && error.status < 500) return false;
  }
  return failureCount < 2;
}

/**
 * The two codes that mean "the session you think you have is gone".
 *
 * Both are reachable from one suspension, and which one arrives is a race:
 * `users.service.ts:300-310` sets the status AND destroys every session row, so a
 * request that lands after the rows are gone finds no session and is anonymous
 * (401), while one that lands between the two writes finds a live session owned by
 * a suspended user and is refused by auth.plugin.ts:63-67 (403). Logging out in
 * another tab produces the first on its own.
 */
const SESSION_LOST = new Set(['UNAUTHENTICATED', 'ACCOUNT_SUSPENDED']);

function isSessionLost(error: unknown): boolean {
  return error instanceof ApiError && SESSION_LOST.has(error.code);
}

/**
 * Revocation is retroactive on the server and was invisible on the client.
 *
 * An admin suspends someone who is mid-session: the API kills every session row
 * immediately and answers their next authenticated request 401. Nothing acted on
 * that. `requireAuth` (guards.ts:37-52) already knows how to bounce a dead session
 * to /login — including the `reason: 'suspended'` branch — but it reads the session
 * through `ensureQueryData`, and that entry was still cached and still fresh, so the
 * guard re-ran on every navigation and kept answering with the old user.
 *
 * Observed on 2026-08-22, in a browser: a suspended student's Settings screen 401'd
 * and rendered an inline "we could not load you" under a shell that still said
 * "Student workspace" beside a profile card that still said "Active"; clicking
 * Dashboard from there issued NO requests at all and painted a full dashboard from
 * cache. They could keep browsing indefinitely.
 *
 * So: drop the session entry and re-run the router's own guard. Nothing new decides
 * where a dead session goes — `requireAuth` still does.
 *
 * Which of its branches, observed rather than assumed: suspension destroys the session
 * rows, so the re-fetched probe answers `{ user: null }` and the guard takes its
 * anonymous branch — /login?redirect=<where they were>. `guards.ts:47`'s
 * `status === 'SUSPENDED'` branch needs a LIVE session owned by a suspended user, which
 * only the 403 race above can produce.
 *
 * The `user` check is the whole loop guard: this only fires while the cache still
 * believes someone is signed in, and the first thing it does is stop believing that.
 */
function handleSessionLost(client: QueryClient, onLost: () => void): void {
  const session = client.getQueryData<{ user: unknown }>(qk.session);
  if (!session?.user) return;

  client.setQueryData(qk.session, { user: null });
  // Everything else was fetched under an identity that no longer exists. Matched by
  // the key's head rather than by reference, so it survives a re-created `qk`.
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
  onLost();
}

/**
 * @param onSessionLost re-runs the router's guards. Late-bound from main.tsx,
 * because the router is built from the client this function returns.
 */
export function createQueryClient(onSessionLost: () => void): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (isSessionLost(error)) handleSessionLost(client, onSessionLost);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isSessionLost(error)) handleSessionLost(client, onSessionLost);
      },
    }),
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        // Long enough that tab-switching does not re-fetch a list the user is
        // still looking at; short enough that a stale enrolment count is rare.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        throwOnError: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return client;
}

/**
 * Every query key in the app. Centralised so an invalidation after a mutation
 * cannot miss a list it did not know existed.
 */
export const qk = {
  session: ['session'] as QueryKey,
  /*
   * TWO key spaces under `notifications`, because there are two SHAPES.
   *
   * `notifications(unreadOnly)` is the LIST — `Paginated<NotificationDto>` under a
   * filter. `notificationsUnread` is the scalar `{ unread: number }` counter behind
   * the badge. These used to share a slot: `notifications(true)` was read as "the
   * list, filtered to unread" by its own type parameter and WRITTEN as the count by
   * the mark-read mutation, so one key held two incompatible shapes and the first
   * component to actually request unread-only rows would have got a number back.
   *
   * The count key deliberately still starts with 'notifications', so a future
   * blanket `invalidateQueries({ queryKey: ['notifications'] })` reaches both.
   */
  notifications: (unreadOnly = false) => ['notifications', { unreadOnly }] as QueryKey,
  notificationsUnread: ['notifications', 'unread-count'] as QueryKey,
  courses: (params: Record<string, unknown> = {}) => ['courses', params] as QueryKey,
  course: (courseId: string) => ['courses', courseId] as QueryKey,
  courseResources: (courseId: string) => ['courses', courseId, 'resources'] as QueryKey,
  courseEnrollments: (courseId: string) => ['courses', courseId, 'enrollments'] as QueryKey,
  enrollments: (params: Record<string, unknown> = {}) => ['enrollments', params] as QueryKey,
  announcements: (params: Record<string, unknown> = {}) => ['announcements', params] as QueryKey,
  conversations: ['conversations'] as QueryKey,
  messages: (conversationId: string) => ['conversations', conversationId, 'messages'] as QueryKey,
  users: (params: Record<string, unknown> = {}) => ['users', params] as QueryKey,
  departments: ['departments'] as QueryKey,
  auditEvents: (params: Record<string, unknown> = {}) => ['audit', params] as QueryKey,
} as const;
