# Phase 4 — Motion, systematized

_Broaden animation deliberately, on a base Phase 1 proved fast._

**Goal:** one documented motion vocabulary, applied consistently and expanded where it earns its keep — with the bundle lever pulled and every addition measured against Phase 1's traces.

## Evidence

- **Nothing to migrate.** `motion` v12.23.12 (resolving to 12.43.0) is installed and imported as `motion/react` in 14 files. Framer Motion is deprecated in favour of motion; the official upgrade guide is the import swap this repo already did, and "there are no breaking changes in Motion for React in version 12" (motion.dev/docs/react-upgrade-guide). React 19 is an officially supported peer.
- The vocabulary already exists and is good: `useMotionKit` (`apps/web/src/lib/motion.ts`) centralizes variants (fade, rise, pop, sheet, toast), durations (80–340 ms), easings, and triple-layer reduced-motion handling (per-variant `:71-72`, `MotionConfig reducedMotion="user"` in `main.tsx:63`, global CSS kill-switch `globals.css:158-167`).
- **The bundle lever:** full `motion` is ~34 kb gzip and cannot tree-shake below it; `LazyMotion` + `m` with `domAnimation` drops the initial cost to ~4.6 kb + 15 kb (motion.dev/docs/react-reduce-size). The app uses no `layout`/drag/pan globally (Toast's `layout` is Phase 1's call), so `domAnimation` would suffice — but `layoutId` sliding indicators in Tabs/AppShell (`Tabs.tsx:142`, `AppShell.tsx:253,297`) require `domMax`. Measure, then choose.
- Dead code: the `collapse` variant animates `height: auto` (`lib/motion.ts:151-155`) and has **zero call sites** — delete it or give it a job.
- Current animation sites: Dialog/Sheet (Phase 1), Toast (+`layout`), DropdownMenu (enter-only, exit deliberately dropped `:13-20`), Select/Tooltip (`pop`), Tabs/AppShell `layoutId` indicators, Dashboard/DataList list staggers, `_public.tsx:44-51` route wrapper. There is **no route-transition system** — pages hard-cut.

## Tasks

1. **Document the vocabulary.** A short section in `lib/motion.ts`'s header (or a docs page): which variants exist, when each is allowed, durations/easings as the only sources of truth, and the rule — transform and opacity only, `height`/`top`/`layout` never in modals.
2. **LazyMotion decision.** Convert `MotionConfig`/`LazyMotion` with `strict` if the trace + bundle analysis justify it; if `layoutId` indicators force `domMax`, record the number and the decision either way. Not a dogma phase — a measured one.
3. **Route transitions, if they earn it.** The hard cut between pages is the largest missing motion. A minimal fade/slide on route change via the router's transition hooks — measured; skipped if it costs perceived speed on slow devices. This is the one place new motion is likely worth it; everything below is optional polish gated on the same test.
4. **Candidate polish, each gated on a trace and a purpose:** list stagger on DataTable adoption (Phase 3), sheet↔dialog consistency (Sheet inherits Phase 1's fixes), enter/exit symmetry for DropdownMenu (its dropped exit is documented but feels abrupt next to everything else).
5. **Guardrails:** `prefers-reduced-motion` behaviour re-verified per addition; axe re-run per touched screen; `pnpm check:mobile-first` green; screenshots' `animations: 'disabled'` still produces stable captures (the settle-wait, not animation fast-forward, protects spring-based captures — keep it true).

## Explicitly out of scope

Shared-layout transitions between routes (FLIP across pages), drag interactions, gesture-driven sheets, animation for its own sake.

**Est.** 6–10 h. **Depends on:** Phase 1 (measurements), touches Phase 3's component. **Blocks:** nothing.
