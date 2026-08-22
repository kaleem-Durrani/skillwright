import { prisma, type Prisma } from '@skillwright/db';
import {
  paginationMeta,
  toSkipTake,
  type Actor,
  type Paginated,
  type Subject,
} from '@skillwright/shared';
import { COURSE_SUMMARY_INCLUDE, toCourseSummary, toUserSummary } from '../../lib/dto.js';
import { capacityExceeded, conflict, validationFailed } from '../../lib/errors.js';
import type {
  ApproveEnrollmentInput,
  EnrollmentDto,
  EnrollmentStatusValue,
  ListEnrollmentsQuery,
  RejectEnrollmentInput,
  RequestEnrollmentInput,
  WithdrawEnrollmentInput,
} from './enrollments.schema.js';

/**
 * `as const` matters: Prisma derives the payload type from the literal shape, and
 * without it `EnrollmentGetPayload` widens to `boolean` and the mapper stops being
 * checked against the columns it reads.
 *
 * The nested course is loaded whole because `enrollmentSchema` embeds a full
 * `courseSummarySchema` (enrollment.ts:20), which itself embeds a department and a
 * teacher. That is the shared shape; trimming it here would be a per-module
 * deviation from the contract the SPA reads.
 */
const ENROLLMENT_INCLUDE = {
  student: true,
  decidedBy: true,
  course: { include: COURSE_SUMMARY_INCLUDE },
} as const;

type EnrollmentWithRelations = Prisma.EnrollmentGetPayload<{
  include: typeof ENROLLMENT_INCLUDE;
}>;

/**
 * Interactive-transaction budget for the three status writes.
 *
 * Generous rather than default because the audit extension writes its AuditEvent on
 * a SEPARATE connection from inside the callback (audit.ts:243), so a burst of
 * concurrent approvals — ADR 0006's 200-at-once test is the deliberate example —
 * queues on the pool before it queues on the row lock. The transaction body itself
 * is three statements.
 */
const TX_OPTIONS = { maxWait: 15_000, timeout: 15_000 } as const;

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

/*
 * `toUserSummary` and `toCourseSummary` are the nested pieces of `enrollmentSchema`,
 * not this module's entity, and courses.service.ts and departments.service.ts need the
 * identical mappers. They now live in lib/dto.ts — which is where the
 * `seatsRemaining`/`isFull` derivation lives too, in exactly one copy.
 */

/** The ONLY shape an enrollment is serialised as. */
export function toEnrollmentDto(enrollment: EnrollmentWithRelations): EnrollmentDto {
  return {
    id: enrollment.id,
    status: enrollment.status,
    student: toUserSummary(enrollment.student),
    course: toCourseSummary(enrollment.course),
    requestedAt: enrollment.requestedAt.toISOString(),
    decidedAt: enrollment.decidedAt?.toISOString() ?? null,
    decidedBy: enrollment.decidedBy ? toUserSummary(enrollment.decidedBy) : null,
    decisionNote: enrollment.decisionNote,
  };
}

// ---------------------------------------------------------------------------
// Subject loaders — the only database access authorization performs
// ---------------------------------------------------------------------------

/**
 * Subject for `enrollment:read`, `:approve`, `:reject` and `:withdraw`.
 *
 * `undefined` for a missing (or soft-deleted-course) row so the policy denies rather
 * than this loader throwing a bare 404 before the gate has run.
 *
 * `enrollmentStatus` is deliberately ABSENT. actor.ts:72-77: that field is the
 * REQUESTING actor's status in the relevant course, not the status of some arbitrary
 * enrollment row — passing this row's status is the one documented way to misuse it,
 * and none of the four rules above read it anyway.
 */
