import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { BRAND } from '@skillwright/shared/brand';
import { redirectIfAuthenticated } from '@/lib/guards';
import { Route as publicLayout } from '../_public.js';

export const Route = createRoute({
  getParentRoute: () => publicLayout,
  path: '/register',
  beforeLoad: redirectIfAuthenticated,
  head: () => ({ meta: [{ title: `Create an account · ${BRAND.name}` }] }),
  component: lazyRouteComponent(() => import('@/pages/Register'), 'RegisterPage'),
});
