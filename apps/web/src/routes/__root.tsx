import { createRootRouteWithContext, HeadContent, Link, Outlet } from '@tanstack/react-router';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { Toaster } from '@/components/ui/Toast';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { BRAND } from '@skillwright/shared/brand';
import type { RouterContext } from '@/lib/guards';

/**
 * The root route owns exactly three things: the tooltip singleton, the toast
 * viewport, and the outlet. Everything else belongs to a layout route, so that
 * the public screens do not pay for the application shell.
 *
 * `head` supplies the document title EVERY match falls back to. A leaf route's
 * own `head` wins over this one (headContentUtils walks matches leaf-first and
 * keeps only the first title it meets), so this is what a reader sees on the 404
 * page and for the instant before a redirect-only route (e.g. `/`) resolves —
 * never a title left over from whatever page they were on before.
 */
export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  head: () => ({ meta: [{ title: BRAND.name }] }),
});

function RootLayout() {
  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={200}>
      <HeadContent />
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
          description={`That address does not match anything in ${BRAND.name}. It may have moved, or the link may be out of date.`}
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
