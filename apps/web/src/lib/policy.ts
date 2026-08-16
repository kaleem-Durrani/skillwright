import { useCallback, useMemo } from 'react';
import { can, type Action, type PolicyResult } from '@skillwright/shared/policy';
import { useSession } from './session.js';

/**
 * The Subject shape is owned by @skillwright/shared — it is a plain data bag the
 * CALLER loads. `can()`'s third parameter type is derived rather than re-declared
 * so the two can never drift apart.
 */
export type PolicySubject = NonNullable<Parameters<typeof can>[2]>;

/**
 * Build a policy subject from whatever fields a screen actually has loaded.
 *
 * WHY the cast: the UI frequently holds a partial projection of an entity (a
 * course list row has `teacherId` but not `resources`), and every rule that
 * matters to a button is answerable from that projection. Confining the cast to
 * this one function means a real Subject mismatch shows up here and nowhere else.
 */
export function subject(draft: Record<string, unknown>): PolicySubject {
  return draft as unknown as PolicySubject;
}

export interface PolicyApi {
  /** Boolean form — what a `disabled` or a conditional render wants. */
  can: (action: Action, target?: PolicySubject) => boolean;
  /** Full result, including the rule name, for explaining a denial. */
  check: (action: Action, target?: PolicySubject) => PolicyResult;
  /** True while the session is still loading; render skeletons, not buttons. */
  isPending: boolean;
}

/**
 * The client-side half of the permission system.
 *
 * WHY it exists at all, given the server also enforces `can()`: a button that
 * would 403 must never be rendered. Showing an action and then failing it is how
 * the previous system taught users that the app was broken. This hook and the
 * API share ONE policy module, so the two answers cannot disagree.
 */
export function usePolicy(): PolicyApi {
  const { actor, isPending } = useSession();

  const check = useCallback(
    (action: Action, target?: PolicySubject): PolicyResult => can(actor, action, target),
    [actor],
  );

  const allowed = useCallback(
    (action: Action, target?: PolicySubject): boolean => check(action, target).allowed,
    [check],
  );

  return useMemo(() => ({ can: allowed, check, isPending }), [allowed, check, isPending]);
}

/** Single-action convenience for the common `{ok && <Button/>}` case. */
export function useCan(action: Action, target?: PolicySubject): boolean {
  const policy = usePolicy();
  return policy.can(action, target);
}

/**
 * Filter a nav/menu list down to the entries the actor may actually reach.
 * Entries without an `action` are always kept.
 */
export function useAllowedItems<T extends { action?: Action; subject?: PolicySubject }>(
  items: readonly T[],
): T[] {
  const policy = usePolicy();
  return useMemo(
    () => items.filter((item) => (item.action ? policy.can(item.action, item.subject) : true)),
    [items, policy],
  );
}
