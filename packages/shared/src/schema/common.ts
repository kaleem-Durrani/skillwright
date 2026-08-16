import { z } from 'zod';

/**
 * Primary keys arrive from two generators, and both are legitimate:
 *
 *   - `@default(cuid())` in schema.prisma, for every row the application inserts
 *     (`cmsvme3r703ucw4g0i6oyh6fh`).
 *   - Deterministic ULIDs from `packages/db/prisma/seed.ts` (`01JGXDFAM0K2Z1GYCSNM5F5RCX`),
 *     because a byte-identical reseed is what keeps screenshots and e2e assertions
 *     valid across resets, and `cuid()` is random by design.
 *
 * This was `z.string().cuid()`, which accepted the first and rejected the second — so
 * every response schema carrying an id turned into a 500 the moment it met seeded data,
 * while the test suite stayed green because its fixtures insert through Prisma and get
 * cuids. Validate the shape of both rather than asserting a uniformity that is not true.
 */
const CUID = /^c[^\s-]{8,}$/i;
const ULID = /^[0-7][0-9ABCDEFGHJKMNPQRSTVWXYZ]{25}$/i;

export const idSchema = z.string().refine((value) => CUID.test(value) || ULID.test(value), {
  message: 'Expected a cuid or a ULID',
});

export const idParamSchema = z.object({ id: idSchema });
export type IdParam = z.infer<typeof idParamSchema>;

/** URL-safe identifier used for courses, departments and announcements. */
export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be lowercase words separated by single hyphens.');

export const slugParamSchema = z.object({ slug: slugSchema });
export type SlugParam = z.infer<typeof slugParamSchema>;

/**
 * Dates cross the wire as ISO-8601 strings, but the server hands DTO builders real
 * `Date` objects straight off Prisma. Accepting both and normalising to a string
 * means response validation can run in the API without a manual mapping pass.
 */
export const isoDateTimeSchema = z
  .union([z.string().datetime({ offset: true }), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));

export const nullableIsoDateTimeSchema = z
  .union([z.string().datetime({ offset: true }), z.date(), z.null()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));

/** Postgres `bigint` columns (`Message.seq`) exceed `Number.MAX_SAFE_INTEGER`; ship them as strings. */
export const bigIntStringSchema = z
  .union([z.bigint(), z.number().int(), z.string().regex(/^\d+$/)])
  .transform((value) => value.toString());

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const nameSchema = z.string().trim().min(2).max(120);

/** E.164-ish. Deliberately permissive: this is a phone number, not a credential. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s()-]{7,20}$/, 'Enter a valid phone number.');

/** Empty response body, for endpoints whose entire meaning is the status code. */
export const emptyResponseSchema = z.object({});
export type EmptyResponse = z.infer<typeof emptyResponseSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof okResponseSchema>;
