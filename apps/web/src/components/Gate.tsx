import type { ReactNode } from 'react';
import type { Action } from '@skillwright/shared/policy';
import { usePolicy, type PolicySubject } from '@/lib/policy';

export interface GateProps {
  action: Action;
  subject?: PolicySubject;
  children: ReactNode;
  /** Rendered when denied. Defaults to nothing — the action simply is not there. */
  fallback?: ReactNode;
  /** Rendered while the session is still resolving. */
  pending?: ReactNode;
}

/**
 * Renders its children only if the policy allows the action.
 *
 * WHY the default fallback is nothing rather than a disabled control: a disabled
 * button still advertises a capability the user does not have, and every user
 * who sees one tries to find out how to enable it. If a denial needs explaining,
 * pass an explicit `fallback` that explains it.
 */
export function Gate({ action, subject, children, fallback = null, pending = null }: GateProps) {
  const policy = usePolicy();
  if (policy.isPending) return <>{pending}</>;
  return <>{policy.can(action, subject) ? children : fallback}</>;
}
