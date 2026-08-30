import { describe, expect, it } from 'vitest';
import {
  bigIntStringSchema,
  emailSchema,
  idParamSchema,
  idSchema,
  isoDateTimeSchema,
  nameSchema,
  nullableIsoDateTimeSchema,
  phoneSchema,
  slugParamSchema,
  slugSchema,
} from '../src/schema/index.js';

/**
 * The primitives every other schema is built out of.
 *
 * `common.ts` is 70 lines and the other fifteen schema files all import from it, so a
 * defect here is not one endpoint — `idSchema` alone appears in roughly every response
 * shape in the system. It has already cost a full outage once: LESSONS-LEARNED #14
 * records `idSchema` shipping as `z.string().cuid()` while `packages/db/prisma/seed.ts`
 * writes deterministic ULIDs, so every response carrying an id answered 500 on the
 * seeded database — the demo, and only the demo, because test fixtures insert through
 * Prisma and get cuids. Nothing in this package had ever imported these schemas, so
 * that regression could land again today and no unit test would move.
 */

/** The literal from LESSONS-LEARNED #14 — the shape seed.ts writes via encodeTime/encodeRandom. */
const SEEDED_ULID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
/** The literal from the same entry — what `@default(cuid())` produces at runtime. */
const PRISMA_CUID = 'cmsvme3r703ucw4g0i6oyh6fh';