export async function loadEnrollmentSubject(id: string): Promise<Subject | undefined> {
  const enrollment = await prisma.enrollment.findFirst({
    // Soft delete is not enforced by the ORM, so the course filter is written by hand.
    where: { id, course: { deletedAt: null } },
    select: {
      id: true,
      studentId: true,
      courseId: true,
      course: { select: { teacherId: true, publishedAt: true, deletedAt: true } },
    },
  });
  if (!enrollment) return undefined;

  return {
    id: enrollment.id,
    // isEnrolledStudent reads `studentId` (combinators.ts:75-79).
    studentId: enrollment.studentId,
    courseId: enrollment.courseId,
    // ownsCourse reads `courseTeacherId`, NOT `teacherId` (combinators.ts:55-59). A
    // wrong key here is a silent 403, never a type error, because every Subject field
    // is optional (actor.ts:53-56).
    courseTeacherId: enrollment.course.teacherId,
    publishedAt: enrollment.course.publishedAt,
    deletedAt: enrollment.course.deletedAt,
  };
}

/**
 * Subject for `enrollment:request`, which is the COURSE and not an enrollment —
 * policy.ts:155: "Subject is the COURSE. A draft course cannot accumulate a waiting
 * list." That is why this module owns two loaders rather than the usual one.
 *
 * It duplicates courses.service.ts's `loadCourseSubject` on purpose: the module that
 * declares the route owns the gate, and importing across modules to save five lines
 * would make an enrollment write fail to load when the courses module is refactored.
 */
export async function loadRequestedCourseSubject(courseId: string): Promise<Subject | undefined> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true, teacherId: true, departmentId: true, publishedAt: true, deletedAt: true },
  });
  if (!course) return undefined;

  return {
    id: course.id,
    courseId: course.id,
    courseTeacherId: course.teacherId,
    departmentId: course.departmentId,
    // isPublished reads `publishedAt` (combinators.ts:95-98).
    publishedAt: course.publishedAt,
    deletedAt: course.deletedAt,
  };
}

// ---------------------------------------------------------------------------
// The status machine
// ---------------------------------------------------------------------------

/**
 * EnrollmentStatus (schema.prisma:59-65) as a graph. COMPLETED is terminal and has
 * no endpoint in this module's contract — it is left unreachable rather than given
 * an unspecified verb. REJECTED and WITHDRAWN return to PENDING only through
 * re-application, which is `requestEnrollment` and not a decision endpoint.
 */
const ALLOWED_TRANSITIONS: Record<EnrollmentStatusValue, readonly EnrollmentStatusValue[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'WITHDRAWN'],
  APPROVED: ['REJECTED', 'WITHDRAWN', 'COMPLETED'],
  REJECTED: ['PENDING'],
  WITHDRAWN: ['PENDING'],
  COMPLETED: [],
};

function assertTransition(from: EnrollmentStatusValue, to: EnrollmentStatusValue): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw conflict(`An enrollment that is ${from} cannot become ${to}`);
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type SortDirection = ListEnrollmentsQuery['order'];

/**
 * `sort` arrives as a free-form string, so it is matched against this map and never
 * interpolated into an orderBy key.
 */
const ORDER_BY: Record<
  string,
  (order: SortDirection) => Prisma.EnrollmentOrderByWithRelationInput
> = {
  requestedAt: (order) => ({ requestedAt: order }),
  decidedAt: (order) => ({ decidedAt: order }),
  updatedAt: (order) => ({ updatedAt: order }),
  status: (order) => ({ status: order }),
};

const DEFAULT_ORDER = (order: SortDirection): Prisma.EnrollmentOrderByWithRelationInput => ({
  requestedAt: order,
});

function orderFor(query: ListEnrollmentsQuery): Prisma.EnrollmentOrderByWithRelationInput {
  const build = query.sort === undefined ? undefined : ORDER_BY[query.sort];
  return (build ?? DEFAULT_ORDER)(query.order);
}

