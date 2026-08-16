import { createRouter } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { routeTree } from './routes/routeTree.js';
import { Spinner } from './components/ui/Spinner.js';
import { EmptyState } from './components/ui/EmptyState.js';

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    // A route only shows its pending UI if it is actually slow. Flashing a
    // skeleton for a 40ms cache hit reads as jank, not as speed.
    defaultPendingMs: 250,
    defaultPendingMinMs: 400,
    defaultPreload: 'intent',
    defaultPreloadDelay: 80,
    // The router owns scroll restoration so a back navigation returns to the
    // row the user tapped, not to the top of a 200-item list.
    scrollRestoration: true,
    defaultPendingComponent: () => (
      <div className="grid min-h-[50dvh] place-items-center">
        <Spinner size="lg" label="Loading" className="text-fg-tertiary" />
      </div>
    ),
    defaultErrorComponent: ({ error, reset }) => (
      <EmptyState
        variant="error"
        description={error.message}
        actionLabel="Try again"
        onAction={reset}
      />
    ),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
