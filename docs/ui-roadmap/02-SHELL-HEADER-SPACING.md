# Phase 2 — Shell, header, and spacing

_The layout contract everything else needs: title in the top bar, search on the right, padding with a rule, and pages that bound their content's height._

**Goal:** every screen's title, description and primary actions live in the shell's top bar; `ShellSearch` sits on the right; page padding follows one scale; and every page's content region is a bounded flex column that later phases can fill.

## Evidence

- The top bar (`apps/web/src/components/layout/AppShell.tsx:123-178`) renders brand → workspace chip → demo badge → `ShellSearch` (centred, `flex-1` from md) → spacer → bell → theme toggle → account menu. **There is no title slot**; a title would fight the centred search for the same row.
- Fifteen pages open with `PageHeader` (title `text-2xl md:text-3xl`, description, actions) as the first block of main content; five auth pages hand-roll the identical pattern (`Login.tsx:70`, `Register.tsx:113`, `ForgotPassword.tsx:49`, `ResetPassword.tsx:67`, `VerifyEmail.tsx:129`), and `Design.tsx` rolls its own top bar.
- Spacing is per-element improvisation: page roots carry no gap class; rhythm comes from `PageHeader`'s `pb-5 md:pb-6`, filter bars' `gap-3 pb-5`, Dashboard sections' `pt-8`, detail metas' `pb-6`–`pb-8`. The gutters and card padding are tokenized (`tokens.css:502-559`) but the vertical rhythm between them is not.
- Main content is `gutter-safe pt-4 md:pt-6` with a `.wide` (80rem) wrapper (`AppShell.tsx:82-87`, `globals.css:189`) — **nothing bounds its height**, which is why no table in the app can fill the viewport (Phase 3's blocker).

## Tasks

1. **Design the context-aware top bar.** A title slot between the workspace chip and the search area: route-driven (each route declares title/description/actions — TanStack Router's `staticData` or a context the page sets), truncated gracefully, description hidden below `lg`. Decide and document how detail pages (course name, resource title) feed it. `PageHeader`'s actions move into the bar; its title/description become the bar's content.
2. **Move `ShellSearch` right.** Search becomes a fixed-width control at the row's end (before bell), no longer owning the centre. Keep the below-md icon-button entry unchanged. Keyboard focus order and `role="search"` semantics preserved.
3. **Slim `PageHeader` to what remains.** Detail pages keep an eyebrow/breadcrumb use case; auth pages adopt the shared component instead of hand-rolling. Delete dead markup rather than leaving a second path.
4. **One spacing scale.** Tokenize the vertical rhythm (e.g. `--space-section` for between-sections, `--space-block` for header-to-content) and sweep the ad-hoc `pt-8`/`pb-5`/`gap-8` values onto it. The census to normalize: filter bars `gap-3 pb-5` (five screens), Dashboard `pt-8` sections, SearchResults `gap-8`, detail metas `pb-6`–`pb-8`. Tighten the overall padding the owner called excessive — the `.wide` wrapper and `gutter-safe` stay; the doubled vertical padding goes.
5. **The layout contract.** Main content becomes `flex flex-col` with a documented rule: a page declares `h-[calc(100dvh-topbar)]`-style bounded height (or flex-1 within it), and content regions that scroll do so **internally**. This is the contract Phase 3's `fillHeight` builds on — write it into a comment in `AppShell.tsx` and follow it on every converted page.
6. Convert all fifteen `PageHeader` pages + five auth pages. Re-run `check:mobile-first`, axe on every converted screen in both themes, and eyeball 375 px: the top bar must not truncate titles into uselessness on phones — if it does, the mobile answer is the existing PageHeader pattern kept below `md`, and that decision gets written down.

## Explicitly out of scope

DataTable (Phase 3), any colour/typography redesign, navigation restructuring (the five-target bottom bar rule stands).

**Est.** 10–14 h. **Depends on:** nothing. **Blocks:** Phase 3.
