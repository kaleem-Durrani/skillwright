import { useMemo } from 'react';
import { useReducedMotion, type Transition, type Variants } from 'motion/react';

/**
 * THE MOTION VOCABULARY. Every animation in this app comes from here.
 *
 * Seven variants and one transition, which is the whole language. If a screen
 * needs something that is not in this list, the question is whether the list is
 * missing a word — not whether that screen can define its own, because a
 * vocabulary with private extensions is not one.
 *
 *   fade         opacity only; the safe default for anything that must not shift layout
 *   riseIn       enters from below; cards, list items, page bodies
 *   stagger      a parent that sequences its children's riseIn
 *   staggerItem  the child half of stagger
 *   sheetBottom  every overlay card — dialogs and sheets, at every breakpoint
 *   toast        enters from the bottom of the stack
 *   pop          popover and dropdown surfaces
 *
 *   transitions.fast   the only one, and only for the three layoutId indicators
 *
 * THE RULES:
 *
 * 1. TRANSFORM AND OPACITY ONLY. Never `height`, `top`, or `layout` inside a
 *    modal. Everything else forces layout on a frame the user is watching.
 * 2. A variant carries its own transition. Passing `transition` alongside one is
 *    writing a value nothing reads — a resolved variant's transition shadows the
 *    prop entirely, and merges only under `inherit: true`. That mistake shipped:
 *    Dialog and Sheet both advertised 220 ms next to a variant running 340 ms.
 * 3. Reduced motion is handled in three layers, and all three are deliberate:
 *    per-variant here (the transform drops, the opacity stays — "reduced" does
 *    not mean "no feedback"), `MotionConfig reducedMotion="user"` in main.tsx as
 *    the belt to these braces, and a global CSS kill-switch in globals.css for
 *    anything that never went through this file.
 * 4. New motion is added with a measurement, not an opinion. Phase 1 built two
 *    dialog animations that measured worse than what they replaced and were
 *    reverted; the numbers are in docs/PROGRESS.md.
 *
 * WHY NOT LazyMotion — measured on 2026-08-30, and the answer is the opposite of
 * the assumption. Bundling the exact imports this app uses, minified and gzipped:
 *
 *   motion (full)                  42,793 B
 *   LazyMotion + m + domMax        42,947 B   <- 154 B LARGER
 *   LazyMotion + m + domAnimation  29,229 B
 *
 * The 13.5 kB is real but it is not available: `domAnimation` excludes layout
 * animations, and the three sliding indicators (Tabs, and the sidebar and tab-bar
 * markers in AppShell) are `layoutId`, which needs `domMax`. So the version this
 * app could actually adopt costs slightly more than doing nothing, on top of
 * rewriting every `motion.*` to `m.*` across fourteen files. The saving is
 * purchasable only by giving up the sliding indicators — a UX trade, not a free
 * win, and not one this phase is taking. Re-measure before revisiting: the
 * scratch entries are three imports and an esbuild call.
 */

/**
 * Durations mirrored from tokens.css. They are duplicated here because a Motion
 * animation is JavaScript: the CSS `prefers-reduced-motion` block cannot reach
 * it, and reading a custom property per animation would cost a layout read.
 * If you change one, change both.
 */
export const DURATION = {
  instant: 0.08,
  fast: 0.14,
  normal: 0.22,
  slow: 0.34,
} as const;

/** Cubic-bezier control points, mirrored from the --ease-* tokens. */
export type Bezier = [number, number, number, number];

export const EASE: Record<'standard' | 'decelerate' | 'accelerate', Bezier> = {
  standard: [0.2, 0, 0, 1],
  decelerate: [0, 0, 0, 1],
  accelerate: [0.3, 0, 1, 1],
};

export interface MotionKit {
  /** True when the OS asked us to stop moving things. */
  reduced: boolean;
  /**
   * The only transition still reachable from a call site.
   *
   * `normal`, `slow` and `spring` were removed rather than kept "for later": every
   * variant below declares its own transition, and a resolved variant's transition
   * SHADOWS the `transition` prop entirely — it is consulted only as a default, and
   * merged only under `inherit: true`. So a caller passing one of these alongside a
   * variant was writing a value nothing would read, which is exactly what
   * Dialog and Sheet were doing: `transition={transitions.normal}` advertising
   * 220 ms next to a variant running 340 ms.
   *
   * `fast` survives because the three `layoutId` indicators (Tabs, and the sidebar
   * and tab-bar markers in AppShell) animate WITHOUT variants, so the prop is the
   * only thing that can carry their timing.
   */
  transitions: {
    fast: Transition;
  };
  variants: {
    /** Opacity only. The safe default for anything that must not shift layout. */
    fade: Variants;
    /** Enters from below — used for cards, list items, page bodies. */
    riseIn: Variants;
    /** A parent that staggers its children's `riseIn`. */
    stagger: Variants;
    /** The child half of `stagger`. */
    staggerItem: Variants;
    /** Every overlay's card: dialogs and sheets, at every breakpoint. */
    sheetBottom: Variants;
    /** Toast entering from the bottom on mobile. */
    toast: Variants;
    /** Popover / dropdown surface. */
    pop: Variants;
  };
}

