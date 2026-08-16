import { describe, expect, it } from 'vitest';
import { ERROR_CODES as SHARED_ERROR_CODES } from '@skillwright/shared/schema';
import { ERROR_CODES, ERROR_COPY } from './problem.js';

/**
 * `src/lib/problem.ts` deliberately MIRRORS the error taxonomy from
 * `packages/shared/src/schema/errors.ts` rather than importing it, so the SPA
 * bundle never pulls zod in just to name a union.
 *
 * A mirror that nobody checks is just a copy waiting to rot: the day someone adds
 * a code to shared, the client's `switch` stops being exhaustive and the new code
 * renders as a blank error. This file is the check. It imports shared only in a
 * test, so the production bundle is unaffected.
 */
describe('problem envelope mirrors @skillwright/shared', () => {
  it('carries exactly the shared error codes', () => {
    expect([...ERROR_CODES].sort()).toEqual([...SHARED_ERROR_CODES].sort());
  });

  it('has user-facing copy for every code', () => {
    for (const code of SHARED_ERROR_CODES) {
      expect(ERROR_COPY[code], `missing ERROR_COPY entry for ${code}`).toBeTruthy();
    }
  });
});