/**
 * The WHERE clause that mirrors the `enrollment:read` row rules, policy.ts:160-165:
 *
 *   STUDENT -> isEnrolledStudent -> `studentId = actor.id`
 *   TEACHER -> ownsCourse        -> `course.teacherId = actor.id`
 *   ADMIN   -> allow             -> unrestricted
 *
 * A cross-course list cannot go through `authorize('enrollment:read')` with no
 * subject: both row rules read absent fields and therefore deny (actor.ts:46-51), so
 * every non-admin would get a 403 on their own list. The route gates on
 * authentication instead and the policy becomes this clause.
 *
 * Reading `actor.role` here is choosing which WHERE mirrors which policy row — the
 * one legitimate role read named by CONTRIBUTING.md:48-55. It is NOT a permission
 * check: if this function and policy.ts ever disagree, this function is the bug.
 * That is why the mirror lives in exactly one named place.
 */
function visibilityWhere(actor: Actor, query: ListEnrollmentsQuery): Prisma.EnrollmentWhereInput {
  const scope: Prisma.EnrollmentWhereInput =
    actor.role === 'STUDENT'
      ? { studentId: actor.id }
      : actor.role === 'TEACHER'
        ? { course: { teacherId: actor.id } }
        : {};

  // Filters narrow WITHIN the scope and can never widen it, which is the whole
  // reason they are a separate AND term rather than a spread over `scope`.
  const filters: Prisma.EnrollmentWhereInput = {
    ...(query.courseId ? { courseId: query.courseId } : {}),
    ...(query.studentId ? { studentId: query.studentId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  // Soft delete is not enforced by the ORM (Course.deletedAt is a plain column), so
  // every read filters it by hand.
  return { AND: [scope, filters, { course: { deletedAt: null } }] };
}

export async function list(
  actor: Actor,
  query: ListEnrollmentsQuery,
): Promise<Paginated<EnrollmentDto>> {
  const where = visibilityWhere(actor, query);

  const [rows, total] = await prisma.$transaction([
    prisma.enrollment.findMany({
      where,
      ...toSkipTake(query),
      orderBy: orderFor(query),
      include: ENROLLMENT_INCLUDE,
    }),
    prisma.enrollment.count({ where }),
  ]);

  return { data: rows.map(toEnrollmentDto), meta: paginationMeta(query.page, query.limit, total) };
}

/**
 * The course-nested list, `GET /courses/:courseId/enrollments`. Declared in
 * courses.routes.ts because it lives under the /courses prefix; implemented here
 * because a module boundary and a URL prefix are not the same thing.
 */
export function listForCourse(
  actor: Actor,
  courseId: string,
  query: ListEnrollmentsQuery,
): Promise<Paginated<EnrollmentDto>> {
  // The path segment wins over any `?courseId=` the caller also sent.
  return list(actor, { ...query, courseId });
}

export async function getById(id: string): Promise<EnrollmentDto> {
  // findUniqueOrThrow: P2025 is already a 404 (errors.plugin.ts:52-53). Reaching here
  // at all means the subject loader found the row, so this is the race, not the path.
  const enrollment = await prisma.enrollment.findUniqueOrThrow({
    where: { id },
    include: ENROLLMENT_INCLUDE,
  });
  return toEnrollmentDto(enrollment);
}

// ---------------------------------------------------------------------------
// Requesting a seat
// ---------------------------------------------------------------------------

export async function requestEnrollment(
  actor: Actor,
  input: RequestEnrollmentInput,
): Promise<EnrollmentDto> {
  /*
   * Data shaping, not authorization. enrollment.ts:28-31: "The student is never in
   * the body — it is the session's user. Admins acting on behalf of a student use
   * `studentId`, which the API accepts only for ADMIN." A non-admin who sends
   * `studentId` has it ignored rather than honoured. The permission to be here at
   * all was decided by `authorize('enrollment:request')` at the route.
   */
  const studentId = actor.role === 'ADMIN' ? (input.studentId ?? actor.id) : actor.id;

  // A foreign key the client chose is checked first, because it turns a
  // foreign-key 500 into a field-level 422 (auth.service.ts:166-174).
  const course = await prisma.course.findFirst({
    where: { id: input.courseId, deletedAt: null },
    select: { id: true },
  });
  if (!course) throw validationFailed([{ path: 'courseId', message: 'Unknown course' }]);

  if (studentId !== actor.id) {
    const student = await prisma.user.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true },
    });
    if (!student) throw validationFailed([{ path: 'studentId', message: 'Unknown student' }]);
  }

  /*
   * `input.note` has nowhere to go. Enrollment carries exactly one free-text column,
   * `decisionNote` (schema.prisma:373), documented as what the student is SHOWN on
   * rejection — writing an applicant's note into it would render their own words as
   * the teacher's decision. Storing it needs an `Enrollment.requestNote` column,
   * which is a schema change with a migration, not something a route module invents.
   */

  const existing = await prisma.enrollment.findUnique({
    where: { studentId_courseId: { studentId, courseId: input.courseId } },
    select: { id: true, status: true },
  });

  if (existing) {
    // schema.prisma:377-379 — one row per (student, course), forever. A withdrawn or
    // rejected student who re-applies UPDATES this row rather than creating a second.
    if (existing.status === 'PENDING' || existing.status === 'APPROVED') {
      throw conflict('You have already applied to this course');
    }
    assertTransition(existing.status, 'PENDING');

    const reapplied = await prisma.enrollment.update({
      where: { id: existing.id },
      data: {
        status: 'PENDING',
        requestedAt: new Date(),
        decidedAt: null,
        decidedById: null,
        decisionNote: null,
      },
      include: ENROLLMENT_INCLUDE,
    });
    return toEnrollmentDto(reapplied);
  }

  // If two requests race past the findUnique above, P2002 on
  // @@unique([studentId, courseId]) is already a friendly 409 — ADR 0006 line 41
  // names this as the intended path, so it is not caught and re-mapped here.
  // `approvedCount` is untouched: a request is PENDING, and only approval seats.
  const created = await prisma.enrollment.create({
    data: { studentId, courseId: input.courseId, status: 'PENDING' },
    include: ENROLLMENT_INCLUDE,
  });
  return toEnrollmentDto(created);
}

