# Phase 1 — Dialog performance

_The sharpest pain, the smallest diff. Measure first, then remove causes cheapest-first._

**Goal:** dialog open and close animate at full frame rate in production, and dev-mode is measurably better too, with the remaining dev-only cost attributed and documented.

## Evidence

- The overlay animates opacity **while carrying `backdrop-blur-[2px]`** on a `fixed inset-0` layer — the filter re-rasterizes the whole page every animation frame (`apps/web/src/components/ui/Dialog.tsx:106`). `Sheet.tsx:94` deliberately omits the blur; the two components disagree for no stated reason.
- The sheet card animates via a **main-thread spring** (`{ type: 'spring', stiffness: 380, damping: 36 }`, `apps/web/src/lib/motion.ts:115`). Springs run on Motion's rAF loop and freeze whenever the main thread stalls. A bezier tween of `transform`/`opacity` promotes cleanly to WAAPI and runs off the main thread.
- Dialog children render only while `open` (`Dialog.tsx:102`), so the **entire form tree commits in the same React commit that starts the enter animation**. Heaviest: `CourseFormDialog.tsx` (~965 lines), `ResourceFormDialog.tsx` (~750), `UserCreateDialog.tsx` (~340).
- In dev, `@axe-core/react` re-audits the whole document after every commit on a 1000 ms debounce (`apps/web/src/main.tsx:38-56`) — a dialog open triggers a full-page scan mid-animation — and `<StrictMode>` double-mounts the portal (`main.tsx:59`).
- Toast rows carry Motion's `layout` prop (`apps/web/src/components/ui/Toast.tsx:139`), forcing FLIP layout measurements on every stack shift. Unrelated to dialogs, but the same jank family.
- Verified non-issues, recorded so nobody re-litigates: Tailwind v4's `-translate-x-1/2` emits the standalone CSS `translate` property, which **composes** with Motion's inline `transform` (no clobbering); the AnimatePresence + Radix `forceMount` pattern is correct; `shadow-e4` paints into the card's own layer once, not per frame.

## Tasks

1. **Instrument.** `performance.mark` around dialog open/close plus a Playwright run with `trace: 'on'` against `vite build && vite preview`. Record baseline frame durations for the three heaviest dialogs in both dev and preview. This is the phase's control — every later number compares against it.
2. **Attribute dev vs prod.** If preview is already smooth, the "5fps" is a dev-only artifact of axe + StrictMode + unminified chunks; gate `@axe-core/react` harder (longer debounce, or dev-only manual trigger) and say so in the report. Do not skip the remaining steps — the blur and spring are real costs in prod too.
3. **Split the overlay.** Static blurred layer (no animation) beneath an animating plain scrim, so the blur rasterizes once instead of per frame; or drop the blur entirely if the trace shows it buying nothing visually. Pick one, A/B it, keep the winner, and make `Sheet` agree.
4. **Tween the sheet.** Replace the `sheetBottom`/`sheetSide` springs with a `transform`+`opacity` bezier tween (`DURATION.slow`, `EASE.decelerate`) so the animation leaves the main thread. Keep the spring in `useMotionKit` for callers that genuinely need it.
5. **Defer heavy bodies.** Mount dialog children after the enter animation completes (`onAnimationComplete`), with a skeleton for the gap, starting with `CourseFormDialog`. The dialog must still be usable immediately for light bodies — apply only above a size threshold.
6. **Drop `layout` from Toast rows** if traces show layout thrash on dismissal; a simple translate-out achieves the same look.
7. Re-run the trace. Record before/after numbers in `docs/PROGRESS.md`. Re-run axe on every dialog in both themes; confirm `prefers-reduced-motion` still zeroes the animations (`lib/motion.ts:71-72`, `MotionConfig reducedMotion="user"`).

## Outcome — landed 2026-08-30

**The measurement cancelled most of the phase.** Against the production preview build, opening the three heaviest dialogs already cost **0 ms total blocking time and 0 long tasks**, before any fix. The "5fps dialog" was dev-mode axe, StrictMode and unminified chunks; production was never slow. Numbers, harness and the before/after table are in [`docs/PROGRESS.md`](../PROGRESS.md).

| Task                         | Outcome                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — instrument               | **Done.** Playwright against `vite build && vite preview`, long-task observer plus rAF sampler, median of 5 per dialog. This is the phase's control.                                                                           |
| 2 — attribute dev vs prod    | **Done, and it was the answer.** Preview is smooth; the cost is dev-only. `@axe-core/react` is now opt-in (`localStorage['sw.axe'] = 'on'`) and its standing gate moved into CI.                                               |
| 3 — split the overlay        | **A/B'd, reverted.** The animated blur costs nothing measurable. The static blur layer popped in at full strength instead of fading with the scrim — a visible regression for no measured gain. Single animated overlay stays. |
| 4 — tween the sheet          | **Kept, for a different reason than the task gave.** Neither curve promotes to WAAPI (the gate is the value NAME, not the variant), so the tween buys determinism and token alignment, not off-main-thread animation.          |
| 5 — defer heavy bodies       | **Tried, measured worse, reverted.** Time-to-usable 110 ms → 910 ms, a 404→228 px collapse on light dialogs, and an `inert` footer that killed Cancel/Delete for ~340 ms. Pinned against return by `e2e/dialogs.spec.ts`.      |
| 6 — drop `layout` from Toast | **Gated on a trace; the trace said no.** Dismissing from a three-deep stack: zero long tasks, zero frames over 20 ms. `layout` stays.                                                                                          |
| 7 — re-run and record        | **Done.** Numbers in `docs/PROGRESS.md`; axe re-run over every dialog surface in both themes, now in CI; `prefers-reduced-motion` asserted to produce zero running animations and `transform: none`.                           |

**What the phase actually found.** Not a slow dialog — a **broken production bundle**. `manualChunks` classified `@tanstack/react-router` by the pnpm peer text in its path, split the package across two mutually-importing chunks, and the built SPA threw `Cannot read properties of undefined (reading 'createContext')` on every page while typecheck, lint, unit tests, `vite build` and `vite dev` all stayed green. Nothing in CI had ever loaded the artefact. That gate now exists (`e2e/build-smoke.spec.ts`, and the `e2e` job in `.github/workflows/ci.yml`), and it is the phase's most valuable output by a distance.

**Handed to Phase 4:** five `MotionKit` members now have zero call sites — `variants.dialog`, `variants.sheetSide`, `variants.collapse`, `transitions.spring`, `transitions.normal` (the last became dead when the inert `transition` prop was deleted). The dead-variant sweep is 04's task 1, not a Phase 1 edit. Also handed over: `Sheet` still has no backdrop blur where `Dialog` does — a real inconsistency, but a visual decision, and this phase is explicitly barred from those.

## Explicitly out of scope

Page transitions, new animation sites, LazyMotion (Phase 4's call), any visual redesign of the dialogs.

**Est.** 4–6 h including measurement. **Depends on:** nothing.
