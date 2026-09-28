import { prisma, Prisma } from '@skillwright/db';
import type { Actor } from '@skillwright/shared';
// The three visibility mirrors, imported rather than rewritten — the exact arrangement
// dashboard.service.ts established for its mixed-audience resources tile: the module
// that owns the policy rows owns the WHERE clause, and a second copy anywhere else is
// how a tile once counted rows no list would return (see that file's block on the
// resources counter, and LESSONS-LEARNED #15/#31/#33).
import { visibilityWhere as visibleCoursesWhere } from '../courses/courses.service.js';
import { visibilityWhere as visibleResourcesWhere } from '../resources/resources.service.js';
import { visibilityWhere as visibleAnnouncementsWhere } from '../announcements/announcements.service.js';
import { candidateSet, headlineOf, matchFilter, rankOf } from './search.sql.js';
import type {
  AnnouncementHit,
  CourseHit,
  ResourceHit,
  SearchGroup,
  SearchQuery,
  SearchResult,
} from './search.schema.js';

/**
 * `GET /search` — one ranked query, three entity groups.
 *
 * There is no `search:*` action to ask `can()` (the route explains why none was added),
 * so the scoping below IS this endpoint's authorization: each group is narrowed by ITS
 * OWN module's `visibilityWhere`, plus soft-delete terms. A caller therefore never sees
 * through this endpoint anything their per-entity list would not have shown them —
 * which is the trap this slice was written to avoid: one query leaking what three
 * modules carefully guard.
 *
 * Per group, two phases:
 *   1. the VISIBLE id set comes from Prisma via the imported mirror — visibility is
 *      never restated in SQL;
 *   2. raw SQL ranks and headlines within that set (`matchFilter`/`rankOf`/
 *      `headlineOf`), page and total in one `$transaction`.
 *
 * The ids are fetched WITHOUT pagination because a school's live rows number in the
 * hundreds at most; ranking over an explicit id set is one index-friendly scan. If
 * that ever stops being true, phase 1 grows a LIMIT — not a second visibility copy.
 *
 * Phase 9 changed HOW the set reaches SQL and nothing about what it selects. Each
 * group used to spell `c.id IN (${Prisma.join(...)})` inline, which is one bind
 * variable per id and therefore a hard failure at 32,767 visible rows rather than a
 * slowdown; all three now go through `candidateSet`, the one function the three
 * per-entity `?q=` handlers use too. Four copies of the same predicate in one module
 * is four chances to keep one of them wrong.
 */
export async function search(actor: Actor | null, query: SearchQuery): Promise<SearchResult> {
  const [courses, resources, announcements] = await Promise.all([
    courseGroup(actor, query),
    resourceGroup(actor, query),
    announcementGroup(actor, query),
  ]);
  return { courses, resources, announcements };
}

/**
 * NOTE for this clause only: courses' `visibilityWhere` deliberately carries no
 * soft-delete term (the catalogue's own `listWhere` adds `deletedAt: null` outside it —
 * courses.service.ts documents why), so it is added here. The other two mirrors carry
 * theirs internally.
 */
