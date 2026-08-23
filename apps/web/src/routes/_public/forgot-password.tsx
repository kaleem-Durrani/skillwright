import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { BRAND } from '@skillwright/shared/brand';
import { Route as publicLayout } from '../_public.js';

export const Route = createRoute({
  getParentRoute: () => publicLayout,
  path: '/forgot-password',
  head: () => ({ meta: [{ title: `Reset your password · ${BRAND.name}` }] }),
  component: lazyRouteComponent(() => import('@/pages/ForgotPassword'), 'ForgotPasswordPage'),
});
