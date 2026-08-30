/**
 * Suspense and error handling fused into one unit.
 *
 * The component is nine lines and the only one of them that is hard to get right
 * is `onReset={reset}` from `QueryErrorResetBoundary`. Without it the error
 * boundary clears its own state, React re-renders the children, `useSuspenseQuery`
 * re-reads the SAME rejected promise from the cache, and the boundary latches
 * again — so "Try again" appears to do nothing at all. There is no error, no log
 * and no failed request to look at; the button simply does not work.
 *
 * That is what the last test drives, with a real QueryClient and a queryFn that
 * fails once and then succeeds. A shallow render could never see it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useSuspenseQuery } from '@tanstack/react-query';
import { AsyncBoundary } from './AsyncBoundary.js';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  /*
   * React reports every caught error to console.error and offers no way to opt
   * out. Silenced so a PASSING run stays readable, and restored after each test
   * so a genuine console.error elsewhere is still visible.
   */
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Answer({ queryFn }: { queryFn: () => Promise<string> }) {
  const query = useSuspenseQuery({ queryKey: ['async-boundary-probe'], queryFn });
  return <p>{query.data}</p>;
}

describe('AsyncBoundary', () => {
  it('shows the pending UI while the child is suspended', () => {
    render(
      <QueryClientProvider client={client()}>
        <AsyncBoundary pending={<p>loading rows</p>}>
          <Answer queryFn={() => new Promise(() => {})} />
        </AsyncBoundary>
      </QueryClientProvider>,
    );

    expect(screen.getByText('loading rows')).toBeInTheDocument();
  });

  it('shows the error fallback when the child throws instead of a blank div', async () => {
    render(
      <QueryClientProvider client={client()}>
        <AsyncBoundary pending={<p>loading rows</p>}>
          <Answer queryFn={() => Promise.reject(new Error('boom'))} />
        </AsyncBoundary>
      </QueryClientProvider>,
    );

    // The two halves answer the same question — "what does the user see while this
    // is not ready?" — which is why they are one component: separating them is how
    // a screen ends up with a skeleton for loading and nothing at all for failure.
    expect(await screen.findByText("That didn't load")).toBeInTheDocument();
    expect(screen.queryByText('loading rows')).not.toBeInTheDocument();
  });

  it('passes a custom fallback straight through', async () => {
    render(
      <QueryClientProvider client={client()}>
        <AsyncBoundary
          pending={<p>loading rows</p>}
          fallback={({ error }) => <p>custom: {error.message}</p>}
        >
          <Answer queryFn={() => Promise.reject(new Error('boom'))} />
        </AsyncBoundary>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('custom: boom')).toBeInTheDocument();
  });

  it('makes "Try again" re-run the query rather than re-read its rejection', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const queryFn = vi.fn(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('four courses');
    });

    render(
      <QueryClientProvider client={client()}>
        <AsyncBoundary pending={<p>loading rows</p>}>
          <Answer queryFn={queryFn} />
        </AsyncBoundary>
      </QueryClientProvider>,
    );
    await screen.findByText("That didn't load");

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    // Two calls, and real data on screen. One call would mean the boundary cleared
    // its own state while the query cache kept serving the rejection.
    expect(await screen.findByText('four courses')).toBeInTheDocument();
    expect(queryFn).toHaveBeenCalledTimes(2);
  });
});
