# Phase 3 — DataTable

_One table component, every screen, filling the space the page gives it._

**Goal:** a single `DataTable` component that fills its container's remaining height, scrolls internally with a sticky header, pins pagination to its footer, renders one DOM copy per row — and every tabular screen in the app uses it.

## Evidence

- **No table is height-constrained anywhere.** `DataList`'s wrapper is `scroll-x` only (`apps/web/src/components/ui/DataList.tsx:101`); pages scroll; pagination sits after the list with a bare `pt-2` as its only separator (`Pagination.tsx:58`). Reaching the last row of any register requires scrolling the page.
- **Every row renders twice.** `DataList` mounts a card `<ul class="md:hidden">` (`:76-98`) and a `hidden md:block` table (`:100-148`), switching with `display` — at `DEFAULT_PAGE_SIZE = 20` (`packages/shared/src/schema/pagination.ts:3`) that is ~40 row subtrees where 20 would do, doubled again where motion wrappers stagger them.
- **Five screens hand-roll an actions column** (AdminUsers `:218`, AdminCourses `:208`, AdminDepartments `:131`, CourseDetail roster `:621` / resources `:826`) against an otherwise shared contract.
- Bespoke lists outside `DataList`: Messages `:119`, Notifications `:283`, SearchResults `:122`, Dashboard cards.
- The sticky-header + internal-scroll pattern needs no dependency: a `flex-1 min-h-0` scroll wrapper and `sticky top-0` header cells are pure CSS. Virtualization (TanStack Virtual) is **not** warranted — data is server-paginated at 20 rows and the app uses neither TanStack Table nor Virtual today; revisit only if an unpaginated register appears.

## Tasks

1. **Design `DataTable` on `DataList`'s contract**, extended:
   - `columns` (`id/header/cell/align/width/secondary`), `rows`, `getKey`, `caption`, `loading`/`skeletonRows`, `empty`, `onRowClick` — unchanged, so the eight DataList screens migrate mechanically.
   - `actions?(row)` — the standard trailing column replacing five hand-rolled ones.
   - `pagination: { page, totalPages, total?, onPageChange }` — rendered in a pinned footer inside the component.
   - `fillHeight?: boolean` — `flex-1 min-h-0` scroll body, `sticky top-0` header, footer always visible. This is the owner's ask: the table and its pagination take exactly the available space, on every screen, at every height.
2. **Decide the mobile story honestly.** Either keep the card list for `< md` (single-render: render cards OR table by a media query, not both-in-DOM) or ship the table at all widths with horizontal scroll. Pick one, write the reasoning down, and delete the dual-DOM pattern — halving row DOM is a stated goal, not a side effect.
3. **Adopt everywhere tabular:** AdminUsers, AdminCourses, AdminDepartments, AdminOverview (audit feed), Courses, Announcements, CourseDetail roster + resources. Then evaluate Messages and Notifications lists for adoption (they are bespoke `<ul>`s; convert only if the table earns its complexity there).
4. **Delete `DataList`** once no consumer remains — the phase is done when the old component is gone, not when the new one exists.
5. **Verify per screen at 1440 px and 375 px:** table fills to the pagination row without page scroll; header sticks while scrolling internally; keyboard navigation through rows/actions intact; axe clean both themes; `check:mobile-first` green. Long-content cells (notes, user agents in the audit feed) wrap or truncate by column config — no horizontal page scroll.

## Outcome — landed 2026-08-30

`DataList` is deleted and every tabular screen renders `DataTable`. The phase ends when the old component is gone, and it is.

| Task                  | Outcome                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — the component     | **Done.** Same props, plus `actions`, `pagination`, `fillHeight` — and `actionsWidth`, added when the migration lost AdminCourses' 12rem actions column. |
| 2 — the mobile story  | **Cards below `md`, table from `md` up, ONE rendered.** `useMediaQuery` picks; the dual DOM is gone. That was ~40 row subtrees where 20 would do.        |
| 3 — adopt everywhere  | **Done.** AdminUsers, AdminCourses, AdminDepartments, AdminOverview, Courses, Announcements, CourseDetail (roster + resources), and the design gallery.  |
| 4 — delete `DataList` | **Done**, with its dangling `DataList.tsx:NN` citations swept out of seven other files.                                                                  |
| 5 — verify per screen | **Measured, not eyeballed** — see below.                                                                                                                 |

**`fillHeight` is inert unless every ancestor passes the height along, and that is the finding worth carrying forward.** It silently did nothing on the first migrated screen: `routes/_app/admin.tsx` was a plain `flex flex-col`, so the table had a bounded grandparent and an unbounded parent, sized to its content, overflowed `main` invisibly, and pushed the document to **2842px against a 900px viewport** with the pager three screens below the fold. Typecheck, lint and 394 unit tests were green over it. Nothing failed — it just did not work.

So the contract is a browser test, `apps/web/e2e/fill-height.spec.ts`, asserting numbers across all five screens that use it: the document does not scroll, the overflowing element is the table's own wrapper, the pagination's bottom edge is inside the viewport. Verified it fails when the chain is broken again — the two admin screens go red while the two that do not route through that layout stay green.

**`fillHeight` is deliberately off** on AdminOverview's audit feed and CourseDetail's two lists: they sit under stat tiles, a course header and tabs, and a list that fills the viewport under other primary content just hides it.

**One accessibility fix fell out.** `DataList`'s `<tr onClick>` was never keyboard-reachable — only its card `<button>` was — so on desktop the row-click affordance existed for a mouse and nothing else. `DataTable`'s rows are operable by Enter and Space.

**And one assertion got stronger.** AdminUsers' row-menu test used to find ALL triggers and click the first, because the dual DOM meant every menu existed twice under one accessible name. It now asserts exactly one, so the pattern returning is a failing test.

## Explicitly out of scope

Virtualization, column sorting/reordering UI, TanStack Table adoption, CSV export changes (Phase 8's exports already stream server-side).

**Est.** 12–16 h including migration of all screens. **Depends on:** Phase 2's layout contract. **Blocks:** nothing.
