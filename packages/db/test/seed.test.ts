import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { seededReference } from '../prisma/seed.js';

/**
 * The one property of the seeded award this file exists to hold: a certificate
 * reference in SEEDED data is shaped exactly like one the API MINTS, so the unauthenticated
 * verifier answers for it.
 *
 * WHY THIS IS HERE RATHER THAN IN AN API TEST. `referenceSchema` lives in
 * `@skillwright/shared`, which `@skillwright/db` does not depend on and must not start
 * depending on — so the schema cannot be imported here without adding a dependency
 * between two packages that currently have none, which is a decision this test is not
 * entitled to make. Importing it from `apps/api` instead would mean a test in a package
 * that owns none of this code, running behind a database it does not need.
 *
 * SO THE CONSTRAINTS ARE RESTATED rather than imported, which is normally the thing
 * LESSONS-LEARNED 28 warns about: two copies of a rule that drift. The difference is
 * that this is not a copy of an EXPRESSION, it is a list of the four properties
 * `referenceSchema` and migration 0013's CHECK between them state — length, alphabet,
 * the masked final character, and stability — each of which is separately meaningful
 * rather than being a transcription, and a drift in the seed shows up here as a named
 * property failing rather than as a silent mismatch between two regexes. If a
 * qualification standard is ever re-shaped, this is the file that says so out loud.
 */

/** Crockford base32, and the reason a person can read it off a printout. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

describe('seededReference', () => {
  test('is 26 characters, which is what the verifier and the CHECK both require', () => {
    assert.equal(seededReference('any-key').length, 26);
  });

  test('uses only the 32 Crockford symbols, so it cannot be mistyped into a neighbour', () => {
    // I, L, O and U are the four that collide with 1, 1, 0 and V; their absence is the
    // whole point of the alphabet and a one-character regression here would be invisible
    // to a length check.
    for (const character of seededReference('alphabet')) {
      assert.ok(CROCKFORD.includes(character), `"${character}" is not a Crockford symbol`);
    }
  });

  test('masks the final character to three bits, because 26 characters carry 130 bits of a 128-bit value', () => {
    // The server's `generateReference` draws the last character from `CROCKFORD.slice(0, 8)`.
    // An unmasked final character here would still be 26 characters of valid alphabet
    // and the verify route would still accept it — while advertising entropy this
    // generator does not have, which is the exact over-claim the shared schema's own
    // comment explains the mask exists to prevent.
    const last = seededReference('mask').at(-1) as string;
    assert.ok('01234567'.includes(last), `final character "${last}" carries five bits`);
  });

  test('is stable for a key, because `reference` is UNIQUE and the seed has to be idempotent', () => {
    // THE property the whole function exists for. `reference` is the seed's upsert key
    // and the column is `@unique`, so a value that moved between runs would not update
    // the award — it would INSERT a second one, and `pnpm db:seed` would quietly double
    // every certificate in the demo each time anybody ran it.
    assert.equal(seededReference('seat:qualification'), seededReference('seat:qualification'));
  });

  test('differs between keys, so two awards are not two rows answering to one reference', () => {
    assert.notEqual(seededReference('first-seat'), seededReference('second-seat'));
  });
});
