import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query from React.
 *
 * This exists so a component can render ONE of two things rather than both.
 * Tailwind can hide the loser with `display`, and for markup that is usually the
 * right trade — but not when both copies are real DOM. The list component this
 * app replaced rendered every row twice, once as cards and once as table rows, and
 * paid for 40 subtrees where 20 would do. Anything that would otherwise duplicate
 * a subtree should ask here instead.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: the effect version
 * renders once with the wrong answer and then corrects itself, which is a visible
 * flash for anything that moves between two places on screen.
 */

const MOBILE_FIRST_DEFAULT = false;

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => undefined;
      }
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    /*
     * `matchMedia` is absent in jsdom unless a test stubs it, and answering
     * "false" there is deliberate: false is the BASE viewport, and this app is
     * mobile-first by constraint (ADR 0008). A component that guesses wrong in a
     * test should guess the layout the rule says is primary, not the enhancement.
     */
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return MOBILE_FIRST_DEFAULT;
    }
    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => MOBILE_FIRST_DEFAULT);
}

/**
 * The `md` breakpoint, as a query.
 *
 * Kept next to the hook and not inlined at call sites, because it has to agree
 * with Tailwind's `md:` — 48rem — and two places writing `(min-width: 48rem)`
 * from memory is how they drift. If the theme's breakpoint moves, this moves.
 */
export const MD_UP = '(min-width: 48rem)';

/** True from Tailwind's `md` breakpoint up. */
export function useIsDesktop(): boolean {
  return useMediaQuery(MD_UP);
}
