import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useIsDesktop } from '@/lib/media';
import { IconButton } from '@/components/ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { usePageSlot } from './page-slot';

export interface PageHeaderProps {
  title: string;
  /**
   * What the screen is for. Rendered BEHIND an info control, never as a visible
   * line under the title — see the disclosure note in this file. Pass
   * `descriptionDisclosure="inline"` to opt out of that and render it visibly.
   */
  description?: ReactNode;
  /**
   * `'popover'` (the default) puts the sentence behind an info control, because on
   * a screen someone has already chosen to visit, a line that repeats what the
   * title says costs a row of the scrolling column and says nothing.
   *
   * `'inline'` renders it under the title, and is what the UNAUTHENTICATED screens
   * pass. Their descriptions are not orientation, they are instructions and
   * conditions: "Students register here. Teaching and admin accounts are
   * provisioned by an administrator", and on the login screen "An administrator
   * has suspended this account." A person arriving at a sign-up form from a link
   * has not chosen this screen yet, and a policy sentence behind a generic info
   * icon is a sentence most of them will never open.
   */
  descriptionDisclosure?: 'popover' | 'inline';
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
 *
 * The DESCRIPTION is a disclosure, not a line of text. It used to be rendered
 * under the title on every screen, which cost a row of vertical space in the
 * scrolling column to say something none of the twenty screens act on — the one
 * place it ever went wrong was the top bar, where the same sentence was measured
 * clipping mid-word at 1280px. It now lives behind an info control at the end of
 * the header row, and that row is the ONLY thing that changed: the sentence is
 * still in the DOM on the same screen, it is just one tap away instead of always
 * on. The control is absent entirely when there is nothing to disclose, because
 * an info icon that opens nothing is worse than no icon.
 */
export function PageHeader({
  title,
  description,
  descriptionDisclosure = 'popover',
  actions,
  eyebrow,
  className,
}: PageHeaderProps) {
  const slot = usePageSlot();
  const isDesktop = useIsDesktop();
  const hoisted = isDesktop && slot !== null;

  // A disclosure cannot open if the sentence is not a sentence, and the inline
  // opt-out is only meaningful on the branch that renders in the page at all —
  // the top bar is 56px tall and there is nowhere in it to put prose.
  const asDisclosure = descriptionDisclosure === 'popover' && description !== undefined;

  if (hoisted) {
    return (
      <>
        {eyebrow ? (
          <div className={cn('pb-(--space-block)', className)}>
            <div className="text-xs text-fg-tertiary">{eyebrow}</div>
          </div>
        ) : null}
        {createPortal(
          <TopBarHeading
            title={title}
            actions={actions}
            description={asDisclosure ? description : undefined}
          />,
          slot,
        )}
      </>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3 pb-(--space-block)', className)}>
      {eyebrow ? <div className="text-xs text-fg-tertiary">{eyebrow}</div> : null}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        {/*
         * `min-w-0 md:flex-1` on the title, and NOT `truncate`: a course name
         * long enough to overflow still WRAPS, and it is the actions and the
         * info control beside it that have to survive. `shrink-0` on the group
         * below is the other half. The top bar's copy of this title does
         * truncate, because that row has a fixed height and a search field at the
         * end of it; this one does not have either.
         */}
        <div className="flex min-w-0 flex-col gap-1.5 md:flex-1">
          <h1 className="font-display text-2xl leading-tight font-semibold md:text-3xl">{title}</h1>
          {description && !asDisclosure ? (
            <p className="measure text-sm text-fg-secondary">{description}</p>
          ) : null}
        </div>
        {actions || asDisclosure ? (
          <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:justify-end md:shrink-0">
            {actions}
            {asDisclosure ? <DescriptionPopover description={description} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The info control and the sentence behind it.
 *
 * `IconButton` rather than a bare `<button>`, and that is the touch target: the
 * `icon` size resolves `--control-height-md` to `--tap-min`, which is 44px, at
 * EVERY breakpoint — there is no `md:` step-down to recover at the top bar's
 * height. It is the same primitive the notification bell and the theme toggle
 * use, so the three controls share a target size in the same row.
 *
 * `aria-label` is required by the prop's own type, and the reason is a gate
 * rather than a convention: `e2e/pages-a11y.spec.ts` audits five whole screens
 * and an icon-only button with no accessible name is a `button-name` CRITICAL
 * on all five.
 *
 * 24rem is the reading column, and it is an arithmetic claim rather than a
 * taste. At `text-sm` (14px, `--text-secondary`) an average glyph runs about
 * 7px, so 384px is roughly 55 characters a line — inside the 45–75 that keeps
 * a line findable by the eye's return sweep. It is also why the `measure`
 * utility is NOT applied here: `measure` is `min(100%, 42rem)`, and 42rem is
 * 672px, so inside a 384px panel it resolves to the panel's own width and does
 * nothing. The panel's width is the measure. Shipping the class anyway would be
 * an inert declaration that reads as if the width had been thought about twice.
 *
 * `max-block-size` is not decoration either. Three screens pass text a USER
 * wrote — `CourseDetail` and `ResourceDetail` pass `data.description`,
 * `DepartmentDetail` the department's own — so the panel can be asked to hold a
 * paragraph rather than a sentence, and it must be bounded by what Radix
 * measured for it rather than by what the copy desk wrote.
 */
function DescriptionPopover({ description }: { description: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          aria-label="About this screen"
          icon={<Info aria-hidden="true" className="size-5" />}
        />
      </PopoverTrigger>
      {/*
       * `align="end"` because the trigger is the LAST thing in the row in both
       * branches, and a panel wider than the gap under it would otherwise run
       * off the end of the viewport. Radix still flips it on collision.
       *
       * `aria-label` names the dialog. The content is a bare paragraph — the
       * only text a name could be built from is the text the panel exists to
       * present, and `aria-labelledby` cannot point at a trigger that is an
       * icon. axe's `aria-dialog-name` is a serious-impact rule, so an unnamed
       * `role="dialog"` is a finding on any screen that opens this.
       */}
      <PopoverContent
        align="end"
        aria-label="About this screen"
        className="[inline-size:min(24rem,var(--radix-popover-content-available-width))] [max-block-size:var(--radix-popover-content-available-height)] overflow-y-auto"
      >
        <p className="text-sm text-fg-secondary">{description}</p>
      </PopoverContent>
    </Popover>
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
 * The DESCRIPTION is not prose here either, and that was measured rather than
 * assumed. The first cut put it under the title at `lg` and up; at 1280px with
 * one action button the bar rendered "One identity table. Role is a column, and
 * suspension destroys sessio…". A sentence clipped mid-word is worse than an
 * absent one, and the bar is the wrong place for prose in any case.
 *
 * What replaced it is the last element in the row, and it is a DISCLOSURE rather
 * than a wider layout: the bar has four controls to its right that this does not
 * own — search, the bell, the theme toggle and the account menu — so the
 * description could never have more room here, only more rows. The sentence
 * behind it is no longer clipped because it no longer lives in a 56px-tall row.
 */
function TopBarHeading({
  title,
  actions,
  description,
}: Pick<PageHeaderProps, 'title' | 'actions' | 'description'>) {
  return (
    <>
      <h1 className="min-w-0 flex-1 truncate font-display text-base font-semibold">{title}</h1>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      {description ? <DescriptionPopover description={description} /> : null}
    </>
  );
}
