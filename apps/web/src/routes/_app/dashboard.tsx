import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { BRAND } from '@skillwright/shared/brand';
import { Route as appLayout } from '../_app.js';

export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/dashboard',
  head: () => ({ meta: [{ title: `Dashboard · ${BRAND.name}` }] }),
  component: lazyRouteComponent(() => import('@/pages/Dashboard'), 'DashboardPage'),
});
