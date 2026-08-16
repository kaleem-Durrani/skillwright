import { useMemo } from 'react';
import { useReducedMotion, type Transition, type Variants } from 'motion/react';

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
  transitions: {
    fast: Transition;
    normal: Transition;
    slow: Transition;
    spring: Transition;
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
    /** Bottom sheet / mobile dialog. */
    sheetBottom: Variants;
    /** Side sheet from md up. */
    sheetSide: Variants;
    /** Centred dialog. */
    dialog: Variants;
    /** Toast entering from the bottom on mobile. */
    toast: Variants;
    /** Popover / dropdown surface. */
    pop: Variants;
    /** Collapsible region. */
    collapse: Variants;
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
      normal: t(DURATION.normal),
      slow: t(DURATION.slow),
      spring: reduced
        ? { duration: DURATION.instant }
        : { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 },
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
          transition: reduced ? t(DURATION.fast) : { type: 'spring', stiffness: 380, damping: 36 },
        },
        exit: {
          opacity: reduced ? 0 : 1,
          y: reduced ? 0 : '100%',
          transition: t(DURATION.fast, EASE.accelerate),
        },
      },
      sheetSide: {
        hidden: { opacity: reduced ? 0 : 1, x: reduced ? 0 : '100%' },
        visible: {
          opacity: 1,
          x: 0,
          transition: reduced ? t(DURATION.fast) : { type: 'spring', stiffness: 380, damping: 36 },
        },
        exit: {
          opacity: reduced ? 0 : 1,
          x: reduced ? 0 : '100%',
          transition: t(DURATION.fast, EASE.accelerate),
        },
      },
      dialog: {
        hidden: { opacity: 0, scale: scale(0.97), y: shift(8) },
        visible: { opacity: 1, scale: 1, y: 0, transition: t(DURATION.normal, EASE.decelerate) },
        exit: { opacity: 0, scale: scale(0.98), transition: t(DURATION.fast) },
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
      collapse: {
        hidden: { opacity: 0, height: 0 },
        visible: { opacity: 1, height: 'auto', transition: t(DURATION.normal) },
        exit: { opacity: 0, height: 0, transition: t(DURATION.fast) },
      },
    },
  };
}

/** Hook form of {@link createMotionKit}. This is the app's only animation entry point. */
export function useMotionKit(): MotionKit {
  const reduced = useReducedMotion() ?? false;
  return useMemo(() => createMotionKit(reduced), [reduced]);
}
