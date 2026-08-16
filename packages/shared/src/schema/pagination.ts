import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Offset pagination for everything that is browsed rather than streamed.
 *
 * `coerce` because these always arrive as query strings; validating the coerced
 * value rather than the raw string means `?limit=abc` is a 422 with a field path
 * instead of a silent `NaN` that becomes `LIMIT NaN`.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: z.string().min(1).max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type PaginationQueryInput = z.input<typeof paginationQuerySchema>;

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

/**
 * Wraps an item schema in the envelope. A factory rather than a generic type alone
 * so the API can validate what it is about to send, not just claim its shape.
 */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), meta: paginationMetaSchema });
}

/** Builds the meta block from the two numbers a repository actually returns. */
export function paginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1 && total > 0,
  };
}

/** `{ skip, take }` for Prisma, so the offset arithmetic exists in exactly one place. */
export function toSkipTake(query: Pick<PaginationQuery, 'page' | 'limit'>): {
  skip: number;
  take: number;
} {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}

// ---------------------------------------------------------------------------
// Cursor pagination — messages only
// ---------------------------------------------------------------------------

/**
 * Messages page by cursor, not offset. A conversation grows while you read it, and
 * offset paging in a growing list re-serves rows you have already seen. The cursor
 * is `Message.seq`, which the schema guarantees is gap-free per conversation.
 */
export const cursorQuerySchema = z.object({
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export const cursorMetaSchema = z.object({
  /** Pass back as `cursor` to fetch the next page; null when the list is exhausted. */
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type CursorMeta = z.infer<typeof cursorMetaSchema>;

export interface CursorPaginated<T> {
  data: T[];
  meta: CursorMeta;
}

export function cursorPaginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), meta: cursorMetaSchema });
}
