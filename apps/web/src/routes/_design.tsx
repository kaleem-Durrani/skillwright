import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { Route as rootRoute } from './__root.js';

/**
 * The design surface at `/design`.
 *
 * It sits directly under the root — outside both the public layout and the app
 * shell — so the primitives are shown on the raw canvas with nothing borrowed
 * from a parent. It is the visual regression target: if a token changes, the
 * diff shows up here first.
 *
 * It is NOT guarded. A component gallery containing no data is not a leak, and
 * an unauthenticated designer needing an admin account to look at a Button is a
 * process failure disguised as security.
 */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/design',
  component: lazyRouteComponent(() => import('@/pages/Design'), 'DesignPage'),
});
