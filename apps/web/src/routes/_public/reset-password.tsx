import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { Route as publicLayout } from '../_public.js';

export interface ResetPasswordSearch {
  /** The 6-digit code from the email. Optional so the form can be typed into. */
  code?: string;
  email?: string;
}

export const Route = createRoute({
  getParentRoute: () => publicLayout,
  path: '/reset-password',
  validateSearch: (search: Record<string, unknown>): ResetPasswordSearch => ({
    ...(typeof search.code === 'string' ? { code: search.code } : {}),
    ...(typeof search.email === 'string' ? { email: search.email } : {}),
  }),
  component: lazyRouteComponent(() => import('@/pages/ResetPassword'), 'ResetPasswordPage'),
});
