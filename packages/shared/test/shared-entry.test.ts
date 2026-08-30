import { describe, expect, it } from 'vitest';
import * as root from '../src/index.js';
import * as policy from '../src/policy/index.js';
import * as schema from '../src/schema/index.js';
import { BRAND } from '../src/brand.js';

/**
 * The package's single entry point, which both apps import from by name.
 *
 * `src/index.ts` is three `export *` lines. That construct has one silent failure mode:
 * when two starred modules export the SAME name, ES modules do not error and do not
 * pick a winner — the ambiguous name is simply EXCLUDED from the re-exporting module.
 * So the day someone adds, say, a `ROLES` constant to `schema/` alongside the one the
 * policy layer already exports, `import { ROLES } from '@skillwright/shared'` stops
 * resolving in apps/api and apps/web, and the only thing that changed is a file neither
 * of them touched. The barrels currently share nothing; this is what keeps it that way.
 */

const namesOf = (namespace: object): string[] =>
  Object.keys(namespace).filter((name) => name !== 'default');

describe('the root barrel', () => {
  it('re-exports every value from both barrels, as the same reference', () => {
    // Same reference, not merely present: an accidental re-declaration would satisfy a
    // "is it defined" check while giving the two apps a different object than the one
    // the policy or schema module actually uses.
    for (const namespace of [policy, schema]) {
      for (const name of namesOf(namespace)) {
        expect(name in root, name).toBe(true);
        expect((root as Record<string, unknown>)[name], name).toBe(
          (namespace as Record<string, unknown>)[name],
        );
      }
    }
  });

  it('has no name declared by both barrels', () => {
    // The condition that triggers the exclusion, stated directly — so the failure names
    // the collision instead of pointing at whichever import happened to break first.
    const collisions = namesOf(schema).filter((name) => namesOf(policy).includes(name));
    expect(collisions).toEqual([]);
  });
});

describe('API_BASE_PATH', () => {
  it('is the version prefix, with no trailing slash', () => {
    // Every route in the API is mounted under it and every SPA request is joined to
    // it. A trailing slash turns each of those joins into `//courses`, which some
    // proxies redirect and some do not.
    expect(root.API_BASE_PATH).toBe('/api/v1');
    expect(root.API_BASE_PATH.endsWith('/')).toBe(false);
  });
});

describe('BRAND', () => {
  it('keeps every address it owns under the one domain', () => {
    // `pnpm check:brand` proves the name is spelled in exactly one file. It does not
    // prove the file is internally consistent, and a rebrand that changes `domain` but
    // leaves `supportEmail` behind sends mail from a domain with no SPF record — which
    // fails silently at the recipient, not here.
    expect(BRAND.supportEmail.endsWith(`@${BRAND.domain}`)).toBe(true);
    const from = BRAND.emailFrom.match(/<([^>]+)>/)?.[1];
    expect(from, BRAND.emailFrom).toBeDefined();
    expect(from?.endsWith(`@${BRAND.domain}`)).toBe(true);
  });

  it('has an assetFolder that is a legal object-key segment', () => {
    // Every upload key is `${assetFolder}/${entity}/${ulid}${ext}`. A space, a slash or
    // an uppercase letter here produces keys that need escaping in a signed URL and
    // sort differently in the bucket listing — for every object, retroactively.
    expect(BRAND.assetFolder).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });
});
