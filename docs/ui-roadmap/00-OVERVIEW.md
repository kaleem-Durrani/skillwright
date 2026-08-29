# UI enhancement roadmap

What to build after the feature roadmap, in the order worth building it.

This is the plan of record for UI work the way `docs/roadmap/00-FEATURE-PLAN.md` is the plan of record for features. It was written after four parallel investigations of the codebase and the motion ecosystem; every claim below is traceable to a file, and the research that produced it is summarized in each phase's Evidence section.

---

## The findings that shaped this plan

**The dialogs are not broken in the way they look.** The "5fps" open/close is a stack of causes, not one: in dev, `@axe-core/react` re-audits the whole document after every commit with a 1000 ms debounce (`apps/web/src/main.tsx:38-56`), so opening a dialog fires a full-page accessibility scan **mid-animation** on the same main thread the spring needs; the overlay animates a `backdrop-blur-[2px]` filter (`apps/web/src/components/ui/Dialog.tsx:106`), which re-rasterizes the entire page every frame; the heaviest dialog bodies (~965 lines in `CourseFormDialog.tsx`) mount synchronously in the same commit that starts the animation; and the sheet uses a main-thread spring (`apps/web/src/lib/motion.ts:115`) that starves when any of the above stalls. Phase 1 measures first — production may already be smooth — then removes each cause.

**The motion library question answers itself.** `motion` v12.23.12 (resolving to 12.43.0) is already installed and correctly imported as `motion/react` — and framer-motion is **deprecated in favour of motion**; the upgrade guide's entire migration is the import swap this repo already did. There is nothing to migrate. What exists is a small, well-built `useMotionKit` abstraction worth systematizing, one dead `height: auto` variant, one `layout`-prop FLIP cost on Toast rows, and room for deliberate, tasteful expansion.

**The table problem is structural.** No table in the app is height-constrained anywhere — pages scroll, pagination floats after the list with only a `pt-2` separator, and the sticky-header pattern does not exist yet. Meanwhile `DataList` renders **every row twice** (a card `<ul>` and a `<table>`, both always in the DOM, switched by `display`), and five screens hand-roll their own actions column. A unified `DataTable` with a page-level "fill the remaining height" contract fixes the owner's ask — table and pagination always visible, table internally scrollable — and halves the DOM cost as a side effect.

**The header problem is a slot that doesn't exist.** Fifteen pages render `PageHeader` (title + description + actions) as the first block of main content; five auth pages hand-roll the same pattern; the top bar has no title slot at all — `ShellSearch` owns the desktop centre. Moving title/description/actions into the top bar (search to the right) is a shell restructure with a layout contract attached, and it is the prerequisite for tables that fill the viewport.

**The deferred features are smaller than remembered.** Much of what was deferred already shipped during the feature roadmap (sweeper, exports, audit forensics UI, search). What genuinely remains fits in one phase: the reinstate endpoint, three notification enum members, the MFA enrolment UI, presigned-PUT immutability, and upload progress. The permanently-cut list (grading, certificates, fourth role, AI, scheduling, analytics dashboards, ⌘K palette, i18n) stays cut.

---

## How the phases are shaped

```
Phase 1   Dialog performance        ← LANDED 2026-08-30, mostly negative: see below
Phase 2   Shell, header, spacing    ← the layout contract everything else needs
Phase 3   DataTable                 ← fills the contract Phase 2 creates
Phase 4   Motion systematized       ← after performance is proven, broaden deliberately
Phase 5   Deferred features         ← LANDED 2026-08-23, all five
```

**Phase 1's result changed what the plan knows.** It measured before it fixed, and the production build was already at **0 ms total blocking time and 0 long tasks** opening the three heaviest dialogs — so the "5fps" was dev-mode axe, StrictMode and unminified chunks, exactly as the first finding below guessed, and two of the four drafted fixes measured _worse_ than what they replaced and were dropped. The outcome table is in [01-DIALOG-PERFORMANCE.md](01-DIALOG-PERFORMANCE.md); the numbers are in [`docs/PROGRESS.md`](../PROGRESS.md).

The phase's real find was not a slow dialog: `manualChunks` was splitting `@tanstack/react-router` across two mutually-importing vendor chunks, so **the production bundle threw on every page** while every gate in the repository stayed green. Nothing in CI had ever loaded the artefact. It does now. Read that before starting Phase 2 — it is the reason the "verify against production builds" rule below is not boilerplate.

Phase 4 also inherits a small debt from Phase 1: five `MotionKit` members now have zero call sites (`variants.dialog`, `variants.sheetSide`, `variants.collapse`, `transitions.spring`, `transitions.normal`), and `Sheet` still has no backdrop blur where `Dialog` does — a real inconsistency, but a visual decision Phase 1 was barred from making.

Phases 1 and 5 touch disjoint files from 2–4 and can run in parallel. Phase 3 depends on Phase 2's layout contract. Phase 4 depends on Phase 1's measurements so polish is added to a proven-fast base.

**Rules every phase inherits** (from `docs/LESSONS-LEARNED.md` and the feature roadmap):

- **Measure before and after.** Every performance claim in Phase 1 and 4 is proven with a Playwright trace or `performance.mark` — "it feels faster" is not a fact this repository records.
- **Verify against production builds**, not `vite dev` — dev-mode axe, StrictMode double-mounts and unminified chunks are themselves findings, not the app.
- **Accessibility is not negotiable.** The repo claims axe-clean screens; animation and layout changes re-run axe, and `prefers-reduced-motion` behaviour is part of every phase's acceptance.
- **Mobile-first is enforced by a script** (ADR 0008) — `pnpm check:mobile-first` gates every phase.
- **A component that replaces five hand-rolled ones pays for itself only if all five adopt it.** Phase 3 is not done when `DataTable` exists; it is done when no DataList consumer remains.

---

## What this plan will not build

From `docs/rebuild/00-REBUILD-PLAN.md` §7, still in force: no grading engine, no certificates, no fourth role, no AI features, no scheduling engine, no equipment inventory, no analytics dashboards, no ⌘K command palette, no marketing page, no i18n. Realtime chat depth (B+1, ~70 h) remains the owner's explicit call and is recorded in Phase 5 as such, not smuggled in.
