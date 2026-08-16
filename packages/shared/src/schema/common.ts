import { z } from 'zod';

/** Every primary key in the schema is a cuid. */
export const idSchema = z.string().cuid();

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
