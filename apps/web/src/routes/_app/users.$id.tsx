import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { BRAND } from '@skillwright/shared/brand';
import { Route as appLayout } from '../_app.js';

/**
 * `GET /users/:id` — a full account record.
 *
 * NO LOADER, and that is the interesting decision. Every other single-row route in
 * this tree warms the cache during the navigation (`resources.$resourceId.tsx` is
 * the precedent), and copying it here is the obvious move. It would be wrong:
 * `user:read` is `isSelf` for a STUDENT and a TEACHER (policy.ts), so a loader
 * would run `ensureQueryData` BEFORE the page has decided anything, and a student
 * following a colleague's link would have the request issued and then refused —
 * rather than never issued at all. The page asks
 * `can('user:read', subject({ userId: params.id }))` first and leaves the query
 * `enabled: false` when the answer is no, which is the client half of the same gate
 * the route's `preHandler: authorize('user:read', targetSubject)` applies on the
 * server.
 *
 * Under `_app`, not under `/admin`. `user:read` is `isSelf` for two of the three
 * roles, so a signed-in student opening their own id is entitled to exactly this
 * page, and filing it under the admin branch would make the `_app` guard and the
 * policy disagree about who it is for.
 */
export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/users/$id',
  head: () => ({ meta: [{ title: `Account · ${BRAND.name}` }] }),
  component: lazyRouteComponent(() => import('@/pages/UserDetail'), 'UserDetailPage'),
});
