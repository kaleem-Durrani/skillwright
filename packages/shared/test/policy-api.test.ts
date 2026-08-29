import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  PolicyError,
  allowed,
  assertCan,
  can,
  isAction,
  type Action,
  type Actor,
} from '../src/policy/index.js';

/**
 * The rest of the policy module's public surface.
 *
 * `policy-matrix.test.ts` proves every `(caller, action, subject)` decision — but
 * it only ever calls `can()`. The three exports service code actually reaches for
 * are `allowed()` (UI affordances), `assertCan()` (every route handler) and
 * `PolicyError` (what the problem+json mapper reads to name the refused rule), and
 * none of them had a single test. The coverage threshold in `vitest.config.ts` said
 * so all along — 100% of `src/policy/**`, on the argument that "anything less than
 * total coverage of it means an authorization branch ships unproven". Nothing had
 * ever run that threshold, because the `--coverage` flag lives only in a CI job
 * that has never executed.
 *
 * That is not a bookkeeping gap. `assertCan()` is the form the API uses, so a
 * defect in the wrapper — swallowing a refusal, throwing on an allow, losing the
 * rule name — is an authorization bug that the entire 656-cell matrix would miss,
 * because the matrix never goes through the wrapper.
 */

const ADMIN: Actor = { id: 'u_admin', role: 'ADMIN', status: 'ACTIVE', provenance: 'PASSWORD' };
const STUDENT: Actor = { id: 'u_s', role: 'STUDENT', status: 'ACTIVE', provenance: 'PASSWORD' };
const SUSPENDED: Actor = { ...STUDENT, status: 'SUSPENDED' };

/** An action every admin may take and no student may, with no subject involved. */
const ADMIN_ONLY: Action = 'user:create';

describe('an unknown action', () => {
  /*
   * Unreachable from typed callers — `Action` is derived from POLICY's own keys —
   * but reachable from anything parsing an action name off the wire, which is
   * exactly where a permissive default would be catastrophic.
   */
  it('is refused rather than defaulted, for every caller including an admin', () => {
    for (const actor of [null, STUDENT, ADMIN]) {
      const result = can(actor, 'course:teleport' as Action);
      expect(result.allowed).toBe(false);
      if (result.allowed) throw new Error('unreachable');
      expect(result.rule).toBe('unknown-action');
      expect(result.reason).toContain('course:teleport');
    }
  });

  it('is not in ACTIONS, and isAction agrees', () => {
    expect(isAction('course:teleport')).toBe(false);
    expect(ACTIONS).not.toContain('course:teleport');
  });
});

describe('isAction', () => {
  it('accepts every action the policy declares', () => {
    for (const action of ACTIONS) {
      expect(isAction(action), action).toBe(true);
    }
  });

  it('rejects a name that only looks like one', () => {
    expect(isAction('course:reads')).toBe(false);
    expect(isAction('')).toBe(false);
  });

  /*
   * `isAction` is a `hasOwnProperty` test, not `in`, precisely so that a caller
   * cannot smuggle an inherited Object.prototype key past it and reach a POLICY
   * lookup with something that is not an action.
   */
  it('rejects inherited Object.prototype keys', () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(isAction(name), name).toBe(false);
    }
  });
});

describe('allowed', () => {
  it('is the boolean of the same decision can() makes', () => {
    const cases: Array<[Actor | null, Action]> = [
      [ADMIN, ADMIN_ONLY],
      [STUDENT, ADMIN_ONLY],
      [null, ADMIN_ONLY],
      [SUSPENDED, ADMIN_ONLY],
    ];
    for (const [actor, action] of cases) {
      expect(allowed(actor, action), `${actor?.role ?? 'anonymous'} / ${action}`).toBe(
        can(actor, action).allowed,
      );
    }
  });

  it('agrees with can() across the whole action list, for every caller class', () => {
    // The cheap exhaustive version: if these two ever disagree anywhere, a `Gate`
    // in the SPA renders a button the API will refuse, or hides one it would allow.
    for (const action of ACTIONS) {
      for (const actor of [null, STUDENT, ADMIN, SUSPENDED]) {
        expect(allowed(actor, action), `${actor?.role ?? 'anonymous'} / ${action}`).toBe(
          can(actor, action).allowed,
        );
      }
    }
  });
});

describe('assertCan', () => {
  it('returns quietly when the decision is allow', () => {
    expect(() => assertCan(ADMIN, ADMIN_ONLY)).not.toThrow();
  });

  it('throws PolicyError when the decision is deny', () => {
    expect(() => assertCan(STUDENT, ADMIN_ONLY)).toThrow(PolicyError);
  });

  /*
   * The thrown object is not decoration: `rule` is lifted into the problem+json
   * body, and the SPA renders errors by CODE while the rule name explains the
   * refusal in a log. Losing either turns a 403 into an unattributable one.
   */
  it('carries the refused rule, the action and the human reason', () => {
    let caught: unknown;
    try {
      assertCan(STUDENT, ADMIN_ONLY);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PolicyError);
    const error = caught as PolicyError;
    expect(error.name).toBe('PolicyError');
    expect(error.action).toBe(ADMIN_ONLY);
    expect(error.rule).toBe(can(STUDENT, ADMIN_ONLY).allowed ? '' : 'STUDENT:deny');
    expect(error.message).toBe((can(STUDENT, ADMIN_ONLY) as { reason: string }).reason);
    expect(error).toBeInstanceOf(Error);
  });

  it('reports the absolute gates by their own rule name, not by a role rule', () => {
    // The distinction the matrix test also insists on: a suspended account must be
    // refused BY suspension. A refusal that arrives via a role rule would look
    // identical to a caller and prove nothing about the account-state gate.
    let caught: PolicyError | undefined;
    try {
      assertCan(SUSPENDED, 'course:read');
    } catch (error) {
      caught = error as PolicyError;
    }
    expect(caught?.rule).toBe('status:SUSPENDED');
  });

  it('throws for an anonymous caller rather than treating null as a wildcard', () => {
    expect(() => assertCan(null, ADMIN_ONLY)).toThrow(PolicyError);
  });
});
