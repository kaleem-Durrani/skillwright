import { prisma, Prisma } from '@skillwright/db';
import {
  paginationMeta,
  toSkipTake,
  type Actor,
  type CourseOffering as CourseOfferingDto,
  type CoursePrerequisite,
  type Paginated,
  type Subject,
} from '@skillwright/shared';
import { COURSE_SUMMARY_INCLUDE, toCourseSummary, toOfferingSummary } from '../../lib/dto.js';
import { conflict, notFound, validationFailed } from '../../lib/errors.js';
// The Upload row belongs to the uploads module, and so does the question of whether
// this actor may claim it. Before this, `syllabusUploadId` was written unchecked.
import { assertUploadClaimable } from '../uploads/uploads.service.js';
import { notify } from '../notifications/notifications.service.js';
import { presignGet, safeFilename } from '../../lib/storage.js';
// The raw-SQL vocabulary for ranked search — match predicate, rank expression and the
// two-query page-plus-total shape. Shared with resources and announcements so the three
// handlers cannot drift apart over escaping or weighting (search.sql.ts header).
import { rankedIdPage } from '../search/search.sql.js';
import type {
  CourseDetail,
  CourseListItem,
  CreateCourseInput,
  CreateCourseOfferingInput,
  ListCoursesQuery,
  PublishCourseInput,
  UpdateCourseInput,
  UpdateCourseOfferingInput,
} from './courses.schema.js';

/**
 * The detail include is the summary include (lib/dto.ts) plus the aggregates the detail
 * DTO adds. Spread rather than restated so the query and the mappers can never disagree
 * about which relations are loaded.
 *
 * Offerings are the per-intake rows (Phase 9): soft delete is not enforced by the ORM,
 * so the nested filter excludes deleted intakes by hand exactly like every other read
 * in this file, and soonest-start-first is how a school thinks about its calendar
 * (`startDate` is nullable; Postgres sorts NULLS LAST ascending, so an intake with no
 * date yet sits under every scheduled one).
 *
 * `syllabusUpload` carries exactly what a signed download needs — key, original name,
 * status — and no bytes ever flow through this process.
 */
const COURSE_LIST_INCLUDE = {
  ...COURSE_SUMMARY_INCLUDE,
  // Exactly what `coursePrerequisiteSchema` (course.ts) serialises: enough to name
  // "Requires: SMAW Level 1" on a card, and no second fetch for it.
  prerequisite: { select: { id: true, code: true, name: true } },
  offerings: {
    where: { deletedAt: null },
    // An explicit mutable-array cast, because Prisma's generated args type rejects a
    // readonly array while the outer `as const` below makes every literal one.
    orderBy: [
      { startDate: 'asc' },
      { id: 'asc' },
    ] as Prisma.CourseOfferingOrderByWithRelationInput[],
  },
} as const;

type CourseWithPrerequisiteRelations = Prisma.CourseGetPayload<{
  include: typeof COURSE_LIST_INCLUDE;
}>;

const COURSE_DETAIL_INCLUDE = {
  ...COURSE_LIST_INCLUDE,
  syllabusUpload: { select: { key: true, originalName: true, status: true } },
  _count: { select: { resources: { where: { deletedAt: null } } } },
} as const;

type CourseWithDetail = Prisma.CourseGetPayload<{ include: typeof COURSE_DETAIL_INCLUDE }>;

/**
 * The five fields the `course:*` policy rows read, plus the prerequisite pointer
 * `hasCompletedPrerequisite` reads on the `enrollment:request` subject built from
 * this select. Nothing else reads it yet; carrying it costs one nullable column.
 *
 * Phase 9 moved dates/capacities off Course but moved NOTHING this select reads:
 * identity, ownership, publication, department and the ladder rung are all still
 * columns of the template, so the subject shape is unchanged.
 */
const SUBJECT_SELECT = {
  id: true,
  teacherId: true,
  departmentId: true,
  publishedAt: true,
  deletedAt: true,
  prerequisiteCourseId: true,
} as const;

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/*
 * `toCourseSummary` and `toOfferingSummary` are imported from lib/dto.ts. They are
 * nested pieces of three other DTOs besides this module's, and they own the seat
 * arithmetic, which has to exist in exactly one place.
 */

/** The ONLY shape a prerequisite is serialised as — null means the course is ungated. */
function toCoursePrerequisite(
  prerequisite: CourseWithPrerequisiteRelations['prerequisite'],
): CoursePrerequisite | null {
  return prerequisite === null
    ? null
    : { id: prerequisite.id, code: prerequisite.code, name: prerequisite.name };
}

