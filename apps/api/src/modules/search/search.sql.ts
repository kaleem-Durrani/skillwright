/**
 * The raw-SQL vocabulary every ranked search in the API is built from — the three
 * upgraded `?q=` list handlers and the cross-entity `GET /search`.
 *
 * WHY THIS EXISTS AS ONE FILE: migration 0002 built three generated `searchVector`
 * tsvector columns (Course, Resource, Announcement) plus pg_trgm GIN indexes on each
 * entity's natural-key columns, deliberately outside schema.prisma because Prisma has
 * no tsvector type. Reaching them needs `$queryRaw`. The match predicate, the rank
 * expression and the LIKE escaping are identical for all three entities modulo column
 * names — three hand-rolled copies would be three chances to disagree about escaping
 * or weighting (LESSONS-LEARNED #28: a comment cannot hold an invariant; one shared
 * function can).
 *
 * CONVENTIONS (enforced by every function here):
 *   - tagged templates / `Prisma.sql` composition only; never `$queryRawUnsafe` or
 *     string concatenation. The user's term is ALWAYS a bound parameter.
 *   - `'english'` is spelled out in `websearch_to_tsquery`/`ts_headline`, exactly as
 *     the generated columns do (migration 0002:44-46): the single-argument forms read
 *     `default_text_search_config`, which is a session setting nobody controls.
 *   - column identifiers arrive as caller-built `Prisma.Sql` fragments (compile-time
 *     literals), so no dynamic identifier ever passes through string interpolation.
 */
import { prisma, Prisma } from '@skillwright/db';

/**
 * The term as an ILIKE pattern, with the three characters SQL LIKE treats specially
 * (`\`, `%`, `_`) escaped first. Prisma's own `contains` escapes these on the caller's
 * behalf; raw SQL does not, so a query typed as "50%" would otherwise widen into a
 * wildcard match. Postgres' default LIKE escape character is the backslash.
 */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

/** The parsed term. `websearch_to_tsquery` cannot raise syntax errors, and quoted phrases and `-exclusions` behave as web searchers expect. */
function tsQuery(term: string): Prisma.Sql {
  return Prisma.sql`websearch_to_tsquery('english', ${term})`;
}

/**
 * The full match predicate for one entity:
 *
 *   searchVector @@ websearch_to_tsquery('english', $1)   -- stemmed words, phrases,
 *                                                          -- exclusions; GIN-indexed
 *   OR <natural-key column> ILIKE '%term%'                -- partial codes ("WELD-2")
 *                                                          -- that stemming cannot
 *                                                          -- see; trigram-indexed
 *
 * The OR is load-bearing, not a convenience. `websearch_to_tsquery('WELD-2')` parses
 * the hyphen as negation syntax (`'weld' <-> '-2'`) and matches nothing — measured
 * against the real columns, not assumed. A pure-tsvector swap therefore regresses
 * every partial-code search to zero hits; the trigram arm on the natural-key columns
 * (Course.name/code, Resource.title, Announcement.title — the exact columns migration
 * 0002:82-90 indexed) is what keeps those queries alive.
 *
 * @param vector      the entity's stored `"searchVector"`, e.g. ``Prisma.sql`c."searchVector"` ``
 * @param likeColumns the natural-key columns the trigram indexes cover
 * @param term        the caller's text, always bound, never interpolated
 */
export function matchFilter(
  vector: Prisma.Sql,
  likeColumns: Array<Prisma.Sql>,
  term: string,
): Prisma.Sql {
  const trigramArms = likeColumns.map((column) => Prisma.sql`${column} ILIKE ${likePattern(term)}`);
  return Prisma.sql`(${vector} @@ ${tsQuery(term)} OR ${Prisma.join(trigramArms, ' OR ')})`;
}

/**
 * Relevance: A-weighted name/code/title lexemes outrank B-weighted description/body
 * ones, because those are the weights the generated columns were built with
 * (migration 0002:54-80). Pure-trigram matches (a partial code) rank at 0, below any
 * lexical match but still present in the results.
 */
export function rankOf(vector: Prisma.Sql, term: string): Prisma.Sql {
  return Prisma.sql`ts_rank_cd(${vector}, ${tsQuery(term)})`;
}

/**
 * Highlight markup over one document, for clients that render matched terms without
 * a client-side regex — which would highlight the wrong thing for a stemmed match.
 * Defaults apply: `<b>…</b>` around hits, one focused fragment, never the whole body.
 */
export function headlineOf(document: Prisma.Sql, term: string): Prisma.Sql {
  return Prisma.sql`ts_headline('english', ${document}, ${tsQuery(term)})`;
}

// ---------------------------------------------------------------------------
// The two-query shape slice 1 shares across all three list handlers
// ---------------------------------------------------------------------------

export interface RankedIdPage {
  /** One page of matching ids, best-ranked first, deterministically tie-broken. */
  page: Prisma.PrismaPromise<Array<{ id: string }>>;
  /** Total matches, for the shared pagination envelope. `::int` — see dashboard.service.ts. */
  total: Prisma.PrismaPromise<Array<{ count: number }>>;
}

export interface RankedIdPageParams {
  /** The FROM item including its alias, e.g. ``Prisma.sql`"Course" c` ``. */
  table: Prisma.Sql;
  /** The alias alone, e.g. ``Prisma.sql`c` ``. */
  alias: Prisma.Sql;
  /** The entity's `"searchVector"` qualified by the same alias. */
  vector: Prisma.Sql;
  /** Natural-key columns for the trigram arms — the columns migration 0002 indexed. */
  likeColumns: Array<Prisma.Sql>;
  /** The caller's text. Bound, never interpolated. */
  term: string;
  /**
   * The ids the PRISMA side of the handler already proved visible-and-filtered.
   * The raw phase ranks within exactly this set and never re-states visibility:
   * `visibilityWhere` stays the one mirror of the policy rows, and a second copy
   * inside SQL is precisely the drift dashboard.service.ts paid for once already.
   */
  candidateIds: Array<string>;
  limit: number;
  offset: number;
}

/**
 * Rank and paginate one entity's candidates, returning BOTH promises for the caller
 * to run inside a single `$transaction([...])` — rows-plus-total in one snapshot, the
 * same shape every list endpoint uses (courses.service.ts).
 *
 * Ordering is `rank DESC, "createdAt" DESC, id ASC`: relevance first, then the
 * entity's default recency order, then the id so equal-rank pages are stable across
 * requests rather than heap-order-dependent.
 */
export function rankedIdPage(params: RankedIdPageParams): RankedIdPage {
  const filter = matchFilter(params.vector, params.likeColumns, params.term);
  const rank = rankOf(params.vector, params.term);
  const { alias } = params;
  return {
    page: prisma.$queryRaw<Array<{ id: string }>>`
      SELECT ${alias}.id
        FROM ${params.table}
       WHERE ${alias}.id IN (${Prisma.join(params.candidateIds)})
         AND ${filter}
    ORDER BY ${rank} DESC, ${alias}."createdAt" DESC, ${alias}.id ASC
       LIMIT ${params.limit} OFFSET ${params.offset}`,
    total: prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
        FROM ${params.table}
       WHERE ${alias}.id IN (${Prisma.join(params.candidateIds)})
         AND ${filter}`,
  };
}
