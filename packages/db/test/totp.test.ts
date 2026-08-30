import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { encryptTotpSecret } from '../src/totp.js';

/**
 * The seed's TOTP envelope — specifically the half apps/api's suite cannot see.
 *
 * `apps/api/test/auth.test.ts` already drives this function through a real login, so
 * the round trip against `apps/api/src/lib/crypto.ts` is covered and is not repeated
 * here. But that test encrypts and verifies inside one process: it would pass just as
 * well if `deterministicIv` silently became a no-op, or if the IV became a constant.
 * Those two are what this file pins.
 */

/** A fixed key, so the assertions never depend on the repository's local .env. */
const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
const SECRET = 'JBSWY3DPEHPK3PXP';

const IV_OFFSET = 1; // one version byte
const IV_BYTES = 12;

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

before(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY;
});

after(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

function ivOf(envelope: string): Buffer {
  return Buffer.from(envelope, 'base64').subarray(IV_OFFSET, IV_OFFSET + IV_BYTES);
}

describe('encryptTotpSecret', () => {
  test('deterministicIv makes a reseed byte-identical', () => {
    // The seed's entire design is that re-running it produces the same rows — ids are
    // ULIDs derived from natural keys for exactly this reason (lesson 11). If this
    // option regressed to `randomBytes`, `pnpm db:reset && pnpm db:seed` would write a
    // different totpSecret every run: no error, no failing test, just a demo database
    // that is no longer reproducible and diffs that are pure noise.
    const first = encryptTotpSecret(SECRET, { deterministicIv: true });
    const second = encryptTotpSecret(SECRET, { deterministicIv: true });
    assert.equal(first, second);
  });

  test('the default is a random IV, because a repeated one breaks GCM outright', () => {
    // The inverse regression, and the dangerous one: `deterministicIv` becoming the
    // default would give every real MFA enrolment a plaintext-derived IV. A repeated
    // IV under one key is a complete break of GCM's authentication, not a weakening.
    const first = encryptTotpSecret(SECRET);
    const second = encryptTotpSecret(SECRET);
    assert.notEqual(first, second);
  });

  test('the deterministic IV is derived from the secret, not fixed', () => {
    // "Deterministic" has an acceptable reading (one IV per plaintext, so the seed is
    // reproducible) and a catastrophic one (one IV for everything, so two accounts
    // share an IV under one key). Only the second is a break, and the two are
    // indistinguishable from a single-secret test.
    const a = ivOf(encryptTotpSecret(SECRET, { deterministicIv: true }));
    const b = ivOf(encryptTotpSecret('KRSXG5CTMVRXEZLU', { deterministicIv: true }));
    assert.notDeepEqual(a, b);
  });
});
