import type { KeyboardEvent, ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { useMotionKit } from '@/lib/motion';
import { useIsDesktop } from '@/lib/media';
import { EmptyState } from './EmptyState.js';
import { Pagination } from './Pagination.js';
import { SkeletonList } from './Skeleton.js';

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'start' | 'end';
  /** Held back until `lg` — secondary detail that a 768px table has no room for. */
  secondary?: boolean;
  /** A CSS width for the column, e.g. '10rem'. */
  width?: string;
}

export interface DataTablePagination {
  page: number;
  totalPages: number;
  total?: number;
  /**
   * Rows per page. Optional to `Pagination`, but every screen that has it passes
   * it — it is what turns "page 2 of 5" into "21–40 of 95", and dropping it on the
   * way through here would have quietly deleted that from five registers.
   */
  limit?: number;
  onPageChange: (page: number) => void;
}

export interface DataTableProps<T> {
  items: T[];
  columns: Array<DataTableColumn<T>>;
  getKey: (row: T) => string;
  /**
   * The MOBILE BASELINE. Not a fallback — this is the primary rendering, and the
   * table below is the enhancement. The contract is inherited from the list component this replaced.
   */
  renderCard: (row: T) => ReactNode;
  /** Names the list for assistive tech and captions the table. */
  caption: string;
  loading?: boolean;
  skeletonRows?: number;
  /** Rendered in place of everything when `items` is empty and not loading. */
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
  /**
   * The standard trailing column. Renders once per row, in the table only — see
   * the header comment above the render for why it has no card-view equivalent.
   */
  actions?: (row: T) => ReactNode;
  /**
   * A CSS width for the actions column, like a `column.width`.
   *
   * Needed because the migration lost one. AdminCourses' hand-rolled actions
   * column carried `width: '12rem'` — it holds two controls, a publish button and
   * a menu — and folding it into the `actions` prop dropped that, so the column
   * sized to its content and the columns beside it shifted. Every other screen's
   * actions column is a single icon button and wants no width at all, which is why
   * this is optional rather than a default.
   */
  actionsWidth?: string;
  /** Rendered as a pinned footer inside the component. Omit to render no pager. */
  pagination?: DataTablePagination;
  /**
   * `true` makes the table body scroll INTERNALLY with a sticky header and a
   * footer that stays put, instead of letting the document scroll. See the
   * render function's header comment: this only ever applies from `md` up.
   */
  fillHeight?: boolean;
}

/**
 * One dataset, one rendering — chosen by viewport, not hidden by it.
 *
 * WHY a single render and not DataList's dual one: DataList mounts a card `<ul>`
 * and a `<table>` together and switches them with `display`, so a 20-row page
 * (`DEFAULT_PAGE_SIZE`, packages/shared/src/schema/pagination.ts) builds ~40 row
 * subtrees where 20 would do. `useIsDesktop()` (lib/media.ts) answers the same
 * `md` breakpoint from `useSyncExternalStore`, so the choice is available on the
 * first render with no flash, and only the chosen half of the DOM is ever built.
 *
 * WHY cards below `md` and the table from `md` up, and not the reverse — ADR
 * 0008, restated from DataList's header because inverting it here would be easy
 * to miss in review: a table is a two-dimensional layout, and a 375px viewport
 * has one usable dimension. Shipping a real `<table>` at every width and solving
 * the overflow with a horizontal scrollbar is what let a student on a phone miss
 * that their enrolment had been rejected — the row was there, one sideways swipe
 * away, and nothing on screen said so.
 *
 * WHY `fillHeight` only changes anything at `md` and up: AppShell's layout
 * contract (components/layout/AppShell.tsx) bounds `main`'s height ONLY from
 * `md`, in those words — "Below md there is no bound. A phone viewport is short
 * enough that a table filling it would show three rows, and the document scroll
 * is the one interaction every phone user already has." A `flex-1 min-h-0` card
 * list below `md` would have no bounded ancestor to claim height from, so it
 * would do nothing except contradict that comment. The card branch therefore
 * always lets the document scroll, `fillHeight` or not.
 *
 * WHY `actions` has no card-view counterpart: `renderCard` is caller-owned
 * markup with no fixed slot an arbitrary layout could inject a trailing column
 * into — the five screens that hand-roll an actions menu today already call
 * their menu component twice, once from a table column and once from inside
 * `renderCard` (AdminUsers.tsx is the clearest example). `actions` replaces only
 * the first call; a screen that wants the same affordance on its card still
 * places it itself, exactly as it does now.
 */