async function courseGroup(
  actor: Actor | null,
  { q, limit }: SearchQuery,
): Promise<SearchGroup<CourseHit>> {
  const visible = await prisma.course.findMany({
    where: { AND: [visibleCoursesWhere(actor), { deletedAt: null }] },
    select: { id: true },
  });
  if (visible.length === 0) return { hits: [], total: 0 };

  const vector = Prisma.sql`c."searchVector"`;
  const filter = matchFilter(vector, [Prisma.sql`c."name"`, Prisma.sql`c."code"`], q);
  const rank = rankOf(vector, q);
  const inCandidates = candidateSet(
    Prisma.sql`c`,
    visible.map((row) => row.id),
  );
  // Headline document: name plus blurb, so a hit in either produces a highlight the
  // catalogue card can render directly.
  const document = Prisma.sql`c.name || ' ' || coalesce(c.description, '')`;

  const [hits, counts] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ id: string; code: string; name: string; headline: string }>>`
      SELECT c.id, c.code, c.name,
             ${headlineOf(document, q)} AS headline
        FROM "Course" c
       WHERE ${inCandidates} AND ${filter}
    ORDER BY ${rank} DESC, c."createdAt" DESC, c.id ASC
       LIMIT ${limit}`,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
        FROM "Course" c
       WHERE ${inCandidates} AND ${filter}`,
  ]);

  return {
    hits: hits.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      headline: row.headline,
      linkPath: `/courses/${row.id}`,
    })),
    total: counts[0]?.count ?? 0,
  };
}

/** Resources' mirror already excludes soft-deleted rows AND rows whose COURSE is soft-deleted. */
async function resourceGroup(
  actor: Actor | null,
  { q, limit }: SearchQuery,
): Promise<SearchGroup<ResourceHit>> {
  const visible = await prisma.resource.findMany({
    where: visibleResourcesWhere(actor),
    select: { id: true },
  });
  if (visible.length === 0) return { hits: [], total: 0 };

  const vector = Prisma.sql`r."searchVector"`;
  // TITLE only for the trigram arm — the column migration 0002:86 indexed. Description
  // words are covered by stemming through the searchVector arm instead.
  const filter = matchFilter(vector, [Prisma.sql`r."title"`], q);
  const rank = rankOf(vector, q);
  const document = Prisma.sql`r.title || ' ' || coalesce(r.description, '')`;
  const inCandidates = candidateSet(
    Prisma.sql`r`,
    visible.map((row) => row.id),
  );

  const [hits, counts] = await prisma.$transaction([
    prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        type: 'DOCUMENT' | 'VIDEO' | 'LINK';
        courseName: string;
        headline: string;
      }>
    >`
      SELECT r.id, r.title, r.type, c.name AS "courseName",
             ${headlineOf(document, q)} AS headline
        FROM "Resource" r
        JOIN "Course" c ON c.id = r."courseId"
       WHERE ${inCandidates} AND ${filter}
    ORDER BY ${rank} DESC, r."createdAt" DESC, r.id ASC
       LIMIT ${limit}`,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
        FROM "Resource" r
       WHERE ${inCandidates} AND ${filter}`,
  ]);

  return {
    hits: hits.map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      courseName: row.courseName,
      headline: row.headline,
      linkPath: `/resources/${row.id}`,
    })),
    total: counts[0]?.count ?? 0,
  };
}

/** Announcements' mirror likewise carries both the live and published terms per role. */
async function announcementGroup(
  actor: Actor | null,
  { q, limit }: SearchQuery,
): Promise<SearchGroup<AnnouncementHit>> {
  const visible = await prisma.announcement.findMany({
    where: visibleAnnouncementsWhere(actor),
    select: { id: true },
  });
  if (visible.length === 0) return { hits: [], total: 0 };

  const vector = Prisma.sql`a."searchVector"`;
  const filter = matchFilter(vector, [Prisma.sql`a."title"`], q);
  const rank = rankOf(vector, q);
  const document = Prisma.sql`a.title || ' ' || a.content`;
  const inCandidates = candidateSet(
    Prisma.sql`a`,
    visible.map((row) => row.id),
  );

  const [hits, counts] = await prisma.$transaction([
    prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        type: 'NEWS' | 'EVENT' | 'ANNOUNCEMENT';
        headline: string;
      }>
    >`
      SELECT a.id, a.title, a.type,
             ${headlineOf(document, q)} AS headline
        FROM "Announcement" a
       WHERE ${inCandidates} AND ${filter}
    ORDER BY ${rank} DESC, a."createdAt" DESC, a.id ASC
       LIMIT ${limit}`,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
        FROM "Announcement" a
       WHERE ${inCandidates} AND ${filter}`,
  ]);

  return {
    hits: hits.map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      headline: row.headline,
      linkPath: `/announcements/${row.id}`,
    })),
    total: counts[0]?.count ?? 0,
  };
}
