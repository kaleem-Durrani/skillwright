import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { Route as appLayout } from '../_app.js';

export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/dashboard',
  component: lazyRouteComponent(() => import('@/pages/Dashboard'), 'DashboardPage'),
});
