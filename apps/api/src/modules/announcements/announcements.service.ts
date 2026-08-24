import { prisma, Prisma } from '@skillwright/db';
import {
  paginationMeta,
  slugSchema,
  toSkipTake,
  type Actor,
  type Paginated,
  type Subject,
} from '@skillwright/shared';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../lib/dto.js';
import { notFound, validationFailed } from '../../lib/errors.js';
import { notify } from '../notifications/notifications.service.js';
// The raw-SQL vocabulary for ranked search, shared with courses and resources so the
// three handlers cannot drift apart over escaping or weighting (search.sql.ts header).
import { rankedIdPage } from '../search/search.sql.js';
import type {
  AnnouncementDetail,
  AnnouncementSummary,
  CreateAnnouncementInput,
  ListAnnouncementsQuery,
  PublishAnnouncementInput,
  UpdateAnnouncementInput,
} from './announcements.schema.js';

/**
 * The relation every read needs. `as const` matters: Prisma derives the payload type
 * from the literal shape, and without it `AnnouncementGetPayload` widens to `boolean`
 * and the mapper stops being checked against the columns it reads.
 *
 * The author is `USER_SUMMARY_SELECT`, never `include: { author: true }` — a bare
 * include selects every User scalar, which pulls `passwordHash` and `totpSecret` into
 * the process for every row of every page (lib/dto.ts:44-53).
 */
const ANNOUNCEMENT_INCLUDE = { author: { select: USER_SUMMARY_SELECT } } as const;

type AnnouncementWithSummaryRelations = Prisma.AnnouncementGetPayload<{
  include: typeof ANNOUNCEMENT_INCLUDE;
}>;

/**
 * The summary include plus the one aggregate the detail DTO adds, on the same split
 * courses.service.ts makes between `COURSE_SUMMARY_INCLUDE` and
 * `COURSE_DETAIL_INCLUDE`: a paginated list of announcements should not pay for a
 * `comments` count on every row when the list DTO never reads one.
 *
 * The count filters `deletedAt` by hand because soft delete is not enforced by the
 * ORM, exactly as resources.service.ts:41 counts a resource's comments.
 */
const ANNOUNCEMENT_DETAIL_INCLUDE = {
  ...ANNOUNCEMENT_INCLUDE,
  _count: { select: { comments: { where: { deletedAt: null } } } },
} as const;

type AnnouncementWithDetailRelations = Prisma.AnnouncementGetPayload<{
  include: typeof ANNOUNCEMENT_DETAIL_INCLUDE;
}>;

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

const EXCERPT_LENGTH = 200;

/**
 * First ~200 characters, cut at a word boundary so a list page never ends a summary
 * mid-word. Built here, server-side, so list pages never ship a full 50,000-character
 * body (announcement.ts:53) just to render a teaser.
 */
function toExcerpt(content: string): string {
  if (content.length <= EXCERPT_LENGTH) return content;
  const slice = content.slice(0, EXCERPT_LENGTH);
  const lastSpace = slice.lastIndexOf(' ');
  return `${lastSpace > 0 ? slice.slice(0, lastSpace) : slice}…`;
}

/** The ONLY shape an announcement is serialised as on a list. */
export function toAnnouncementSummary(
  announcement: AnnouncementWithSummaryRelations,
): AnnouncementSummary {
  return {
    id: announcement.id,
    title: announcement.title,
    slug: announcement.slug,
    type: announcement.type,
    excerpt: toExcerpt(announcement.content),
    author: toUserSummary(announcement.author),
    eventDate: announcement.eventDate?.toISOString() ?? null,
    publishedAt: announcement.publishedAt?.toISOString() ?? null,
    createdAt: announcement.createdAt.toISOString(),
  };
}

