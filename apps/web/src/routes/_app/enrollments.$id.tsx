import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { BRAND } from '@skillwright/shared/brand';
import { Route as appLayout } from '../_app.js';

/**
 * `GET /enrollments/:id` — one seat, with the record of how it was decided.
 *
 * NO LOADER, and the reason is the same one `users.$id.tsx` gives, inverted. A
 * loader would issue the request for every viewer, and this route's gate
 * (`enrollment:read`) is `isEnrolledStudent` for a student and `ownsCourse` for a
 * teacher — both SUBJECT-dependent, and both fields live on the response rather
 * than in the URL. The client cannot build the subject before the fetch, so the
 * fetch is the honest first step and the server is the authority on whether it
 * was allowed; a subject-free `can()` used as `enabled` would be a guaranteed
 * denial (LESSONS-LEARNED #15) that leaves a disabled query sitting at
 * `status: 'pending'` in React Query v5 — a skeleton that never resolves, for
 * every legitimate viewer including an admin.
 *
 * `qk.enrollment(id)` shares the `enrollments` HEAD with the list and the
 * attendance key, so the `['enrollments']` prefix invalidation every seat write
 * already performs (CourseDetail's `decide`) refreshes this page too. A row page
 * that could disagree with the roster it was opened from would be the mirror image
 * of the dashboard-tile bug in LESSONS-LEARNED #28.
 */
export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/enrollments/$id',
  head: () => ({ meta: [{ title: `Enrolment · ${BRAND.name}` }] }),
  component: lazyRouteComponent(() => import('@/pages/EnrollmentDetail'), 'EnrollmentDetailPage'),
});
