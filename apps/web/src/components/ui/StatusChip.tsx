import { cn } from '@/lib/cn';
import { Badge, type BadgeProps } from './Badge.js';

type Tone = NonNullable<BadgeProps['tone']>;

/**
 * Every domain status the UI can render, mapped once.
 *
 * WHY a single map: an enrolment that is amber on the dashboard and grey on the
 * course page is a bug the user experiences as "the app disagrees with itself".
 * Adding a status to the schema should break this file, and that is intentional.
 */
const STATUS_MAP = {
  // EnrollmentStatus
  PENDING: { tone: 'warning', label: 'Pending' },
  APPROVED: { tone: 'success', label: 'Approved' },
  REJECTED: { tone: 'danger', label: 'Rejected' },
  WITHDRAWN: { tone: 'neutral', label: 'Withdrawn' },
  COMPLETED: { tone: 'info', label: 'Completed' },
  // UserStatus
  PENDING_VERIFICATION: { tone: 'warning', label: 'Unverified' },
  ACTIVE: { tone: 'success', label: 'Active' },
  SUSPENDED: { tone: 'danger', label: 'Suspended' },
  // Publish state
  PUBLISHED: { tone: 'success', label: 'Published' },
  DRAFT: { tone: 'neutral', label: 'Draft' },
  // UploadStatus
  COMMITTED: { tone: 'success', label: 'Uploaded' },
  // Visibility
  PUBLIC: { tone: 'info', label: 'Public' },
  PRIVATE: { tone: 'neutral', label: 'Enrolled only' },
  // Capacity
  FULL: { tone: 'danger', label: 'Full' },
  OPEN: { tone: 'success', label: 'Open' },
} as const satisfies Record<string, { tone: Tone; label: string }>;

export type StatusKey = keyof typeof STATUS_MAP;

export interface StatusChipProps extends Omit<BadgeProps, 'tone' | 'children'> {
  status: StatusKey;
  /** Override the default copy without losing the tone mapping. */
  label?: string;
}

/**
 * A status is never communicated by colour alone: the dot has a distinct shape
 * position, the text always spells the state out, and the tone is decoration.
 */
export function StatusChip({ status, label, className, ...props }: StatusChipProps) {
  const entry = STATUS_MAP[status];
  return (
    <Badge
      tone={entry.tone}
      variant="soft"
      className={cn('ps-1.5', className)}
      icon={
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current opacity-80" />
      }
      {...props}
    >
      {label ?? entry.label}
    </Badge>
  );
}

export { STATUS_MAP };
