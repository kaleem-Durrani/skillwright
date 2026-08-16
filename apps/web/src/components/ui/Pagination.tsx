import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button.js';

export interface PaginationProps {
  page: number;
  totalPages: number;
  total?: number;
  limit?: number;
  onPageChange: (page: number) => void;
  className?: string;
  /** Screen-reader name, e.g. "Courses pagination". */
  label?: string;
}

/**
 * Windowed page list: first, last, the current page and its neighbours, with
 * ellipses standing in for the rest. Never renders more than seven numbers, so
 * a 400-page result set does not produce a 400-item control.
 */
function pageWindow(page: number, totalPages: number): Array<number | 'gap'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const items: Array<number | 'gap'> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) items.push('gap');
  for (let i = start; i <= end; i += 1) items.push(i);
  if (end < totalPages - 1) items.push('gap');
  items.push(totalPages);
  return items;
}

/**
 * The mobile control is Previous / position / Next — three targets, all 44px,
 * all reachable with one thumb. Numbered pages are an ENHANCEMENT that appears
 * from `md`, where there is room for them and a pointer to hit them with.
 */
export function Pagination({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  className,
  label = 'Pagination',
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const first = total !== undefined && limit ? (page - 1) * limit + 1 : null;
  const last = total !== undefined && limit ? Math.min(page * limit, total) : null;

  return (
    <nav
      aria-label={label}
      className={cn(
        'flex flex-col gap-3 pt-2 md:flex-row md:items-center md:justify-between',
        className,
      )}
    >
      {total !== undefined ? (
        <p className="text-center text-xs text-fg-tertiary md:text-start">
          {first !== null && last !== null
            ? `Showing ${first}–${last} of ${total}`
            : `${total} results`}
        </p>
      ) : (
        <span />
      )}

      <div className="flex items-center justify-between gap-2 md:justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          leadingIcon={<ChevronLeft aria-hidden="true" className="size-4" />}
        >
          Previous
        </Button>

        {/* Base viewport: a position readout, not a page list. */}
        <span aria-hidden="true" className="text-sm font-medium tabular-nums md:hidden">
          {page} / {totalPages}
        </span>

        {/* md and up: real page buttons. */}
        <ul className="hidden items-center gap-1 md:flex">
          {pageWindow(page, totalPages).map((item, index) =>
            item === 'gap' ? (
              <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-sm text-fg-tertiary">
                &hellip;
              </li>
            ) : (
              <li key={item}>
                <Button
                  variant={item === page ? 'primary' : 'ghost'}
                  size="sm"
                  aria-current={item === page ? 'page' : undefined}
                  onClick={() => onPageChange(item)}
                  className="min-w-9 tabular-nums"
                >
                  {item}
                </Button>
              </li>
            ),
          )}
        </ul>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          trailingIcon={<ChevronRight aria-hidden="true" className="size-4" />}
        >
          Next
        </Button>
      </div>

      {/* One live region for the whole control: screen readers hear the page
          change once, not once per button. */}
      <p aria-live="polite" className="sr-only">
        Page {page} of {totalPages}
      </p>
    </nav>
  );
}