/**
 * The course-nested create, `POST /courses/:courseId/enrollments`. The SPA posts no
 * body at all (CourseDetail.tsx:70), so courses.routes.ts binds
 * `requestEnrollmentSchema.omit({ courseId: true }).optional()` and the id comes off
 * the path.
 */
export function requestForCourse(
  actor: Actor,
  courseId: string,
  input?: Omit<RequestEnrollmentInput, 'courseId'>,
): Promise<EnrollmentDto> {
  return requestEnrollment(actor, { ...input, courseId });
}

// ---------------------------------------------------------------------------
// Decisions — every one of these maintains approvedCount (ADR 0006 line 40)
// ---------------------------------------------------------------------------

export async function approve(
  actor: Actor,
  enrollmentId: string,
  input?: ApproveEnrollmentInput,
): Promise<EnrollmentDto> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.enrollment.findUniqueOrThrow({
      // P2025 -> 404, errors.plugin.ts:52-53.
      where: { id: enrollmentId },
      select: { id: true, status: true, courseId: true },
    });

    if (current.status === 'APPROVED') {
      // Idempotent: a second click must return the seated row without a second
      // increment, or two clicks oversell by one.
      return toEnrollmentDto(
        await tx.enrollment.findUniqueOrThrow({
          where: { id: enrollmentId },
          include: ENROLLMENT_INCLUDE,
        }),
      );
    }
    assertTransition(current.status, 'APPROVED');

    /*
     * ADR 0006. THE UPDATE IS THE CAPACITY CHECK — there is no SELECT count, no
     * read-then-write compare: "the read-then-write shape loses it every time under
     * load" (line 7). The row lock this UPDATE takes serializes concurrent approvals
     * on that course and nothing else (line 25).
     *
     * A tagged template, never $executeRawUnsafe, and `courseId` is a bound
     * parameter rather than interpolated text. It returns the affected row count.
     *
     * This statement bypasses the Prisma audit extension, which intercepts model
     * operations and not raw SQL (audit.ts:243). That is intended: the counter is
     * bookkeeping, and the `tx.enrollment.update` below writes the AuditEvent that
     * matters. No manual audit row is written for it.
     */
    const claimed = await tx.$executeRaw`
      UPDATE "Course"
         SET "approvedCount" = "approvedCount" + 1
       WHERE id = ${current.courseId} AND "approvedCount" < "capacity"`;

    // Zero rows affected means the course is full. Throwing here rolls the increment
    // back and nothing was seated — which is why it is never caught inside the
    // transaction.
    if (claimed === 0) throw capacityExceeded('This course is full');

    const updated = await tx.enrollment.update({
      where: { id: enrollmentId },
      data: {
        status: 'APPROVED',
        decidedAt: new Date(),
        decidedById: actor.id,
        // exactOptionalPropertyTypes: `{ decisionNote: undefined }` is not assignable
        // to an optional field, so the key is spread in or left out entirely.
        ...(input?.note ? { decisionNote: input.note } : {}),
      },
      include: ENROLLMENT_INCLUDE,
    });
    return toEnrollmentDto(updated);
  }, TX_OPTIONS);
}

