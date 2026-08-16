import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { Route as publicLayout } from '../_public.js';

export interface VerifyEmailSearch {
  /** Prefilled from the link in the email. */
  code?: string;
  /**
   * The address being verified. Required by `POST /auth/verify-email`, which
   * takes `{ email, code }` so that a stolen code alone is not enough. There is
   * usually no session on this screen — registration does not sign you in, and
   * login refuses a PENDING_VERIFICATION account — so the address has to travel
   * in the URL or be typed.
   */
  email?: string;
}

export const Route = createRoute({
  getParentRoute: () => publicLayout,
  path: '/verify-email',
  validateSearch: (search: Record<string, unknown>): VerifyEmailSearch => ({
    ...(typeof search.code === 'string' ? { code: search.code } : {}),
    ...(typeof search.email === 'string' ? { email: search.email } : {}),
  }),
  component: lazyRouteComponent(() => import('@/pages/VerifyEmail'), 'VerifyEmailPage'),
});
