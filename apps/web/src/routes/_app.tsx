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

/**
 * There is no route transition here, and that was measured rather than assumed.
 *
 * The UI roadmap calls the hard cut between pages "the largest missing motion"
 * and gates it: added if it earns its place, skipped if it costs perceived speed.
 * So it was built — a fade on a `key={pathname}` column, carrying
 * `flex min-h-0 flex-1 flex-col` so it would not break the layout contract for
 * every screen at once — and then sampled frame by frame on navigation:
 *
 *   content first painted   ~98 ms after the click
 *   opacity 0 -> 1          ~207 ms, across 14 frames
 *   fully readable          ~305 ms
 *
 * Three times the time-to-readable, on every navigation, for an effect with no
 * purpose beyond looking smoother. `_public.tsx` does animate its Outlet, and the
 * asymmetry is deliberate rather than an oversight: a sign-in screen is entered
 * once a session, and these are navigated continuously.
 *
 * Rebuild it if you disagree — but sample it first, and note that shortening the
 * fade means adding a variant rather than passing `transition`, which a resolved
 * variant shadows (lib/motion.ts).
 */
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
