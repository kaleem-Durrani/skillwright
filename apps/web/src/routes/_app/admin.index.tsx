import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { BRAND } from '@skillwright/shared/brand';
import { Route as adminLayout } from './admin.js';

export const Route = createRoute({
  getParentRoute: () => adminLayout,
  path: '/',
  head: () => ({ meta: [{ title: `Administration · ${BRAND.name}` }] }),
  component: lazyRouteComponent(() => import('@/pages/AdminOverview'), 'AdminOverviewPage'),
});
