import type { ReactNode } from 'react';
import { CircleAlert, Inbox, SearchX } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button.js';

export type EmptyStateVariant = 'empty' | 'no-results' | 'error';

interface VariantPreset {
  icon: ReactNode;
  iconClass: string;
  title: string;
  description: string;
  actionLabel: string;
  role: 'status' | 'alert';
}

/**
 * Three genuinely different situations, three genuinely different responses.
 *
 *   empty      — the collection has never had anything in it. The user is not
 *                stuck; they are at the beginning. Offer the create action.
 *   no-results — there IS data, the filter hid it. The user IS stuck, and the
 *                fix is to widen the filter, so offer exactly that.
 *   error      — we failed. Say so, do not blame the user, offer a retry.
 *
 * Collapsing these into one "nothing here" panel — which the previous system did
 * — tells a user with a bad filter that their course list is empty. It is not.
 */
const PRESETS: Record<EmptyStateVariant, VariantPreset> = {
  empty: {
    icon: <Inbox aria-hidden="true" className="size-6" />,
    iconClass: 'bg-brand-soft text-brand-on-soft',
    title: 'Nothing here yet',
    description: 'When something is added it will show up in this list.',
    actionLabel: 'Get started',
    role: 'status',
  },
  'no-results': {
    icon: <SearchX aria-hidden="true" className="size-6" />,
    iconClass: 'bg-info-soft text-info-fg',
    title: 'No matches',
    description: 'Nothing matched those filters. Try a broader search.',
    actionLabel: 'Clear filters',
    role: 'status',
  },
  error: {
    icon: <CircleAlert aria-hidden="true" className="size-6" />,
    iconClass: 'bg-danger-soft text-danger-fg',
    title: "That didn't load",
    description: 'Something went wrong on our side. Nothing you did caused this.',
    actionLabel: 'Try again',
    role: 'alert',
  },
};

export interface EmptyStateProps {
  variant?: EmptyStateVariant;
  title?: string;
  description?: ReactNode;
  /** Overrides the preset icon. */
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  /** Replaces the default button entirely — for a Link, say. */
  action?: ReactNode;
  secondaryAction?: ReactNode;
  /** Support reference, shown only for the error variant. */
  requestId?: string;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  variant = 'empty',
  title,
  description,
  icon,
  actionLabel,
  onAction,
  action,
  secondaryAction,
  requestId,
  className,
  compact = false,
}: EmptyStateProps) {
  const preset = PRESETS[variant];

  return (
    <div
      role={preset.role}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-[var(--card-radius)] text-center',
        compact ? 'px-4 py-8' : 'px-4 py-12 md:py-16',
        'border border-dashed border-line-subtle bg-[var(--card-bg)]',
        className,
      )}
    >
      <span
        className={cn('flex size-12 items-center justify-center rounded-full', preset.iconClass)}
      >
        {icon ?? preset.icon}
      </span>

      <div className="flex flex-col gap-1.5">
        <h3 className="font-display text-lg font-semibold">{title ?? preset.title}</h3>
        <p className="measure mx-auto text-sm text-fg-secondary">
          {description ?? preset.description}
        </p>
      </div>

      {(action || onAction) && (
        <div className="flex w-full flex-col gap-2 pt-1 sm:w-auto sm:flex-row sm:items-center">
          {action ?? (
            <Button
              variant={variant === 'error' ? 'secondary' : 'primary'}
              onClick={onAction}
              block
              className="sm:w-auto"
            >
              {actionLabel ?? preset.actionLabel}
            </Button>
          )}
          {secondaryAction}
        </div>
      )}

      {variant === 'error' && requestId ? (
        <p className="pt-1 font-mono text-2xs text-fg-tertiary">Reference: {requestId}</p>
      ) : null}
    </div>
  );
}