/**
 * The actor-relative status one offering carries inside a top-level course payload.
 * It moved INTO the offerings since Phase 9, so the old
 * `CourseDetail['viewerEnrollmentStatus']` path no longer exists; this alias is the
 * honest address of where it lives now.
 */
type ViewerEnrollmentStatus = CourseDetail['offerings'][number]['viewerEnrollmentStatus'];

/**
 * Serialises one offering row, attaching THE REQUESTING ACTOR'S status ON THAT INTAKE
 * when the caller has one (the top-level course payloads). `null` for anonymous,
 * teachers, admins, and intakes the actor has no row for — the same answer the old
 * single-offering world gave.
 */
function toViewerOffering(
  offering: CourseWithDetail['offerings'][number],
  status: ViewerEnrollmentStatus | undefined,
): CourseDetail['offerings'][number] {
  return { ...toOfferingSummary(offering), viewerEnrollmentStatus: status ?? null };
}

/**
 * `viewerEnrollmentStatus` is resolved per OFFERING now that seats are sold per
 * intake: the parameter maps offering ids to the actor's status on each, which no
 * include can express because it is REQUESTING-actor-relative.
 *
 * Async only because presigning is: the syllabus download mirrors
 * `buildDownloadUrl` (resources.service.ts) — same signed GET, same 5-minute TTL,
 * same `attachment` disposition under `originalName`. A PENDING or missing upload
 * answers null rather than a URL: signing unverified bytes is exactly what the
 * resources download endpoint refuses with 409, and a detail DTO has no error channel,
 * so "no verified object" degrades to "no link" instead of a button that 403s out of
 * the bucket. Unreachable for rows attached through the API since
 * `assertUploadClaimable` began refusing PENDING claims; kept for legacy rows.
 */
export async function toCourseDetail(
  course: CourseWithDetail,
  statusByOffering: ReadonlyMap<string, ViewerEnrollmentStatus>,
): Promise<CourseDetail> {
  const { syllabusUpload } = course;
  const syllabusUrl =
    syllabusUpload !== null && syllabusUpload.status === 'COMMITTED'
      ? (
          await presignGet({
            key: syllabusUpload.key,
            filename: safeFilename(syllabusUpload.originalName),
          })
        ).url
      : null;

  return {
    ...toCourseSummary(course),
    description: course.description,
    syllabusUploadId: course.syllabusUploadId,
    syllabusUrl,
    resourceCount: course._count.resources,
    prerequisiteCourseId: course.prerequisiteCourseId,
    prerequisite: toCoursePrerequisite(course.prerequisite),
    offerings: course.offerings.map((offering) =>
      toViewerOffering(offering, statusByOffering.get(offering.id)),
    ),
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString(),
  };
}

/**
 * One catalogue row (course.ts). Same per-intake status resolution as the detail
 * mapper, fed by ONE query for the WHOLE page — see
 * `viewerEnrollmentStatusByOffering`.
 */
export function toCourseListItem(
  course: CourseWithPrerequisiteRelations,
  statusByOffering: ReadonlyMap<string, ViewerEnrollmentStatus>,
): CourseListItem {
  return {
    ...toCourseSummary(course),
    description: course.description,
    prerequisiteCourseId: course.prerequisiteCourseId,
    prerequisite: toCoursePrerequisite(course.prerequisite),
    offerings: course.offerings.map((offering) =>
      toViewerOffering(offering, statusByOffering.get(offering.id)),
    ),
  };
}

// ---------------------------------------------------------------------------
// Subjects — loaded here, decided by can() in the auth plugin
// ---------------------------------------------------------------------------

/**
 * Returns `undefined` for a missing or soft-deleted row so the policy denies, rather
 * than the loader throwing a bare 404 before the gate has run.
 */
export async function loadCourseSubject(id: string): Promise<Subject | undefined> {
  const course = await prisma.course.findFirst({
    where: { id, deletedAt: null },
    select: SUBJECT_SELECT,
  });
  if (!course) return undefined;
  return {
    id: course.id,
    // `ownsCourse` reads `courseTeacherId` (combinators.ts), NOT `teacherId`.
    // A wrong key here is a silent denial, because every Subject field is optional.
    courseTeacherId: course.teacherId,
    departmentId: course.departmentId,
    publishedAt: course.publishedAt,
    deletedAt: course.deletedAt,
    // Selected and returned explicitly — every nested-route enrollment request once
    // denied because an absent `prerequisiteCourseId` means "loader forgot" and
    // `hasCompletedPrerequisite` refuses (LESSONS-LEARNED #31). Explicit null = ungated.
    prerequisiteCourseId: course.prerequisiteCourseId,
  };
}

/**
 * The same subject plus the requesting actor's own enrollment status in the COURSE —
 * APPROVED on any live offering of it — which the STUDENT row of `course:read` needs:
 * without it `enrolledApproved` (combinators.ts) can never fire and an approved student
 * is 403'd off a course that was later unpublished.
 */