/**
 * Build the animation vocabulary for the current reduced-motion preference.
 *
 * WHY every animation must route through here: "reduced motion" does not mean
 * "no feedback". Each variant below keeps its opacity change and drops only the
 * transform, so the interface still confirms that something happened — a page
 * that simply snaps is a regression for the users this setting exists to help.
 */
export function createMotionKit(reduced: boolean): MotionKit {
  const t = (duration: number, ease: Bezier = EASE.standard): Transition =>
    reduced ? { duration: DURATION.instant, ease: 'linear' } : { duration, ease };

  const shift = (px: number) => (reduced ? 0 : px);
  const scale = (value: number) => (reduced ? 1 : value);

  return {
    reduced,
    transitions: {
      fast: t(DURATION.fast),
    },
    variants: {
      fade: {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: t(DURATION.normal) },
        exit: { opacity: 0, transition: t(DURATION.fast) },
      },
      riseIn: {
        hidden: { opacity: 0, y: shift(8) },
        visible: { opacity: 1, y: 0, transition: t(DURATION.normal, EASE.decelerate) },
        exit: { opacity: 0, y: shift(-4), transition: t(DURATION.fast) },
      },
      stagger: {
        hidden: {},
        visible: {
          transition: {
            staggerChildren: reduced ? 0 : 0.035,
            delayChildren: reduced ? 0 : 0.02,
          },
        },
        exit: {},
      },
      staggerItem: {
        hidden: { opacity: 0, y: shift(10) },
        visible: { opacity: 1, y: 0, transition: t(DURATION.normal, EASE.decelerate) },
        exit: { opacity: 0, transition: t(DURATION.fast) },
      },
      sheetBottom: {
        hidden: { opacity: reduced ? 0 : 1, y: reduced ? 0 : '100%' },
        visible: {
          opacity: 1,
          y: 0,
          /*
           * A bezier tween, per Phase 1's task 4 — but NOT for the reason that
           * task gave. It assumed a tween "promotes cleanly to WAAPI and runs off
           * the main thread"; it does not, and neither did the spring it replaced.
           * Motion accelerates a value only when its NAME is in motion-dom's
           * `acceleratedValues` — opacity, clipPath, filter, transform,
           * backgroundColor (`supportsBrowserAnimation`, motion-dom 12.43). This
           * card animates `y`, a transform SUB-value that Motion composes into
           * `transform` itself, so it stays on the rAF loop either way and
           * `document.getAnimations()` never lists it. (The sibling scrim's
           * `opacity` fade IS accelerated — same variants, different value name,
           * which is what proves the gate is the name and not the variant.) Only
           * a whole-`transform` string keyframe would move this off the main
           * thread, and that is a Phase 4 experiment, not a Phase 1 claim.
           *
           * What the tween is actually worth, then: a deterministic DURATION.slow
           * length instead of a spring's rest-detected tail, and timing that comes
           * from the same tokens as everything else. Phase 1 measured the open at
           * 0 ms total blocking time in the production build with EITHER curve
           * (docs/PROGRESS.md), so this is a consistency change, not a fix.
           *
           * The spring this replaced is gone rather than kept for a caller who
           * might want it: it had no call site, and a vocabulary entry nobody uses
           * is a suggestion the next person has to evaluate. Motion's own spring
           * is one object literal away if a case ever argues for it.
           */
          transition: reduced
            ? t(DURATION.fast)
            : { duration: DURATION.slow, ease: EASE.decelerate },
        },
        exit: {
          opacity: reduced ? 0 : 1,
          y: reduced ? 0 : '100%',
          transition: t(DURATION.fast, EASE.accelerate),
        },
      },
      toast: {
        hidden: { opacity: 0, y: shift(24), scale: scale(0.98) },
        visible: { opacity: 1, y: 0, scale: 1, transition: t(DURATION.normal, EASE.decelerate) },
        exit: { opacity: 0, y: shift(12), transition: t(DURATION.fast) },
      },
      pop: {
        hidden: { opacity: 0, scale: scale(0.96), y: shift(-4) },
        visible: { opacity: 1, scale: 1, y: 0, transition: t(DURATION.fast, EASE.decelerate) },
        exit: { opacity: 0, scale: scale(0.98), transition: t(DURATION.instant) },
      },
    },
  };
}

/** Hook form of {@link createMotionKit}. This is the app's only animation entry point. */
export function useMotionKit(): MotionKit {
  const reduced = useReducedMotion() ?? false;
  return useMemo(() => createMotionKit(reduced), [reduced]);
}
