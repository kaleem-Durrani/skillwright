import { EMPTY_SUBJECT, type Actor, type Subject } from './actor.js';
import { POLICY, type Action, type ActionRules } from './policy.js';

/**
 * The answer, and — when it is no — WHY, in two registers: `reason` for a human
 * reading a log line, `rule` for a machine (the problem+json body, the generated
 * permissions matrix, the test assertions).
 */
export type PolicyResult = { allowed: true } | { allowed: false; reason: string; rule: string };

const ALLOWED: PolicyResult = Object.freeze({ allowed: true } as const);

function refuse(rule: string, reason: string): PolicyResult {
  return { allowed: false, reason, rule };
}

/**
 * Actions a DEMO session may not perform.
 *
 * Demo accounts are shared and reset on a schedule; letting one of them delete a
 * row or suspend a user hands every anonymous visitor a wrecking ball. Everything
 * non-destructive stays open so the demo is worth logging into.
 */
const DEMO_DENIED: ReadonlySet<Action> = new Set<Action>([
  'course:delete',
  'resource:delete',
  'announcement:delete',
  'comment:delete',
  'department:delete',
  'user:suspend',
]);

/** The single action a half-authenticated session is permitted to complete. */
const MFA_ESCAPE_HATCH: Action = 'mfa:verify';

/**
 * The only authorization entry point in the system.
 *
 * Every gate is evaluated in a fixed order, cheapest and most absolute first, so
 * that a suspended account can never fall through to a permissive role rule. The
 * function is pure: it performs no I/O and reads nothing but its arguments, which
 * is what allows the browser to run the identical decision for UI affordances.
 */
export function can(actor: Actor | null, action: Action, subject?: Subject): PolicyResult {
  // Annotated as possibly-undefined because untyped callers reach here with
  // arbitrary strings; the index signature alone would hide that.
  const entry: ActionRules | undefined = POLICY[action];
  if (entry === undefined) {
    // Defensive: reachable only from untyped callers parsing an action off the wire.
    return refuse('unknown-action', `Unknown action "${String(action)}".`);
  }

  const target = subject ?? EMPTY_SUBJECT;

  // --- Anonymous -----------------------------------------------------------
  if (actor === null) {
    return entry.anonymous(null, target)
      ? ALLOWED
      : refuse(
          `anonymous:${entry.anonymous.ruleName}`,
          `Anonymous visitors may not perform "${action}".`,
        );
  }

  // --- Account state (absolute, checked before any role rule) ---------------
  if (actor.status === 'SUSPENDED') {
    return refuse('status:SUSPENDED', 'This account is suspended.');
  }

  if (actor.status === 'PENDING_VERIFICATION' && action !== MFA_ESCAPE_HATCH) {
    return refuse(
      'status:PENDING_VERIFICATION',
      'Confirm your email address before using this account.',
    );
  }

  // --- Session provenance --------------------------------------------------
  if (actor.provenance === 'MFA_PENDING' && action !== MFA_ESCAPE_HATCH) {
    return refuse(
      'provenance:MFA_PENDING',
      'Finish two-factor verification before using this session.',
    );
  }

  if (actor.provenance === 'DEMO' && DEMO_DENIED.has(action)) {
    return refuse('provenance:DEMO', 'Demo sessions cannot perform destructive actions.');
  }

  // --- Role rule -----------------------------------------------------------
  const roleRule = entry[actor.role];
  return roleRule(actor, target)
    ? ALLOWED
    : refuse(
        `${actor.role}:${roleRule.ruleName}`,
        `A ${actor.role.toLowerCase()} may not perform "${action}" on this subject.`,
      );
}

/** Boolean-only convenience for UI affordances, where the reason is never rendered. */
export function allowed(actor: Actor | null, action: Action, subject?: Subject): boolean {
  return can(actor, action, subject).allowed;
}

/**
 * Throwing variant for service code, so an authorization mistake is a crash rather
 * than an ignored return value. The thrown object carries the rule name for the
 * problem+json mapper to lift into the response body.
 */
export class PolicyError extends Error {
  readonly rule: string;
  readonly action: Action;

  constructor(action: Action, result: Extract<PolicyResult, { allowed: false }>) {
    super(result.reason);
    this.name = 'PolicyError';
    this.rule = result.rule;
    this.action = action;
  }
}

/** Asserts the decision, throwing `PolicyError` when it is a refusal. */
export function assertCan(actor: Actor | null, action: Action, subject?: Subject): void {
  const result = can(actor, action, subject);
  if (!result.allowed) {
    throw new PolicyError(action, result);
  }
}
