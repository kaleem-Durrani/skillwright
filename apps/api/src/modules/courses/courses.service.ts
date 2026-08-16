import { prisma, type Prisma } from '@skillwright/db';
import {
  paginationMeta,
  toSkipTake,
  type Actor,
  type Paginated,
  type Subject,
} from '@skillwright/shared';
import {
  COURSE_SUMMARY_INCLUDE,
  toCourseSummary,
  type CourseWithSummaryRelations,
} from '../../lib/dto.js';
import { notFound, validationFailed } from '../../lib/errors.js';
import type {
  CourseDetail,
  CourseListItem,
  CreateCourseInput,
  ListCoursesQuery,
  PublishCourseInput,
  UpdateCourseInput,
} from './courses.schema.js';

/**
 * The detail include is the summary include (lib/dto.ts) plus the one aggregate the
 * detail DTO adds. Spread rather than restated so the query and `toCourseSummary` can
 * never disagree about which relations are loaded.
 *
 * Soft delete is not enforced by the ORM, so the nested count filters `deletedAt`
 * by hand exactly like every other read in this file.
 */
const COURSE_DETAIL_INCLUDE = {
  ...COURSE_SUMMARY_INCLUDE,
  _count: { select: { resources: { where: { deletedAt: null } } } },
} as const;

type CourseWithDetail = Prisma.CourseGetPayload<{ include: typeof COURSE_DETAIL_INCLUDE }>;

/** The five fields the `course:*` policy rows read, and nothing else. */
const SUBJECT_SELECT = {
  id: true,
  teacherId: true,
  departmentId: true,
  publishedAt: true,
  deletedAt: true,
} as const;

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/*
 * `toCourseSummary` is imported from lib/dto.ts. It is a nested piece of three other
 * DTOs besides this module's, and it owns the `seatsRemaining`/`isFull` derivation,
 * which has to exist in exactly one place.
 */

/**
 * `viewerEnrollmentStatus` is a parameter rather than a column because it is the
 * REQUESTING actor's own state (course.ts:51-54), which no include can express.
 */
export function toCourseDetail(
  course: CourseWithDetail,
  viewerEnrollmentStatus: CourseDetail['viewerEnrollmentStatus'],
): CourseDetail {
  return {
    ...toCourseSummary(course),
    description: course.description,
    startDate: course.startDate?.toISOString() ?? null,
    endDate: course.endDate?.toISOString() ?? null,
    syllabusUploadId: course.syllabusUploadId,
    // TODO(uploads): presign this when the uploads module lands. A fabricated URL
    // would render as a download button pointing at nothing.
    syllabusUrl: null,
    resourceCount: course._count.resources,
    viewerEnrollmentStatus,
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString(),
  };
}

/**
 * One catalogue row (course.ts:60-81). `viewerEnrollmentStatus` is a parameter for the
 * same reason it is one on `toCourseDetail` — it is the REQUESTING actor's state, which
 * no include can express — but the list resolves it for the WHOLE page in one query
 * (`viewerEnrollmentStatusByCourse`) and hands each row its answer from a Map.
 *
 * `description` is a plain Course column, and `CourseWithSummaryRelations` carries every
 * scalar because an `include` narrows relations, not columns.
 */
export function toCourseListItem(
  course: CourseWithSummaryRelations,
  viewerEnrollmentStatus: CourseListItem['viewerEnrollmentStatus'],
): CourseListItem {
  return {
    ...toCourseSummary(course),
    description: course.description,
    viewerEnrollmentStatus,
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
    // `ownsCourse` reads `courseTeacherId` (combinators.ts:55-59), NOT `teacherId`.
    // A wrong key here is a silent denial, because every Subject field is optional.
    courseTeacherId: course.teacherId,
    departmentId: course.departmentId,
    publishedAt: course.publishedAt,
    deletedAt: course.deletedAt,
  };
}

/**
 * The same subject plus the requesting actor's own enrollment status, which the
 * STUDENT row of `course:read` needs: without it `enrolledApproved`
 * (combinators.ts:62-65) can never fire and an approved student is 403'd off a course
 * that was later unpublished.
 */
