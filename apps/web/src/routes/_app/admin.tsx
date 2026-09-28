import { createRoute, Link, Outlet } from '@tanstack/react-router';
import { cn } from '@/lib/cn';
import { requireRole } from '@/lib/guards';
import { Route as appLayout } from '../_app.js';

/**
 * The admin area is a nested layout with ONE extra guard — not a separate shell,
 * not a separate design language, not a separate URL vocabulary.
 *
 * The role is checked against the session here and against `can()` on the server
 * for every request. `/admin` in the address bar grants nothing.
 */
export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/admin',
  beforeLoad: requireRole('ADMIN'),
  component: AdminLayout,
});

/**
 * The console's sub-navigation: one row of tabs under the shell header, one entry
 * per child route. It is LINKS, not Radix Tabs — each tab is a real URL with its
 * own search params and history entry, so deep links, back/forward and screen-reader
 * page semantics all behave like navigation rather than an in-page widget.
 *
 * No per-tab action gate here, deliberately. The whole area is already ADMIN-only
 * via `requireRole`, and every tab's contents gate their own actions through
 * `can()`; a nav entry may only be gated on subject-independent actions anyway,
 * which is a constraint these four destinations do not need to spend.
 */
const TABS = [
  // `exact` on Overview only: '/admin' is a PREFIX of every other tab's path, so
  // without it the first tab would read as current on all four screens.
  { to: '/admin', label: 'Overview', exact: true },
  { to: '/admin/users', label: 'Users', exact: false },
  { to: '/admin/departments', label: 'Departments', exact: false },
  { to: '/admin/courses', label: 'Courses', exact: false },
] as const;

function AdminLayout() {
  return (
    /*
     * A LAYOUT ROUTE HAS TO PASS THE HEIGHT ALONG, or the contract stops here.
     *
     * AppShell bounds `main` from `md` up and a page claims what is left with
     * `flex-1 min-h-0`. Every route between the two has to do the same, and this one
     * did not: with a plain `flex flex-col` the four admin screens had a bounded
     * grandparent and an unbounded parent, so `AdminUsers`' table computed its height
     * from its content, overflowed `main` visibly, and pushed the document to 2842px
     * against a 900px viewport — pagination three screens below the fold, which is
     * the exact symptom this phase exists to remove.
     *
     * The nav stays `shrink-0` so the tabs keep their size and the Outlet absorbs
     * the remainder.
     *
     * `main` is the shell's scroll container from `md` up, so the document no
     * longer scrolls to absorb a broken chain — a missing link now shows up as the
     * screen scrolling with the pager at the bottom of it, not as a 2842px page.
     * Same failure, much closer to the cause, and still red in
     * `e2e/fill-height.spec.ts`.
     */
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label="Admin sections" className="shrink-0">
        <ul className="scroll-x -mx-[var(--shell-gutter)] flex min-w-full items-center gap-1 border-b border-line-subtle px-[var(--shell-gutter)] md:mx-0 md:min-w-0 md:px-0">
          {TABS.map((tab) => (
            <li key={tab.to}>
              <Link
                to={tab.to}
                {...(tab.exact ? { activeOptions: { exact: true } } : {})}
                activeProps={{ 'aria-current': 'page' as const }}
                className={cn(
                  'relative flex shrink-0 items-center gap-2 px-3 pb-2.5 pt-2 text-sm font-medium whitespace-nowrap',
                  'text-fg-secondary transition-colors duration-[var(--duration-fast)] outline-none',
                  'hover:text-fg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus',
                  'aria-[current=page]:text-fg after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full',
                  'after:bg-transparent aria-[current=page]:after:bg-brand',
                )}
              >
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/*
       * The tabs sit above the pages' own headers, which carry the eyebrow + title.
       *
       * `pt-4 md:pt-0`, not a flat `pt-5`. `main` already applies the shell's top
       * inset (`pt-6` at `md`, `pt-4` below it), so the `pt-5` that used to sit
       * here was a second, larger inset on the four admin screens and on nothing
       * else — they started 20px lower than every other page for no structural
       * reason. From `md` the title is in the top bar and this tab rail is the
       * last thing above the content, so the bar's own bottom border is the
       * divider and any inset here reads as slack. Below `md` the title is back in
       * the page, the rail and the header genuinely stack, and a 16px gap is what
       * keeps them from reading as one block.
       */}
      <div className="flex min-h-0 flex-1 flex-col pt-4 md:pt-0">
        <Outlet />
      </div>
    </div>
  );
}