/** The ONLY shape a single announcement is serialised as. */
export function toAnnouncementDetail(
  announcement: AnnouncementWithDetailRelations,
): AnnouncementDetail {
  return {
    ...toAnnouncementSummary(announcement),
    content: announcement.content,
    commentCount: announcement._count.comments,
    updatedAt: announcement.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Subject loader — the only database access authorization performs
// ---------------------------------------------------------------------------

/**
 * Subject for `announcement:read`, `:update`, `:delete` and `:publish` — every gate
 * that names one row (policy.ts:229-253).
 *
 * `undefined` for a missing or soft-deleted row so the policy denies, rather than this
 * loader throwing a bare 404 before the gate has run. An ADMIN still passes the gate on
 * a missing id (their cell is `allow`, which reads no field), and the service below
 * then answers a truthful 404.
 *
 * No `actor` parameter and no per-viewer field: unlike `resource:read`, nothing in the
 * `announcement:*` rows reads a viewer-scoped field like `enrollmentStatus` — `isAuthor`
 * compares `subject.authorId` against the CALLER's own id, which `can()` already has.
 *
 * Every field the announcement rules read is populated, named individually rather than
 * spread (a spread is not excess-property-checked, so a misspelled key would pass
 * silently — LESSONS-LEARNED #18):
 *   authorId    -> isAuthor     (combinators.ts:68-72)
 *   publishedAt -> isPublished  (combinators.ts:95-98)
 */
export async function loadAnnouncementSubject(id: string): Promise<Subject | undefined> {
  const announcement = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, authorId: true, publishedAt: true, deletedAt: true },
  });
  if (!announcement) return undefined;

  return {
    id: announcement.id,
    authorId: announcement.authorId,
    publishedAt: announcement.publishedAt,
    deletedAt: announcement.deletedAt,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The `announcement:read` policy rows (policy.ts:229-235) expressed as a WHERE clause.
 *
 * A list cannot ask `can()` a yes/no question — there is no single subject — so each
 * branch below mirrors one policy row and must be changed with it:
 *   anonymous -> isPublished                 (policy.ts)
 *   STUDENT   -> isPublished                 (policy.ts)
 *   TEACHER   -> or(isPublished, isAuthor)   (policy.ts)
 *   ADMIN     -> allow                       (policy.ts)
 *
 * STUDENT is written as plain `isPublished` rather than `or(isPublished, isAuthor)`:
 * the two are equivalent for a student because `announcement:create` denies STUDENT
 * outright (policy.ts:238-243), so `authorId` can never equal a student's own id — but
 * the literal policy row is what this mirrors, not a simplification of it.
 *
 * Reading `actor.role` here is choosing which WHERE mirrors which policy row — the one
 * legitimate role read named by CONTRIBUTING.md:48-55. It is NOT a permission check:
 * IF THIS FUNCTION AND policy.ts DISAGREE, THIS FUNCTION IS THE BUG.
 */
export function visibilityWhere(actor: Actor | null): Prisma.AnnouncementWhereInput {
  const live: Prisma.AnnouncementWhereInput = { deletedAt: null };
  const published: Prisma.AnnouncementWhereInput = { publishedAt: { not: null } };

  if (actor === null) return { AND: [live, published] };

  switch (actor.role) {
    case 'ADMIN':
      return live;
    case 'TEACHER':
      return { AND: [live, { OR: [published, { authorId: actor.id }] }] };
    case 'STUDENT':
      return { AND: [live, published] };
  }
}

/**
 * Visibility AND the caller's filters, never visibility OR them — `visibilityWhere`
 * already owns the top-level `OR`, and a second one at this level would silently
 * replace it, so a filter can narrow a caller's rows and can never widen them past the
 * policy. Same shape as resources.service.ts's `listWhere`.
 *
 * `q` is deliberately NOT one of these filters. A text term needs `ts_rank_cd` and the
 * trigram indexes (migration 0002), which Prisma cannot see — so when `q` is present
 * `list` switches to `listRanked` below instead of building a WHERE here.
 */
function listWhere(
  actor: Actor | null,
  query: ListAnnouncementsQuery,
): Prisma.AnnouncementWhereInput {
  const filters: Prisma.AnnouncementWhereInput[] = [visibilityWhere(actor)];

  if (query.type !== undefined) filters.push({ type: query.type });
  if (query.authorId !== undefined) filters.push({ authorId: query.authorId });

  // `published=false` is ignored for anonymous and STUDENT callers: `visibilityWhere`
  // already fixes both of them to published-only rows (there is no `enrolledApproved`
  // style escape hatch for an announcement), so applying the filter there would just
  // answer an empty page instead of the shelf they asked for. TEACHER and ADMIN are
  // the only roles that can ever see an unpublished row at all.
  if (actor !== null && actor.role !== 'STUDENT' && query.published !== undefined) {
    filters.push({ publishedAt: query.published ? { not: null } : null });
  }

  if (query.upcoming !== undefined) {
    // Only an EVENT row carries an `eventDate` — schema.prisma leaves it null for NEWS
    // and ANNOUNCEMENT rows — so this filter narrows to events on its own: a null
    // column never satisfies `gte` or `lt`, with no separate `type` term needed.
    const now = new Date();
    filters.push({ eventDate: query.upcoming ? { gte: now } : { lt: now } });
  }

  return { AND: filters };
}

type SortDirection = ListAnnouncementsQuery['order'];

const ORDER_BY: Record<
  string,
  (order: SortDirection) => Prisma.AnnouncementOrderByWithRelationInput
> = {
  createdAt: (order) => ({ createdAt: order }),
  updatedAt: (order) => ({ updatedAt: order }),
  publishedAt: (order) => ({ publishedAt: order }),
  eventDate: (order) => ({ eventDate: order }),
  title: (order) => ({ title: order }),
};

const DEFAULT_ORDER = (order: SortDirection): Prisma.AnnouncementOrderByWithRelationInput => ({
  createdAt: order,
});

/**
 * `hasOwnProperty`, not a bare `ORDER_BY[sort]` — load-bearing, not pedantic. An object
 * literal inherits from `Object.prototype`, so `ORDER_BY['toString']` is not
 * `undefined`; it is a function, which passes the `??` below and then runs with `this`
 * unbound and hands Prisma a broken `orderBy`. `sort` is free-form text off the query
 * string (pagination.ts:16); the whitelist is the only thing between a caller and that
 * key. Same guard as resources.service.ts's `orderFor`.
 */
function orderFor(query: ListAnnouncementsQuery): Prisma.AnnouncementOrderByWithRelationInput {
  const build =
    query.sort !== undefined && Object.prototype.hasOwnProperty.call(ORDER_BY, query.sort)
      ? ORDER_BY[query.sort]
      : undefined;
  return (build ?? DEFAULT_ORDER)(query.order);
}

/**
 * `GET /announcements`. `Actor | null` because the anonymous row of
 * `announcement:read` is `isPublished`, not `deny` (policy.ts:230): a logged-out
 * visitor is a legitimate caller here and gets the published feed.
 *
 * A `q` text term switches the whole read to `listRanked`: ranking needs the stored
 * `searchVector` tsvector and the trigram index (migration 0002), which live in the
 * database only and are invisible to Prisma.
 */
export async function list(
  actor: Actor | null,
  query: ListAnnouncementsQuery,
): Promise<Paginated<AnnouncementSummary>> {
  if (query.q !== undefined) return listRanked(actor, query, query.q);

  const where = listWhere(actor, query);

  const [rows, total] = await prisma.$transaction([
    prisma.announcement.findMany({
      where,
      ...toSkipTake(query),
      orderBy: orderFor(query),
      include: ANNOUNCEMENT_INCLUDE,
    }),
    prisma.announcement.count({ where }),
  ]);

  return {
    data: rows.map(toAnnouncementSummary),
    meta: paginationMeta(query.page, query.limit, total),
  };
}

/**
 * The ranked search path behind `?q=`, replacing the v1 substring fallback — same
 * three-phase shape as courses.service.ts's `listRanked`, and for the same reasons:
 *
 * Phase 1 proves visibility and every other filter through PRISMA (`listWhere` above),
 * so `visibilityWhere` stays the one mirror of the `announcement:read` rows and no SQL
 * copy of it can drift. Phase 2 ranks the surviving ids with raw SQL —
 * `searchVector @@ websearch_to_tsquery(...)` over title+content OR'd with a trigram
 * `ILIKE '%term%'` on TITLE, the one natural-key column migration 0002:87 indexed for
 * this table; stemming covers the content's words, the trigram arm covers partial
 * titles ("Closu") that stemming cannot see. Page and total go out as one
 * `$transaction`. Phase 3 hydrates with the SAME include and mapper as the ordinary
 * path and restores phase 2's order.
 *
 * When `q` is present, relevance ordering replaces `sort`/`order` — a search that
 * silently re-sorts by date would hide the best hit below the fold.
 */
async function listRanked(
  actor: Actor | null,
  query: ListAnnouncementsQuery,
  term: string,
): Promise<Paginated<AnnouncementSummary>> {
  const candidates = await prisma.announcement.findMany({
    where: listWhere(actor, query),
    select: { id: true },
  });
  if (candidates.length === 0) {
    return { data: [], meta: paginationMeta(query.page, query.limit, 0) };
  }

  const { page, total } = rankedIdPage({
    table: Prisma.sql`"Announcement" a`,
    alias: Prisma.sql`a`,
    vector: Prisma.sql`a."searchVector"`,
    likeColumns: [Prisma.sql`a."title"`],
    term,
    candidateIds: candidates.map((row) => row.id),
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });
  const [matches, counts] = await prisma.$transaction([page, total]);

  const meta = paginationMeta(query.page, query.limit, counts[0]?.count ?? 0);
  const orderedIds = matches.map((row) => row.id);
  if (orderedIds.length === 0) return { data: [], meta };

  const rows = await prisma.announcement.findMany({
    where: { id: { in: orderedIds } },
    include: ANNOUNCEMENT_INCLUDE,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  return {
    data: orderedIds.flatMap((id) => {
      const announcement = byId.get(id);
      return announcement ? [toAnnouncementSummary(announcement)] : [];
    }),
    meta,
  };
}

/**
 * One announcement, after `authorize('announcement:read')` has already accepted the
 * caller. `findFirst` with the soft-delete filter rather than `findUniqueOrThrow`: an
 * ADMIN passes the gate on an id that does not exist (their cell is `allow`, which
 * reads no subject field), so a missing row is a reachable path here, not merely a
 * race, and it has to answer 404 rather than a null-dereference 500.
 */
export async function getById(id: string): Promise<AnnouncementDetail> {
  const announcement = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    include: ANNOUNCEMENT_DETAIL_INCLUDE,
  });
  if (!announcement) throw notFound('Announcement');
  return toAnnouncementDetail(announcement);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Derives the URL slug the server owns, the same convention departments.service.ts and
 * courses.service.ts use. NFKD first so an accented letter decomposes into a plain one
 * plus a combining mark; the mark is not alphanumeric, so the same pass that collapses
 * spaces removes it.
 */
function deriveSlug(title: string): string {
  return title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The slug is accepted so a migration can preserve an existing URL, and derived from
 * the title otherwise. Either way it is validated against the shared rule before the
 * insert, which turns a title that derives to nothing (all punctuation) into a 422 on
 * `slug` instead of a raw write — same shape as departments.service.ts's `create`.
 */
function resolveSlug(candidate: string | undefined, title: string): string {
  const parsed = slugSchema.safeParse(candidate ?? deriveSlug(title));
  if (!parsed.success) {
    throw validationFailed([
      {
        path: 'slug',
        message: 'Could not derive a URL slug from this title. Send one explicitly.',
      },
    ]);
  }
  return parsed.data;
}

/**
 * ANNOUNCEMENT_PUBLISHED's audience, shared by the two paths that can flip a row live
 * (`create` with `publish: true` and `publish`). An Announcement has no course to scope
 * it (schema.prisma:465-490) — it speaks to the whole school — so "approved enrolled
 * students" is read school-wide: every student seated in a live course except the actor.
 * The Phase 1 plan's parenthetical named a course the schema does not give announcements;
 * this is that sentence adapted to the rows that exist.
 */
async function approvedStudentIdsExcept(exceptUserId: string): Promise<string[]> {
  const rows = await prisma.enrollment.findMany({
    where: {
      status: 'APPROVED',
      studentId: { not: exceptUserId },
      // Seats are per-intake since Phase 9, so the relation is two hops; a student
      // seated on several intakes of one course appears once — SELECT dedupes.
      offering: { deletedAt: null, course: { deletedAt: null } },
    },
    select: { studentId: true },
    distinct: ['studentId'],
  });
  return rows.map((row) => row.studentId);
}

/**
 * `announcement:create` was decided at the route with no subject at all — TEACHER and
 * ADMIN are both a flat `allow` (policy.ts:238-243) — so everything here is data
 * shaping. The author is always the session, never the body: `createAnnouncementSchema`
 * has no `authorId` (announcement.ts:44-53), and there is no admin-on-behalf-of field
 * the way `course:create` has `teacherId` — an announcement always speaks in its
 * creator's voice.
 */
export async function create(
  actor: Actor,
  input: CreateAnnouncementInput,
): Promise<AnnouncementDetail> {
  const slug = resolveSlug(input.slug, input.title);

  const announcement = await prisma.announcement.create({
    data: {
      title: input.title,
      slug,
      content: input.content,
      type: input.type,
      authorId: actor.id,
      eventDate: input.eventDate ? new Date(input.eventDate) : null,
      // Create-then-publish is two steps by default (announcement.ts:51); `publish`
      // only flips this row live immediately when the caller asked for that.
      publishedAt: input.publish ? new Date() : null,
    },
    include: ANNOUNCEMENT_DETAIL_INCLUDE,
  });

  // The row went live in the create above; announce it after that commit, best-effort
  // (notify() never throws). A draft created without `publish` announces nothing here —
  // its publication is `publish`'s event to announce.
  if (input.publish) {
    await notify({
      userIds: await approvedStudentIdsExcept(actor.id),
      type: 'ANNOUNCEMENT_PUBLISHED',
      title: 'New announcement',
      body: `${announcement.author.name} posted: ${announcement.title}`,
      linkPath: `/announcements/${announcement.id}`,
    });
  }

  return toAnnouncementDetail(announcement);
}

/**
 * No `slug` in `updateAnnouncementSchema` (announcement.ts:57-65) — URLs are stable,
 * the same rule departments.service.ts documents for its own update.
 */
export async function update(
  id: string,
  input: UpdateAnnouncementInput,
): Promise<AnnouncementDetail> {
  const current = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!current) throw notFound('Announcement');

  const announcement = await prisma.announcement.update({
    where: { id },
    data: {
      // Keys are spread in or left out entirely: under `exactOptionalPropertyTypes`,
      // `{ title: undefined }` is not assignable to an optional field, and writing it
      // would also overwrite a column the caller never mentioned.
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.eventDate !== undefined
        ? { eventDate: input.eventDate === null ? null : new Date(input.eventDate) }
        : {}),
    },
    include: ANNOUNCEMENT_DETAIL_INCLUDE,
  });

  return toAnnouncementDetail(announcement);
}

/**
 * `POST /:id/publish`. `published` is a boolean rather than a bare publish verb
 * (announcement.ts:67-68) on the same shape as `course:publish` — one action, two
 * directions, one audit shape.
 *
 * Idempotent like `enrollments.service.ts`'s `approve`: a second call in the direction
 * the row is already in must not move `publishedAt`. For publish that matters because
 * `publishedAt` is the row's go-live time — a second click must not reset how long a
 * post has been live — and for unpublish it just avoids a write nobody asked for.
 */
export async function publish(
  actor: Actor,
  id: string,
  input: PublishAnnouncementInput,
): Promise<AnnouncementDetail> {
  const current = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, publishedAt: true },
  });
  if (!current) throw notFound('Announcement');

  const alreadyInTargetState = input.published
    ? current.publishedAt !== null
    : current.publishedAt === null;
  if (alreadyInTargetState) return getById(id);

  const announcement = await prisma.announcement.update({
    where: { id },
    data: { publishedAt: input.published ? new Date() : null },
    include: ANNOUNCEMENT_DETAIL_INCLUDE,
  });

  // Only the draft -> live transition announces, and only after the update has
  // committed; best-effort (notify() never throws). Unpublishing is silent — a row
  // telling students about a post that has just been withdrawn would be noise with a
  // link to it.
  if (input.published) {
    await notify({
      userIds: await approvedStudentIdsExcept(actor.id),
      type: 'ANNOUNCEMENT_PUBLISHED',
      title: 'New announcement',
      body: `${announcement.author.name} posted: ${announcement.title}`,
      linkPath: `/announcements/${announcement.id}`,
    });
  }

  return toAnnouncementDetail(announcement);
}

/**
 * Soft delete only — schema.prisma rule 3, which is why every read in this file
 * filters `deletedAt`. A hard delete would also cascade the row's comments away
 * (schema.prisma:508), and removing a post does not mean erasing the discussion under
 * it.
 */
export async function remove(id: string): Promise<void> {
  const announcement = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!announcement) throw notFound('Announcement');

  await prisma.announcement.update({ where: { id }, data: { deletedAt: new Date() } });
}
