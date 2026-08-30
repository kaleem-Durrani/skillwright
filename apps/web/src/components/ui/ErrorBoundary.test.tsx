/**
 * The last line of defence, and the one component whose failure mode is a WHITE
 * SCREEN — the single most expensive thing this SPA can show, and the one no
 * other test can observe, because every other test renders a component that works.
 *
 * What is pinned here:
 *
 * - An `ApiError` thrown during render is rendered as its user-facing copy, with
 *   the request id beside it. LESSONS-LEARNED #25 is the reason: the client maps
 *   CODE to copy, and a boundary that fell back to `error.message` would print a
 *   policy rule tag (`TEACHER:ownsCourse`) or a stack-trace fragment at a user.
 * - `resetKeys` clearing the boundary. Without it, navigating away from a screen
 *   that threw leaves the boundary latched and the NEXT screen shows the previous
 *   screen's error — which reads as the whole app being broken.
 * - `onReset` firing before the state clears, because that is the wire to
 *   `QueryErrorResetBoundary`: without it "Try again" re-renders the same rejected
 *   promise and the button appears to do nothing.
 */
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/lib/problem';
import { ErrorBoundary } from './ErrorBoundary.js';

const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: loggerError },
}));

/** Throws on the first render and behaves on request. */
function Boom({ error, throwNow = true }: { error: Error; throwNow?: boolean }) {
  if (throwNow) throw error;
  return <p>recovered</p>;
}

function apiError(status: number, code: 'FORBIDDEN' | 'NOT_FOUND'): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: code,
    status,
    code,
    detail: `Not yours. (rule: TEACHER:ownsCourse)`,
    requestId: 'req-boundary',
  });
}

beforeEach(() => {
  loggerError.mockReset();
  /*
   * React writes its own "The above error occurred in..." report straight to
   * console.error for every caught error, and there is no supported way to turn
   * that off. Silencing it here keeps a PASSING run readable; it is restored
   * after each test so a genuine console.error elsewhere is still visible.
   */
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the default fallback', () => {
  it('renders a plain error as copy nobody has to decode', () => {
    render(
      <ErrorBoundary>
        <Boom error={new Error('Cannot read properties of undefined')} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("That didn't load")).toBeInTheDocument();
    // The thrown message is a developer's sentence. It must not be the headline.
    expect(screen.queryByText(/Cannot read properties/)).not.toBeInTheDocument();
  });

  it('renders an ApiError as its code-mapped copy, never its detail', () => {
    render(
      <ErrorBoundary>
        <Boom error={apiError(404, 'NOT_FOUND')} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("We couldn't find that.")).toBeInTheDocument();
    // `detail` carries rule tags — diagnostics written for a log, not for a user.
    expect(screen.queryByText(/TEACHER:ownsCourse/)).not.toBeInTheDocument();
  });

  it('adds a sentence a user can act on for a 403', () => {
    render(
      <ErrorBoundary>
        <Boom error={apiError(403, 'FORBIDDEN')} />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/ask an administrator/)).toBeInTheDocument();
  });

  it('surfaces the request id so a support message can quote it', () => {
    render(
      <ErrorBoundary>
        <Boom error={apiError(403, 'FORBIDDEN')} />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/req-boundary/)).toBeInTheDocument();
  });
});

describe('logging', () => {
  it('reports through the logger, with the fields that identify the request', () => {
    render(
      <ErrorBoundary>
        <Boom error={apiError(403, 'FORBIDDEN')} />
      </ErrorBoundary>,
    );

    expect(loggerError).toHaveBeenCalledTimes(1);
    const [message, context] = loggerError.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toBe('render boundary caught');
    // The request id and code are what make a user's screenshot joinable to a
    // server log line; without them the report is "it broke".
    expect(context).toMatchObject({ requestId: 'req-boundary', code: 'FORBIDDEN' });
    expect(context.componentStack).toBeTruthy();
  });

  it('logs a non-ApiError without inventing an id for it', () => {
    render(
      <ErrorBoundary>
        <Boom error={new Error('boom')} />
      </ErrorBoundary>,
    );

    const [, context] = loggerError.mock.calls[0] as [string, Record<string, unknown>];
    expect(context.message).toBe('boom');
    expect('requestId' in context).toBe(false);
  });
});

