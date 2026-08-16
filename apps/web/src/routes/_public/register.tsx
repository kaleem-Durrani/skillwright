import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { redirectIfAuthenticated } from '@/lib/guards';
import { Route as publicLayout } from '../_public.js';

export const Route = createRoute({
  getParentRoute: () => publicLayout,
  path: '/register',
  beforeLoad: redirectIfAuthenticated,
  component: lazyRouteComponent(() => import('@/pages/Register'), 'RegisterPage'),
});
