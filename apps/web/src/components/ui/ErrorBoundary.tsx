import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ApiError } from '@/lib/problem';
import { logger } from '@/lib/logger';
import { EmptyState } from './EmptyState.js';

export interface ErrorFallbackProps {
  error: Error;
  reset: () => void;
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback. Receives the error and a reset that clears the boundary. */
  fallback?: (props: ErrorFallbackProps) => ReactNode;
  /** Called on every caught error — wire it to the reset of a query cache. */
  onReset?: () => void;
  /**
   * Changing any value here clears the error. Pass the route path so navigating
   * away from a broken screen does not leave the boundary stuck.
   */
  resetKeys?: unknown[];
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * The last line of defence.
 *
 * WHY a class: React still offers no hook-based way to catch a render error, and
 * a render error is exactly the case where the alternative — a white screen —
 * is most expensive.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('render boundary caught', {
      message: error.message,
      componentStack: info.componentStack,
      ...(error instanceof ApiError ? { requestId: error.requestId, code: error.code } : {}),
    });
  }

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    const { resetKeys } = this.props;
    if (!this.state.error || !resetKeys) return;
    const changed =
      previous.resetKeys?.length !== resetKeys.length ||
      resetKeys.some((key, index) => !Object.is(key, previous.resetKeys?.[index]));
    if (changed) this.reset();
  }

  reset = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback({ error, reset: this.reset });
    }

    const apiError = error instanceof ApiError ? error : null;
    return (
      <EmptyState
        variant="error"
        title={apiError ? apiError.userMessage : "That didn't load"}
        description={
          apiError?.status === 403
            ? 'You do not have access to this. If that looks wrong, ask an administrator.'
            : undefined
        }
        actionLabel="Try again"
        onAction={this.reset}
        requestId={apiError?.requestId}
      />
    );
  }
}