describe('recovering', () => {
  it('calls onReset before clearing, which is what re-runs the query', async () => {
    const onReset = vi.fn();
    const user = userEvent.setup();

    function Screen() {
      const [broken, setBroken] = useState(true);
      return (
        <ErrorBoundary
          onReset={() => {
            onReset();
            setBroken(false);
          }}
        >
          <Boom error={new Error('boom')} throwNow={broken} />
        </ErrorBoundary>
      );
    }

    render(<Screen />);
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    // Ordering matters: the reset has to reach QueryErrorResetBoundary before the
    // children re-render, or they re-read the same rejected promise and the button
    // looks inert.
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('recovered')).toBeInTheDocument();
  });

  it('clears itself when a reset key changes', () => {
    const view = render(
      <ErrorBoundary resetKeys={['/courses/a']}>
        <Boom error={new Error('boom')} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("That didn't load")).toBeInTheDocument();

    // The route path changed: the user navigated away from the broken screen.
    view.rerender(
      <ErrorBoundary resetKeys={['/courses/b']}>
        <Boom error={new Error('boom')} throwNow={false} />
      </ErrorBoundary>,
    );

    // A latched boundary would show the previous screen's error on the new screen,
    // and there would be nothing on the new screen to clear it.
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('stays latched while the keys are unchanged', () => {
    const view = render(
      <ErrorBoundary resetKeys={['/courses/a']}>
        <Boom error={new Error('boom')} />
      </ErrorBoundary>,
    );

    view.rerender(
      <ErrorBoundary resetKeys={['/courses/a']}>
        <Boom error={new Error('boom')} throwNow={false} />
      </ErrorBoundary>,
    );

    // Re-rendering is not recovering. Clearing on every update would put a screen
    // that throws on mount into an infinite throw/reset loop.
    expect(screen.getByText("That didn't load")).toBeInTheDocument();
  });

  it('notices a key list that changed length', () => {
    const view = render(
      <ErrorBoundary resetKeys={['/courses/a']}>
        <Boom error={new Error('boom')} />
      </ErrorBoundary>,
    );

    view.rerender(
      <ErrorBoundary resetKeys={['/courses/a', 'tab=resources']}>
        <Boom error={new Error('boom')} throwNow={false} />
      </ErrorBoundary>,
    );

    // An index-wise comparison alone would miss an appended key, because every
    // index it checks still matches.
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('notices a key list that shrank, even though every remaining index still matches', () => {
    // The mirror image of the test above, and the one the length check actually
    // exists for: `.some()` walks the NEW array's own length, so dropping a
    // trailing key leaves every index it still checks equal to what it was.
    // Without the length comparison a navigation from a tabbed subview
    // (`['/courses/a', 'tab=resources']`) back to the plain route
    // (`['/courses/a']`) would leave the boundary latched on the old screen's
    // error.
    const view = render(
      <ErrorBoundary resetKeys={['/courses/a', 'tab=resources']}>
        <Boom error={new Error('boom')} />
      </ErrorBoundary>,
    );

    view.rerender(
      <ErrorBoundary resetKeys={['/courses/a']}>
        <Boom error={new Error('boom')} throwNow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('recovered')).toBeInTheDocument();
  });
});

describe('a custom fallback', () => {
  it('receives the error and a working reset', async () => {
    const user = userEvent.setup();

    function Screen() {
      const [broken, setBroken] = useState(true);
      return (
        <ErrorBoundary
          fallback={({ error, reset }) => (
            <div>
              <p>custom: {error.message}</p>
              <button
                type="button"
                onClick={() => {
                  setBroken(false);
                  reset();
                }}
              >
                Retry here
              </button>
            </div>
          )}
        >
          <Boom error={new Error('boom')} throwNow={broken} />
        </ErrorBoundary>
      );
    }

    render(<Screen />);
    expect(screen.getByText('custom: boom')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry here' }));

    expect(await screen.findByText('recovered')).toBeInTheDocument();
  });
});
