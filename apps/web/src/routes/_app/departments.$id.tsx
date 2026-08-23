import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { BRAND } from '@skillwright/shared/brand';
import { Route as appLayout } from '../_app.js';

/**
 * A department detail lives under the APP SHELL, not under `/admin`:
 * `department:read` denies only anonymous callers (departments.routes.ts:22-28),
 * so any signed-in role may open one. The `_app` guard supplies the session this
 * route's policy row assumes; nothing admin-specific happens here.
 */
export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/departments/$id',
  head: () => ({ meta: [{ title: `Department · ${BRAND.name}` }] }),
  component: lazyRouteComponent(() => import('@/pages/DepartmentDetail'), 'DepartmentDetailPage'),
});
