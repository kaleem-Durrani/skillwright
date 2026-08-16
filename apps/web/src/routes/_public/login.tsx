import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { Route as publicLayout } from '../_public.js';

export interface LoginSearch {
  /** Where to return to once the session is real. */
  redirect?: string;
  /** Jumps straight to the TOTP step after a reload mid-login. */
  step?: 'mfa';
  /** Explains why the previous session ended. */
  reason?: 'suspended' | 'expired';
}

export const Route = createRoute({
  getParentRoute: () => publicLayout,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    ...(typeof search.redirect === 'string' ? { redirect: search.redirect } : {}),
    ...(search.step === 'mfa' ? { step: 'mfa' as const } : {}),
    ...(search.reason === 'suspended' || search.reason === 'expired'
      ? { reason: search.reason as 'suspended' | 'expired' }
      : {}),
  }),
  // Concrete module path, never a barrel: this import is the split point, and a
  // barrel would drag every other screen into the login chunk.
  component: lazyRouteComponent(() => import('@/pages/Login'), 'LoginPage'),
});
