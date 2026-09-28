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
 * `suspend()` in users.service.ts sets the status AND destroys every session row, so a
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
   * `page` is the archive page's slot (`/notifications`, offset-paginated), and it
   * is a separate SEGMENT rather than a field inside the filter object so the
   * bell's key — `notifications(false)`, no page — stays exactly what it always
   * was. TanStack matches keys structurally, so invalidating the two-element
   * prefix `qk.notifications(true)` reaches EVERY page of the unread-filtered
   * list without anyone enumerating pages.
   *
   * The count key deliberately still starts with 'notifications', so a future
   * blanket `invalidateQueries({ queryKey: ['notifications'] })` reaches both.
   */
  notifications: (unreadOnly = false, page?: number) =>
    ['notifications', { unreadOnly }, ...(page === undefined ? [] : [page])] as QueryKey,
  notificationsUnread: ['notifications', 'unread-count'] as QueryKey,
  courses: (params: Record<string, unknown> = {}) => ['courses', params] as QueryKey,
  course: (courseId: string) => ['courses', courseId] as QueryKey,
  courseResources: (courseId: string) => ['courses', courseId, 'resources'] as QueryKey,
  courseEnrollments: (courseId: string) => ['courses', courseId, 'enrollments'] as QueryKey,
  // One slot PER INTAKE AND DATE under the same `courses/:id/attendance` head. A
  // register is one intake's day-answer since Phase 9 (the endpoints REQUIRE an
  // `offeringId`), so both ride in the key and switching either is a cache miss that
  // refetches rather than a stale read; invalidating the three-element prefix would
  // sweep intakes and dates the save never touched.
  courseAttendance: (courseId: string, offeringId: string, date: string) =>
    ['courses', courseId, 'attendance', { offeringId, date }] as QueryKey,
  enrollmentAttendance: (enrollmentId: string) =>
    ['enrollments', enrollmentId, 'attendance'] as QueryKey,
  enrollments: (params: Record<string, unknown> = {}) => ['enrollments', params] as QueryKey,
  /*
   * The single enrolment row behind `routes/_app/enrollments.$id.tsx`, and it
   * deliberately shares the `enrollments` HEAD with the list above and with
   * `enrollmentAttendance` rather than getting a head of its own.
   *
   * Every write to a seat — approve, reject, withdraw, complete — already
   * invalidates the `['enrollments']` prefix (CourseDetail.tsx's `decide`), so a
   * detail page reading and writing this slot is swept by the same call that
   * refreshes the roster it was opened from. A key the writes do not reach would
   * make the detail page the one screen in the app that can disagree with the list
   * behind it.
   */
  enrollment: (enrollmentId: string) => ['enrollments', enrollmentId] as QueryKey,
  // Single-row key, distinct from `resources()` for the same reason `course` sits
  // beside `courses`: `routes/_app/resources.$resourceId.tsx`'s loader and any
  // detail screen need to invalidate or read ONE row without knowing what filters
  // the list was under.
  resource: (resourceId: string) => ['resources', resourceId] as QueryKey,
  /*
   * Three key spaces under `assignments`, because there are three SHAPES and they are
   * not variations of one another:
   *
   *   - `myAssignments(params)` is the STUDENT's own list — `{ data: MyAssignmentDto[] }`,
   *     unpaginated, each row already joined to whether they have handed in. The filter
   *     object is in the key so switching course or intake is a fetch, not a stale read.
   *   - `offeringAssignments(offeringId)` is one intake's task list, a bare array. A
   *     task belongs to an INTAKE (schema.prisma's `Assignment.offeringId`), so this
   *     is the teacher's reader and a bare array is what the route answers.
   *   - `assignmentSubmissions(assignmentId)` is ONE task's class, `{ data: [...] }`.
   *
   * All three share the `assignments` head so a blanket `['assignments']` sweep after a
   * hand-in reaches the student's list, the teacher's list and the class that has to be
   * re-rendered, without any of the three knowing about the others.
   */
  myAssignments: (params: Record<string, unknown> = {}) =>
    ['assignments', 'mine', params] as QueryKey,
  offeringAssignments: (offeringId: string) => ['assignments', 'offering', offeringId] as QueryKey,
  assignment: (assignmentId: string) => ['assignments', assignmentId] as QueryKey,
  assignmentSubmissions: (assignmentId: string) =>
    ['assignments', assignmentId, 'submissions'] as QueryKey,
  announcements: (params: Record<string, unknown> = {}) => ['announcements', params] as QueryKey,
  // Single-row key, distinct from the list above for the same reason `course` sits
  // beside `courses`: `routes/_app/announcements.$announcementId.tsx`'s loader and
  // the detail screen need to invalidate or read ONE row without knowing what
  // filters the list was under.
  announcement: (announcementId: string) => ['announcements', announcementId] as QueryKey,
  /*
   * Two key spaces under `certificates`, and the split is the same one the module makes.
   *
   *   - `certificates(studentId?)` is the LIST the Qualifications tab reads. It is
   *     self-scoped for a student, and the filter is in the key so switching which
   *     student a teacher is reading is a fetch rather than a stale read.
   *   - `certificate(certificateId)` is ONE row, for the signed-URL download. It is a
   *     separate segment beside the list for the reason `course` sits beside `courses`:
   *     a detail reader must be able to name one row without knowing what filters the
   *     list was under.
   *
   * A blanket `['certificates']` invalidation after an issue reaches both, which is what
   * the issue dialog does — issuing changes the holder's list and nobody else's, and the
   * prefix is cheaper to get right than enumerating the two.
   */
  certificates: (studentId?: string) =>
    ['certificates', 'list', ...(studentId === undefined ? [] : [studentId])] as QueryKey,
  certificate: (certificateId: string) => ['certificates', 'detail', certificateId] as QueryKey,
  conversations: ['conversations'] as QueryKey,
  messages: (conversationId: string) => ['conversations', conversationId, 'messages'] as QueryKey,
  users: (params: Record<string, unknown> = {}) => ['users', params] as QueryKey,
  /*
   * The single account behind `routes/_app/users.$id.tsx` — `GET /users/:id`, which
   * had a route, a policy gate and a complete DTO and no caller in the SPA at all.
   *
   * Same head as the admin table above, and for the same reason
   * `department(departmentId)` sits beside `departments()`: suspending or
   * reinstating a row sweeps `['users']`, so the detail page and the table it was
   * opened from can never show two different statuses for one person.
   *
   * A blanket `['users']` invalidation also reaches it, which matters because
   * `PATCH /users/:id` writes exactly this row.
   */
  user: (userId: string) => ['users', userId] as QueryKey,
  departments: ['departments'] as QueryKey,
  // Single-row key under the same head as the list above, for the same reason
  // `course` sits beside `courses`: `routes/_app/departments.$id.tsx` and the
  // admin dialogs need to read or sweep ONE department without knowing what the
  // list was filtered by. A blanket `['departments']` invalidation still reaches it.
  department: (departmentId: string) => ['departments', departmentId] as QueryKey,
  auditEvents: (params: Record<string, unknown> = {}) => ['audit', params] as QueryKey,
  // Single-row key beside the feed above, for the detail dialog: it reads ONE event
  // with its stored forensics (GET /audit-events/:id), a shape the feed rows never
  // carry. Same head so a blanket ['audit'] sweep still reaches it.
  auditEvent: (eventId: string) => ['audit', 'detail', eventId] as QueryKey,
  // Cross-entity search. Keyed on the RAW q the URL carries (not a trimmed copy)
  // so back/forward between two typed variants cannot share an entry; the
  // whitespace guard lives in the query's `enabled`, not in the key.
  search: (params: Record<string, unknown> = {}) => ['search', params] as QueryKey,
} as const;
