import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  cursorPaginated,
  cursorQuerySchema,
  paginated,
  paginationMeta,
  paginationQuerySchema,
  toSkipTake,
} from '../src/schema/index.js';

/**
 * The offset arithmetic behind every list in the product.
 *
 * `paginationMeta` and `toSkipTake` are four lines of pure arithmetic called by
 * announcements, audit, comments, conversations, courses, enrollments, notifications,
 * resources and users — `grep -rn 'toSkipTake' apps/api/src` finds nine services. They
 * are also completely silent when wrong: a `hasNext` that is true one page too long
 * gives an infinite scroller that never stops fetching, and a `skip` off by one
 * `limit` drops the first twenty rows of every list without erroring anywhere. No test
 * anywhere in the repository has ever called either function.
 */

describe('paginationMeta', () => {
  it('reports an empty list as a single dead-end page', () => {
    // `hasPrev` is `page > 1 && total > 0` rather than just `page > 1`, so an empty
    // result deep-linked at ?page=3 does not render a Previous button into nothing.
    expect(paginationMeta(1, 20, 0)).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    });
    expect(paginationMeta(3, 20, 0).hasPrev).toBe(false);
  });

  it('stops at an exact multiple of the page size', () => {
    // The classic off-by-one. With `total === limit` there is exactly one page, and
    // `page < totalPages` must be false; `page <= totalPages` would offer a second
    // page that comes back empty.
    const meta = paginationMeta(1, 20, 20);
    expect(meta.totalPages).toBe(1);
    expect(meta.hasNext).toBe(false);
  });

  it('offers one more page when a single row spills over', () => {
    expect(paginationMeta(1, 20, 21)).toMatchObject({
      totalPages: 2,
      hasNext: true,
      hasPrev: false,
    });
    expect(paginationMeta(2, 20, 21)).toMatchObject({
      totalPages: 2,
      hasNext: false,
      hasPrev: true,
    });
  });

  it('refuses to advance past the end for a page number the client invented', () => {
    // A deep link to ?page=99 on a two-page list must terminate, not keep offering
    // `hasNext` because the caller asked for a page that does not exist.
    const meta = paginationMeta(99, 20, 21);
    expect(meta.totalPages).toBe(2);
    expect(meta.hasNext).toBe(false);
    expect(meta.hasPrev).toBe(true);
  });

  it('does not divide by zero when limit is zero', () => {
    // `Math.ceil(21 / 0)` is Infinity, and `page < Infinity` is true for every page —
    // an infinite scroller that never terminates. The `limit > 0` guard is the only
    // thing standing between that and any caller who builds a limit arithmetically.
    const meta = paginationMeta(1, 0, 21);
    expect(meta.totalPages).toBe(0);
    expect(meta.hasNext).toBe(false);
  });

  it('agrees with the numbers it was given', () => {
    // The three inputs are echoed, not recomputed: the SPA renders "page 2 of 5" from
    // this block alone and has no other source for them.
    expect(paginationMeta(2, 50, 137)).toEqual({
      page: 2,
      limit: 50,
      total: 137,
      totalPages: 3,
      hasNext: true,
      hasPrev: true,
    });
  });
});

describe('toSkipTake', () => {
  it('starts page 1 at offset zero', () => {
    // `page * limit` instead of `(page - 1) * limit` skips the first page of every
    // list in the app and nothing errors — the list is simply missing its top.
    expect(toSkipTake({ page: 1, limit: 20 })).toEqual({ skip: 0, take: 20 });
  });

  it('advances by exactly one page', () => {
    expect(toSkipTake({ page: 3, limit: 20 })).toEqual({ skip: 40, take: 20 });
    expect(toSkipTake({ page: 2, limit: 1 })).toEqual({ skip: 1, take: 1 });
  });
});

describe('paginationMeta and toSkipTake together', () => {
  /**
   * Walks a list the way the SPA does — follow `hasNext`, page by page, taking the
   * `{ skip, take }` window each time — and returns the row indices actually served.
   */
  const walk = (total: number, limit: number): number[] => {
    const seen: number[] = [];
    for (let page = 1; page <= 1000; page += 1) {
      const { skip, take } = toSkipTake({ page, limit });
      for (let row = skip; row < Math.min(skip + take, total); row += 1) seen.push(row);
      const meta = paginationMeta(page, limit, total);
      expect(meta.hasPrev, `page ${page} of ${total}/${limit}`).toBe(page > 1 && total > 0);
      if (!meta.hasNext) return seen;
    }
    throw new Error('paging did not terminate within 1000 pages');
  };

  it('serves every row exactly once and then stops', () => {
    // The property the two functions exist to hold jointly. An off-by-one in either
    // one shows up here as a duplicated row, a missing row, or a runaway loop —
    // whereas each function on its own can look plausible while the pair is wrong.
    for (const limit of [1, 2, 3, 7, 20]) {
      for (const total of [0, 1, 2, 6, 7, 8, 20, 21, 41]) {
        const expected = Array.from({ length: total }, (_, index) => index);
        expect(walk(total, limit), `total=${total} limit=${limit}`).toEqual(expected);
      }
    }
  });
});

