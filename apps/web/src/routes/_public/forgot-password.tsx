import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { Route as publicLayout } from '../_public.js';

export const Route = createRoute({
  getParentRoute: () => publicLayout,
  path: '/forgot-password',
  component: lazyRouteComponent(() => import('@/pages/ForgotPassword'), 'ForgotPasswordPage'),
});