/**
 * Reject and withdraw are the same write with a different target status, and both
 * must RELEASE the seat when the row they are leaving was APPROVED. ADR 0006 line
 * 40 makes that an obligation of "every transaction that changes an enrollment's
 * status", so it is written once here rather than twice below.
 *
 * They stay separate verbs at the route because policy.ts:180-182 says so: "A
 * teacher removing a student is a rejection, not a withdrawal; separate verb,
 * separate audit action, separate notification."
 */
async function settle(
  actor: Actor,
  enrollmentId: string,
  next: Extract<EnrollmentStatusValue, 'REJECTED' | 'WITHDRAWN'>,
  note: string | null,
): Promise<EnrollmentDto> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.enrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
      select: { id: true, status: true, courseId: true },
    });

    if (current.status === next) {
      // Same-state repeat, on the same reasoning as approve(): a double submission
      // must not move the counter. The row is returned untouched.
      return toEnrollmentDto(
        await tx.enrollment.findUniqueOrThrow({
          where: { id: enrollmentId },
          include: ENROLLMENT_INCLUDE,
        }),
      );
    }
    assertTransition(current.status, next);

    if (current.status === 'APPROVED') {
      // The `> 0` guard is what keeps the CHECK's lower bound — course_capacity_sane
      // in migration 0002_constraints:14-16, NOT the `course_capacity_check` the ADR
      // quotes — from ever being the thing that fires.
      await tx.$executeRaw`
        UPDATE "Course"
           SET "approvedCount" = "approvedCount" - 1
         WHERE id = ${current.courseId} AND "approvedCount" > 0`;
    }

    const updated = await tx.enrollment.update({
      where: { id: enrollmentId },
      data: {
        status: next,
        decidedAt: new Date(),
        // Who ended it. For a withdrawal that is the student themself (or the admin
        // acting for them), which is the honest reading of the column.
        decidedById: actor.id,
        decisionNote: note,
      },
      include: ENROLLMENT_INCLUDE,
    });
    return toEnrollmentDto(updated);
  }, TX_OPTIONS);
}

export function reject(
  actor: Actor,
  enrollmentId: string,
  input: RejectEnrollmentInput,
): Promise<EnrollmentDto> {
  // enrollment.ts:45 — the reason is mandatory because it is the only thing the
  // student is shown, so it always lands in `decisionNote`.
  return settle(actor, enrollmentId, 'REJECTED', input.reason);
}

export function withdraw(
  actor: Actor,
  enrollmentId: string,
  input?: WithdrawEnrollmentInput,
): Promise<EnrollmentDto> {
  return settle(actor, enrollmentId, 'WITHDRAWN', input?.reason ?? null);
}
