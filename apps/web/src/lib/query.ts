import { QueryClient, type QueryKey } from '@tanstack/react-query';
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

export function createQueryClient(): QueryClient {
  return new QueryClient({
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
