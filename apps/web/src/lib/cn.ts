import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names with last-wins conflict resolution.
 *
 * WHY tailwind-merge and not plain clsx: every primitive here accepts a
 * `className` override. Without conflict resolution `px-4` from a variant and
 * `px-6` from the call site both survive and the winner depends on stylesheet
 * order, which is not something a caller can reason about.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
