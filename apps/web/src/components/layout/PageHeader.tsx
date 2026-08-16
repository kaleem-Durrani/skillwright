import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Primary + secondary actions. They stack full-width below md. */
  actions?: ReactNode;
  /** Breadcrumb or back link, rendered above the title. */
  eyebrow?: ReactNode;
  className?: string;
}

/**
 * Actions stack UNDER the title on mobile and move beside it from `md`.
 *
 * WHY not the other way round: a title and a button competing for one 375px row
 * either truncates the title to three words or shrinks the button below the
 * 44px target. Both are worse than one extra row.
 */
export function PageHeader({ title, description, actions, eyebrow, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 pb-5 md:pb-6', className)}>
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
