import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const skeletonVariants = cva('shimmer', {
  variants: {
    shape: {
      text: 'h-3.5 rounded-xs',
      heading: 'h-5 rounded-sm',
      block: 'rounded-md',
      circle: 'rounded-full',
      chip: 'h-5 w-16 rounded-full',
      control: 'h-[var(--control-height-md)] rounded-[var(--control-radius)]',
    },
  },
  defaultVariants: { shape: 'text' },
});

export interface SkeletonProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof skeletonVariants> {}

export function Skeleton({ className, shape, ...props }: SkeletonProps) {
  return (
    <div aria-hidden="true" className={cn(skeletonVariants({ shape }), className)} {...props} />
  );
}

/**
 * Composite skeletons.
 *
 * WHY these are shipped alongside the components they stand in for: a skeleton
 * that does not match the final layout causes a visible jump on load, which is a
 * worse experience than a spinner. Each one below mirrors the real component's
 * box model exactly — same paddings, same gaps, same mobile-first structure.
 * If you change a card, change its skeleton in the same commit.
 */

/** Mirrors Card + CardHeader + CardContent + a two-chip footer. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-[var(--card-radius)] border border-[var(--card-border)] bg-[var(--card-bg)] p-[var(--card-padding)]',
        className,
      )}
    >
      <div className="flex flex-col gap-1 pb-3 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="flex w-full flex-col gap-2">
          <Skeleton shape="heading" className="w-3/5" />
          <Skeleton shape="text" className="w-4/5" />
        </div>
        <Skeleton shape="chip" className="hidden md:block" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton shape="text" className="w-full" />
        <Skeleton shape="text" className="w-11/12" />
      </div>
      <div className="flex items-center gap-2 pt-4">
        <Skeleton shape="chip" />
        <Skeleton shape="chip" className="w-20" />
      </div>
    </div>
  );
}

/** Mirrors DataList's card baseline and its table enhancement from md up. */
export function SkeletonList({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 md:gap-0', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn(
            'rounded-[var(--card-radius)] border border-[var(--card-border)] bg-[var(--card-bg)] p-[var(--card-padding)]',
            'md:flex md:items-center md:gap-4 md:rounded-none md:border-0 md:border-b md:px-3 md:py-3.5',
          )}
        >
          <Skeleton shape="circle" className="mb-3 size-10 md:mb-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton shape="text" className="w-2/5" />
            <Skeleton shape="text" className="w-3/5 md:hidden" />
          </div>
          <Skeleton shape="text" className="mt-3 w-1/3 md:mt-0 md:w-24" />
          <Skeleton shape="chip" className="mt-3 md:mt-0" />
        </div>
      ))}
    </div>
  );
}

/** Mirrors the dashboard stat row: 1 column at 375px, 2 at sm, 4 at lg. */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="rounded-[var(--card-radius)] border border-[var(--card-border)] bg-[var(--card-bg)] p-[var(--card-padding)]"
        >
          <Skeleton shape="text" className="w-20" />
          <Skeleton shape="heading" className="mt-3 h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Mirrors a message thread: alternating alignment, variable bubble widths. */
export function SkeletonThread({ rows = 6 }: { rows?: number }) {
  const widths = ['w-3/5', 'w-2/5', 'w-4/5', 'w-1/2', 'w-3/4', 'w-1/3'];
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={cn('flex', index % 2 === 0 ? 'justify-start' : 'justify-end')}>
          <Skeleton shape="block" className={cn('h-12', widths[index % widths.length])} />
        </div>
      ))}
    </div>
  );
}