export async function loadCourseSubjectForActor(
  id: string,
  actor: Actor | null,
): Promise<Subject | undefined> {
  const subject = await loadCourseSubject(id);
  if (!subject) return undefined;
  return { ...subject, enrollmentStatus: await viewerEnrollmentStatus(actor, id) };
}

/**
 * Subject for the two enrollment gates that hang off the `/courses/:courseId` path.
 * The subject is still the COURSE (policy.ts:153-159), with `studentId` added for a
 * student so `isEnrolledStudent` can match — the row-level scoping of what a student
 * actually sees is the enrollments service's WHERE clause, not this gate.
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
    ...(actor?.role === 'STUDENT' ? { studentId: actor.id } : {}),
  };
}

/**
 * The actor's own enrollment status in one course, scoped to the actor — passing
 * someone else's status into a Subject is the one way to misuse this field
 * (actor.ts:72-77). Reading the role here is data scoping, not authorization.
 */
async function viewerEnrollmentStatus(
  actor: Actor | null,
  courseId: string,
): Promise<CourseDetail['viewerEnrollmentStatus']> {
  if (actor === null || actor.role !== 'STUDENT') return null;
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_courseId: { studentId: actor.id, courseId } },
    select: { status: true },
  });
  return enrollment?.status ?? null;
}

/**
 * The same field as `viewerEnrollmentStatus` above — same actor scoping, same "null for
 * anonymous, teachers and admins" rule — for a whole page in ONE query.
 *
 * The list must never call the single-course version per row: a 100-row page would fire
 * 100 extra round trips to render one badge per card, and the cost would grow with the
 * page size rather than stay flat. `@@unique([studentId, courseId])` (schema.prisma:379)
 * is the index this `IN` lookup reads, so it stays one indexed scan however wide the
 * page gets.
 *
 * A course the actor has no row for is simply absent from the Map, which the caller
 * reads back as null — the same answer the detail path gives.
 */
async function viewerEnrollmentStatusByCourse(
  actor: Actor | null,
  courseIds: string[],
): Promise<Map<string, CourseListItem['viewerEnrollmentStatus']>> {
  const statuses = new Map<string, CourseListItem['viewerEnrollmentStatus']>();
  if (actor === null || actor.role !== 'STUDENT' || courseIds.length === 0) return statuses;

  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: actor.id, courseId: { in: courseIds } },
    select: { courseId: true, status: true },
  });
  for (const enrollment of enrollments) statuses.set(enrollment.courseId, enrollment.status);
  return statuses;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The `course:read` policy rows (policy.ts:118-124) expressed as a WHERE clause.
 *
 * This is the one legitimate role read in the module: a list endpoint cannot ask
 * `can()` a yes/no question, so each branch below mirrors one policy row and must be
 * changed with it. The per-row decision is what `GET /courses/:id` still runs.
 *   anonymous -> isPublished                          (policy.ts:119)
 *   STUDENT   -> or(isPublished, enrolledApproved)    (policy.ts:121)
 *   TEACHER   -> or(isPublished, ownsCourse)          (policy.ts:122)
 *   ADMIN     -> allow                                (policy.ts:123)
 */
function visibilityWhere(actor: Actor | null): Prisma.CourseWhereInput {
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
          { enrollments: { some: { studentId: actor.id, status: 'APPROVED' } } },
        ],
      };
  }
}

/**
 * Visibility AND the caller's filters, never visibility OR them. The filters are
 * collected into `AND` because `visibilityWhere` already owns the top-level `OR` and
 * a second one would silently replace it.
 */