export async function loadCourseSubjectForActor(
  id: string,
  actor: Actor | null,
): Promise<Subject | undefined> {
  const subject = await loadCourseSubject(id);
  if (!subject) return undefined;
  return { ...subject, enrollmentStatus: await courseEnrollmentStatus(actor, id) };
}

/**
 * Subject for the two enrollment gates that hang off the `/courses/:courseId` path.
 * The subject is still the COURSE (policy.ts), with `studentId` added for a
 * student so `isEnrolledStudent` can match — the row-level scoping of what a student
 * actually sees is the enrollments service's WHERE clause, not this gate.
 *
 * For a student it also carries `completedCourseIds`: `hasCompletedPrerequisite`
 * reads it on `enrollment:request`, and a subject that omits it denies EVERY gated
 * request silently — LESSONS-LEARNED #15/#31. One indexed query
 * (`@@index([studentId, status])`), whatever the catalogue looks like.
 */
export async function loadCourseEnrollmentSubject(
  courseId: string,
  actor: Actor | null,
): Promise<Subject | undefined> {
  const subject = await loadCourseSubject(courseId);
  if (!subject) return undefined;
  return {
    ...subject,
    courseId,
    ...(actor?.role === 'STUDENT'
      ? { studentId: actor.id, completedCourseIds: await completedCourseIds(actor.id) }
      : {}),
  };
}

/**
 * The ids the student holds APPROVED enrollments for — "completed" for
 * prerequisite purposes, exactly as `enrolledApproved` defines completion for the
 * rest of policy (a PENDING request is not a seat). Since Phase 9 enrollments point
 * at offerings, so the course id rides the relation. Duplicated in
 * enrollments.service.ts on purpose: each module owns its own loader's database
 * access, per the same note on that file.
 */
async function completedCourseIds(studentId: string): Promise<string[]> {
  const rows = await prisma.enrollment.findMany({
    where: { studentId, status: 'APPROVED' },
    select: { offering: { select: { courseId: true } } },
  });
  return [...new Set(rows.map((row) => row.offering.courseId))];
}

/**
 * The actor's own enrollment status in one course, scoped to the actor — passing
 * someone else's status into a Subject is the one way to misuse this field
 * (actor.ts). Reading the role here is data scoping, not authorization.
 *
 * A student may hold several rows across a course's intakes; ANY APPROVED seat makes
 * the course theirs (the meaning `enrolledApproved` has always carried). Otherwise the
 * MOST RECENT row wins, so "PENDING" reflects where they actually stand rather than
 * whatever the oldest application said.
 */
async function courseEnrollmentStatus(
  actor: Actor | null,
  courseId: string,
): Promise<ViewerEnrollmentStatus> {
  if (actor === null || actor.role !== 'STUDENT') return null;
  const approved = await prisma.enrollment.findFirst({
    where: {
      studentId: actor.id,
      status: 'APPROVED',
      offering: { courseId, deletedAt: null },
    },
    select: { status: true },
  });
  if (approved) return approved.status;
  const latest = await prisma.enrollment.findFirst({
    where: { studentId: actor.id, offering: { courseId, deletedAt: null } },
    orderBy: { requestedAt: 'desc' },
    select: { status: true },
  });
  return latest?.status ?? null;
}

/**
 * The actor's status PER OFFERING for a whole page of courses, in ONE query — never
 * one query per row: a 100-row page would fire 100 extra round trips to render one
 * badge per intake, and the cost would grow with the page size rather than stay flat.
 *
 * The read rides `@@index([studentId, status])`; an intake the actor has no row for
 * is simply absent from the Map, which the mappers render as null.
 */
