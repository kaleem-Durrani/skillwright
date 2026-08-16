import { Suspense, type ReactNode } from 'react';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { ErrorBoundary, type ErrorFallbackProps } from './ErrorBoundary.js';

export interface AsyncBoundaryProps {
  children: ReactNode;
  /**
   * The loading UI. Should be a Skeleton that MIRRORS the resolved layout — pass
   * a spinner only when the resolved shape is genuinely unknowable.
   */
  pending: ReactNode;
  fallback?: (props: ErrorFallbackProps) => ReactNode;
  /** Clears the boundary when any of these change; pass the route params. */
  resetKeys?: unknown[];
}

/**
 * Suspense and error handling as one unit.
 *
 * WHY they are fused: they are the two halves of the same question ("what does
 * the user see while this is not ready?"), and separating them is how a screen
 * ends up with a skeleton for loading and a blank div for failure. Wiring
 * QueryErrorResetBoundary here also means "Try again" actually re-runs the
 * query instead of re-rendering the same rejected promise.
 */
export function AsyncBoundary({ children, pending, fallback, resetKeys }: AsyncBoundaryProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          {...(fallback ? { fallback } : {})}
          {...(resetKeys ? { resetKeys } : {})}
        >
          <Suspense fallback={pending}>{children}</Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