describe('idSchema', () => {
  it('accepts both generators, because both are in the database right now', () => {
    expect(idSchema.parse(PRISMA_CUID)).toBe(PRISMA_CUID);
    expect(idSchema.parse(SEEDED_ULID)).toBe(SEEDED_ULID);
  });

  /*
   * The half that regressed. A validator that accepts only cuids passes the whole
   * suite — fixtures are cuids — and 500s on every seeded row, so this assertion has
   * to exist separately from "accepts an id".
   */
  it('accepts a ULID even though no test fixture ever produces one', () => {
    expect(idSchema.safeParse(SEEDED_ULID).success).toBe(true);
  });

  it('rejects a UUID, which a cuid pattern loose enough to pass one would also admit', () => {
    // Starts with `c` and is 36 characters, so only the hyphen exclusion in
    // `/^c[^\s-]{8,}$/i` refuses it. Relaxing that character class to `.` would
    // silently widen every id parameter in the API to arbitrary hyphenated text.
    expect(idSchema.safeParse('c0a80101-0000-4000-8000-000000000000').success).toBe(false);
  });

  it('rejects Crockford-ambiguous characters in a ULID', () => {
    // I, L, O and U are excluded from Crockford base32 precisely so a transcribed id
    // cannot be confused with 1 or 0; a ULID containing one was never minted by `ulid`.
    for (const forbidden of ['I', 'L', 'O', 'U']) {
      const candidate = `01JGXDFAM0K2Z1GYCSNM5F5RC${forbidden}`;
      expect(idSchema.safeParse(candidate).success, candidate).toBe(false);
    }
  });

  it('rejects a ULID whose timestamp field overflows 48 bits', () => {
    // The first character carries the top bits of a 48-bit millisecond timestamp, so it
    // cannot exceed `7`. A leading `8` is not something any clock can produce.
    expect(idSchema.safeParse('81JGXDFAM0K2Z1GYCSNM5F5RCX').success).toBe(false);
  });

  it('rejects the near-misses a URL can carry', () => {
    for (const bad of ['', 'abc', '../../etc/passwd', 'c', 'cshort', `${SEEDED_ULID}X`]) {
      expect(idSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('names itself in the failure message, so a 422 says what was expected', () => {
    const result = idSchema.safeParse('nope');
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.issues[0]?.message).toBe('Expected a cuid or a ULID');
  });
});

describe('idParamSchema', () => {
  it('is the gate between a URL segment and a findUnique', () => {
    expect(idParamSchema.parse({ id: SEEDED_ULID })).toEqual({ id: SEEDED_ULID });
    // Without this the traversal string reaches Prisma as a primary key.
    expect(idParamSchema.safeParse({ id: '../admin' }).success).toBe(false);
  });
});

describe('slugSchema', () => {
  it('accepts the canonical form the server derives from a name', () => {
    for (const good of ['weld-101', 'a', 'metal-fabrication-level-2', 'x1']) {
      expect(slugSchema.safeParse(good).success, good).toBe(true);
    }
  });

  it('rejects every shape that would produce a duplicate or an unroutable URL', () => {
    // `-weld`, `weld-` and `weld--101` all slugify back to something that reads
    // identically in the address bar, so accepting them invites two rows a human
    // cannot tell apart; uppercase does the same on a case-folding host.
    for (const bad of ['-weld', 'weld-', 'weld--101', 'Weld-101', 'weld 101', 'weld_101', '']) {
      expect(slugSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('caps at 120 characters', () => {
    expect(slugSchema.safeParse('a'.repeat(120)).success).toBe(true);
    expect(slugSchema.safeParse('a'.repeat(121)).success).toBe(false);
  });
});

describe('slugParamSchema', () => {
  it('refuses a path segment that is not a slug', () => {
    expect(slugParamSchema.parse({ slug: 'weld-101' })).toEqual({ slug: 'weld-101' });
    expect(slugParamSchema.safeParse({ slug: '..' }).success).toBe(false);
  });
});

describe('isoDateTimeSchema', () => {
  /*
   * The reason the union exists: response validation runs inside the API against DTOs
   * built straight off Prisma, which hands back `Date`. A string-only schema would
   * force a manual mapping pass in every DTO builder, and the first builder to forget
   * it would 500 in production rather than fail here.
   */
  it('normalises a Prisma Date to an ISO string', () => {
    expect(isoDateTimeSchema.parse(new Date('2026-08-30T10:00:00.000Z'))).toBe(
      '2026-08-30T10:00:00.000Z',
    );
  });

  it('passes an offset-bearing string through unchanged rather than re-basing it to UTC', () => {
    // `datetime({ offset: true })` is what admits this at all — the default rejects any
    // timestamp that is not `Z`, which would refuse every value produced by a client or
    // a database session outside UTC. The transform only touches `Date`, so the
    // original offset survives and the client renders the instant it was handed.
    expect(isoDateTimeSchema.parse('2026-08-30T10:00:00+05:00')).toBe('2026-08-30T10:00:00+05:00');
  });

  it('rejects a bare calendar date and a null', () => {
    expect(isoDateTimeSchema.safeParse('2026-08-30').success).toBe(false);
    // The non-nullable variant guards NOT NULL columns such as `createdAt`; if it
    // accepted null there would be nothing left distinguishing it from its sibling.
    expect(isoDateTimeSchema.safeParse(null).success).toBe(false);
  });
});

describe('nullableIsoDateTimeSchema', () => {
  it('accepts null, a Date and a string, and normalises the Date', () => {
    expect(nullableIsoDateTimeSchema.parse(null)).toBeNull();
    expect(nullableIsoDateTimeSchema.parse(new Date('2026-01-02T03:04:05.000Z'))).toBe(
      '2026-01-02T03:04:05.000Z',
    );
    expect(nullableIsoDateTimeSchema.parse('2026-01-02T03:04:05.000Z')).toBe(
      '2026-01-02T03:04:05.000Z',
    );
  });

  it('still rejects a non-datetime string', () => {
    // Nullable must not degrade into "anything": `publishedAt: 'soon'` has to be a 422.
    expect(nullableIsoDateTimeSchema.safeParse('soon').success).toBe(false);
  });
});

describe('bigIntStringSchema', () => {
  /*
   * `Message.seq` is a Postgres bigint and the cursor pager does exact range queries
   * against it. Serialising it as a JSON number silently rounds past 2^53 and two
   * distinct messages then share a cursor — the backfill after a reconnect either
   * skips a message or repeats one forever.
   */
  it('keeps a bigint past Number.MAX_SAFE_INTEGER exact', () => {
    const beyond = 9007199254740993n;
    expect(bigIntStringSchema.parse(beyond)).toBe('9007199254740993');
    // What a `z.number()` round-trip would have produced instead.
    expect(String(Number(beyond))).toBe('9007199254740992');
  });

  it('accepts the three forms the value arrives in', () => {
    expect(bigIntStringSchema.parse(42n)).toBe('42');
    expect(bigIntStringSchema.parse(42)).toBe('42');
    expect(bigIntStringSchema.parse('42')).toBe('42');
  });

  it('rejects a string that is not all digits, and a float', () => {
    for (const bad of ['', '4 2', '42abc', '4.2', 'NaN']) {
      expect(bigIntStringSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    // A float would truncate on the way into a bigint column.
    expect(bigIntStringSchema.safeParse(4.2).success).toBe(false);
  });
});

describe('emailSchema', () => {
  it('trims and lowercases before validating', () => {
    // Login and the unique index both match on the stored string. Without the
    // normalisation `Ann@Example.com` registers a second account for the same person
    // and then fails to find it at sign-in.
    expect(emailSchema.parse('  Ann@Example.COM  ')).toBe('ann@example.com');
  });

  it('enforces the RFC 5321 path limit of 254 characters', () => {
    const at254 = `${'a'.repeat(242)}@example.com`;
    const at255 = `${'a'.repeat(243)}@example.com`;
    expect(at254).toHaveLength(254);
    expect(at255).toHaveLength(255);
    expect(emailSchema.safeParse(at254).success).toBe(true);
    expect(emailSchema.safeParse(at255).success).toBe(false);
  });

  it('rejects an address with no usable domain', () => {
    for (const bad of ['ann', 'ann@', '@example.com', 'ann@example']) {
      expect(emailSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('nameSchema', () => {
  it('measures length after trimming, not before', () => {
    // `'  a  '` is five characters of input and one character of name. A min-length
    // check that ran first would let a whitespace-padded single letter through.
    expect(nameSchema.safeParse('  a  ').success).toBe(false);
    expect(nameSchema.parse('  Ann  ')).toBe('Ann');
  });

  it('caps at 120 characters', () => {
    expect(nameSchema.safeParse('a'.repeat(120)).success).toBe(true);
    expect(nameSchema.safeParse('a'.repeat(121)).success).toBe(false);
  });
});

describe('phoneSchema', () => {
  it('accepts the formats a human types, which is the point of it being loose', () => {
    for (const good of ['+92 300 1234567', '(042) 111-2222', '0300-1234567']) {
      expect(phoneSchema.safeParse(good).success, good).toBe(true);
    }
  });

  it('still refuses letters and anything under seven characters', () => {
    // Permissive is not absent: this value is rendered as a `tel:` link.
    for (const bad of ['not a phone', '12345', '', '+92-300-1234567-extension-4']) {
      expect(phoneSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