async function viewerEnrollmentStatusByOffering(
  actor: Actor | null,
  offeringIds: string[],
): Promise<Map<string, ViewerEnrollmentStatus>> {
  const statuses = new Map<string, ViewerEnrollmentStatus>();
  if (actor === null || actor.role !== 'STUDENT' || offeringIds.length === 0) return statuses;

  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: actor.id, offeringId: { in: offeringIds } },
    select: { offeringId: true, status: true, requestedAt: true },
    orderBy: { requestedAt: 'desc' },
  });
  // First row per offering IS the most recent one (the orderBy above).
  for (const enrollment of enrollments) {
    if (!statuses.has(enrollment.offeringId)) {
      statuses.set(enrollment.offeringId, enrollment.status);
    }
  }
  return statuses;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The `course:read` policy rows (policy.ts) expressed as a WHERE clause.
 *
 * This is the one legitimate role read in the module: a list endpoint cannot ask
 * `can()` a yes/no question, so each branch below mirrors one policy row and must be
 * changed with it. The per-row decision is what `GET /courses/:id` still runs.
 *   anonymous -> isPublished                          (policy.ts)
 *   STUDENT   -> or(isPublished, enrolledApproved)    (policy.ts)
 *   TEACHER   -> or(isPublished, ownsCourse)          (policy.ts)
 *   ADMIN     -> allow                                (policy.ts)
 *
 * `enrolledApproved` is "an APPROVED seat on some live offering" since Phase 9 — two
 * relation hops, same rule.
 *
 * EXPORTED because the cross-entity search module (`GET /search`) must scope its
 * course group by exactly this clause — the dashboard's arrangement
 * (dashboard.service.ts imports resources' clause rather than keeping a second copy),
 * and for the same reason. NOTE for every importer: unlike resources and
 * announcements, this clause deliberately carries NO soft-delete term — the catalogue's
 * own `listWhere` applies `deletedAt: null` outside it — so importers must add that
 * term themselves.
 */
export function visibilityWhere(actor: Actor | null): Prisma.CourseWhereInput {
  if (actor === null) return { publishedAt: { not: null } };
  switch (actor.role) {
    case 'ADMIN':
      return {};
    case 'TEACHER':
      return { OR: [{ publishedAt: { not: null } }, { teacherId: actor.id }] };
    case 'STUDENT':
      return {
        OR: [
          { publishedAt: { not: null } },
          {
            offerings: {
              some: {
                deletedAt: null,
                enrollments: { some: { studentId: actor.id, status: 'APPROVED' } },
              },
            },
          },
        ],
      };
  }
}

/**
 * Visibility AND the caller's filters, never visibility OR them. The filters are
 * collected into `AND` because `visibilityWhere` already owns the top-level `OR` and
 * a second one would silently replace it.
 *
 * `q` is deliberately NOT one of these filters. A text term needs `ts_rank_cd` and the
 * trigram indexes (migration 0002), which Prisma cannot see — so when `q` is present
 * `list` switches to `listRanked` below instead of building a WHERE here. Everything
 * else a caller can send is expressed exactly once, in this function, and both paths
 * consume it.
 */
function listWhere(actor: Actor | null, query: ListCoursesQuery): Prisma.CourseWhereInput {
  const filters: Prisma.CourseWhereInput[] = [visibilityWhere(actor)];

  // course.ts — `published` is ignored for anonymous callers, who only ever see
  // published courses. Applying it there would answer `published=false` with an empty
  // page instead of the catalogue they asked for.
  if (actor !== null && query.published !== undefined) {
    filters.push({ publishedAt: query.published ? { not: null } : null });
  }
  if (query.hasSeats === true) {
    // Column-to-column comparison via a Prisma field reference; the alternative is
    // raw SQL, and this stays inside the same query the count reuses. Seats are an
    // offering fact since Phase 9, so "has seats" means SOME live intake has them.
    filters.push({
      offerings: {
        some: { deletedAt: null, approvedCount: { lt: prisma.courseOffering.fields.capacity } },
      },
    });
  }

  return {
    deletedAt: null,
    ...(query.departmentId !== undefined ? { departmentId: query.departmentId } : {}),
    ...(query.teacherId !== undefined ? { teacherId: query.teacherId } : {}),
    AND: filters,
  };
}

/**
 * `sort` arrives as free-form text (pagination.ts), so it is matched against this
 * whitelist and never interpolated into an `orderBy` key.
 *
 * `capacity`/`approvedCount` were dropped as sort keys when the guarded numbers moved
 * onto offerings (Phase 9): ordering templates by a number they no longer carry was
 * meaningless, and aggregating across intakes would invent a semantics nobody asked
 * for. Name, code, publication date and creation date remain template facts.
 */
function orderFor(query: ListCoursesQuery): Prisma.CourseOrderByWithRelationInput {
  switch (query.sort) {
    case 'name':
      return { name: query.order };
    case 'code':
      return { code: query.order };
    case 'publishedAt':
      return { publishedAt: query.order };
    default:
      return { createdAt: query.order };
  }
}

/**
 * The catalogue. Rows are `CourseListItem`, not `CourseSummary`: the browse screen shows
 * a blurb and whether the viewer has already applied to each intake.
 *
 * Two queries — page and total — plus ONE more for a signed-in student, whatever the
 * page size. The badge is never resolved row by row.
 *
 * A `q` text term switches the whole read to `listRanked`: ranking needs the stored
 * `searchVector` tsvector and the trigram indexes (migration 0002), which live in the
 * database only and are invisible to Prisma. Every other filter still flows through
 * `listWhere` above.
 */
export async function list(
  actor: Actor | null,
  query: ListCoursesQuery,
): Promise<Paginated<CourseListItem>> {
  if (query.q !== undefined) return listRanked(actor, query, query.q);

  const where = listWhere(actor, query);
  const [rows, total] = await prisma.$transaction([
    prisma.course.findMany({
      where,
      ...toSkipTake(query),
      orderBy: orderFor(query),
      include: COURSE_LIST_INCLUDE,
    }),
    prisma.course.count({ where }),
  ]);

  // One query for the page, never one per row — see `viewerEnrollmentStatusByOffering`.
  const statuses = await viewerEnrollmentStatusByOffering(
    actor,
    rows.flatMap((row) => row.offerings.map((offering) => offering.id)),
  );

  return {
    data: rows.map((row) => toCourseListItem(row, statuses)),
    meta: paginationMeta(query.page, query.limit, total),
  };
}

/**
 * The ranked search path behind `?q=`, replacing the v1 substring fallback.
 *
 * THREE phases, and the split is deliberate:
 *
 * Phase 1 finds every candidate through PRISMA — `listWhere`, which is `visibilityWhere`
 * plus the caller's other filters. This is why visibility is never restated in SQL:
 * `visibilityWhere` is the one mirror of the `course:read` rows, and a second copy
 * inside raw SQL is exactly how dashboard.service.ts's resource tile once drifted from
 * the list it sat above (LESSONS-LEARNED #15/#31/#33 are all this shape of mistake).
 *
 * Phase 2 ranks those candidate ids with raw SQL (`rankedIdPage`): `searchVector @@
 * websearch_to_tsquery(...)` for stemmed words, phrases and `-exclusions`, OR'd with a
 * trigram `ILIKE '%term%'` on name/code so partial codes like "WELD-2" keep matching —
 * `websearch_to_tsquery('WELD-2')` parses the hyphen as negation syntax and matches
 * nothing, which is measured fact rather than caution, and the whole reason migration
 * 0002 built both index families. Page and total go out as one `$transaction`.
 *
 * Phase 9 left this path alone: the generated column weights name/code/description,
 * all three of which STAYED on the template, so the tsvector and the trgm indexes on
 * Course remain exactly what they were — no join, no rebuild, no denormalising.
 *
 * Phase 3 hydrates the surviving ids with the SAME include and mapper the ordinary
 * path uses, so the response shape cannot diverge between searched and unsearched
 * lists, then restores phase 2's order (a Prisma `in`-query does not preserve it).
 *
 * When `q` is present, relevance ordering replaces `sort`/`order` — a search that
 * silently re-sorts by date would hide the best hit below the fold.
 */
async function listRanked(
  actor: Actor | null,
  query: ListCoursesQuery,
  term: string,
): Promise<Paginated<CourseListItem>> {
  const candidates = await prisma.course.findMany({
    where: listWhere(actor, query),
    select: { id: true },
  });
  if (candidates.length === 0) {
    return { data: [], meta: paginationMeta(query.page, query.limit, 0) };
  }

  const { page, total } = rankedIdPage({
    table: Prisma.sql`"Course" c`,
    alias: Prisma.sql`c`,
    vector: Prisma.sql`c."searchVector"`,
    likeColumns: [Prisma.sql`c."name"`, Prisma.sql`c."code"`],
    term,
    candidateIds: candidates.map((row) => row.id),
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });
  const [matches, counts] = await prisma.$transaction([page, total]);

  const meta = paginationMeta(query.page, query.limit, counts[0]?.count ?? 0);
  const orderedIds = matches.map((row) => row.id);
  if (orderedIds.length === 0) return { data: [], meta };

  const courseRows = await prisma.course.findMany({
    where: { id: { in: orderedIds } },
    include: COURSE_LIST_INCLUDE,
  });
  const statuses = await viewerEnrollmentStatusByOffering(
    actor,
    courseRows.flatMap((row) => row.offerings.map((offering) => offering.id)),
  );
  const byId = new Map(courseRows.map((row) => [row.id, row]));

  return {
    data: orderedIds.flatMap((id) => {
      const course = byId.get(id);
      return course ? [toCourseListItem(course, statuses)] : [];
    }),
    meta,
  };
}

export async function getById(actor: Actor | null, id: string): Promise<CourseDetail> {
  const course = await prisma.course.findFirst({
    where: { id, deletedAt: null },
    include: COURSE_DETAIL_INCLUDE,
  });
  if (!course) throw notFound('Course');

  const statuses = await viewerEnrollmentStatusByOffering(
    actor,
    course.offerings.map((offering) => offering.id),
  );
  return toCourseDetail(course, statuses);
}

// ---------------------------------------------------------------------------
// Mutations — the template
// ---------------------------------------------------------------------------

/** ISO string in, `Date` or explicit null out — Prisma never sees a string date. */
function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

/**
 * Derived from the name when the client does not supply one, the same convention
 * departments use (department.ts). The code is the fallback because a name of
 * nothing but punctuation would otherwise produce a slug `slugSchema` rejects.
 */
function slugify(name: string, code: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug.slice(0, 120).replace(/-+$/g, '') : code.toLowerCase();
}

/** A foreign key the client chose turns a 500 into a field-level 422 (auth.service.ts). */
async function assertDepartmentExists(departmentId: string): Promise<void> {
  const department = await prisma.department.findFirst({
    where: { id: departmentId, deletedAt: null },
    select: { id: true },
  });
  if (!department) {
    throw validationFailed([{ path: 'departmentId', message: 'Unknown department' }]);
  }
}

async function assertTeacherExists(teacherId: string): Promise<void> {
  const teacher = await prisma.user.findFirst({
    where: { id: teacherId, deletedAt: null },
    select: { id: true },
  });
  if (!teacher) {
    throw validationFailed([{ path: 'teacherId', message: 'Unknown teacher' }]);
  }
}

/**
 * A prerequisite the client chose is validated, not trusted — same shape as
 * `assertDepartmentExists`: a foreign key turns into a field-level 422, never a
 * foreign-key 500.
 *
 * Cycles are impossible ONLY because every write through here walks the chain:
 * a 2-level check is not enough, because depth grows one PATCH at a time —
 * A -> B is fine, B -> A needs level 2, and A -> B -> C -> A needs level 3. The
 * walk starts above the candidate and refuses if it ever arrives back at the
 * course being edited; by induction the graph stays acyclic, so the walk always
 * terminates on its own and the visited set is belt-and-braces.
 */
async function assertPrerequisiteAllowed(
  id: string,
  prerequisiteCourseId: string | null,
): Promise<void> {
  // Explicit null clears the requirement; there is nothing to validate.
  if (prerequisiteCourseId === null) return;

  if (prerequisiteCourseId === id) {
    throw validationFailed([
      { path: 'prerequisiteCourseId', message: 'A course cannot be its own prerequisite' },
    ]);
  }

  const exists = await prisma.course.findFirst({
    where: { id: prerequisiteCourseId, deletedAt: null },
    select: { id: true },
  });
  if (!exists) {
    throw validationFailed([{ path: 'prerequisiteCourseId', message: 'Unknown course' }]);
  }

  // Chains are short (101 -> 201 -> 301), so point queries beat loading the table.
  const seen = new Set<string>([id]);
  let cursor: string | null = prerequisiteCourseId;
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const next: { prerequisiteCourseId: string | null } | null = await prisma.course.findUnique({
      where: { id: cursor },
      select: { prerequisiteCourseId: true },
    });
    // Defensive only: no dangling edge can exist through this API.
    cursor = next?.prerequisiteCourseId ?? null;
  }
  if (cursor !== null) {
    throw validationFailed([
      { path: 'prerequisiteCourseId', message: 'Setting this prerequisite would create a cycle' },
    ]);
  }
}

