import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useIsDesktop } from '@/lib/media';
import { usePageSlot } from './page-slot';

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Primary + secondary actions. They stack full-width below md. */
  actions?: ReactNode;
  /** Breadcrumb or back link. Stays with the content, never moves to the top bar. */
  eyebrow?: ReactNode;
  className?: string;
}

/**
 * A screen's title, description and primary actions — rendered in one of two
 * places, never both.
 *
 * From `md` up, inside the app shell, the title and actions are portalled into
 * the top bar. That is what lets a page bound its own height: with the header out
 * of the scrolling column, `main` becomes a flex column whose child can claim the
 * remaining space, and a table can fill the viewport instead of running past the
 * bottom of it. See the layout contract in `AppShell.tsx`.
 *
 * Below `md`, and on the unauthenticated screens where there is no shell at all,
 * it renders exactly where it is written. The top bar at 375px already holds a
 * brand, a badge, a search button, a bell, a theme toggle and an avatar; a title
 * competing for that row would be truncated into uselessness, and the roadmap
 * named that outcome in advance as the reason to keep the in-page pattern below
 * `md`. This is that decision, taken.
 *
 * ONE of the two renders, chosen by `useMediaQuery`, not both hidden by CSS. The
 * dual-DOM pattern this codebase removed from its list component — every row
 * present twice, switched by `display` — is what it is trying to stop doing, and duplicating
 * a header's action buttons would duplicate their event handlers and their
 * `aria-controls` targets with them.
 *
 * The EYEBROW never moves. Three screens use it for a breadcrumb with live links,
 * which is contextual navigation for the content below it rather than a label for
 * the workspace; hoisting it into a bar that already names the workspace would
 * say the same thing twice and drop the link.
 */
export function PageHeader({ title, description, actions, eyebrow, className }: PageHeaderProps) {
  const slot = usePageSlot();
  const isDesktop = useIsDesktop();
  const hoisted = isDesktop && slot !== null;

  if (hoisted) {
    return (
      <>
        {eyebrow || description ? (
          <div className={cn('flex flex-col gap-1 pb-(--space-block)', className)}>
            {eyebrow ? <div className="text-xs text-fg-tertiary">{eyebrow}</div> : null}
            {description ? (
              <p className="measure text-sm text-fg-secondary">{description}</p>
            ) : null}
          </div>
        ) : null}
        {createPortal(<TopBarHeading title={title} actions={actions} />, slot)}
      </>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3 pb-(--space-block)', className)}>
      {eyebrow ? <div className="text-xs text-fg-tertiary">{eyebrow}</div> : null}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-2xl leading-tight font-semibold md:text-3xl">{title}</h1>
          {description ? <p className="measure text-sm text-fg-secondary">{description}</p> : null}
        </div>
        {actions ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center md:shrink-0">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The bar's own rendering of the same three things.
 *
 * The heading stays an `<h1>`: it is still the document's one top-level heading,
 * and moving it into a `<header>` landmark does not change what a screen reader
 * should call this page. `truncate` with `min-w-0` on the column above is what
 * makes a long course name give way instead of pushing the search field off the
 * end of the row.
 *
 * The DESCRIPTION is not here, and that was measured rather than assumed. The
 * first cut put it under the title at `lg` and up; at 1280px with one action
 * button the bar rendered "One identity table. Role is a column, and suspension
 * destroys sessio…". A sentence clipped mid-word is worse than an absent one, and
 * the bar is the wrong place for prose in any case — it stays with the content,
 * where there is a measure to read it at.
 */
function TopBarHeading({ title, actions }: Pick<PageHeaderProps, 'title' | 'actions'>) {
  return (
    <>
      <h1 className="min-w-0 flex-1 truncate font-display text-base font-semibold">{title}</h1>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </>
  );
}
