import { prisma, Prisma } from '@skillwright/db';
import { can } from '@skillwright/shared';
import type {
  Actor,
  AssignmentDto,
  AssignmentSubmissionList,
  CreateAssignmentInput,
  CreateSubmissionInput,
  EnrollmentState,
  GradeSubmissionInput,
  MyAssignmentList,
  ReturnSubmissionInput,
  Subject,
  SubmissionDto,
  UpdateAssignmentInput,
} from '@skillwright/shared';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../lib/dto.js';
import { conflict, notFound, validationFailed } from '../../lib/errors.js';
// The Upload row, and whether it may be attached to anything, belong to the uploads
// module — which owns the presign -> PUT -> commit path every hand-in arrives through.
// The same import resources.service.ts makes for its own `uploadId`.
import { assertUploadClaimable } from '../uploads/uploads.service.js';
import type { AssignmentSubmissionRow, ListAssignmentsQuery } from './assignments.schema.js';

// ---------------------------------------------------------------------------
// Query shapes
// ---------------------------------------------------------------------------

/**
 * Exactly the relations `toSubmissionDto` reads, as one include every hand-in query
 * spreads.
 *
 * `as const` matters: Prisma derives the payload type from the literal shape, and
 * without it the mapper stops being checked against the columns it reads.
 *
 * `gradedBy` is `USER_SUMMARY_SELECT`, never `include: { gradedBy: true }` — a bare
 * include pulls every User scalar, which for a class-sized list of hand-ins is every
 * Argon2id hash and TOTP ciphertext belonging to every grader (lib/dto.ts:44-53).
 */
const SUBMISSION_INCLUDE = {
  upload: { select: { id: true, originalName: true, contentType: true, sizeBytes: true } },
  gradedBy: { select: USER_SUMMARY_SELECT },
} as const;

type SubmissionWithRelations = Prisma.SubmissionGetPayload<{ include: typeof SUBMISSION_INCLUDE }>;

/**
 * What the teacher's class list adds on top: whose seat it was handed in on, and
 * which intake — a course with two intakes running at once would otherwise show one
 * list of names and no way to tell the two cohorts apart.
 */
const SUBMISSION_ROW_INCLUDE = {
  ...SUBMISSION_INCLUDE,
  assignment: { select: { offeringId: true } },
  enrollment: { select: { student: { select: USER_SUMMARY_SELECT } } },
} as const;

/**
 * The student-side join. `submissions` is a NESTED relation filtered to this student's
 * own seat, which is what makes `listMine` one round trip rather than one query per
 * task — see that function's comment, which is the whole point of the endpoint.
 *
 * A FUNCTION rather than a constant because the filter needs the caller's id, and a
 * `Prisma.AssignmentGetPayload` over `ReturnType<typeof …>` still derives exactly.
 */
const myAssignmentInclude = (studentId: string) =>
  ({
    offering: { select: { course: { select: { id: true, name: true, code: true } } } },
    submissions: {
      where: { deletedAt: null, enrollment: { studentId } },
      orderBy: { attempt: 'desc' },
      include: SUBMISSION_INCLUDE,
    },
  }) as const;

type SubmissionRowWithRelations = Prisma.SubmissionGetPayload<{
  include: typeof SUBMISSION_ROW_INCLUDE;
}>;

type MyAssignmentRow = Prisma.AssignmentGetPayload<{
  include: ReturnType<typeof myAssignmentInclude>;
}>;

/**
 * The student's list is capped rather than paginated.
 *
 * A school runs five intakes of one course and a student sits in at most a couple of
 * them, so a cap in the hundreds is unreachable in practice — but an unbounded
 * `findMany` on a table a school can write to is a shape nobody should ship on the
 * strength of "it will not happen". `MAX_PAGE_SIZE` would be the wrong constant here
 * too: this endpoint is deliberately not paginated, because the SPA renders the whole
 * list and a paginated variant would need a second response shape for no reader.
 */
const MINE_LIMIT = 200;

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

