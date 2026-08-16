import { createRoute, Outlet } from '@tanstack/react-router';
import { requireRole } from '@/lib/guards';
import { Route as appLayout } from '../_app.js';

/**
 * The admin area is a nested layout with ONE extra guard — not a separate shell,
 * not a separate design language, not a separate URL vocabulary.
 *
 * The role is checked against the session here and against `can()` on the server
 * for every request. `/admin` in the address bar grants nothing.
 */
export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/admin',
  beforeLoad: requireRole('ADMIN'),
  component: () => <Outlet />,
});
