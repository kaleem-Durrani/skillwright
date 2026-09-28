import { prisma, type Prisma } from '@skillwright/db';
import {
  paginationMeta,
  toSkipTake,
  type Actor,
  type Paginated,
  type Subject,
} from '@skillwright/shared';
import { Readable } from 'node:stream';
import { csvStream } from '../../lib/csv.js';
import {
  COURSE_SUMMARY_INCLUDE,
  toCourseSummary,
  toOfferingSummary,
  toUserSummary,
} from '../../lib/dto.js';
import { capacityExceeded, conflict, validationFailed } from '../../lib/errors.js';
import { notify } from '../notifications/notifications.service.js';
import type {
  ApproveEnrollmentInput,
  CompleteEnrollmentInput,
  EnrollmentDto,
  EnrollmentStatusValue,
  ExportEnrollmentsQuery,
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
 * `courseSummarySchema` (enrollment.ts), which itself embeds a department and a
 * teacher. Since Phase 9 the enrollment points at an OFFERING, so the course is one
 * relation further down (`offering.course`) — the wire shape keeps both blocks: the
 * template it teaches, and the intake the seat belongs to.
 */
const ENROLLMENT_INCLUDE = {
  student: true,
  decidedBy: true,
  completedBy: true,
  offering: { include: { course: { include: COURSE_SUMMARY_INCLUDE } } },
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
    course: toCourseSummary(enrollment.offering.course),
    offering: toOfferingSummary(enrollment.offering),
    requestedAt: enrollment.requestedAt.toISOString(),
    decidedAt: enrollment.decidedAt?.toISOString() ?? null,
    decidedBy: enrollment.decidedBy ? toUserSummary(enrollment.decidedBy) : null,
    decisionNote: enrollment.decisionNote,
    completedAt: enrollment.completedAt?.toISOString() ?? null,
    completedBy: enrollment.completedBy ? toUserSummary(enrollment.completedBy) : null,
  };
}

// ---------------------------------------------------------------------------
// Subject loaders — the only database access authorization performs
// ---------------------------------------------------------------------------

/**
 * Subject for `enrollment:read`, `:approve`, `:reject`, `:withdraw`, `:complete` and
 * `:uncomplete`.
 *
 * `undefined` for a missing row, a soft-deleted offering or a soft-deleted course, so
 * the policy denies rather than this loader throwing a bare 404 before the gate has
 * run.
 *
 * `enrollmentStatus` is deliberately ABSENT. actor.ts: that field is the REQUESTING
 * actor's status in the relevant course, not the status of some arbitrary enrollment
 * row — passing this row's status is the one documented way to misuse it, and none of
 * the rules above read it anyway.
 */
export async function loadEnrollmentSubject(id: string): Promise<Subject | undefined> {
  const enrollment = await prisma.enrollment.findFirst({
    // Soft delete is not enforced by the ORM, so the course filter is written by hand.
    where: { id, offering: { deletedAt: null, course: { deletedAt: null } } },
    select: {
      id: true,
      studentId: true,
      offering: {
        select: {
          courseId: true,
          deletedAt: true,
          course: { select: { teacherId: true, publishedAt: true, deletedAt: true } },
        },
      },
    },
  });
  if (!enrollment) return undefined;

  return {
    id: enrollment.id,
    // isEnrolledStudent reads `studentId` (combinators.ts).
    studentId: enrollment.studentId,
    courseId: enrollment.offering.courseId,
    // ownsCourse reads `courseTeacherId`, NOT `teacherId` (combinators.ts). A
    // wrong key here is a silent 403, never a type error, because every Subject field
    // is optional (actor.ts).
    courseTeacherId: enrollment.offering.course.teacherId,
    publishedAt: enrollment.offering.course.publishedAt,
    deletedAt: enrollment.offering.course.deletedAt,
  };
}

/**
 * Subject for `enrollment:request`, which is the COURSE and not an enrollment —
 * policy.ts: "Subject is the COURSE. A draft course cannot accumulate a waiting
 * list." That is why this module owns two loaders rather than the usual one.
 *
 * For a STUDENT it also carries `completedCourseIds`, which `hasCompletedPrerequisite`
 * reads: without it every gated request is denied silently, the LESSONS-LEARNED #15/#31
 * failure. One indexed query (`@@index([studentId, status])`). Admins skip it — their
 * row is `allow` and enrolling by hand IS the escape hatch.
 *
 * It duplicates courses.service.ts's `loadCourseSubject` on purpose: the module that
 * declares the route owns the gate, and importing across modules to save five lines
 * would make an enrollment write fail to load when the courses module is refactored.
 */