export async function create(actor: Actor, input: CreateCourseInput): Promise<CourseDetail> {
  await assertDepartmentExists(input.departmentId);
  // `syllabusUploadId` used to go from the body straight into the row. Nothing checked
  // that the Upload existed, belonged to this actor, had been committed, or was not
  // already somebody else's syllabus — so a teacher could bind a colleague's private
  // file to their own course by guessing an id.
  if (input.syllabusUploadId) {
    await assertUploadClaimable(input.syllabusUploadId, actor, 'syllabusUploadId');
  }

  // Data shaping, not authorization: `course:create` was already decided by
  // authorize() at the route. course.ts — teacherId is an admin-only field, and a
  // teacher always gets themself.
  const teacherId = actor.role === 'ADMIN' ? (input.teacherId ?? actor.id) : actor.id;
  await assertTeacherExists(teacherId);

  /*
   * The course AND its first intakes are created together, but as SEPARATE statements
   * inside one transaction rather than a nested `offerings: { create: [...] }`: the
   * audit extension intercepts TOP-LEVEL operations only (audit.ts), so a nested write
   * would land silently outside the trail. Each `tx.courseOffering.create` passes
   * through it and writes its own CREATE row — `CourseOffering` is in AUDITED_MODELS.
   */
  const courseId = await prisma.$transaction(async (tx) => {
    const course = await tx.course.create({
      data: {
        code: input.code,
        slug: input.slug ?? slugify(input.name, input.code),
        name: input.name,
        description: input.description ?? null,
        departmentId: input.departmentId,
        teacherId,
        durationValue: input.duration.value,
        durationUnit: input.duration.unit,
        syllabusUploadId: input.syllabusUploadId ?? null,
        // `publishedAt` stays null: creating a course does not publish it.
      },
      select: { id: true },
    });
    for (const offering of input.offerings) {
      await tx.courseOffering.create({
        data: {
          courseId: course.id,
          capacity: offering.capacity,
          workshopCapacity: offering.workshopCapacity ?? null,
          startDate: toDate(offering.startDate),
          endDate: toDate(offering.endDate),
        },
        select: { id: true },
      });
    }
    return course.id;
  });

  // Re-read through the DETAIL include so the response shape is exactly the one
  // GET /courses/:id serves — no second mapper for the just-written rows.
  const created = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    include: COURSE_DETAIL_INCLUDE,
  });
  return toCourseDetail(created, new Map());
}

