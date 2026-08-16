import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { Route as adminLayout } from './admin.js';

export const Route = createRoute({
  getParentRoute: () => adminLayout,
  path: '/',
  component: lazyRouteComponent(() => import('@/pages/AdminOverview'), 'AdminOverviewPage'),
});
