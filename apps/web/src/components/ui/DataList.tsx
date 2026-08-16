import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { useMotionKit } from '@/lib/motion';
import { EmptyState } from './EmptyState.js';
import { SkeletonList } from './Skeleton.js';

export interface DataListColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'start' | 'end';
  /** Held back until `lg` — secondary detail that a 768px table has no room for. */
  secondary?: boolean;
  /** A CSS width for the column, e.g. '10rem'. */
  width?: string;
}

export interface DataListProps<T> {
  items: T[];
  columns: Array<DataListColumn<T>>;
  getKey: (row: T) => string;
  /**
   * The MOBILE BASELINE. Not a fallback — this is the primary rendering, and the
   * table below is the enhancement.
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
}

/**
 * One dataset, two renderings, one source of truth.
 *
 * WHY the card list is the baseline and the table is the enhancement: a table
 * is a two-dimensional layout, and a 375px viewport has one usable dimension.
 * The previous system shipped a real <table> at every width and solved the
 * overflow with a horizontal scrollbar, which meant a student on a phone had to
 * scroll sideways to discover that their enrolment had been rejected.
 *
 * Both renderings exist in the DOM and are switched with `display`, which
 * removes the hidden one from the accessibility tree — so a screen reader
 * encounters exactly one of them, never both.
 */
export function DataList<T>({
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
}: DataListProps<T>) {
  const { variants } = useMotionKit();

  if (loading) {
    return <SkeletonList rows={skeletonRows} className={className} />;
  }

  if (items.length === 0) {
    return <>{empty ?? <EmptyState variant="empty" />}</>;
  }

  return (
    <div className={className}>
      {/* ---------- BASELINE: card list ---------- */}
      <motion.ul
        aria-label={caption}
        className="flex flex-col gap-3 md:hidden"
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
                className="w-full rounded-[var(--card-radius)] text-start outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus"
              >
                {renderCard(row)}
              </button>
            ) : (
              renderCard(row)
            )}
          </motion.li>
        ))}
      </motion.ul>

      {/* ---------- ENHANCEMENT: real table, from md up ---------- */}
      <div className="scroll-x hidden rounded-[var(--card-radius)] border border-[var(--card-border)] bg-[var(--card-bg)] md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line-subtle">
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(
                    'px-3 py-2.5 text-2xs font-semibold tracking-wide text-fg-tertiary uppercase whitespace-nowrap',
                    column.align === 'end' ? 'text-end' : 'text-start',
                    column.secondary && 'hidden lg:table-cell',
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
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-line-subtle last:border-b-0',
                  onRowClick && 'cursor-pointer hover:bg-hover',
                )}
              >
                {columns.map((column) => (
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
    </div>
  );
}