export async function update(
  actor: Actor,
  id: string,
  input: UpdateCourseInput,
): Promise<CourseDetail> {
  // Same check as create(): an update is the other way to claim someone else's upload.
  // `null` clears the syllabus and needs no check; only a non-null id claims anything.
  if (input.syllabusUploadId) {
    await assertUploadClaimable(input.syllabusUploadId, actor, 'syllabusUploadId');
  }

  const exists = await prisma.course.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!exists) throw notFound('Course');

  if (input.departmentId !== undefined) await assertDepartmentExists(input.departmentId);

  if (input.prerequisiteCourseId !== undefined) {
    await assertPrerequisiteAllowed(id, input.prerequisiteCourseId);
  }

  // Same data shaping as create: a teacher may not hand their course to someone else,
  // nor take another's. The `course:update` decision itself happened at the route.
  const teacherId = actor.role === 'ADMIN' ? input.teacherId : undefined;
  if (teacherId !== undefined) await assertTeacherExists(teacherId);

  await prisma.course.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(teacherId !== undefined ? { teacherId } : {}),
      ...(input.duration !== undefined
        ? { durationValue: input.duration.value, durationUnit: input.duration.unit }
        : {}),
      ...(input.syllabusUploadId !== undefined ? { syllabusUploadId: input.syllabusUploadId } : {}),
      ...(input.prerequisiteCourseId !== undefined
        ? { prerequisiteCourseId: input.prerequisiteCourseId }
        : {}),
    },
    include: COURSE_DETAIL_INCLUDE,
  });

  return getDetailForActor(id, actor);
}