/**
 * Prisma's `Decimal` serialises to JSON as a STRING (decimal.js `toJSON`), and
 * `assignmentSchema.maxScore` / `submissionSchema.score` are `z.number()`. Handing the
 * Decimal straight to the response serializer would answer a 500 on every response
 * carrying a mark — a validation error naming `data.0.maxScore`, with nothing in it to
 * suggest a decimal was involved. The conversion therefore happens HERE, in the one
 * place a score becomes a wire value.
 *
 * `toNumber()` on a `DECIMAL(10,2)` cannot lose precision: 8 integer digits and 2
 * decimals is comfortably inside the 2^53 a double represents exactly.
 */
function toScore(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

type AssignmentScalars = {
  id: string;
  offeringId: string;
  title: string;
  brief: string;
  dueAt: Date;
  maxScore: Prisma.Decimal;
  resourceId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toAssignmentDto(row: AssignmentScalars): AssignmentDto {
  return {
    id: row.id,
    offeringId: row.offeringId,
    title: row.title,
    brief: row.brief,
    dueAt: row.dueAt.toISOString(),
    // Non-null by the column's NOT NULL plus `assignment_max_score_positive`.
    maxScore: toScore(row.maxScore) ?? 0,
    resourceId: row.resourceId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toSubmissionDto(row: SubmissionWithRelations): SubmissionDto {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    enrollmentId: row.enrollmentId,
    status: row.status,
    attempt: row.attempt,
    score: toScore(row.score),
    feedback: row.feedback,
    submittedAt: row.submittedAt.toISOString(),
    gradedAt: row.gradedAt === null ? null : row.gradedAt.toISOString(),
    gradedBy: row.gradedBy === null ? null : toUserSummary(row.gradedBy),
    upload: {
      id: row.upload.id,
      originalName: row.upload.originalName,
      contentType: row.upload.contentType,
      sizeBytes: row.upload.sizeBytes,
    },
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Subject loaders — the only database access authorization performs
// ---------------------------------------------------------------------------

/**
 * The actor's own enrolment status in the course an INTAKE belongs to.
 *
 * `Subject.enrollmentStatus` is the REQUESTING actor's status in the relevant course,
 * never the status of some arbitrary row (actor.ts) — passing someone else's is the one
 * documented way to misuse the field. Teachers, admins and anonymous visitors have no
 * enrolment to report, and `enrolledApproved` is not the rule that lets any of them
 * through anyway.
 *
 * This is `viewerEnrollmentStatus` from resources.service.ts, re-derived against the
 * offering rather than imported: the resources module's copy is private, the two are a
 * dozen lines each, and importing across modules to save them would make an
 * authorization subject depend on the resources module not being refactored. That
 * reasoning is written out at `loadResourceCourseSubject` and applies unchanged.
 */
async function viewerEnrollmentStatus(
  actor: Actor | null,
  courseId: string,
): Promise<EnrollmentState | null> {
  if (actor === null || actor.role !== 'STUDENT') return null;
  // Seats are per-intake since Phase 9, so "in the course" means ANY live offering of
  // it — an APPROVED seat anywhere reads APPROVED, which is what `enrolledApproved`
  // checks. Otherwise the most recent row wins.
  const approved = await prisma.enrollment.findFirst({
    where: { studentId: actor.id, status: 'APPROVED', offering: { courseId, deletedAt: null } },
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
 * Subject for `assignment:create`: the INTAKE, because a deadline belongs to a run of
 * the course and not to the template (schema.prisma's `Assignment.offeringId`).
 *
 * `undefined` for a missing or soft-deleted INTAKE so the policy denies, rather than
 * this loader throwing a bare 404 before the gate has run.
 *
 * Every field is named individually rather than spread: TypeScript does not
 * excess-property-check a spread, and a misspelled key here is a SILENT 403 that no
 * type error and no log line will ever show you (LESSONS-LEARNED #18).
 *   courseTeacherId   -> ownsCourse       (combinators.ts)
 *   enrollmentStatus  -> enrolledApproved (combinators.ts)
 */
export async function loadOfferingSubject(
  offeringId: string,
  actor: Actor | null,
): Promise<Subject | undefined> {
  const offering = await prisma.courseOffering.findFirst({
    // Soft delete is not enforced by the ORM, so both levels are filtered by hand: a
    // task on a retired intake is as invisible as one on a deleted course.
    where: { id: offeringId, deletedAt: null, course: { deletedAt: null } },
    select: { id: true, courseId: true, course: { select: { teacherId: true } } },
  });
  if (!offering) return undefined;

  return {
    id: offering.id,
    courseId: offering.courseId,
    // ownsCourse reads `courseTeacherId`, NOT `teacherId`.
    courseTeacherId: offering.course.teacherId,
    enrollmentStatus: await viewerEnrollmentStatus(actor, offering.courseId),
  };
}

/**
 * Subject for an EXISTING assignment — the PATCH and DELETE routes, which ride
 * `assignment:create` because setting, correcting and withdrawing work on an intake
 * are the same authority (policy.ts).
 */
export async function loadAssignmentSubject(
  id: string,
  actor: Actor | null,
): Promise<Subject | undefined> {
  const assignment = await prisma.assignment.findFirst({
    where: { id, deletedAt: null, offering: { deletedAt: null, course: { deletedAt: null } } },
    select: {
      id: true,
      offering: { select: { courseId: true, course: { select: { teacherId: true } } } },
    },
  });
  if (!assignment) return undefined;

  return {
    id: assignment.id,
    courseId: assignment.offering.courseId,
    courseTeacherId: assignment.offering.course.teacherId,
    enrollmentStatus: await viewerEnrollmentStatus(actor, assignment.offering.courseId),
  };
}

/**
 * Subject for a SUBMISSION — the shape `submission:read` and `submission:grade`
 * decide on.
 *
 * `studentId` is read off the ENROLLMENT the hand-in was made on, and it is the field
 * a student's entire access rests on. `Submission` has no `studentId` column and must
 * not acquire one: a second copy of "who is this student" is a second thing that can
 * disagree with the register, and an ABSENT one denies silently (LESSONS-LEARNED #31,
 * which has cost three features in this repository and is why this block is spelled out
 * rather than summarised).
 *
 * `assignment:read` on a WHOLE assignment is deliberately NOT this shape — a class of
 * hand-ins has no single student — so `GET /assignments/:id/submissions` is gated on
 * `submission:read` with the assignment's own subject, where a student's
 * `isEnrolledStudent` reads an absent `studentId` and refuses. The same deliberate
 * #15/#31 shape the attendance register uses.
 */
export async function loadSubmissionSubject(id: string): Promise<Subject | undefined> {
  const submission = await prisma.submission.findFirst({
    where: {
      id,
      deletedAt: null,
      assignment: { deletedAt: null, offering: { deletedAt: null, course: { deletedAt: null } } },
    },
    select: {
      id: true,
      enrollment: {
        select: {
          studentId: true,
          offering: { select: { courseId: true, course: { select: { teacherId: true } } } },
        },
      },
    },
  });
  if (!submission) return undefined;

  return {
    id: submission.id,
    courseId: submission.enrollment.offering.courseId,
    courseTeacherId: submission.enrollment.offering.course.teacherId,
    studentId: submission.enrollment.studentId,
  };
}

/**
 * Subject for the WHOLE-CLASS read, `GET /assignments/:id/submissions`. The assignment,
 * deliberately WITHOUT `studentId` — see the note on `loadSubmissionSubject`.
 */
export async function loadAssignmentClassSubject(id: string): Promise<Subject | undefined> {
  const assignment = await prisma.assignment.findFirst({
    where: { id, deletedAt: null, offering: { deletedAt: null, course: { deletedAt: null } } },
    select: {
      id: true,
      offering: { select: { courseId: true, course: { select: { teacherId: true } } } },
    },
  });
  if (!assignment) return undefined;

  return {
    id: assignment.id,
    courseId: assignment.offering.courseId,
    courseTeacherId: assignment.offering.course.teacherId,
  };
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/**
 * The `assignment:read` rows (policy.ts) expressed as a WHERE clause, for the
 * per-intake list.
 *
 * A list cannot ask `can()` a yes/no question — there is no single subject — so each
 * branch below mirrors one policy row and must be changed with it:
 *   anonymous -> deny            (policy.ts)
 *   STUDENT   -> enrolledApproved (policy.ts)
 *   TEACHER   -> ownsCourse       (policy.ts)
 *   ADMIN     -> allow            (policy.ts)
 *
 * Reading `actor.role` here is choosing which WHERE mirrors which policy row — the one
 * legitimate role read named by CONTRIBUTING.md. It is NOT a permission check: IF THIS
 * FUNCTION AND policy.ts DISAGREE, THIS FUNCTION IS THE BUG.
 *
 * The STUDENT branch is the two-hop seat lookup again, because seats are per-INTAKE
 * since Phase 9 and an assignment hangs off an intake.
 */
export function visibilityWhere(actor: Actor): Prisma.AssignmentWhereInput {
  const live: Prisma.AssignmentWhereInput = {
    deletedAt: null,
    offering: { deletedAt: null, course: { deletedAt: null } },
  };

  switch (actor.role) {
    case 'ADMIN':
      return live;
    case 'TEACHER':
      return { AND: [live, { offering: { course: { teacherId: actor.id } } }] };
    case 'STUDENT':
      return {
        AND: [
          live,
          { offering: { enrollments: { some: { studentId: actor.id, status: 'APPROVED' } } } },
        ],
      };
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** `GET /offerings/:offeringId/assignments` — one intake's tasks, in deadline order. */
export async function listForOffering(actor: Actor, offeringId: string): Promise<AssignmentDto[]> {
  const rows = await prisma.assignment.findMany({
    where: { AND: [visibilityWhere(actor), { offeringId }] },
    // `@@index([offeringId, dueAt])` (schema.prisma) is the index this reads, which is
    // why the compound index exists rather than two single-column ones.
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toAssignmentDto);
}

/**
 * THE query this phase was designed around: every task the viewer holds an APPROVED
 * seat for, joined to whether they have handed anything in.
 *
 * ONE round trip, and that is the whole claim. The obvious spelling is `findMany` over
 * assignments and then, per row, a second query for that student's hand-ins — which for
 * a student in three intakes of a course is a query per task, on the screen they open
 * most often, over mobile data. Instead the hand-ins are a NESTED relation filtered to
 * this student, which Prisma resolves in the same statement, and the answer is one
 * result set.
 *
 * The nested `where` is a relation filter on a required to-one, so `enrollment: {
 * studentId: actor.id }` filters inside the same SELECT rather than in application
 * code — which matters, because filtering afterwards would mean loading the whole
 * class's hand-ins into this process to throw them away.
 *
 * `orderBy: { attempt: 'desc' }` is what makes the latest attempt element 0, so the
 * mapping below reads an index rather than searching the array for a maximum.
 */
export async function listMine(
  actor: Actor,
  query: ListAssignmentsQuery,
): Promise<MyAssignmentList> {
  // A teacher's own courses carry no enrolment of theirs, so this list is empty for
  // them by construction. Answering `[]` rather than running a query that cannot match
  // is also the honest shape: they have the per-intake list above instead.
  if (actor.role !== 'STUDENT') return { data: [] };

  const rows: MyAssignmentRow[] = await prisma.assignment.findMany({
    where: {
      deletedAt: null,
      ...(query.offeringId !== undefined ? { offeringId: query.offeringId } : {}),
      offering: {
        deletedAt: null,
        course: { deletedAt: null },
        // The self-scoping clause. This endpoint has NO subject gate — a list of the
        // caller's own rows has no subject to gate on, exactly as `GET /enrollments`
        // self-scopes — so this WHERE is the only thing standing between a student and
        // somebody else's coursework. It mirrors `enrolledApproved`, and if the two
        // disagree, this WHERE is the bug.
        ...(query.courseId !== undefined ? { courseId: query.courseId } : {}),
        enrollments: { some: { studentId: actor.id, status: 'APPROVED' } },
      },
    },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    take: MINE_LIMIT,
    include: myAssignmentInclude(actor.id),
  });

  const now = Date.now();

  return {
    data: rows.map((row) => {
      const latest = row.submissions[0] ?? null;
      const score = toScore(latest?.score ?? null);
      const maxScore = toScore(row.maxScore) ?? 0;
      return {
        ...toAssignmentDto(row),
        course: row.offering.course,
        submission: latest === null ? null : toSubmissionDto(latest),
        submissionCount: row.submissions.length,
        // The division a certificate in Phase 3 will perform, done ONCE and here.
        // Null rather than 0 while the work is ungraded: 0 is a mark nobody gave, and
        // a client that renders it as "0%" has invented a grade.
        scorePercent:
          score === null || maxScore <= 0 ? null : Math.round((score / maxScore) * 1000) / 10,
        // A FACT about the clock, not a permission: whether a deadline has passed says
        // nothing about who may still hand in. `RETURNED` asks for another attempt and
        // the submission dialog stays open on an overdue task, because the teacher who
        // set it may well accept a late one and the API is the one that decides.
        overdue: row.dueAt.getTime() < now,
      };
    }),
  };
}

/**
 * `GET /assignments/:id/submissions` — the whole class, one row per hand-in, newest
 * attempt first for each student.
 *
 * Not paginated and not filtered by `submission:read` per row: the route's gate is the
 * single `submission:read` decision on the assignment's subject, which a student fails
 * by their own rule, and the WHERE below is `visibilityWhere`'s scope narrowed to one
 * assignment — which a caller who passed that gate is entitled to.
 */
export async function listSubmissions(assignmentId: string): Promise<AssignmentSubmissionList> {
  const rows = await prisma.submission.findMany({
    where: {
      deletedAt: null,
      assignmentId,
      // A hand-in on a task whose intake or course has since been retired is as
      // invisible as one on a deleted task. The ORM enforces neither level.
      assignment: { deletedAt: null, offering: { deletedAt: null, course: { deletedAt: null } } },
    },
    orderBy: [{ submittedAt: 'desc' }],
    include: SUBMISSION_ROW_INCLUDE,
  });

  return {
    data: rows.map((row: SubmissionRowWithRelations): AssignmentSubmissionRow => ({
      ...toSubmissionDto(row),
      student: toUserSummary(row.enrollment.student),
      offeringId: row.assignment.offeringId,
    })),
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * A foreign key the client chose turns a 500 into a field-level 422.
 *
 * Same helper shape `resources.service.ts` uses for `courseId`. `CourseOffering` is
 * the FK here rather than `Course` because a deadline belongs to a run of the course.
 */
async function assertOfferingExists(offeringId: string, path: string): Promise<void> {
  const offering = await prisma.courseOffering.findFirst({
    where: { id: offeringId, deletedAt: null, course: { deletedAt: null } },
    select: { id: true },
  });
  if (!offering) throw validationFailed([{ path, message: 'Unknown intake' }]);
}

/**
 * The brief attached to a task is a real `Resource`, so "may this resource be the
 * brief?" is asked with the SAME `can()` the resources module's own routes ask, on a
 * subject built from the resource plus the two fields only the course knows.
 *
 * NOT a `role ===` branch, and not a second copy of the visibility rules: `resource:read`
 * already answers this exactly, including the `and(isPublic, isPublished)` narrowing
 * that lesson 33 exists for and the `enrolledApproved` branch an approved student gets.
 * Re-deriving it here would be the second policy mirror lesson 28 is about, and the
 * dashboard's resources tile is what that cost.
 *
 * The COURSE check is not in the policy and cannot be: a resource from a different
 * course is not a permission question, it is a category error, and a teacher who could
 * hang a colleague's private material off their own task would be a leak pointed the
 * other way from the one lesson 33 closed.
 */
async function assertBriefUsable(
  resourceId: string,
  courseId: string,
  actor: Actor,
): Promise<void> {
  const resource = await prisma.resource.findFirst({
    where: { id: resourceId, deletedAt: null, course: { deletedAt: null } },
    select: {
      id: true,
      courseId: true,
      authorId: true,
      isPublic: true,
      course: { select: { teacherId: true, publishedAt: true } },
    },
  });
  if (!resource) throw validationFailed([{ path: 'resourceId', message: 'Unknown resource' }]);
  if (resource.courseId !== courseId) {
    throw validationFailed([
      { path: 'resourceId', message: 'That resource belongs to a different course' },
    ]);
  }

  // The projection `resources.service.ts` names `loadResourceSubject`, field for field.
  // A misspelled key here would deny silently and nothing would say why.
  const decision = can(actor, 'resource:read', {
    id: resource.id,
    courseId: resource.courseId,
    courseTeacherId: resource.course.teacherId,
    publishedAt: resource.course.publishedAt,
    authorId: resource.authorId,
    isPublic: resource.isPublic,
    enrollmentStatus: await viewerEnrollmentStatus(actor, resource.courseId),
  });
  if (!decision.allowed) {
    throw validationFailed([
      { path: 'resourceId', message: 'That resource is not yours to attach.' },
    ]);
  }
}

/**
 * `assignment:create` was decided at the route against the INTAKE named in the body,
 * so everything here is data shaping.
 *
 * There is no author: an assignment belongs to the intake, and the intake already
 * names its course, which already names its teacher. A second attribution column would
 * be a second thing that can disagree with the one the policy reads.
 */
export async function create(actor: Actor, input: CreateAssignmentInput): Promise<AssignmentDto> {
  await assertOfferingExists(input.offeringId, 'offeringId');

  const offering = await prisma.courseOffering.findUniqueOrThrow({
    where: { id: input.offeringId },
    select: { courseId: true },
  });
  if (input.resourceId) await assertBriefUsable(input.resourceId, offering.courseId, actor);

  const row = await prisma.assignment.create({
    data: {
      offeringId: input.offeringId,
      title: input.title,
      brief: input.brief,
      dueAt: input.dueAt,
      // `new Prisma.Decimal(...)` rather than the bare number: Prisma accepts a
      // `Decimal | number | string`, and `Decimal` is the type the column is declared
      // with, so the schema and the write cannot drift apart.
      maxScore: new Prisma.Decimal(input.maxScore),
      resourceId: input.resourceId ?? null,
    },
  });

  return toAssignmentDto(row);
}

/**
 * No `actor` parameter, because nothing in an update is actor-scoped: the offering
 * never moves (there is no `offeringId` in `updateAssignmentSchema`) and a task has no
 * author to re-attribute. `assignment:create` was already decided against this row's
 * subject at the gate.
 *
 * Keys are spread in or left out entirely: under `exactOptionalPropertyTypes`,
 * `{ title: undefined }` is not assignable to an optional field, and writing it would
 * also overwrite a column the caller never mentioned.
 */
export async function update(
  actor: Actor,
  id: string,
  input: UpdateAssignmentInput,
): Promise<AssignmentDto> {
  const current = await prisma.assignment.findFirst({
    where: { id, deletedAt: null, offering: { deletedAt: null, course: { deletedAt: null } } },
    select: { id: true, offering: { select: { courseId: true } } },
  });
  if (!current) throw notFound('Assignment');

  if (input.resourceId) {
    await assertBriefUsable(input.resourceId, current.offering.courseId, actor);
  }

  const row = await prisma.assignment.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.brief !== undefined ? { brief: input.brief } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
      ...(input.maxScore !== undefined ? { maxScore: new Prisma.Decimal(input.maxScore) } : {}),
      // Explicit null DETACHES the brief and absent leaves it alone; the two are
      // different intentions and `.nullable().optional()` is what lets the wire say
      // which one it meant.
      ...(input.resourceId !== undefined ? { resourceId: input.resourceId } : {}),
    },
  });

  return toAssignmentDto(row);
}

/**
 * SOFT delete only — schema.prisma rule 3, which is why every read in this file
 * filters `deletedAt`.
 *
 * A hard delete would cascade the hand-ins away, and a teacher's decision to stop
 * setting a task is emphatically not a decision to erase a class's graded work: the
 * register, and any certificate Phase 3 issues from it, still needs those rows. The
 * upload behind each hand-in is left alone too, and `Submission.uploadId` is
 * `Restrict` precisely so that deleting an Upload under a live hand-in is a 409 rather
 * than a silent loss of assessment evidence.
 */
export async function remove(id: string): Promise<void> {
  const assignment = await prisma.assignment.findFirst({
    // The same two-level filter every other read here uses, so a row nobody can see is
    // also a row nobody can delete: soft-deleting an already-invisible task changes
    // nothing and would answer 204 to a caller whose GET answers 404.
    where: { id, deletedAt: null, offering: { deletedAt: null, course: { deletedAt: null } } },
    select: { id: true },
  });
  if (!assignment) throw notFound('Assignment');

  await prisma.assignment.update({ where: { id }, data: { deletedAt: new Date() } });
}

/**
 * The seat a hand-in must be made on.
 *
 * THE precondition of this whole model, and the reason `Submission` carries
 * `enrollmentId` rather than `studentId`: work is handed in against a seat. A student
 * whose request is still PENDING, or who holds a seat on a DIFFERENT intake of the
 * same course, has no row to hand in against, and inventing one would put coursework
 * in the register of a cohort the student was never admitted to.
 *
 * A 409 rather than a 403: the caller is not forbidden from handing in, they are
 * handing in against something that does not exist yet, and the SPA renders the CODE
 * (LESSONS-LEARNED #25) — so the copy is the generic conflict sentence and the detail
 * here is the diagnostic.
 */
async function seatForHandIn(studentId: string, offeringId: string): Promise<{ id: string }> {
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      studentId,
      offeringId,
      status: 'APPROVED',
      offering: { deletedAt: null },
    },
    select: { id: true },
  });
  if (!enrollment) {
    throw conflict(
      'You do not hold an approved seat on this intake, so there is nothing to hand in against.',
    );
  }
  return enrollment;
}

/**
 * The next attempt number for this (task, seat).
 *
 * Computed over EVERY row for the pair, INCLUDING soft-deleted ones. The unique
 * `@@unique([assignmentId, enrollmentId, attempt])` is a database index and does not
 * know about `deletedAt`, so a numbering that skipped deleted rows would collide with
 * the very row it is meant to supersede — an untranslated P2002 surfacing as a 500.
 */
async function nextAttempt(assignmentId: string, enrollmentId: string): Promise<number> {
  const highest = await prisma.submission.findFirst({
    where: { assignmentId, enrollmentId },
    orderBy: { attempt: 'desc' },
    select: { attempt: true },
  });
  return (highest?.attempt ?? 0) + 1;
}

/**
 * A hand-in.
 *
 * `assignment:read` was already decided at the route against the intake, which is
 * what refuses a student with no APPROVED seat — so by the time this runs the caller is
 * entitled to SEE the task, and the question left is whether they hold the seat to hand
 * it in on. That is a data fact, not a permission, which is why it is answered here
 * rather than by widening or narrowing a policy rule.
 *
 * The upload is claimed through the uploads module's own helper, exactly as
 * `resources.service.ts` claims its own: the same check that a private file cannot be
 * attached by somebody else, and that an unconfirmed upload cannot be attached at all.
 */
export async function createSubmission(
  actor: Actor,
  input: CreateSubmissionInput,
): Promise<SubmissionDto> {
  const assignment = await prisma.assignment.findFirst({
    where: {
      id: input.assignmentId,
      deletedAt: null,
      offering: { deletedAt: null, course: { deletedAt: null } },
    },
    select: { id: true, offeringId: true },
  });
  if (!assignment) throw notFound('Assignment');

  await assertUploadClaimable(input.uploadId, actor, 'uploadId');

  const enrollment = await seatForHandIn(actor.id, assignment.offeringId);
  const attempt = await nextAttempt(assignment.id, enrollment.id);

  // A race between two tabs on the same pair still lands on the unique index, which
  // errors.plugin.ts turns into a 409 rather than a 500. That is the intended outcome:
  // two hand-ins at the same attempt number is a client that lost a race, and the
  // answer is "try again", not a crash.
  const row = await prisma.submission.create({
    data: {
      assignmentId: assignment.id,
      enrollmentId: enrollment.id,
      uploadId: input.uploadId,
      attempt,
    },
    include: SUBMISSION_INCLUDE,
  });

  return toSubmissionDto(row);
}

/**
 * A mark. `gradedById` and `gradedAt` are the session and the clock, never the body —
 * `gradeSubmissionSchema` has neither field, and accepting one would let a caller
 * forge attribution for the grade they just gave themselves.
 *
 * Re-grading an already-graded hand-in is the CORRECTION path, and is deliberately
 * allowed: the same discipline `AttendanceRecord` uses, where marking the same
 * register twice corrects the row rather than duplicating it. A grader who changes
 * their mind writes the new mark over the old one and the audit trail keeps both,
 * rather than forcing a "return" round trip that leaves the student with a wrong grade
 * in the meantime.
 */
export async function grade(
  actor: Actor,
  id: string,
  input: GradeSubmissionInput,
): Promise<SubmissionDto> {
  const target = await loadGradeableSubmission(id);
  const score = input.score ?? null;

  if (score !== null) assertScoreWithinMax(score, target.maxScore);

  const row = await prisma.submission.update({
    where: { id: target.id },
    data: {
      status: 'GRADED',
      score: score === null ? null : new Prisma.Decimal(score),
      feedback: input.feedback ?? null,
      gradedById: actor.id,
      gradedAt: new Date(),
    },
    include: SUBMISSION_INCLUDE,
  });

  return toSubmissionDto(row);
}

/**
 * Returning asks for another attempt: a verdict, a mandatory reason, and NO mark.
 *
 * Separate from `grade` rather than `grade` with an absent score, on the rule quoted
 * at `enrollment:withdraw` — "separate verb, separate audit action". A status column
 * written by two different URLs carries one audit action, so the trail could not
 * distinguish "I marked this" from "I sent this back", and a reader would be left
 * diffing two JSON blobs. `score` is set to null rather than left: a RETURNED row
 * carrying a mark is a contradiction, and the certificate arithmetic in Phase 3 divides
 * by `maxScore` and would count it twice.
 */
export async function returnWork(
  actor: Actor,
  id: string,
  input: ReturnSubmissionInput,
): Promise<SubmissionDto> {
  const target = await loadGradeableSubmission(id);

  const row = await prisma.submission.update({
    where: { id: target.id },
    data: {
      status: 'RETURNED',
      score: null,
      feedback: input.feedback,
      gradedById: actor.id,
      gradedAt: new Date(),
    },
    include: SUBMISSION_INCLUDE,
  });

  return toSubmissionDto(row);
}

/**
 * The row a grade is going to be written to, with the ceiling it has to respect.
 *
 * `findFirst` with the three-level soft-delete filter rather than
 * `findUniqueOrThrow`: an ADMIN passes `submission:grade` on an id that does not exist
 * (their cell is `allow`, which reads no subject field), so a missing row is a
 * reachable path here and not merely a race — and it has to answer 404 rather than a
 * null-dereference 500. The same reasoning `getById` in resources.service.ts states.
 */
async function loadGradeableSubmission(
  id: string,
): Promise<{ id: string; maxScore: Prisma.Decimal }> {
  const submission = await prisma.submission.findFirst({
    where: {
      id,
      deletedAt: null,
      assignment: { deletedAt: null, offering: { deletedAt: null, course: { deletedAt: null } } },
    },
    select: { id: true, assignment: { select: { maxScore: true } } },
  });
  if (!submission) throw notFound('Submission');
  return { id: submission.id, maxScore: submission.assignment.maxScore };
}

/**
 * A mark above the task's own maximum is a data-entry accident, and it is refused with
 * a field path rather than stored.
 *
 * The database CANNOT hold this one: the ceiling lives on a different table, and a
 * Postgres CHECK may not contain a subquery. So the invariant is held here, which is
 * the exception schema design rule 5 has to admit — and it is why the shared schema
 * bounds `score` at 10_000 (a shape check, not a business one) rather than pretending
 * to know the real maximum, which is per-row data the body does not carry.
 */
function assertScoreWithinMax(score: number, maxScore: Prisma.Decimal): void {
  if (new Prisma.Decimal(score).greaterThan(maxScore)) {
    throw validationFailed([
      { path: 'score', message: `This task is out of ${maxScore.toNumber()}.` },
    ]);
  }
}