export async function loadRequestedCourseSubject(
  courseId: string,
  actor: Actor | null,
): Promise<Subject | undefined> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: {
      id: true,
      teacherId: true,
      departmentId: true,
      publishedAt: true,
      deletedAt: true,
      prerequisiteCourseId: true,
    },
  });
  if (!course) return undefined;

  return {
    id: course.id,
    courseId: course.id,
    courseTeacherId: course.teacherId,
    departmentId: course.departmentId,
    // isPublished reads `publishedAt` (combinators.ts).
    publishedAt: course.publishedAt,
    deletedAt: course.deletedAt,
    // hasCompletedPrerequisite reads both (combinators.ts). ABSENT would deny.
    prerequisiteCourseId: course.prerequisiteCourseId,
    ...(actor?.role === 'STUDENT'
      ? { completedCourseIds: await completedCourseIds(actor.id) }
      : {}),
  };
}

/**
 * The ids the student holds APPROVED enrollments for — duplicated from
 * courses.service.ts for the same reason that module's subject loader is duplicated
 * here rather than imported. Enrollments point at offerings since Phase 9, so the
 * course id rides the relation.
 */
async function completedCourseIds(studentId: string): Promise<string[]> {
  const rows = await prisma.enrollment.findMany({
    where: { studentId, status: 'APPROVED' },
    select: { offering: { select: { courseId: true } } },
  });
  return [...new Set(rows.map((row) => row.offering.courseId))];
}

// ---------------------------------------------------------------------------
// The status machine
// ---------------------------------------------------------------------------

/**
 * EnrollmentStatus (schema.prisma) as a graph.
 *
 * COMPLETED is no longer the dead end this map used to describe. It is still terminal
 * in the sense that nothing moves PAST it — but it is not terminal in the sense of
 * unrevisable, because a qualification recorded against the wrong student, or against
 * a cohort that was rescheduled, has to be correctable by the same person who made the
 * mistake. `complete()` and `uncomplete()` are therefore one edge, and the correction
 * is a separate VERB for the reason policy.ts gives rather than a second status write
 * on the first one: a single endpoint would put "recorded a completion" and "erased
 * one" under one audit action, and the trail could not tell them apart.
 *
 * REJECTED and WITHDRAWN return to PENDING only through re-application, which is
 * `requestEnrollment` and not a decision endpoint.
 */
const ALLOWED_TRANSITIONS: Record<EnrollmentStatusValue, readonly EnrollmentStatusValue[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'WITHDRAWN'],
  APPROVED: ['REJECTED', 'WITHDRAWN', 'COMPLETED'],
  REJECTED: ['PENDING'],
  WITHDRAWN: ['PENDING'],
  COMPLETED: ['APPROVED'],
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

function orderFor(query: EnrollmentSort): Prisma.EnrollmentOrderByWithRelationInput {
  const build = query.sort === undefined ? undefined : ORDER_BY[query.sort];
  return (build ?? DEFAULT_ORDER)(query.order);
}

/**
 * The fields of `ListEnrollmentsQuery` the shared helpers actually read, so the
 * export's paging-free query satisfies them structurally without inventing page
 * numbers it does not have.
 */
type EnrollmentFilters = Pick<
  ListEnrollmentsQuery,
  'courseId' | 'offeringId' | 'studentId' | 'status'
