import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { Toaster } from '@/components/ui/Toast';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import type { RouterContext } from '@/lib/guards';

/**
 * The root route owns exactly three things: the tooltip singleton, the toast
 * viewport, and the outlet. Everything else belongs to a layout route, so that
 * the public screens do not pay for the application shell.
 */
export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={200}>
      <Outlet />
      <Toaster />
    </TooltipProvider>
  );
}

function NotFound() {
  return (
    <div className="gutter-safe grid min-h-dvh place-items-center py-12">
      <div className="narrow">
        <EmptyState
          variant="no-results"
          title="Page not found"
          description="That address does not match anything in Skillwright. It may have moved, or the link may be out of date."
          action={
            <Button asChild block className="sm:w-auto">
              <Link to="/dashboard">Go to dashboard</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