function listWhere(actor: Actor | null, query: ListCoursesQuery): Prisma.CourseWhereInput {
  const filters: Prisma.CourseWhereInput[] = [visibilityWhere(actor)];

  // course.ts:121 — `published` is ignored for anonymous callers, who only ever see
  // published courses. Applying it there would answer `published=false` with an empty
  // page instead of the catalogue they asked for.
  if (actor !== null && query.published !== undefined) {
    filters.push({ publishedAt: query.published ? { not: null } : null });
  }
  if (query.hasSeats === true) {
    // Column-to-column comparison via a Prisma field reference; the alternative is
    // raw SQL, and this stays inside the same query the count reuses.
    filters.push({ approvedCount: { lt: prisma.course.fields.capacity } });
  }
  if (query.q !== undefined) {
    // v1 substring match. The GIN tsvector index (`Course_searchVector_idx`) and the
    // trigram indexes exist for a real ranked search, but `searchVector` is absent
    // from schema.prisma on purpose (migration 0002:48-51), so wiring it needs raw
    // SQL. Saying so here beats pretending the tsvector is already in play.
    filters.push({
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { code: { contains: query.q, mode: 'insensitive' } },
      ],
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
 * `sort` arrives as free-form text (pagination.ts:16), so it is matched against this
 * whitelist and never interpolated into an `orderBy` key.
 */
function orderFor(query: ListCoursesQuery): Prisma.CourseOrderByWithRelationInput {
  switch (query.sort) {
    case 'name':
      return { name: query.order };
    case 'code':
      return { code: query.order };
    case 'capacity':
      return { capacity: query.order };
    case 'approvedCount':
      return { approvedCount: query.order };
    case 'publishedAt':
      return { publishedAt: query.order };
    default:
      return { createdAt: query.order };
  }
}

/**
 * The catalogue. Rows are `CourseListItem`, not `CourseSummary`: the browse screen shows
 * a blurb and whether the viewer has already applied, and the summary cannot carry the
 * second one (course.ts:60-81).
 *
 * Two queries — page and total — plus ONE more for a signed-in student, whatever the
 * page size. The badge is never resolved row by row.
 */
export async function list(
  actor: Actor | null,
  query: ListCoursesQuery,
): Promise<Paginated<CourseListItem>> {
  const where = listWhere(actor, query);
  const [rows, total] = await prisma.$transaction([
    prisma.course.findMany({
      where,
      ...toSkipTake(query),
      orderBy: orderFor(query),
      include: COURSE_SUMMARY_INCLUDE,
    }),
    prisma.course.count({ where }),
  ]);

  // One query for the page, never one per row — see `viewerEnrollmentStatusByCourse`.
  const statuses = await viewerEnrollmentStatusByCourse(
    actor,
    rows.map((row) => row.id),
  );

  return {
    data: rows.map((row) => toCourseListItem(row, statuses.get(row.id) ?? null)),
    meta: paginationMeta(query.page, query.limit, total),
  };
}

export async function getById(actor: Actor | null, id: string): Promise<CourseDetail> {
  const course = await prisma.course.findFirst({
    where: { id, deletedAt: null },
    include: COURSE_DETAIL_INCLUDE,
  });
  if (!course) throw notFound('Course');
  return toCourseDetail(course, await viewerEnrollmentStatus(actor, id));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** ISO string in, `Date` or explicit null out — Prisma never sees a string date. */
function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

/**
 * Derived from the name when the client does not supply one, the same convention
 * departments use (department.ts:22-25). The code is the fallback because a name of
 * nothing but punctuation would otherwise produce a slug `slugSchema` rejects.
 */
function slugify(name: string, code: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug.slice(0, 120).replace(/-+$/, '') : code.toLowerCase();
}

/** A foreign key the client chose turns a 500 into a field-level 422 (auth.service.ts:167-174). */
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

export async function create(actor: Actor, input: CreateCourseInput): Promise<CourseDetail> {
  await assertDepartmentExists(input.departmentId);

  // Data shaping, not authorization: `course:create` was already decided by
  // authorize() at the route. course.ts:86 — teacherId is an admin-only field, and a
  // teacher always gets themself.
  const teacherId = actor.role === 'ADMIN' ? (input.teacherId ?? actor.id) : actor.id;
  await assertTeacherExists(teacherId);

  const course = await prisma.course.create({
    data: {
      code: input.code,
      slug: input.slug ?? slugify(input.name, input.code),
      name: input.name,
      description: input.description ?? null,
      departmentId: input.departmentId,
      teacherId,
      durationValue: input.duration.value,
      durationUnit: input.duration.unit,
      capacity: input.capacity,
      startDate: toDate(input.startDate),
      endDate: toDate(input.endDate),
      syllabusUploadId: input.syllabusUploadId ?? null,
      // `approvedCount` defaults to 0 (schema.prisma:332) and `publishedAt` stays
      // null: creating a course does not publish it.
    },
    include: COURSE_DETAIL_INCLUDE,
  });

  // The audit row is written by the Prisma extension (Course is in AUDITED_MODELS);
  // writing one here too would double every create.
  return toCourseDetail(course, null);
}

export async function update(
  actor: Actor,
  id: string,
  input: UpdateCourseInput,
): Promise<CourseDetail> {
  const current = await prisma.course.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, approvedCount: true, startDate: true, endDate: true },
  });
  if (!current) throw notFound('Course');

  // course.ts:104. The DB CHECK `course_capacity_sane` (migration 0002:14-16) would
  // also stop this, but an untranslated constraint violation surfaces as a 500
  // (errors.plugin.ts:59-61) — so the service rejects it first, with a field path.
  if (input.capacity !== undefined && input.capacity < current.approvedCount) {
    throw validationFailed([
      { path: 'capacity', message: 'Capacity cannot be lower than the approved count' },
    ]);
  }

  // `course_dates_ordered` (migration 0002:33-35) compares the STORED row. The zod
  // refinement (course.ts:60-77) only ever sees the submitted body, so patching one
  // date alone slips past it.
  const startDate = input.startDate === undefined ? current.startDate : toDate(input.startDate);
  const endDate = input.endDate === undefined ? current.endDate : toDate(input.endDate);
  if (startDate !== null && endDate !== null && endDate.getTime() <= startDate.getTime()) {
    throw validationFailed([
      { path: 'endDate', message: 'The end date must come after the start date.' },
    ]);
  }

  if (input.departmentId !== undefined) await assertDepartmentExists(input.departmentId);

  // Same data shaping as create: a teacher may not hand their course to someone else,
  // nor take another's. The `course:update` decision itself happened at the route.
  const teacherId = actor.role === 'ADMIN' ? input.teacherId : undefined;
  if (teacherId !== undefined) await assertTeacherExists(teacherId);

  const course = await prisma.course.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(teacherId !== undefined ? { teacherId } : {}),
      ...(input.duration !== undefined
        ? { durationValue: input.duration.value, durationUnit: input.duration.unit }
        : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.startDate !== undefined ? { startDate } : {}),
      ...(input.endDate !== undefined ? { endDate } : {}),
      ...(input.syllabusUploadId !== undefined ? { syllabusUploadId: input.syllabusUploadId } : {}),
    },
    include: COURSE_DETAIL_INCLUDE,
  });

  return toCourseDetail(course, await viewerEnrollmentStatus(actor, id));
}

/**
 * Publish and unpublish are one verb with a boolean (course.ts:114), so both leave a
 * single audit shape. Unpublishing deliberately does not touch enrollments: an
 * enrolled student keeps access to a course that was later unpublished (policy.ts:120).
 */
export async function publish(
  actor: Actor,
  id: string,
  input: PublishCourseInput,
): Promise<CourseDetail> {
  const current = await prisma.course.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!current) throw notFound('Course');

  const course = await prisma.course.update({
    where: { id },
    data: { publishedAt: input.published ? new Date() : null },
    include: COURSE_DETAIL_INCLUDE,
  });
  return toCourseDetail(course, await viewerEnrollmentStatus(actor, id));
}

/** Soft delete only — schema.prisma:5-7 rule 3. Every read in this file filters it out. */
export async function remove(id: string): Promise<void> {
  const course = await prisma.course.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!course) throw notFound('Course');

  await prisma.course.update({ where: { id }, data: { deletedAt: new Date() } });
}
