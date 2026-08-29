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
 * Accessibility failures are reported in the browser console during development —
 * for developers who ask for it — not once a quarter in an audit. The import is
 * dynamic and DEV-gated so axe never reaches a production bundle.
 *
 * The auditor is opt-IN (`localStorage['sw.axe'] = 'on'`) because Phase 1 measured
 * it as the single largest source of dev-mode jank: axe re-audits the whole
 * document after every commit, so opening a dialog fires a full-page scan on the
 * main thread the animation is using, and no debounce fixes that — a scan lands
 * mid-interaction whenever the user pauses for its duration. The production build
 * has no such cost at all (0 ms total blocking time opening the three heaviest
 * dialogs; the numbers are in docs/PROGRESS.md), which is the whole reason the
 * "5fps dialog" was a dev-only artefact.
 *
 * Turning it off by default trades a per-render dev signal for an on-demand one,
 * so the standing gate moved into CI instead: e2e/dialog-perf.spec.ts runs axe
 * over every dialog surface in both themes, and that suite now runs on every push
 * (.github/workflows/ci.yml). Set the flag whenever you want the live console
 * feedback back; the debounce below is deliberately long so a scan waits out
 * animations and typing bursts rather than interrupting them.
 */
async function mountAxe() {
  if (!import.meta.env.DEV) return;
  try {
    // Reading storage can throw outright where site data is blocked, which is
    // why this sits inside the same try/catch as the import rather than above it.
    if (localStorage.getItem('sw.axe') !== 'on') return;
    const [{ default: axe }, React, ReactDOM] = await Promise.all([
      import('@axe-core/react'),
      import('react'),
      import('react-dom'),
    ]);
    await axe(React, ReactDOM, 5000);
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