>;
type EnrollmentSort = Pick<ListEnrollmentsQuery, 'sort' | 'order'>;

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
function visibilityWhere(actor: Actor, query: EnrollmentFilters): Prisma.EnrollmentWhereInput {
  const scope: Prisma.EnrollmentWhereInput =
    actor.role === 'STUDENT'
      ? { studentId: actor.id }
      : actor.role === 'TEACHER'
        ? // The course rides the offering relation since Phase 9.
          { offering: { course: { teacherId: actor.id } } }
        : {};

  // Filters narrow WITHIN the scope and can never widen it, which is the whole
  // reason they are a separate AND term rather than a spread over `scope`.
  const filters: Prisma.EnrollmentWhereInput = {
    ...(query.courseId ? { offering: { courseId: query.courseId } } : {}),
    ...(query.offeringId ? { offeringId: query.offeringId } : {}),
    ...(query.studentId ? { studentId: query.studentId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  // Soft delete is not enforced by the ORM (Course.deletedAt is a plain column), so
  // every read filters it by hand — on BOTH levels now: an enrollment on a retired
  // intake is as invisible as one on a deleted course.
  return {
    AND: [scope, filters, { offering: { deletedAt: null, course: { deletedAt: null } } }],
  };
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
// The register export (Phase 8)
// ---------------------------------------------------------------------------

/**
 * How many enrollment rows one batched query loads while streaming. The generator
 * below walks the register in pages of this size and never accumulates them, so a
 * full intake costs this many rows of memory, not the whole table.
 */
const EXPORT_BATCH = 500;

/**
 * The enrolment register as a CSV stream, `GET /enrollments/export`.
 *
 * The WHERE clause and the ordering are THE LIST'S — `visibilityWhere` and `orderFor`
 * above, not parallel copies — so the file can never serve a row the list would
 * refuse, and a filter the list honours narrows the export identically. The only new
 * decisions are presentation: which columns an accreditor's register needs, and the
 * `{ id: 'asc' }` tiebreaker that makes each batched page deterministic (a sort key
 * alone can order two rows either way between queries; with the tiebreaker every row
 * is visited exactly once).
 *
 * Rows are yielded one at a time from inside Prisma batches, so nothing is buffered:
 * csvStream (lib/csv.ts) pulls only as Fastify drains.
 */
async function* registerRows(
  actor: Actor,
  query: ExportEnrollmentsQuery,
): AsyncGenerator<readonly (string | null)[]> {
  yield [
    'enrollment_id',
    'status',
    'student_name',
    'student_id',
    'course_code',
    'course_name',
    'requested_at',
    'decided_at',
    'decided_by',
    'decision_note',
  ];

  const where = visibilityWhere(actor, query);
  // `orderFor` is the list's own sort resolution — free-text `sort` falls back to
  // requestedAt there rather than ever reaching an orderBy key raw.
  const orderBy: Prisma.EnrollmentOrderByWithRelationInput[] = [orderFor(query), { id: 'asc' }];

  for (let skip = 0; ; skip += EXPORT_BATCH) {
    const rows = await prisma.enrollment.findMany({
      where,
      orderBy,
      skip,
      take: EXPORT_BATCH,
      include: ENROLLMENT_INCLUDE,
    });

    for (const row of rows) {
      yield [
        row.id,
        row.status,
        row.student.name,
        row.student.id,
        row.offering.course.code,
        row.offering.course.name,
        row.requestedAt.toISOString(),
        row.decidedAt?.toISOString() ?? '',
        row.decidedBy?.name ?? '',
        row.decisionNote,
      ];
    }
    if (rows.length < EXPORT_BATCH) return;
  }
}

export function streamRegister(actor: Actor, query: ExportEnrollmentsQuery): Readable {
  return csvStream(registerRows(actor, query));
}

// ---------------------------------------------------------------------------
// Requesting a seat
// ---------------------------------------------------------------------------

export async function requestEnrollment(
  actor: Actor,
  input: RequestEnrollmentInput,
): Promise<EnrollmentDto> {
  /*
   * Data shaping, not authorization. enrollment.ts: "The student is never in
   * the body — it is the session's user. Admins acting on behalf of a student use
   * `studentId`, which the API accepts only for ADMIN." A non-admin who sends
   * `studentId` has it ignored rather than honoured. The permission to be here at
   * all was decided by `authorize('enrollment:request')` at the route.
   */
  const studentId = actor.role === 'ADMIN' ? (input.studentId ?? actor.id) : actor.id;

  // A foreign key the client chose is checked first, because it turns a
  // foreign-key 500 into a field-level 422 (auth.service.ts).
  const course = await prisma.course.findFirst({
    where: { id: input.courseId, deletedAt: null },
    select: { id: true },
  });
  if (!course) throw validationFailed([{ path: 'courseId', message: 'Unknown course' }]);

  /*
   * The intake is named explicitly since Phase 9 — seats are sold per intake, so a
   * bodyless or stale offeringId has no honest default. The offering must belong to
   * the course in the same request; disagreeing ids are a client bug, not a lookup.
   * Retired intakes refuse new applications exactly like deleted courses.
   */
  const offering = await prisma.courseOffering.findFirst({
    where: { id: input.offeringId, courseId: input.courseId, deletedAt: null },
    select: { id: true },
  });
  if (!offering) {
    throw validationFailed([{ path: 'offeringId', message: 'Unknown offering for this course' }]);
  }

  if (studentId !== actor.id) {
    const student = await prisma.user.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true },
    });
    if (!student) throw validationFailed([{ path: 'studentId', message: 'Unknown student' }]);
  }

  /*
   * `input.note` has nowhere to go. Enrollment carries exactly one free-text column,
   * `decisionNote`, documented as what the student is SHOWN on rejection — writing an
   * applicant's note into it would render their own words as the teacher's decision.
   * Storing it needs an `Enrollment.requestNote` column, which is a schema change with
   * a migration, not something a route module invents.
   */

  const existing = await prisma.enrollment.findUnique({
    where: { studentId_offeringId: { studentId, offeringId: input.offeringId } },
    select: { id: true, status: true },
  });

  if (existing) {
    // One row per (student, OFFERING). A withdrawn or rejected student who re-applies
    // to THIS intake UPDATES the row rather than creating a second one; applying to a
    // DIFFERENT intake of the same course fell through to `create` below — that is
    // the "apply again for the spring cohort" path Phase 9 exists to express.
    if (existing.status === 'PENDING' || existing.status === 'APPROVED') {
      throw conflict('You have already applied to this intake');
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

    // After the write has committed, best-effort — a failed notification never fails
    // the request (notify() catches its own errors). Re-application is a fresh PENDING
    // row the teacher must action, so it announces like a first one.
    await notify({
      userIds: [reapplied.offering.course.teacherId],
      type: 'ENROLLMENT_REQUESTED',
      title: 'Enrolment requested',
      body: `${reapplied.student.name} asked to join ${reapplied.offering.course.name}.`,
      linkPath: `/courses/${reapplied.offering.courseId}`,
    });
    return toEnrollmentDto(reapplied);
  }

  // If two requests race past the findUnique above, P2002 on
  // @@unique([studentId, offeringId]) is already a friendly 409 — ADR 0006 line 41
  // names this as the intended path, so it is not caught and re-mapped here.
  // `approvedCount` is untouched: a request is PENDING, and only approval seats.
  const created = await prisma.enrollment.create({
    data: { studentId, offeringId: input.offeringId, status: 'PENDING' },
    include: ENROLLMENT_INCLUDE,
  });

  // Same side effect as the re-application branch above, after the same commit.
  await notify({
    userIds: [created.offering.course.teacherId],
    type: 'ENROLLMENT_REQUESTED',
    title: 'Enrolment requested',
    body: `${created.student.name} asked to join ${created.offering.course.name}.`,
    linkPath: `/courses/${created.offering.courseId}`,
  });
  return toEnrollmentDto(created);
}

/**
 * The course-nested create, `POST /courses/:courseId/enrollments`. courses.routes.ts
 * binds `requestEnrollmentSchema.omit({ courseId: true })` and the course id comes off
 * the path; `offeringId` is REQUIRED in the body since Phase 9, because seats are sold
 * per intake.
 */
export function requestForCourse(
  actor: Actor,
  courseId: string,
  input: Omit<RequestEnrollmentInput, 'courseId'>,
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
  const settled = await prisma.$transaction(async (tx) => {
    const current = await tx.enrollment.findUniqueOrThrow({
      // P2025 -> 404, errors.plugin.ts:52-53.
      where: { id: enrollmentId },
      select: { id: true, status: true, offeringId: true },
    });

    if (current.status === 'APPROVED') {
      // Idempotent: a second click must return the seated row without a second
      // increment, or two clicks oversell by one. `decided: false` also keeps that
      // second click from re-notifying the student.
      return {
        enrollment: await tx.enrollment.findUniqueOrThrow({
          where: { id: enrollmentId },
          include: ENROLLMENT_INCLUDE,
        }),
        decided: false,
      };
    }
    assertTransition(current.status, 'APPROVED');

    /*
     * ADR 0006. THE UPDATE IS THE CAPACITY CHECK — there is no SELECT count, no
     * read-then-write compare: "the read-then-write shape loses it every time under
     * load" (line 7). The row lock this UPDATE takes serializes concurrent approvals
     * on that offering and nothing else (line 25).
     *
     * Phase 7 added the second bound as a second term in the SAME WHERE: an intake
     * with a workshop seats only while BOTH `capacity` and `workshopCapacity`
     * hold against the one counter. `IS NULL OR` keeps an unbound intake (a
     * lecture) on exactly the old statement; there is no separate workshop
     * counter and no second increment. Phase 9 moved the whole statement from
     * Course to CourseOffering with the numbers it guards.
     *
     * A tagged template, never $executeRawUnsafe, and `offeringId` is a bound
     * parameter rather than interpolated text. It returns the affected row count.
     *
     * This statement bypasses the Prisma audit extension, which intercepts model
     * operations and not raw SQL (audit.ts:243). That is intended: the counter is
     * bookkeeping, and the `tx.enrollment.update` below writes the AuditEvent that
     * matters. No manual audit row is written for it.
     */
    const claimed = await tx.$executeRaw`
      UPDATE "CourseOffering"
         SET "approvedCount" = "approvedCount" + 1
       WHERE id = ${current.offeringId}
         AND "approvedCount" < "capacity"
         AND ("workshopCapacity" IS NULL OR "approvedCount" < "workshopCapacity")`;

    // Zero rows affected means a bound is full. Throwing here rolls the increment
    // back and nothing was seated — which is why it is never caught inside the
    // transaction. The read below does NOT gate the seat (the UPDATE above already
    // refused it); it only names which bound fired so the teacher sees "workshop"
    // rather than a wrong "intake full". Same refusal shape either way.
    if (claimed === 0) {
      const offeringRow = await tx.courseOffering.findUniqueOrThrow({
        where: { id: current.offeringId },
        select: { approvedCount: true, workshopCapacity: true },
      });
      if (
        offeringRow.workshopCapacity !== null &&
        offeringRow.approvedCount >= offeringRow.workshopCapacity
      ) {
        throw capacityExceeded('The workshop for this intake is full');
      }
      throw capacityExceeded('This intake is full');
    }

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
    return { enrollment: updated, decided: true };
  }, TX_OPTIONS);

  if (settled.decided) {
    // After the transaction above has committed — a notification written inside it
    // would both extend its lock window and roll back with a later failure. Best-
    // effort; notify() never throws.
    await notify({
      userIds: [settled.enrollment.studentId],
      type: 'ENROLLMENT_APPROVED',
      title: 'Enrolment approved',
      body: `You have a seat on ${settled.enrollment.offering.course.name}.`,
      linkPath: `/courses/${settled.enrollment.offering.courseId}`,
    });
  }
  return toEnrollmentDto(settled.enrollment);
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
  const settled = await prisma.$transaction(async (tx) => {
    const current = await tx.enrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
      select: { id: true, status: true, offeringId: true },
    });

    if (current.status === next) {
      // Same-state repeat, on the same reasoning as approve(): a double submission
      // must not move the counter. The row is returned untouched, and `changed:
      // false` keeps it from re-notifying anyone.
      return {
        enrollment: await tx.enrollment.findUniqueOrThrow({
          where: { id: enrollmentId },
          include: ENROLLMENT_INCLUDE,
        }),
        changed: false,
      };
    }
    assertTransition(current.status, next);

    if (current.status === 'APPROVED') {
      // The `> 0` guard is what keeps the CHECK's lower bound —
      // course_offering_capacity_sane in migration 0007, heir to 0002's
      // course_capacity_sane on Course — from ever being the thing that fires.
      await tx.$executeRaw`
        UPDATE "CourseOffering"
           SET "approvedCount" = "approvedCount" - 1
         WHERE id = ${current.offeringId} AND "approvedCount" > 0`;
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
    return { enrollment: updated, changed: true };
  }, TX_OPTIONS);

  // A rejection is news to its student; a withdrawal is news to the COURSE'S TEACHER,
  // who now holds a seat to re-offer — both land after the transaction has committed,
  // best-effort (notify() never throws). The two are separate verbs with separate
  // notifications for exactly the reason policy.ts:180-182 gives.
  if (next === 'REJECTED' && settled.changed) {
    await notify({
      userIds: [settled.enrollment.studentId],
      type: 'ENROLLMENT_REJECTED',
      title: 'Enrolment declined',
      body: `Your request for ${settled.enrollment.offering.course.name} was not approved.`,
      linkPath: `/courses/${settled.enrollment.offering.courseId}`,
    });
  }
  if (next === 'WITHDRAWN' && settled.changed) {
    await notify({
      userIds: [settled.enrollment.offering.course.teacherId],
      type: 'ENROLLMENT_WITHDRAWN',
      title: 'Enrolment withdrawn',
      body: `${settled.enrollment.student.name} withdrew from ${settled.enrollment.offering.course.name}.`,
      linkPath: `/courses/${settled.enrollment.offering.courseId}`,
    });
  }
  return toEnrollmentDto(settled.enrollment);
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

// ---------------------------------------------------------------------------
// Completion — the one decision that does NOT move approvedCount
// ---------------------------------------------------------------------------

/**
 * Record that a student finished, and the correction path that takes it back.
 *
 * Neither function touches `CourseOffering.approvedCount`, and the absence is the
 * point rather than an oversight. Every decision above maintains that counter, and
 * ADR 0006 line 40 makes it "an obligation of every transaction that changes an
 * enrollment's status" — but the obligation exists because a seat is a SCARCE
 * RESOURCE: an intake holds so many of them, overselling one is the failure the whole
 * concurrency design is about, and a counter that drifts from the APPROVED rows is a
 * capacity lie. A completion is not scarce and has no capacity behind it. The student
 * held the seat, did the course, and holds it still — the register keeps them on it, a
 * completed student's record stays visible on the roll, and decrementing here would
 * hand back a seat for a term that has already been taught. So the counter is left
 * exactly as APPROVE left it, and `uncomplete` returns to that same number rather
 * than adjusting anything on the way.
 *
 * The public return is the plain DTO, like `approve()` and `settle()`; the
 * `{ enrollment, changed }` pair is the transaction's own result, and `changed` is
 * what makes a double click a no-op instead of a second audit row and a second
 * notification for the same qualification.
 */
async function markCompletion(
  actor: Actor,
  enrollmentId: string,
  next: Extract<EnrollmentStatusValue, 'COMPLETED' | 'APPROVED'>,
  note: string | null,
): Promise<EnrollmentDto> {
  const settled = await prisma.$transaction(async (tx) => {
    const current = await tx.enrollment.findUniqueOrThrow({
      // P2025 -> 404, errors.plugin.ts:52-53.
      where: { id: enrollmentId },
      select: { id: true, status: true },
    });

    if (current.status === next) {
      // Same-state repeat, on approve()'s reasoning: a teacher double-clicking
      // Complete must not produce two audit rows for one qualification, and must not
      // tell the student they passed twice. The row is returned untouched and
      // `changed: false` keeps it silent.
      return {
        enrollment: await tx.enrollment.findUniqueOrThrow({
          where: { id: enrollmentId },
          include: ENROLLMENT_INCLUDE,
        }),
        changed: false,
      };
    }
    assertTransition(current.status, next);

    const completing = next === 'COMPLETED';
    const updated = await tx.enrollment.update({
      where: { id: enrollmentId },
      data: {
        status: next,
        // The pair is written as one statement so `completedAt` and `completedBy` can
        // never be half-present. Clearing both on the correction is what stops a
        // withdrawn-by-attrition user from leaving a dangling "qualified by" on a row
        // that says APPROVED again.
        ...(completing
          ? { completedAt: new Date(), completedById: actor.id }
          : { completedAt: null, completedById: null }),
        // The note rides the same column an approval's does, and is taken with it on
        // the way back — see completeEnrollmentSchema for why it is not a "reason".
        ...(completing && note ? { decisionNote: note } : {}),
        ...(completing ? {} : { decisionNote: null }),
      },
      include: ENROLLMENT_INCLUDE,
    });
    return { enrollment: updated, changed: true };
  }, TX_OPTIONS);

  // After the transaction has committed, best-effort (notify() never throws), and
  // only on a REAL completion. A reversal announces nothing to the student: telling
  // someone they passed and then telling them they had not, both from a click
  // somewhere in a staff office, is worse than the correction itself being quiet.
  if (next === 'COMPLETED' && settled.changed) {
    await notify({
      userIds: [settled.enrollment.studentId],
      type: 'ENROLLMENT_COMPLETED',
      title: 'Course completed',
      body: `You have completed ${settled.enrollment.offering.course.name}.`,
      linkPath: `/courses/${settled.enrollment.offering.courseId}`,
    });
  }
  return toEnrollmentDto(settled.enrollment);
}

export function complete(
  actor: Actor,
  enrollmentId: string,
  input?: CompleteEnrollmentInput,
): Promise<EnrollmentDto> {
  return markCompletion(actor, enrollmentId, 'COMPLETED', input?.note ?? null);
}

export function uncomplete(actor: Actor, enrollmentId: string): Promise<EnrollmentDto> {
  return markCompletion(actor, enrollmentId, 'APPROVED', null);
}
