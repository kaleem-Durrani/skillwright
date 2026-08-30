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

## Outcome — landed 2026-08-30

Every screen's title, description and actions moved into the shell's top bar, and `main` became a bounded flex column from `md` up. That second half is the point: nothing on a page had a height before, which is why no table could fill the viewport, and why this phase blocks Phase 3.

| Task                      | Outcome                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — context-aware top bar | **Done, via a portal rather than route metadata.** `staticData` can carry a constant title; half these screens have none — the course detail's title is the course's name, the dashboard greets by first name, three render a breadcrumb with live links. A store written from an effect paints the bar wrong and corrects it a frame later. |
| 2 — search moves right    | **Done.** Fixed width at the row's end. It was `flex-1` in the centre, and two elastic children in one row means neither can give way — that was the actual reason there was nowhere to put a title.                                                                                                                                         |
| 3 — slim `PageHeader`     | **Done differently.** It became the component that decides WHERE a header renders, not a smaller one. That kept all fifteen call sites untouched. The five auth screens adopted it, deleting a sixth copy of the same two elements.                                                                                                          |
| 4 — one spacing scale     | **Done.** `--space-block` and `--space-section`; 20 improvised values across 11 pages swept onto them, including the five identical filter bars and the 1.5rem values that sat between the app's two real rhythms.                                                                                                                           |
| 5 — the layout contract   | **Done and written into `AppShell.tsx`.** A page hands a child `flex-1 min-h-0` and it claims the rest, scrolling internally. Note what Phase 3 then discovered: every route wrapper between `main` and the page has to pass it along too.                                                                                                   |
| 6 — convert every screen  | **Done.** Fifteen `PageHeader` pages and five auth pages.                                                                                                                                                                                                                                                                                    |

**Two things the plan asked for that measuring rejected.** The description was to sit under the title from `lg` up; at 1280px with one action button the bar rendered "One identity table. Role is a column, and suspension destroys sessio…", so it stays with the content where there is a measure to read it at. And the four admin screens set `eyebrow="Admin workspace"` two inches from the bar's own _Admin workspace_ badge.

**The mobile answer, taken as the plan predicted.** Below `md` the header renders in the page exactly as before — the bar at 375px already holds a brand, a badge, a search button, a bell, a theme toggle and an avatar. One of the two renders, chosen by `useMediaQuery`, never both hidden by CSS.

**New gate:** `apps/web/e2e/pages-a11y.spec.ts`. This moved every `<h1>` out of `<main>` and into the `banner` landmark — the edit that produces `heading-order` or a page with no level-one heading — and `dialogs.spec.ts` only ever scoped its run to an open overlay. Five screens, both themes, clean.

## Explicitly out of scope

DataTable (Phase 3), any colour/typography redesign, navigation restructuring (the five-target bottom bar rule stands).

**Est.** 10–14 h. **Depends on:** nothing. **Blocks:** Phase 3.
