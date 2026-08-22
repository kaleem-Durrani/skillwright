import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import { createQueryClient } from './lib/query.js';
import { createAppRouter } from './router.js';
import { logger } from './lib/logger.js';
import './styles/globals.css';

/**
 * The two are mutually dependent for exactly one callback: the client needs to
 * re-run the router's guards when a request proves the session is gone, and the
 * router is built from the client. A closure breaks the cycle — it is created here
 * and called much later, by which time both bindings exist.
 */
const queryClient = createQueryClient(() => {
  // `invalidate()` re-runs `beforeLoad` for the current match, and `requireAuth`
  // has already been handed a null session — so the redirect is the guard's,
  // not a second opinion about where a dead session belongs.
  //
  // `router` is referenced above its own declaration on purpose: this closure can
  // only run from a failed request, which cannot happen before the line below.
  void router.invalidate();
});

const router = createAppRouter(queryClient);

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing from index.html');

/**
 * Accessibility failures are reported in the browser console during development,
 * on every render, for every developer — not once a quarter in an audit.
 *
 * The import is dynamic and DEV-gated so axe never reaches a production bundle.
 */
async function mountAxe() {
  if (!import.meta.env.DEV) return;
  try {
    const [{ default: axe }, React, ReactDOM] = await Promise.all([
      import('@axe-core/react'),
      import('react'),
      import('react-dom'),
    ]);
    // 1000ms debounce: axe re-scans on every commit, and a tighter window makes
    // typing in a form feel heavy.
    await axe(React, ReactDOM, 1000);
  } catch (error) {
    logger.warn('axe-core failed to start', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

void mountAxe();

createRoot(container).render(
  <StrictMode>
    {/* `reducedMotion="user"` is the belt to lib/motion.ts's braces: the kit
        removes transforms from every variant, and this stops any stray
        animation that did not go through it. */}
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MotionConfig>
  </StrictMode>,
);
