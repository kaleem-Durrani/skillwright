import { createRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { AppShell } from '@/components/layout/AppShell';
import { AsyncBoundary } from '@/components/ui/AsyncBoundary';
import { SkeletonStats } from '@/components/ui/Skeleton';
import { requireAuth } from '@/lib/guards';
import { Route as rootRoute } from './__root.js';

/**
 * The authenticated area.
 *
 * The guard runs in `beforeLoad`, so nothing inside this layout — including the
 * shell — renders for a visitor who is not entitled to it.
 */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  id: '_app',
  beforeLoad: requireAuth,
  component: AppLayout,
});

function AppLayout() {
  // Reset the boundary on navigation: a screen that failed should not stay
  // failed after the user has moved somewhere else entirely.
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <AppShell>
      <AsyncBoundary pending={<SkeletonStats />} resetKeys={[pathname]}>
        <Outlet />
      </AsyncBoundary>
    </AppShell>
  );
}