/**
 * Publish and unpublish are one verb with a boolean (course.ts), so both leave a
 * single audit shape. Unpublishing deliberately does not touch enrollments: an
 * enrolled student keeps access to a course that was later unpublished (policy.ts),
 * on any of its intakes.
 */
export async function publish(
  actor: Actor,
  id: string,
  input: PublishCourseInput,
): Promise<CourseDetail> {
  const current = await prisma.course.findFirst({
    where: { id, deletedAt: null },
    // `publishedAt` is read back so only the draft -> live transition announces;
    // a republish of an already-live course is the announcements.service.ts idempotency
    // case, not a second event. `name` rides along for the notification copy.
    select: { id: true, name: true, publishedAt: true },
  });
  if (!current) throw notFound('Course');

  await prisma.course.update({
    where: { id },
    data: { publishedAt: input.published ? new Date() : null },
    include: COURSE_DETAIL_INCLUDE,
  });

  /*
   * Only the draft -> live transition announces, and only after the update has
   * committed; best-effort (notify() never throws). Unpublishing is silent — a bell
   * telling students about a course that just went dark would be noise with a link to
   * it. The audience is every APPROVED student on any intake of THIS course except the
   * actor (an admin publishing their own seat must not ring their own bell), deduped
   * by notify() itself for the multi-intake case.
   */
  if (input.published && current.publishedAt === null) {
    const seated = await prisma.enrollment.findMany({
      where: { status: 'APPROVED', offering: { courseId: id } },
      select: { studentId: true },
      distinct: ['studentId'],
    });
    await notify({
      userIds: seated.map((row) => row.studentId).filter((studentId) => studentId !== actor.id),
      type: 'COURSE_PUBLISHED',
      title: 'Course published',
      body: `${current.name} is now open for enrolment.`,
      linkPath: `/courses/${id}`,
    });
  }

  return getDetailForActor(id, actor);
}

/** Soft delete only — schema.prisma rules. Every read in this file filters it out. */
export async function remove(id: string): Promise<void> {
  const course = await prisma.course.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!course) throw notFound('Course');

  await prisma.course.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Mutations — the intakes (Phase 9)
//
// Three small routes under /courses/:courseId/offerings, gated by the EXISTING
// `course:update` action against the TEMPLATE subject. No new policy action, no new
// matrix cell: opening, retuning or retiring an intake is editing the course, done by
// whoever may edit the course. This is the minimum the corrected data model needs to
// be writable through the API — without it the seed would be the only thing anywhere
// that could open an intake.
// ---------------------------------------------------------------------------

