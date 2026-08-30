/**
 * `ApiError` and the three helpers around it — the error contract every screen in
 * this SPA renders through.
 *
 * `problem.test.ts` already pins the CODE TAXONOMY against the shared package.
 * This file pins the BEHAVIOUR built on top of it, which is where the recorded
 * failures were:
 *
 * - LESSONS-LEARNED #25: a suspended person was told "You don't have access to
 *   that." The API's `detail` said "This account has been suspended" and the SPA
 *   had that exact sentence written as `ERROR_COPY.ACCOUNT_SUSPENDED` — it had
 *   simply never been rendered, because the client maps CODE to copy and the
 *   server had reached for a generic 403. The code is the whole contract; `detail`
 *   is a note for whoever reads the log.
 * - Which makes `userMessage`'s fallback load-bearing in the other direction too:
 *   the server can ship a code this closed union has not learned yet, and the
 *   user must get a sentence rather than `undefined`.
 */
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  ERROR_COPY,
  isDemoDenial,
  isProblem,
  transportProblem,
  type ErrorCode,
  type Problem,
} from './problem.js';

function problem(overrides: Partial<Problem> = {}): Problem {
  return {
    type: 'about:blank',
    title: 'Forbidden',
    status: 403,
    code: 'FORBIDDEN',
    requestId: 'req-1',
    ...overrides,
  };
}

describe('isProblem', () => {
  it('accepts the minimum a problem envelope must carry', () => {
    expect(isProblem({ title: 'Nope', status: 404, code: 'NOT_FOUND' })).toBe(true);
  });

  it('rejects anything that is not one', () => {
    // This narrowing decides whether the server's own envelope is used or a
    // synthesised one is built. It runs on whatever came back — including a
    // proxy's HTML page, a JSON `null`, or an empty array.
    expect(isProblem(null)).toBe(false);
    expect(isProblem(undefined)).toBe(false);
    expect(isProblem('Forbidden')).toBe(false);
    expect(isProblem([])).toBe(false);
    expect(isProblem({ title: 'Nope', status: 404 })).toBe(false);
    expect(isProblem({ title: 'Nope', code: 'NOT_FOUND' })).toBe(false);
    // A status that arrived as a string is not a status.
    expect(isProblem({ title: 'Nope', status: '404', code: 'NOT_FOUND' })).toBe(false);
  });
});

describe('ApiError', () => {
  it('reads as the developer-facing detail, and renders as the user-facing copy', () => {
    const error = new ApiError(
      problem({ code: 'ACCOUNT_SUSPENDED', detail: 'This account has been suspended' }),
    );

    // Two different audiences. `message` is what lands in a log or a stack trace;
    // `userMessage` is the only string a screen is allowed to show.
    expect(error.message).toBe('This account has been suspended');
    expect(error.userMessage).toBe(ERROR_COPY.ACCOUNT_SUSPENDED);
  });

  it('falls back to the title when the server sent no detail', () => {
    expect(new ApiError(problem({ title: 'Forbidden' })).message).toBe('Forbidden');
  });

  it('still produces a sentence for a code it has never heard of', () => {
    // The cast is the point of the test: the server owns the taxonomy and may add
    // a member before the client's closed union learns it. Without the fallback
    // the user would be shown `undefined`.
    const error = new ApiError(problem({ code: 'SOMETHING_NEW' as ErrorCode }));

    expect(error.userMessage).toBe(ERROR_COPY.INTERNAL);
  });

  it('keeps the first message per field, so the most specific one survives', () => {
    // A 422 can carry several errors for one path — the schema's own refinement
    // plus a service-level check. `setError` takes one string per field, and the
    // first is the one the server put nearest the cause.
    const error = new ApiError(
      problem({
        status: 422,
        code: 'VALIDATION_FAILED',
        errors: [
          { path: 'email', message: 'That is not a valid email address' },
          { path: 'email', message: 'Invalid input' },
          { path: 'password', message: 'Use at least 12 characters' },
        ],
      }),
    );

    expect(error.byField).toEqual({
      email: 'That is not a valid email address',
      password: 'Use at least 12 characters',
    });
  });

  it('has an empty field map when the server named no fields', () => {
    // Screens iterate `byField` unconditionally; undefined here would throw inside
    // an error handler, which is the worst possible place to throw.
    expect(new ApiError(problem()).byField).toEqual({});
    expect(new ApiError(problem()).fieldErrors).toEqual([]);
  });

  it('answers `is` on the code and nothing else', () => {
    const error = new ApiError(problem({ status: 409, code: 'CONFLICT' }));

    expect(error.is('CONFLICT')).toBe(true);
    expect(error.is('VALIDATION_FAILED')).toBe(false);
  });

  it('survives being thrown and caught as an instance', () => {
    // `instanceof` in a catch block is the entire reason this is a class: it has to
    // hold after the error has been through TanStack Query and an error boundary.
    const caught: unknown = (() => {
      try {
        throw new ApiError(problem());
      } catch (error) {
        return error;
      }
    })();

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).name).toBe('ApiError');
  });
});

describe('isDemoDenial', () => {
  const DEMO_DETAIL = 'Demo sessions cannot perform destructive actions. (rule: provenance:DEMO)';

  it('recognises the rule tag the API appends to a demo refusal', () => {
    // The rule name has no structured field on the wire — it is spelled inside
    // `detail` — so this is a string match by necessity, not by choice.
    expect(isDemoDenial(new ApiError(problem({ detail: DEMO_DETAIL })))).toBe(true);
  });

  it('does not claim an ordinary refusal is a demo one', () => {
    // A teacher refused a colleague's course must be told they do not own it, not
    // that they are on a demo account.
    expect(
      isDemoDenial(new ApiError(problem({ detail: 'Not yours. (rule: TEACHER:ownsCourse)' }))),
    ).toBe(false);
    expect(isDemoDenial(new ApiError(problem()))).toBe(false);
    expect(
      isDemoDenial(
        new ApiError(problem({ status: 401, code: 'UNAUTHENTICATED', detail: DEMO_DETAIL })),
      ),
    ).toBe(false);
  });

  it('is false for anything that is not an ApiError', () => {
    expect(isDemoDenial(new Error(DEMO_DETAIL))).toBe(false);
    expect(isDemoDenial(null)).toBe(false);
  });
});

describe('transportProblem', () => {
  it('marks a request that never reached the server', () => {
    const built = transportProblem('Failed to fetch');

    // status 0 is what `query.ts` retries on and what tells the UI this was not a
    // verdict. The `local` request id says there is no server-side trace to quote.
    expect(built.status).toBe(0);
    expect(built.code).toBe('INTERNAL');
    expect(built.requestId).toBe('local');
  });

  it('keeps the raw cause for the log while showing the user calm copy', () => {
    const error = new ApiError(transportProblem('NetworkError when attempting to fetch resource.'));

    expect(error.message).toBe('NetworkError when attempting to fetch resource.');
    expect(error.userMessage).toBe(ERROR_COPY.INTERNAL);
  });
});
