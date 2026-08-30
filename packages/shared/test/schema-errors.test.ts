import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  ERROR_STATUS,
  ErrorCode,
  PROBLEM_CONTENT_TYPE,
  errorCodeSchema,
  fieldErrorSchema,
  problemSchema,
  problemTypeUri,
} from '../src/schema/index.js';

/**
 * The failure taxonomy, which is a rendering contract and not just a log format.
 *
 * `apps/web/src/lib/problem.ts` switches on `code` — `ERROR_COPY` maps each one to the
 * sentence the user reads, `query.ts` treats UNAUTHENTICATED and ACCOUNT_SUSPENDED as
 * a lost session, and `CourseDetail.tsx` branches on CAPACITY_EXCEEDED to explain a
 * full intake. A renamed or dropped code is therefore not a cosmetic change: the SPA
 * falls through to its generic copy and the specific screen the code exists to trigger
 * never renders. Nothing fails; the user is just told less than the server knew.
 *
 * `apps/api/src/plugins/errors.plugin.ts` is the only consumer of `problemTypeUri` and
 * `PROBLEM_CONTENT_TYPE`, and it calls them for every error response the API sends.
 */

describe('ERROR_STATUS', () => {
  it('has exactly one status per code, in both directions', () => {
    // A code with no status makes `reply.status(undefined)` in the error plugin; a
    // status for a code that no longer exists is a rename nobody finished. The type
    // says `Record<ErrorCode, number>`, which catches the first at compile time and
    // the second not at all — `ERROR_CODES` is a const array, not the object's keys.
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('maps every code to a real client or server failure status', () => {
    for (const code of ERROR_CODES) {
      const status = ERROR_STATUS[code];
      expect(Number.isInteger(status), code).toBe(true);
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
    }
  });

  it('keeps the four 403s distinct, which is the reason `code` exists at all', () => {
    // "You are not allowed", "verify your email", "you are suspended" and "finish MFA"
    // are one status and four screens. Collapsing any of them back into FORBIDDEN
    // would leave the SPA unable to tell a dead end from a solvable one.
    const forbidden = ['FORBIDDEN', 'MFA_REQUIRED', 'EMAIL_NOT_VERIFIED', 'ACCOUNT_SUSPENDED'];
    for (const code of forbidden) {
      expect(ERROR_STATUS[code as (typeof ERROR_CODES)[number]], code).toBe(403);
    }
    expect(new Set(forbidden).size).toBe(4);
  });

  it('answers a capacity conflict with 409, not 422', () => {
    // ADR 0006's conditional UPDATE turns an over-capacity approval into a conflict
    // rather than a validation failure — the request was well-formed and lost a race.
    expect(ERROR_STATUS.CAPACITY_EXCEEDED).toBe(409);
    expect(ERROR_STATUS.CONFLICT).toBe(409);
    expect(ERROR_STATUS.VALIDATION_FAILED).toBe(422);
  });
});

describe('the ErrorCode const object', () => {
  it('maps every name to itself', () => {
    // Call sites read `ErrorCode.NOT_FOUND` and the value is what lands in the JSON, so
    // a key whose value drifted from its name would emit an unrenderable code with no
    // type error anywhere — the mapped type only constrains the keys.
    for (const code of ERROR_CODES) {
      expect(ErrorCode[code], code).toBe(code);
    }
    expect(Object.keys(ErrorCode).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('is frozen, so a handler cannot redefine a code for everyone', () => {
    expect(Object.isFrozen(ErrorCode)).toBe(true);
    expect(Object.isFrozen(ERROR_STATUS)).toBe(true);
  });
});

describe('errorCodeSchema', () => {
  it('accepts every declared code', () => {
    for (const code of ERROR_CODES) {
      expect(errorCodeSchema.safeParse(code).success, code).toBe(true);
    }
  });

  it('rejects the near-misses that would reach the SPA as an unknown code', () => {
    for (const bad of ['not_found', 'NOT-FOUND', 'NOT_FOUND ', '', 'TEAPOT']) {
      expect(errorCodeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('problemTypeUri', () => {
  it('kebab-cases the code under the documented namespace', () => {
    expect(problemTypeUri('INTERNAL')).toBe('https://skillwright.dev/problems/internal');
    expect(problemTypeUri('EMAIL_NOT_VERIFIED')).toBe(
      'https://skillwright.dev/problems/email-not-verified',
    );
  });

  it('produces a distinct absolute URI for every code', () => {
    // RFC 9457 makes `type` the identifier a client may dereference or compare, so two
    // codes collapsing onto one URI would make the field useless for telling them
    // apart — and `replace(/_/g, '-')` without the `g` flag does exactly that to
    // ENROLLMENT-style names with more than one underscore.
    const uris = ERROR_CODES.map(problemTypeUri);
    expect(new Set(uris).size).toBe(ERROR_CODES.length);
    for (const uri of uris) {
      expect(uri, uri).toMatch(/^https:\/\/skillwright\.dev\/problems\/[a-z-]+$/);
      expect(() => new URL(uri)).not.toThrow();
    }
  });
});

describe('problemSchema', () => {
  const problem = {
    type: 'https://skillwright.dev/problems/not-found',
    title: 'Not found',
    status: 404,
    code: 'NOT_FOUND',
    requestId: 'req_01JGXDFAM0K2Z1GYCSNM5F5RCX',
  };

  it('accepts the minimum every error response carries', () => {
    expect(problemSchema.parse(problem)).toEqual(problem);
  });

  it('requires requestId, which is the whole support-ticket story', () => {
    // Documented as present on EVERY response so a user can paste one number and have
    // it resolve to a log line. Optional would mean a route can quietly omit it and
    // nobody notices until someone reports a bug with nothing to correlate.
    const { requestId: _omitted, ...withoutRequestId } = problem;
    expect(problemSchema.safeParse(withoutRequestId).success).toBe(false);
  });

  it('requires code, and requires it to be in the taxonomy', () => {
    const { code: _omitted, ...withoutCode } = problem;
    expect(problemSchema.safeParse(withoutCode).success).toBe(false);
    expect(problemSchema.safeParse({ ...problem, code: 'SOMETHING_ELSE' }).success).toBe(false);
  });

  it('carries field errors with a path the form can key on', () => {
    // A 422 is only actionable if each message names the input it belongs to; without
    // the path the SPA can do nothing but print the list above the form.
    const parsed = problemSchema.parse({
      ...problem,
      status: 422,
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'profile.phoneNumber', message: 'Enter a valid phone number.' }],
    });
    expect(parsed.errors?.[0]?.path).toBe('profile.phoneNumber');
    expect(fieldErrorSchema.safeParse({ message: 'no path' }).success).toBe(false);
  });
});

describe('PROBLEM_CONTENT_TYPE', () => {
  it('is the RFC 9457 media type', () => {
    // The error plugin sets this on every failure response. Serving `application/json`
    // instead is invisible to the SPA's own parser and wrong for anything else that
    // content-negotiates — including the browser devtools view a reviewer looks at.
    expect(PROBLEM_CONTENT_TYPE).toBe('application/problem+json');
  });
});