export function DataTable<T>({
  items,
  columns,
  getKey,
  renderCard,
  caption,
  loading = false,
  skeletonRows = 4,
  empty,
  onRowClick,
  className,
  actions,
  actionsWidth,
  pagination,
  fillHeight = false,
}: DataTableProps<T>) {
  const { variants } = useMotionKit();
  const isDesktop = useIsDesktop();

  if (loading) {
    return <SkeletonList rows={skeletonRows} className={className} />;
  }

  if (items.length === 0) {
    return <>{empty ?? <EmptyState variant="empty" />}</>;
  }

  const pager = pagination ? (
    <Pagination
      page={pagination.page}
      totalPages={pagination.totalPages}
      total={pagination.total}
      limit={pagination.limit}
      onPageChange={pagination.onPageChange}
      label={`${caption} pagination`}
    />
  ) : null;

  if (!isDesktop) {
    return (
      <div className={className}>
        <motion.ul
          aria-label={caption}
          className="flex flex-col gap-3"
          variants={variants.stagger}
          initial="hidden"
          animate="visible"
        >
          {items.map((row) => (
            <motion.li key={getKey(row)} variants={variants.staggerItem}>
              {onRowClick ? (
                <button
                  type="button"
                  onClick={() => onRowClick(row)}
                  className="w-full rounded-[var(--card-radius)] text-start outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus"
                >
                  {renderCard(row)}
                </button>
              ) : (
                renderCard(row)
              )}
            </motion.li>
          ))}
        </motion.ul>
        {pager}
      </div>
    );
  }

  /*
   * The trailing column is built here rather than asked of the caller, because
   * that is the entire point of `actions`: five screens each hand-write this
   * same shape today (id/header/align/cell) around a menu component that is
   * otherwise identical. The header carries NO visible text — `<span
   * className="sr-only">` rather than the plain `header: 'Actions'` every one of
   * those five screens uses today. A sighted user does not need a column word
   * for a lone icon button; a screen reader user does not need it either, because
   * every cell in this column already names itself in full ("Actions for Jane
   * Doe" — see AdminUsers.tsx's RowMenu), and a table-mode screen reader command
   * that lands on this `<th>` would otherwise repeat the word "Actions" once per
   * row for information the row's own control already gave it. The header is not
   * EMPTY, though: axe's empty-table-header rule (and real AT) still wants an
   * accessible name on every `<th>`, sr-only or not — it is how a user tabbing
   * through column headers with no row focused yet still learns the column
   * exists.
   */
  const tableColumns: Array<DataTableColumn<T>> = actions
    ? [
        ...columns,
        {
          id: '__actions',
          header: <span className="sr-only">Actions</span>,
          align: 'end',
          cell: actions,
          ...(actionsWidth === undefined ? {} : { width: actionsWidth }),
        },
      ]
    : columns;

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    // Enter and Space are the WAI-ARIA APG activation keys for a clickable row;
    // neither does anything on a bare `<tr onClick>`, which is why DataList's
    // table rows (the list component it replaced) were never keyboard-reachable at all —
    // only its card `<button>` was. Space is prevented because its default is to
    // scroll the page, which a row activation must not also do.
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onRowClick?.(row);
  };

  return (
    <div
      className={cn(
        'rounded-[var(--card-radius)] border border-[var(--card-border)] bg-[var(--card-bg)]',
        // `overflow-hidden` clips the scrolling region to the card's own rounded
        // corners; without it a scrolled-to-the-bottom table shows square corners
        // where the border-radius should be.
        fillHeight && 'flex min-h-0 flex-1 flex-col overflow-hidden',
        className,
      )}
    >
      <div className={cn('scroll-x', fillHeight && 'scroll-y min-h-0 flex-1')}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {tableColumns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(
                    'border-b border-line-subtle bg-[var(--card-bg)] px-3 py-2.5 text-2xs font-semibold tracking-wide text-fg-tertiary uppercase whitespace-nowrap',
                    column.align === 'end' ? 'text-end' : 'text-start',
                    column.secondary && 'hidden lg:table-cell',
                    // Sticky header cells, not a sticky `<thead>` or `<tr>`: sticky
                    // positioning on a table-row-group has patchier engine support
                    // than on the cells themselves, and this is the one place the
                    // task brief was explicit about which element carries it.
                    fillHeight && 'sticky top-0 z-10',
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={getKey(row)}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (event) => handleRowKeyDown(event, row) : undefined}
                className={cn(
                  'border-b border-line-subtle last:border-b-0',
                  onRowClick &&
                    'cursor-pointer outline-none hover:bg-hover focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-line-focus',
                )}
              >
                {tableColumns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      'px-3 py-3 align-middle text-fg-secondary',
                      column.align === 'end' ? 'text-end' : 'text-start',
                      column.secondary && 'hidden lg:table-cell',
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination ? (
        <div className="shrink-0 border-t border-line-subtle px-3">
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            limit={pagination.limit}
            onPageChange={pagination.onPageChange}
            label={`${caption} pagination`}
            className="pb-3"
          />
        </div>
      ) : null}
    </div>
  );
}
