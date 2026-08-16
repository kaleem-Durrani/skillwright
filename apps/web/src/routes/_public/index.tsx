import { createRoute, redirect } from '@tanstack/react-router';
import { sessionQueryOptions } from '@/lib/session';
import { Route as publicLayout } from '../_public.js';

/**
 * `/` is not a screen. It is a decision.
 *
 * Rendering a marketing page here and then bouncing the user is a wasted paint;
 * deciding in `beforeLoad` means the browser only ever renders the destination.
 */
export const Route = createRoute({
  getParentRoute: () => publicLayout,
  path: '/',
  beforeLoad: async ({ context }) => {
    const { user } = await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (user && user.status === 'ACTIVE' && user.provenance !== 'MFA_PENDING') {
      throw redirect({ to: '/dashboard' });
    }
    throw redirect({ to: '/login' });
  },
});