/**
 * Loads one offering of one course, refusing soft-deleted courses and offerings alike.
 * `undefined` lets the caller answer 404 AFTER the gate has run (the same post-gate 404
 * every module serves an admin who names a missing row).
 */
async function loadLiveOffering(courseId: string, offeringId: string) {
  const offering = await prisma.courseOffering.findFirst({
    where: { id: offeringId, courseId, deletedAt: null, course: { deletedAt: null } },
  });
  return offering ?? undefined;
}

/** Opens another intake of the course. Audited as a CourseOffering CREATE. */
export async function createOffering(
  courseId: string,
  input: CreateCourseOfferingInput,
): Promise<CourseOfferingDto> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true },
  });
  if (!course) throw notFound('Course');

  const offering = await prisma.courseOffering.create({
    data: {
      courseId,
      capacity: input.capacity,
      workshopCapacity: input.workshopCapacity ?? null,
      startDate: toDate(input.startDate),
      endDate: toDate(input.endDate),
    },
  });
  return toOfferingSummary(offering);
}

/**
 * Retunes one intake. Both guarded bounds refuse to shrink below `approvedCount`
 * first — seating already committed is what a shrink would strand — and the date-order
 * check compares the STORED row merged with the patch, because the zod refinement only
 * ever sees the submitted fields while `course_offering_dates_ordered` (migration
 * 0007) reads the stored one.
 */
export async function updateOffering(
  courseId: string,
  offeringId: string,
  input: UpdateCourseOfferingInput,
): Promise<CourseOfferingDto> {
  const current = await loadLiveOffering(courseId, offeringId);
  if (!current) throw notFound('Offering');

  if (input.capacity !== undefined && input.capacity < current.approvedCount) {
    throw validationFailed([
      { path: 'capacity', message: 'Capacity cannot be lower than the approved count' },
    ]);
  }

  // Explicit null clears the bound and strands nothing, so it needs no check.
  if (
    input.workshopCapacity !== undefined &&
    input.workshopCapacity !== null &&
    input.workshopCapacity < current.approvedCount
  ) {
    throw validationFailed([
      {
        path: 'workshopCapacity',
        message: 'Workshop capacity cannot be lower than the approved count',
      },
    ]);
  }

  const startDate = input.startDate === undefined ? current.startDate : toDate(input.startDate);
  const endDate = input.endDate === undefined ? current.endDate : toDate(input.endDate);
  if (startDate !== null && endDate !== null && endDate.getTime() <= startDate.getTime()) {
    throw validationFailed([
      { path: 'endDate', message: 'The end date must come after the start date.' },
    ]);
  }

  const offering = await prisma.courseOffering.update({
    where: { id: current.id },
    data: {
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.workshopCapacity !== undefined ? { workshopCapacity: input.workshopCapacity } : {}),
      ...(input.startDate !== undefined ? { startDate } : {}),
      ...(input.endDate !== undefined ? { endDate } : {}),
    },
  });
  return toOfferingSummary(offering);
}

/**
 * Retires an intake. Soft delete only; refused while anyone still holds or awaits a
 * seat on it, because silently orphaning applications behind a deleted intake reads
 * as a bug ("I applied, now my application is gone") rather than a decision.
 */
export async function deleteOffering(courseId: string, offeringId: string): Promise<void> {
  const current = await loadLiveOffering(courseId, offeringId);
  if (!current) throw notFound('Offering');

  const liveSeats = await prisma.enrollment.count({
    where: { offeringId: current.id, status: { in: ['PENDING', 'APPROVED'] } },
  });
  if (liveSeats > 0) {
    throw conflict(
      `${liveSeats} ${liveSeats === 1 ? 'enrolment is' : 'enrolments are'} still pending or approved on this intake`,
    );
  }

  await prisma.courseOffering.update({
    where: { id: current.id },
    data: { deletedAt: new Date() },
  });
}

/**
 * The detail read `update()` and `publish()` hand back. Split out because both mutate
 * the TEMPLATE but must answer with the full aggregate — offerings included, viewer
 * statuses resolved — so the response cannot diverge from GET /courses/:id.
 */
async function getDetailForActor(id: string, actor: Actor): Promise<CourseDetail> {
  const course = await prisma.course.findUniqueOrThrow({
    where: { id },
    include: COURSE_DETAIL_INCLUDE,
  });
  const statuses = await viewerEnrollmentStatusByOffering(
    actor,
    course.offerings.map((offering) => offering.id),
  );
  return toCourseDetail(course, statuses);
}