describe('paginationQuerySchema', () => {
  it('defaults to page 1 and the documented page size', () => {
    expect(paginationQuerySchema.parse({})).toEqual({
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      order: 'desc',
    });
    expect(DEFAULT_PAGE_SIZE).toBe(20);
    // A default `sort` is deliberately absent — each service picks its own column, so
    // the key must not appear at all rather than arrive as undefined.
    expect('sort' in paginationQuerySchema.parse({})).toBe(false);
  });

  it('coerces the strings a query string actually carries', () => {
    expect(paginationQuerySchema.parse({ page: '2', limit: '50', order: 'asc' })).toEqual({
      page: 2,
      limit: 50,
      order: 'asc',
    });
  });

  it('rejects a non-numeric limit with a field path instead of producing NaN', () => {
    // The documented reason the coercion is validated rather than trusted: `LIMIT NaN`
    // is a database error at the far end of the call stack, `?limit=abc` is a 422 with
    // a field name the form can render next to the input.
    const result = paginationQuerySchema.safeParse({ limit: 'abc' });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.issues[0]?.path).toEqual(['limit']);
  });

  it('holds the page-size ceiling exactly at MAX_PAGE_SIZE', () => {
    // The ceiling is the only thing stopping `?limit=100000` from selecting a table.
    //
    // Pinned to the LITERAL first, and that line is the whole test. The two assertions
    // below reference the constant on both sides, so they prove only that the schema
    // agrees with whatever the constant currently says: raising MAX_PAGE_SIZE to 1000
    // leaves them green and coverage at 100% while the regression they claim to catch
    // ships. `DEFAULT_PAGE_SIZE` is pinned literally twenty lines up; this was the
    // asymmetry, not a stance.
    expect(MAX_PAGE_SIZE).toBe(100);
    expect(paginationQuerySchema.safeParse({ limit: String(MAX_PAGE_SIZE) }).success).toBe(true);
    expect(paginationQuerySchema.safeParse({ limit: String(MAX_PAGE_SIZE + 1) }).success).toBe(
      false,
    );
  });

  it('refuses the values that would break the offset arithmetic', () => {
    // `page=0` gives a negative skip, `page=1.5` a fractional one, `limit=0` the
    // division guarded above. Each has to fail at the edge, not downstream.
    for (const bad of [{ page: '0' }, { page: '-1' }, { page: '1.5' }, { limit: '0' }]) {
      expect(paginationQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('accepts only the two sort directions', () => {
    expect(paginationQuerySchema.safeParse({ order: 'sideways' }).success).toBe(false);
    // A free-form `order` would be interpolated into a Prisma orderBy.
    expect(paginationQuerySchema.safeParse({ sort: '' }).success).toBe(false);
  });
});

describe('cursorQuerySchema', () => {
  it('defaults to a bigger page than offset pagination does', () => {
    // Messages page at 50, not DEFAULT_PAGE_SIZE. The two are separate numbers on
    // purpose — a chat backfill of 20 rows visibly stutters — so a refactor that
    // collapses them into one constant has to fail here.
    expect(cursorQuerySchema.parse({}).limit).toBe(50);
    expect(cursorQuerySchema.parse({}).limit).not.toBe(DEFAULT_PAGE_SIZE);
  });

  it('accepts only an all-digit cursor', () => {
    // The cursor is `Message.seq`, a bigint. Anything else reaching a range query is
    // either a Prisma type error or a caller trying to steer the WHERE clause.
    expect(cursorQuerySchema.parse({ cursor: '00912' }).cursor).toBe('00912');
    for (const bad of ['-1', '1.5', 'abc', '', '1 OR 1=1']) {
      expect(cursorQuerySchema.safeParse({ cursor: bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('shares the page-size ceiling with offset pagination', () => {
    expect(cursorQuerySchema.safeParse({ limit: String(MAX_PAGE_SIZE) }).success).toBe(true);
    expect(cursorQuerySchema.safeParse({ limit: String(MAX_PAGE_SIZE + 1) }).success).toBe(false);
  });
});

describe('the envelope factories', () => {
  const item = z.object({ id: z.string() });

  it('validates the items inside the envelope, with the index in the path', () => {
    // The factories exist so the API validates what it is about to send. If the item
    // schema were not applied per element, a malformed row would ship as-is and the
    // SPA would render undefined.
    const result = paginated(item).safeParse({
      data: [{ id: 'ok' }, { id: 7 }],
      meta: { page: 1, limit: 20, total: 2, totalPages: 1, hasNext: false, hasPrev: false },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.issues[0]?.path).toEqual(['data', 1, 'id']);
  });

  it('requires the meta block, so a list cannot ship without its page numbers', () => {
    expect(paginated(item).safeParse({ data: [] }).success).toBe(false);
  });

  it('accepts a well-formed page', () => {
    const meta = paginationMeta(1, 20, 1);
    expect(paginated(item).parse({ data: [{ id: 'a' }], meta })).toEqual({
      data: [{ id: 'a' }],
      meta,
    });
  });

  it('gives the cursor envelope a null nextCursor at the end of history', () => {
    // `nextCursor: null` is how the client knows to stop; a schema that made it
    // optional would let a service omit it and leave the client paging forever.
    expect(
      cursorPaginated(item).parse({ data: [], meta: { nextCursor: null, hasMore: false } }),
    ).toEqual({ data: [], meta: { nextCursor: null, hasMore: false } });
    expect(cursorPaginated(item).safeParse({ data: [], meta: { hasMore: false } }).success).toBe(
      false,
    );
  });
});
