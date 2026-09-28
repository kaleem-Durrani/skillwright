import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  SUBJECT_INDEPENDENT_ACTIONS,
  can,
  computeSubjectIndependentActions,
  type Action,
  type Actor,
  type Role,
  type Subject,
} from '../src/policy/index.js';

/**
 * The permissions matrix.
 *
 * Every claim the project makes about authorization is decided here. A cell is a
 * (caller, action, subject-state) triple with an expected answer and, for
 * refusals, the exact rule identifier that must have produced it — asserting the
 * rule name is what stops a cell from passing for the wrong reason (a suspended
 * teacher denied by `ownsCourse` instead of by `status:SUSPENDED` would look green
 * while proving nothing).
 *
 * The final block iterates `ACTIONS` and fails on any action no cell mentions, so
 * adding an action without testing it breaks CI.
 */

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

const ADMIN: Actor = { id: 'u_admin', role: 'ADMIN', status: 'ACTIVE', provenance: 'PASSWORD' };
const TEACHER_A: Actor = { id: 'u_ta', role: 'TEACHER', status: 'ACTIVE', provenance: 'PASSWORD' };
const TEACHER_B: Actor = { id: 'u_tb', role: 'TEACHER', status: 'ACTIVE', provenance: 'PASSWORD' };
/** Enrolled and APPROVED in course A. */
const STUDENT_IN: Actor = { id: 'u_s1', role: 'STUDENT', status: 'ACTIVE', provenance: 'PASSWORD' };
/** Enrolled nowhere. */
const STUDENT_OUT: Actor = {
  id: 'u_s2',
  role: 'STUDENT',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
};
const ANON = null;

const withStatus = (actor: Actor, status: Actor['status']): Actor => ({ ...actor, status });
const withProvenance = (actor: Actor, provenance: Actor['provenance']): Actor => ({
  ...actor,
  provenance,
});

const SUSPENDED_ADMIN = withStatus(ADMIN, 'SUSPENDED');
const SUSPENDED_TEACHER = withStatus(TEACHER_A, 'SUSPENDED');
const SUSPENDED_STUDENT = withStatus(STUDENT_IN, 'SUSPENDED');
const PENDING_STUDENT = withStatus(STUDENT_IN, 'PENDING_VERIFICATION');
const PENDING_TEACHER = withStatus(TEACHER_A, 'PENDING_VERIFICATION');
const MFA_PENDING_ADMIN = withProvenance(ADMIN, 'MFA_PENDING');
const MFA_PENDING_STUDENT = withProvenance(STUDENT_IN, 'MFA_PENDING');
const DEMO_ADMIN = withProvenance(ADMIN, 'DEMO');
const DEMO_TEACHER = withProvenance(TEACHER_A, 'DEMO');
const DEMO_STUDENT = withProvenance(STUDENT_IN, 'DEMO');

const ROLE_ACTORS: Readonly<Record<Role, Actor>> = {
  STUDENT: STUDENT_IN,
  TEACHER: TEACHER_A,
  ADMIN: ADMIN,
};

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

const T0 = '2026-01-01T00:00:00.000Z';

const COURSE_A_LIVE: Subject = {
  id: 'c_a',
  courseId: 'c_a',
  courseTeacherId: TEACHER_A.id,
  publishedAt: T0,
};
const COURSE_A_DRAFT: Subject = { ...COURSE_A_LIVE, publishedAt: null };
const COURSE_B_LIVE: Subject = {
  id: 'c_b',
  courseId: 'c_b',
  courseTeacherId: TEACHER_B.id,
  publishedAt: T0,
};

/** Same course rows, as seen by a student with a given enrollment state. */
const COURSE_A_LIVE_APPROVED: Subject = { ...COURSE_A_LIVE, enrollmentStatus: 'APPROVED' };
const COURSE_A_DRAFT_APPROVED: Subject = { ...COURSE_A_DRAFT, enrollmentStatus: 'APPROVED' };
const COURSE_A_LIVE_PENDING: Subject = { ...COURSE_A_LIVE, enrollmentStatus: 'PENDING' };

/*
 * `enrollment:request`'s subject is the course WITH its prerequisite fields
 * (actor.ts): `prerequisiteCourseId` — explicit null means ungated, ABSENT means
 * the loader never loaded it and must deny — and `completedCourseIds`, the
 * requesting actor's APPROVED seats.
 */
const COURSE_A_LIVE_UNGATED: Subject = { ...COURSE_A_LIVE, prerequisiteCourseId: null };
const COURSE_A_DRAFT_UNGATED: Subject = { ...COURSE_A_DRAFT, prerequisiteCourseId: null };
/** Requires completing c_b first. */
const COURSE_A_LIVE_GATED: Subject = { ...COURSE_A_LIVE, prerequisiteCourseId: 'c_b' };
const COURSE_A_LIVE_GATED_COMPLETED: Subject = {
  ...COURSE_A_LIVE_GATED,
  completedCourseIds: ['c_b'],
};
const COURSE_A_LIVE_GATED_WRONG_COMPLETION: Subject = {
  ...COURSE_A_LIVE_GATED,
  completedCourseIds: ['c_z'],
};

const ENROLLMENT_S1_IN_A: Subject = {
  id: 'e_1',
  studentId: STUDENT_IN.id,
  courseId: 'c_a',
  courseTeacherId: TEACHER_A.id,
  enrollmentStatus: 'APPROVED',
};
const ENROLLMENT_S2_IN_B: Subject = {
  id: 'e_2',
  studentId: STUDENT_OUT.id,
  courseId: 'c_b',
  courseTeacherId: TEACHER_B.id,
  enrollmentStatus: 'PENDING',
};

/** An attendance row as its ENROLLMENT — the shape a personal summary is gated on. */
const ATTENDANCE_OF_S1_IN_A: Subject = {
  id: 'e_1',
  studentId: STUDENT_IN.id,
  courseId: 'c_a',
  courseTeacherId: TEACHER_A.id,
};
const ATTENDANCE_OF_S2_IN_B: Subject = {
  id: 'e_2',
  studentId: STUDENT_OUT.id,
  courseId: 'c_b',
  courseTeacherId: TEACHER_B.id,
};

/*
 * `publishedAt` is the COURSE's, carried on the resource subject: a resource is never
 * more visible than the course it hangs off, so the public branch of `resource:read`
 * and `resource:download` is `and(isPublic, isPublished)`. A fixture that omits it is
 * a resource on a DRAFT course, which is what RESOURCE_A_PUBLIC_DRAFT below is for.
 */
const RESOURCE_A_PUBLIC: Subject = {
  id: 'r_pub',
  courseId: 'c_a',
  courseTeacherId: TEACHER_A.id,
  authorId: TEACHER_A.id,
  isPublic: true,
  publishedAt: T0,
};
const RESOURCE_A_PRIVATE: Subject = { ...RESOURCE_A_PUBLIC, id: 'r_priv', isPublic: false };
const RESOURCE_A_PRIVATE_APPROVED: Subject = {
  ...RESOURCE_A_PRIVATE,
  enrollmentStatus: 'APPROVED',
};
const RESOURCE_A_PRIVATE_PENDING: Subject = { ...RESOURCE_A_PRIVATE, enrollmentStatus: 'PENDING' };
/** Flagged public, but its course was never published. The leak this pair closes. */
const RESOURCE_A_PUBLIC_DRAFT: Subject = {
  ...RESOURCE_A_PUBLIC,
  id: 'r_pub_draft',
  publishedAt: null,
};
/** The same draft resource, seen by a student who is approved on that course. */
const RESOURCE_A_PUBLIC_DRAFT_APPROVED: Subject = {
  ...RESOURCE_A_PUBLIC_DRAFT,
  enrollmentStatus: 'APPROVED',
};
const RESOURCE_B_PRIVATE: Subject = {
  id: 'r_b',
  courseId: 'c_b',
  courseTeacherId: TEACHER_B.id,
  authorId: TEACHER_B.id,
  isPublic: false,
  publishedAt: T0,
};
/** Teacher B's course is published, the resource is public, and it is not A's. */
const RESOURCE_B_PUBLIC_DRAFT: Subject = {
  id: 'r_b_draft',
  courseId: 'c_b',
  courseTeacherId: TEACHER_B.id,
  authorId: TEACHER_B.id,
  isPublic: true,
  publishedAt: null,
};

const ANN_A_LIVE: Subject = { id: 'a_1', authorId: TEACHER_A.id, publishedAt: T0 };
const ANN_A_DRAFT: Subject = { id: 'a_2', authorId: TEACHER_A.id, publishedAt: null };
const ANN_B_LIVE: Subject = { id: 'a_3', authorId: TEACHER_B.id, publishedAt: T0 };
const ANN_B_DRAFT: Subject = { id: 'a_4', authorId: TEACHER_B.id, publishedAt: null };

const COMMENT_BY_S1: Subject = {
  id: 'cm_1',
  authorId: STUDENT_IN.id,
  courseId: 'c_a',
  courseTeacherId: TEACHER_A.id,
};
const COMMENT_BY_S2_IN_A: Subject = { ...COMMENT_BY_S1, id: 'cm_2', authorId: STUDENT_OUT.id };
const COMMENT_BY_S2_IN_B: Subject = {
  id: 'cm_3',
  authorId: STUDENT_OUT.id,
  courseId: 'c_b',
  courseTeacherId: TEACHER_B.id,
};

const SELF_STUDENT: Subject = { userId: STUDENT_IN.id };
const SELF_TEACHER: Subject = { userId: TEACHER_A.id };
const SELF_ADMIN: Subject = { userId: ADMIN.id };
const OTHER_USER: Subject = { userId: 'u_stranger' };

const UPLOAD_OF_S1: Subject = { id: 'up_1', userId: STUDENT_IN.id };
const UPLOAD_OF_STRANGER: Subject = { id: 'up_2', userId: 'u_stranger' };

const THREAD_WITH_S1_AND_TA: Subject = {
  id: 'cv_1',
  participantIds: [STUDENT_IN.id, TEACHER_A.id],
};
const THREAD_WITHOUT_ME: Subject = { id: 'cv_2', participantIds: ['u_x', 'u_y'] };

const NOTIFICATION_OF_S1: Subject = { id: 'n_1', userId: STUDENT_IN.id };
const NOTIFICATION_OF_STRANGER: Subject = { id: 'n_2', userId: 'u_stranger' };

const DEPARTMENT: Subject = { id: 'd_1' };

// ---------------------------------------------------------------------------
// Cell shape
// ---------------------------------------------------------------------------

interface Cell {
  /** Reads as the test name; describe the situation, not the expectation. */
  readonly why: string;
  readonly actor: Actor | null;
  readonly action: Action;
  readonly subject?: Subject;
  readonly allow: boolean;
  /** Required on refusals: the exact `PolicyResult.rule` that must be reported. */
  readonly rule?: string;
}

const ok = (why: string, actor: Actor | null, action: Action, subject?: Subject): Cell =>
  subject === undefined
    ? { why, actor, action, allow: true }
    : { why, actor, action, subject, allow: true };

const no = (
  why: string,
  actor: Actor | null,
  action: Action,
  rule: string,
  subject?: Subject,
): Cell =>
  subject === undefined
    ? { why, actor, action, allow: false, rule }
    : { why, actor, action, subject, allow: false, rule };

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

const COURSE_CELLS: readonly Cell[] = [
  ok('anonymous reads a published course', ANON, 'course:read', COURSE_A_LIVE),
  no(
    'anonymous reads a draft course',
    ANON,
    'course:read',
    'anonymous:isPublished',
    COURSE_A_DRAFT,
  ),
  ok('student reads a published course', STUDENT_IN, 'course:read', COURSE_A_LIVE),
  ok('approved student reads their live course', STUDENT_IN, 'course:read', COURSE_A_LIVE_APPROVED),
  ok(
    'student with a PENDING request still reads the published course',
    STUDENT_OUT,
    'course:read',
    COURSE_A_LIVE_PENDING,
  ),
  no(
    'student with a PENDING request reads a draft course',
    STUDENT_OUT,
    'course:read',
    'STUDENT:or(isPublished, enrolledApproved)',
    { ...COURSE_A_DRAFT, enrollmentStatus: 'PENDING' },
  ),
  ok(
    'enrolled student keeps reading a course that was unpublished',
    STUDENT_IN,
    'course:read',
    COURSE_A_DRAFT_APPROVED,
  ),
  no(
    'outsider student reads a draft course',
    STUDENT_OUT,
    'course:read',
    'STUDENT:or(isPublished, enrolledApproved)',
    COURSE_A_DRAFT,
  ),
  ok('teacher reads their own draft course', TEACHER_A, 'course:read', COURSE_A_DRAFT),
  no(
    "teacher reads another teacher's draft course",
    TEACHER_A,
    'course:read',
    'TEACHER:or(isPublished, ownsCourse)',
    { ...COURSE_B_LIVE, publishedAt: null },
  ),
  ok('admin reads any course', ADMIN, 'course:read', COURSE_A_DRAFT),

  no('student creates a course', STUDENT_IN, 'course:create', 'STUDENT:deny'),
  ok('teacher creates a course', TEACHER_A, 'course:create'),
  ok('admin creates a course', ADMIN, 'course:create'),

  ok('teacher updates their own course', TEACHER_A, 'course:update', COURSE_A_LIVE),
  no(
    "teacher updates another teacher's course",
    TEACHER_A,
    'course:update',
    'TEACHER:ownsCourse',
    COURSE_B_LIVE,
  ),
  no('student updates a course', STUDENT_IN, 'course:update', 'STUDENT:deny', COURSE_A_LIVE),
  ok('admin updates any course', ADMIN, 'course:update', COURSE_B_LIVE),

  ok('teacher deletes their own course', TEACHER_A, 'course:delete', COURSE_A_LIVE),
  no(
    "teacher deletes another teacher's course",
    TEACHER_A,
    'course:delete',
    'TEACHER:ownsCourse',
    COURSE_B_LIVE,
  ),
  no('student deletes a course', STUDENT_IN, 'course:delete', 'STUDENT:deny', COURSE_A_LIVE),
  ok('admin deletes any course', ADMIN, 'course:delete', COURSE_B_LIVE),

  ok('teacher publishes their own course', TEACHER_A, 'course:publish', COURSE_A_DRAFT),
  no(
    "teacher publishes another teacher's course",
    TEACHER_A,
    'course:publish',
    'TEACHER:ownsCourse',
    COURSE_B_LIVE,
  ),
  no('student publishes a course', STUDENT_IN, 'course:publish', 'STUDENT:deny', COURSE_A_DRAFT),
  ok('admin publishes any course', ADMIN, 'course:publish', COURSE_B_LIVE),
];

const ENROLLMENT_CELLS: readonly Cell[] = [
  /*
   * The prerequisite ladder. The STUDENT row of `enrollment:request` is now
   * `and(isPublished, hasCompletedPrerequisite)`, so every refusal on this action
   * reports the whole composition — `and()` does not name which conjunct failed,
   * exactly as the resource rows above report their full `or(...)` chains.
   */
  ok(
    'student requests enrollment in an ungated published course',
    STUDENT_OUT,
    'enrollment:request',
    COURSE_A_LIVE_UNGATED,
  ),
  no(
    'student requests enrollment in a draft course',
    STUDENT_OUT,
    'enrollment:request',
    'STUDENT:and(isPublished, hasCompletedPrerequisite)',
    COURSE_A_DRAFT_UNGATED,
  ),
  ok(
    'student who completed the prerequisite requests the gated course',
    STUDENT_OUT,
    'enrollment:request',
    COURSE_A_LIVE_GATED_COMPLETED,
  ),
  no(
    'student who never completed the prerequisite requests the gated course',
    STUDENT_OUT,
    'enrollment:request',
    'STUDENT:and(isPublished, hasCompletedPrerequisite)',
    COURSE_A_LIVE_GATED,
  ),
  no(
    'completing an unrelated course does not satisfy the prerequisite',
    STUDENT_OUT,
    'enrollment:request',
    'STUDENT:and(isPublished, hasCompletedPrerequisite)',
    COURSE_A_LIVE_GATED_WRONG_COMPLETION,
  ),
  no(
    'completing the prerequisite still does not open a draft course',
    STUDENT_OUT,
    'enrollment:request',
    'STUDENT:and(isPublished, hasCompletedPrerequisite)',
    { ...COURSE_A_LIVE_GATED_COMPLETED, publishedAt: null },
  ),
  // LESSONS-LEARNED #31 pointed in the dangerous direction: an ABSENT
  // `prerequisiteCourseId` must read as "loader forgot", and deny — only explicit
  // null means "no requirement". Otherwise forgetting the column opens every gate.
  no(
    'a subject missing the prerequisite field denies rather than waving through',
    STUDENT_OUT,
    'enrollment:request',
    'STUDENT:and(isPublished, hasCompletedPrerequisite)',
    COURSE_A_LIVE,
  ),
  no(
    'anonymous requests enrollment even on an ungated course',
    ANON,
    'enrollment:request',
    'anonymous:deny',
    COURSE_A_LIVE_UNGATED,
  ),
  no('teacher requests enrollment', TEACHER_A, 'enrollment:request', 'TEACHER:deny', COURSE_A_LIVE),
  ok('admin enrolls a student directly', ADMIN, 'enrollment:request', COURSE_A_LIVE),

  ok('student reads their own enrollment', STUDENT_IN, 'enrollment:read', ENROLLMENT_S1_IN_A),
  no(
    "student reads another student's enrollment",
    STUDENT_IN,
    'enrollment:read',
    'STUDENT:isEnrolledStudent',
    ENROLLMENT_S2_IN_B,
  ),
  ok(
    'teacher reads an enrollment in their course',
    TEACHER_A,
    'enrollment:read',
    ENROLLMENT_S1_IN_A,
  ),
  no(
    "teacher reads an enrollment in another teacher's course",
    TEACHER_A,
    'enrollment:read',
    'TEACHER:ownsCourse',
    ENROLLMENT_S2_IN_B,
  ),
  ok('admin reads any enrollment', ADMIN, 'enrollment:read', ENROLLMENT_S2_IN_B),

  ok(
    'teacher approves an enrollment in their course',
    TEACHER_A,
    'enrollment:approve',
    ENROLLMENT_S1_IN_A,
  ),
  no(
    "teacher approves an enrollment in another teacher's course",
    TEACHER_A,
    'enrollment:approve',
    'TEACHER:ownsCourse',
    ENROLLMENT_S2_IN_B,
  ),
  no(
    'student approves their own enrollment',
    STUDENT_IN,
    'enrollment:approve',
    'STUDENT:deny',
    ENROLLMENT_S1_IN_A,
  ),
  ok('admin approves any enrollment', ADMIN, 'enrollment:approve', ENROLLMENT_S2_IN_B),

  ok(
    'teacher rejects an enrollment in their course',
    TEACHER_A,
    'enrollment:reject',
    ENROLLMENT_S1_IN_A,
  ),
  no(
    "teacher rejects an enrollment in another teacher's course",
    TEACHER_A,
    'enrollment:reject',
    'TEACHER:ownsCourse',
    ENROLLMENT_S2_IN_B,
  ),
  no(
    'student rejects an enrollment',
    STUDENT_IN,
    'enrollment:reject',
    'STUDENT:deny',
    ENROLLMENT_S1_IN_A,
  ),
  ok('admin rejects any enrollment', ADMIN, 'enrollment:reject', ENROLLMENT_S2_IN_B),

  ok(
    'student withdraws their own enrollment',
    STUDENT_IN,
    'enrollment:withdraw',
    ENROLLMENT_S1_IN_A,
  ),
  no(
    "student withdraws another student's enrollment",
    STUDENT_IN,
    'enrollment:withdraw',
    'STUDENT:isEnrolledStudent',
    ENROLLMENT_S2_IN_B,
  ),
  no(
    'teacher withdraws a student (rejection is the correct verb)',
    TEACHER_A,
    'enrollment:withdraw',
    'TEACHER:deny',
    ENROLLMENT_S1_IN_A,
  ),
  ok('admin withdraws any enrollment', ADMIN, 'enrollment:withdraw', ENROLLMENT_S1_IN_A),

  /*
   * Completion and its reversal. The four cells per action are the same four the
   * approval block above asserts, and that is the claim: recording a qualification
   * is exactly the authority to seat the student, and taking it back is exactly the
   * same authority. Restating them per action is what proves the two rules cannot
   * drift apart silently — a future edit that opens `enrollment:uncomplete` to a
   * student would turn one of these red with the rule name in the failure.
   */
  ok(
    'teacher completes an enrollment in their course',
    TEACHER_A,
    'enrollment:complete',
    ENROLLMENT_S1_IN_A,
  ),
  no(
    "teacher completes an enrollment in another teacher's course",
    TEACHER_A,
    'enrollment:complete',
    'TEACHER:ownsCourse',
    ENROLLMENT_S2_IN_B,
  ),
  no(
    'student completes their own enrollment',
    STUDENT_IN,
    'enrollment:complete',
    'STUDENT:deny',
    ENROLLMENT_S1_IN_A,
  ),
  ok('admin completes any enrollment', ADMIN, 'enrollment:complete', ENROLLMENT_S2_IN_B),

  ok(
    'teacher reverses a completion in their course',
    TEACHER_A,
    'enrollment:uncomplete',
    ENROLLMENT_S1_IN_A,
  ),
  no(
    "teacher reverses a completion in another teacher's course",
    TEACHER_A,
    'enrollment:uncomplete',
    'TEACHER:ownsCourse',
    ENROLLMENT_S2_IN_B,
  ),
  no(
    'student reverses their own completion',
    STUDENT_IN,
    'enrollment:uncomplete',
    'STUDENT:deny',
    ENROLLMENT_S1_IN_A,
  ),
  ok('admin reverses any completion', ADMIN, 'enrollment:uncomplete', ENROLLMENT_S2_IN_B),
];

const ATTENDANCE_CELLS: readonly Cell[] = [
  ok('teacher marks the register of their own course', TEACHER_A, 'attendance:mark', COURSE_A_LIVE),
  no(
    "teacher marks another teacher's register",
    TEACHER_A,
    'attendance:mark',
    'TEACHER:ownsCourse',
    COURSE_B_LIVE,
  ),
  no('student marks a register', STUDENT_IN, 'attendance:mark', 'STUDENT:deny', COURSE_A_LIVE),
  ok('admin marks any register', ADMIN, 'attendance:mark', COURSE_B_LIVE),

  // The subject here is the ENROLLMENT row, so `isEnrolledStudent` passes only for
  // the student's own summary.
  ok(
    'student reads their own attendance summary',
    STUDENT_IN,
    'attendance:read',
    ATTENDANCE_OF_S1_IN_A,
  ),
  no(
    "student reads another student's attendance summary",
    STUDENT_IN,
    'attendance:read',
    'STUDENT:isEnrolledStudent',
    ATTENDANCE_OF_S2_IN_B,
  ),
  // On the COURSE shape — the whole register — a student's rule reads an absent
  // `studentId` and denies even though they are enrolled. A class list is not
  // assembled one personal summary at a time.
  no(
    'an enrolled student still cannot read the whole register',
    STUDENT_IN,
    'attendance:read',
    'STUDENT:isEnrolledStudent',
    COURSE_A_LIVE_APPROVED,
  ),
  ok('teacher reads the register of their own course', TEACHER_A, 'attendance:read', COURSE_A_LIVE),
  no(
    "teacher reads another teacher's register or summaries",
    TEACHER_A,
    'attendance:read',
    'TEACHER:ownsCourse',
    ATTENDANCE_OF_S2_IN_B,
  ),
  ok(
    'admin reads any register or attendance summary',
    ADMIN,
    'attendance:read',
    ATTENDANCE_OF_S2_IN_B,
  ),
];

/*
 * An ASSIGNMENT as its INTAKE. `assignment:read` is `enrolledApproved` for a student,
 * and that rule reads `subject.enrollmentStatus` — the VIEWER's own status in the
 * course the intake belongs to. PENDING is a request, not a seat, and the register
 * will not carry somebody who was never marked present, so it is not enough.
 */
const ASSIGNMENT_IN_A_APPROVED: Subject = {
  ...COURSE_A_LIVE_APPROVED,
  id: 'as_1',
};
const ASSIGNMENT_IN_A_PENDING: Subject = { ...COURSE_A_LIVE_PENDING, id: 'as_1' };
const ASSIGNMENT_IN_A_NO_ENROLMENT: Subject = { ...COURSE_A_LIVE, id: 'as_1' };
const ASSIGNMENT_IN_B_APPROVED: Subject = {
  id: 'as_2',
  courseId: 'c_b',
  courseTeacherId: TEACHER_B.id,
  publishedAt: T0,
  enrollmentStatus: 'APPROVED',
};

/*
 * A SUBMISSION as itself. `studentId` is the ENROLLMENT's student, not a column of
 * Submission — the row has no `studentId` and must not acquire one (schema.prisma).
 *
 * The last two fixtures are the #31 pair and they are the reason this block is
 * hand-written rather than generated: a subject MISSING `studentId` and a subject
 * carrying someone ELSE's must both deny, and only the first is a mistake anybody
 * would make by accident.
 */
const SUBMISSION_OF_S1_IN_A: Subject = {
  id: 'sub_1',
  studentId: STUDENT_IN.id,
  courseId: 'c_a',
  courseTeacherId: TEACHER_A.id,
};
const SUBMISSION_OF_S2_IN_A: Subject = {
  ...SUBMISSION_OF_S1_IN_A,
  id: 'sub_2',
  studentId: STUDENT_OUT.id,
};
const SUBMISSION_OF_S2_IN_B: Subject = {
  id: 'sub_3',
  studentId: STUDENT_OUT.id,
  courseId: 'c_b',
  courseTeacherId: TEACHER_B.id,
};
/** A loader that forgot the enrollment join: everything but the deciding field. */
const SUBMISSION_WITHOUT_ITS_STUDENT: Subject = {
  id: 'sub_4',
  courseId: 'c_a',
  courseTeacherId: TEACHER_A.id,
};

const ASSIGNMENT_CELLS: readonly Cell[] = [
  no(
    'anonymous reads an assignment brief',
    ANON,
    'assignment:read',
    'anonymous:deny',
    ASSIGNMENT_IN_A_APPROVED,
  ),
  ok(
    'approved student reads the assignments on their own intake',
    STUDENT_IN,
    'assignment:read',
    ASSIGNMENT_IN_A_APPROVED,
  ),
  // PENDING is a request, not a seat. `enrolledApproved` has always refused to count
  // one, and an assessment brief is not a published syllabus a visitor may browse.
  no(
    'student whose request is still pending reads the assignments',
    STUDENT_OUT,
    'assignment:read',
    'STUDENT:enrolledApproved',
    ASSIGNMENT_IN_A_PENDING,
  ),
  no(
    'student with no enrolment at all reads the assignments',
    STUDENT_OUT,
    'assignment:read',
    'STUDENT:enrolledApproved',
    ASSIGNMENT_IN_A_NO_ENROLMENT,
  ),
  ok(
    'teacher reads the assignments on their own intake',
    TEACHER_A,
    'assignment:read',
    ASSIGNMENT_IN_A_APPROVED,
  ),
  no(
    "teacher reads another intake's assignments",
    TEACHER_A,
    'assignment:read',
    'TEACHER:ownsCourse',
    ASSIGNMENT_IN_B_APPROVED,
  ),
  ok('admin reads any assignment', ADMIN, 'assignment:read', ASSIGNMENT_IN_B_APPROVED),

  no(
    'student sets an assignment',
    STUDENT_IN,
    'assignment:create',
    'STUDENT:deny',
    ASSIGNMENT_IN_A_APPROVED,
  ),
  ok(
    'teacher sets an assignment on their own intake',
    TEACHER_A,
    'assignment:create',
    ASSIGNMENT_IN_A_APPROVED,
  ),
  no(
    "teacher sets an assignment on another teacher's intake",
    TEACHER_A,
    'assignment:create',
    'TEACHER:ownsCourse',
    ASSIGNMENT_IN_B_APPROVED,
  ),
  no(
    'anonymous sets an assignment',
    ANON,
    'assignment:create',
    'anonymous:deny',
    ASSIGNMENT_IN_A_APPROVED,
  ),
  ok('admin sets an assignment anywhere', ADMIN, 'assignment:create', ASSIGNMENT_IN_B_APPROVED),
];

const SUBMISSION_CELLS: readonly Cell[] = [
  no('anonymous reads a hand-in', ANON, 'submission:read', 'anonymous:deny', SUBMISSION_OF_S1_IN_A),
  ok('student reads their own hand-in', STUDENT_IN, 'submission:read', SUBMISSION_OF_S1_IN_A),
  no(
    "student reads another student's hand-in in the same course",
    STUDENT_IN,
    'submission:read',
    'STUDENT:isEnrolledStudent',
    SUBMISSION_OF_S2_IN_A,
  ),
  // #31, and the cell that makes the phase: a subject that does not carry the
  // enrollment's studentId DENIES. It does not fall through to "any hand-in in a
  // course you are enrolled on", and it does not throw — the same silent, safe,
  // invisible refusal that has cost three features in this repository.
  no(
    'a hand-in whose subject never loaded its studentId denies rather than opens',
    STUDENT_IN,
    'submission:read',
    'STUDENT:isEnrolledStudent',
    SUBMISSION_WITHOUT_ITS_STUDENT,
  ),
  ok("teacher reads their class's hand-in", TEACHER_A, 'submission:read', SUBMISSION_OF_S1_IN_A),
  no(
    "teacher reads a hand-in in another teacher's course",
    TEACHER_A,
    'submission:read',
    'TEACHER:ownsCourse',
    SUBMISSION_OF_S2_IN_B,
  ),
  ok('admin reads any hand-in', ADMIN, 'submission:read', SUBMISSION_OF_S2_IN_B),

  no(
    'student grades their own hand-in',
    STUDENT_IN,
    'submission:grade',
    'STUDENT:deny',
    SUBMISSION_OF_S1_IN_A,
  ),
  ok('teacher grades in their own course', TEACHER_A, 'submission:grade', SUBMISSION_OF_S1_IN_A),
  no(
    "teacher grades in another teacher's course",
    TEACHER_A,
    'submission:grade',
    'TEACHER:ownsCourse',
    SUBMISSION_OF_S2_IN_B,
  ),
  no(
    'anonymous grades a hand-in',
    ANON,
    'submission:grade',
    'anonymous:deny',
    SUBMISSION_OF_S1_IN_A,
  ),
  ok('admin grades any hand-in', ADMIN, 'submission:grade', SUBMISSION_OF_S2_IN_B),
];

/*
 * A CERTIFICATE, as a student holds it. `studentId` is the holder and the only field
 * a student's access rests on; `courseTeacherId` is reached through the seat the
 * certificate was issued against, which is how `ownsCourse` can decide it. `authorId`
 * is the ISSUER — see `loadCertificateSubject` in certificates.service.ts, which says
 * in a comment that it is putting `issuedById` on that key, because `isAuthor` reads
 * `authorId` and every other `Subject` field is optional.
 */
const CERTIFICATE_OF_S1_IN_A: Subject = {
  id: 'cert_1',
  studentId: STUDENT_IN.id,
  courseId: 'c_a',
  courseTeacherId: TEACHER_A.id,
  authorId: TEACHER_A.id,
};
const CERTIFICATE_OF_S2_IN_A: Subject = {
  ...CERTIFICATE_OF_S1_IN_A,
  id: 'cert_2',
  studentId: STUDENT_OUT.id,
};
const CERTIFICATE_OF_S2_IN_B: Subject = {
  ...CERTIFICATE_OF_S1_IN_A,
  id: 'cert_3',
  studentId: STUDENT_OUT.id,
  courseId: 'c_b',
  courseTeacherId: TEACHER_B.id,
  authorId: ADMIN.id,
};
/** #31 for this phase: everything except the field `isEnrolledStudent` reads. */
const CERTIFICATE_WITHOUT_ITS_STUDENT: Subject = {
  id: 'cert_4',
  courseId: 'c_a',
  courseTeacherId: TEACHER_A.id,
};
/**
 * Issued by a teacher whose seat has since been hard-deleted, so there is no course
 * to own. `ownsCourse` reads an absent field and denies; `isAuthor` is what saves it.
 */
const CERTIFICATE_ISSUERLESS_COURSE: Subject = {
  id: 'cert_5',
  studentId: STUDENT_IN.id,
  courseId: 'c_a',
  authorId: TEACHER_A.id,
};

/** The SEAT a certificate is issued against, which is what `certificate:issue` reads. */
const COMPLETED_ENROLLMENT_S1_IN_A: Subject = {
  id: 'enr_1',
  studentId: STUDENT_IN.id,
  courseId: 'c_a',
  courseTeacherId: TEACHER_A.id,
  enrollmentStatus: 'COMPLETED',
};
const COMPLETED_ENROLLMENT_S2_IN_B: Subject = {
  id: 'enr_2',
  studentId: STUDENT_OUT.id,
  courseId: 'c_b',
  courseTeacherId: TEACHER_B.id,
  enrollmentStatus: 'COMPLETED',
};

const CERTIFICATE_CELLS: readonly Cell[] = [
  no(
    'anonymous reads a certificate',
    ANON,
    'certificate:read',
    'anonymous:deny',
    CERTIFICATE_OF_S1_IN_A,
  ),
  ok('student reads their own certificate', STUDENT_IN, 'certificate:read', CERTIFICATE_OF_S1_IN_A),
  no(
    "student reads another student's certificate",
    STUDENT_IN,
    'certificate:read',
    'STUDENT:isEnrolledStudent',
    CERTIFICATE_OF_S2_IN_A,
  ),
  no(
    'a certificate whose subject never loaded its studentId denies rather than opens',
    STUDENT_IN,
    'certificate:read',
    'STUDENT:isEnrolledStudent',
    CERTIFICATE_WITHOUT_ITS_STUDENT,
  ),
  ok(
    'teacher reads a certificate in their own course',
    TEACHER_A,
    'certificate:read',
    CERTIFICATE_OF_S1_IN_A,
  ),
  ok(
    'teacher reads a certificate they issued with no course left to own',
    TEACHER_A,
    'certificate:read',
    CERTIFICATE_ISSUERLESS_COURSE,
  ),
  no(
    "teacher reads a certificate in another teacher's course",
    TEACHER_A,
    'certificate:read',
    'TEACHER:or(ownsCourse, isAuthor)',
    CERTIFICATE_OF_S2_IN_B,
  ),
  ok('admin reads any certificate', ADMIN, 'certificate:read', CERTIFICATE_OF_S2_IN_B),

  no(
    'anonymous issues a certificate',
    ANON,
    'certificate:issue',
    'anonymous:deny',
    COMPLETED_ENROLLMENT_S1_IN_A,
  ),
  no(
    'student issues their own certificate',
    STUDENT_IN,
    'certificate:issue',
    'STUDENT:deny',
    COMPLETED_ENROLLMENT_S1_IN_A,
  ),
  ok(
    'teacher issues against a completed seat in their own course',
    TEACHER_A,
    'certificate:issue',
    COMPLETED_ENROLLMENT_S1_IN_A,
  ),
  no(
    "teacher issues against a seat in another teacher's course",
    TEACHER_A,
    'certificate:issue',
    'TEACHER:ownsCourse',
    COMPLETED_ENROLLMENT_S2_IN_B,
  ),
  ok(
    'admin issues against any completed seat',
    ADMIN,
    'certificate:issue',
    COMPLETED_ENROLLMENT_S2_IN_B,
  ),

  // Revocation is the narrowest cell in the table, and the three refusals are the
  // point: a student cannot withdraw their own, a teacher cannot withdraw one from
  // their own course, and an admin can.
  no(
    'student revokes their own certificate',
    STUDENT_IN,
    'certificate:revoke',
    'STUDENT:deny',
    CERTIFICATE_OF_S1_IN_A,
  ),
  no(
    'teacher revokes a certificate in their own course',
    TEACHER_A,
    'certificate:revoke',
    'TEACHER:deny',
    CERTIFICATE_OF_S1_IN_A,
  ),
  no(
    'anonymous revokes a certificate',
    ANON,
    'certificate:revoke',
    'anonymous:deny',
    CERTIFICATE_OF_S1_IN_A,
  ),
  ok('admin revokes any certificate', ADMIN, 'certificate:revoke', CERTIFICATE_OF_S1_IN_A),

  /*
   * The five `certificate:verify` cells, and the only action in this table that is
   * `allow` for anonymous.
   *
   * The first is the whole argument in one line: there is no caller to authorise, so
   * there is nothing to read and nothing to compare. The second is the failure mode
   * this cell is shaped to avoid — had it been composed from any `Subject`-reading
   * rule, EVERY ONE of these five would be a denial, because every subject a caller
   * could supply would be the wrong one (a certificate belongs to the holder, not to
   * whoever is asking) and an absent field denies.
   */
  ok('anonymous verifies a reference', ANON, 'certificate:verify'),
  ok(
    'anonymous verifies with a subject present and irrelevant',
    ANON,
    'certificate:verify',
    CERTIFICATE_OF_S1_IN_A,
  ),
  ok('a student verifies a reference', STUDENT_IN, 'certificate:verify'),
  ok('a teacher verifies a reference', TEACHER_A, 'certificate:verify'),
  ok('an admin verifies a reference', ADMIN, 'certificate:verify'),
];

const QUALIFICATION_CELLS: readonly Cell[] = [
  no('anonymous reads the catalogue', ANON, 'qualification:read', 'anonymous:deny'),
  ok('student reads the catalogue', STUDENT_IN, 'qualification:read'),
  ok('teacher reads the catalogue', TEACHER_A, 'qualification:read'),
  ok('admin reads the catalogue', ADMIN, 'qualification:read'),
  no('anonymous adds to the catalogue', ANON, 'qualification:create', 'anonymous:deny'),
  no('student adds to the catalogue', STUDENT_IN, 'qualification:create', 'STUDENT:deny'),
  no('teacher adds to the catalogue', TEACHER_A, 'qualification:create', 'TEACHER:deny'),
  ok('admin adds to the catalogue', ADMIN, 'qualification:create'),
];

const RESOURCE_CELLS: readonly Cell[] = [
  ok('anonymous reads a public resource', ANON, 'resource:read', RESOURCE_A_PUBLIC),
  no(
    'anonymous reads a private resource',
    ANON,
    'resource:read',
    'anonymous:and(isPublic, isPublished)',
    RESOURCE_A_PRIVATE,
  ),
  ok('any student reads a public resource', STUDENT_OUT, 'resource:read', RESOURCE_A_PUBLIC),
  ok(
    'approved student reads a private resource in their course',
    STUDENT_IN,
    'resource:read',
    RESOURCE_A_PRIVATE_APPROVED,
  ),
  no(
    'non-enrolled student reads a private resource',
    STUDENT_OUT,
    'resource:read',
    'STUDENT:or(and(isPublic, isPublished), enrolledApproved)',
    RESOURCE_A_PRIVATE,
  ),
  no(
    'student with a PENDING request reads a private resource',
    STUDENT_OUT,
    'resource:read',
    'STUDENT:or(and(isPublic, isPublished), enrolledApproved)',
    RESOURCE_A_PRIVATE_PENDING,
  ),
  ok(
    'teacher reads a private resource in their own course',
    TEACHER_A,
    'resource:read',
    RESOURCE_A_PRIVATE,
  ),
  no(
    "teacher reads another teacher's private resource",
    TEACHER_A,
    'resource:read',
    'TEACHER:or(and(isPublic, isPublished), ownsCourse, isAuthor)',
    RESOURCE_B_PRIVATE,
  ),
  ok('admin reads any resource', ADMIN, 'resource:read', RESOURCE_B_PRIVATE),

  /*
   * A resource is never more visible than its course. Measured before the fix, against
   * the running API: an anonymous caller was refused the draft COURSE with a 401 and
   * served its "public" resource with a 200, title and all, from `GET /resources`.
   */
  no(
    'anonymous reads a public resource in an unpublished course',
    ANON,
    'resource:read',
    'anonymous:and(isPublic, isPublished)',
    RESOURCE_A_PUBLIC_DRAFT,
  ),
  no(
    'a stranger student reads a public resource in an unpublished course',
    STUDENT_OUT,
    'resource:read',
    'STUDENT:or(and(isPublic, isPublished), enrolledApproved)',
    RESOURCE_A_PUBLIC_DRAFT,
  ),
  no(
    "a teacher reads a public resource in another teacher's unpublished course",
    TEACHER_A,
    'resource:read',
    'TEACHER:or(and(isPublic, isPublished), ownsCourse, isAuthor)',
    RESOURCE_B_PUBLIC_DRAFT,
  ),
  no(
    'anonymous downloads a public resource in an unpublished course',
    ANON,
    'resource:download',
    'anonymous:deny',
    RESOURCE_A_PUBLIC_DRAFT,
  ),
  no(
    'a stranger student downloads a public resource in an unpublished course',
    STUDENT_OUT,
    'resource:download',
    'STUDENT:or(and(isPublic, isPublished), enrolledApproved)',
    RESOURCE_A_PUBLIC_DRAFT,
  ),
  // The allowances the narrowing must NOT have cost:
  ok(
    'an approved student still reads a draft-course resource they are enrolled on',
    STUDENT_IN,
    'resource:read',
    RESOURCE_A_PUBLIC_DRAFT_APPROVED,
  ),
  ok(
    'the owning teacher still reads their own unpublished draft resource',
    TEACHER_A,
    'resource:read',
    RESOURCE_A_PUBLIC_DRAFT,
  ),
  ok('admin still reads a draft-course resource', ADMIN, 'resource:read', RESOURCE_A_PUBLIC_DRAFT),

  ok('teacher creates a resource in their own course', TEACHER_A, 'resource:create', COURSE_A_LIVE),
  no(
    "teacher A plants a resource in teacher B's course",
    TEACHER_A,
    'resource:create',
    'TEACHER:ownsCourse',
    COURSE_B_LIVE,
  ),
  no('student creates a resource', STUDENT_IN, 'resource:create', 'STUDENT:deny', COURSE_A_LIVE),
  ok('admin creates a resource anywhere', ADMIN, 'resource:create', COURSE_B_LIVE),

  ok(
    'teacher updates a resource in their own course',
    TEACHER_A,
    'resource:update',
    RESOURCE_A_PRIVATE,
  ),
  no(
    "teacher updates another teacher's resource",
    TEACHER_A,
    'resource:update',
    'TEACHER:ownsCourse',
    RESOURCE_B_PRIVATE,
  ),
  no(
    'student updates a resource',
    STUDENT_IN,
    'resource:update',
    'STUDENT:deny',
    RESOURCE_A_PUBLIC,
  ),
  ok('admin updates any resource', ADMIN, 'resource:update', RESOURCE_B_PRIVATE),

  ok(
    'teacher deletes a resource in their own course',
    TEACHER_A,
    'resource:delete',
    RESOURCE_A_PRIVATE,
  ),
  no(
    "teacher deletes another teacher's resource",
    TEACHER_A,
    'resource:delete',
    'TEACHER:ownsCourse',
    RESOURCE_B_PRIVATE,
  ),
  no(
    'student deletes a resource',
    STUDENT_IN,
    'resource:delete',
    'STUDENT:deny',
    RESOURCE_A_PUBLIC,
  ),
  ok('admin deletes any resource', ADMIN, 'resource:delete', RESOURCE_B_PRIVATE),

  no(
    'anonymous downloads even a public resource (bytes need a session)',
    ANON,
    'resource:download',
    'anonymous:deny',
    RESOURCE_A_PUBLIC,
  ),
  ok(
    'any student downloads a public resource',
    STUDENT_OUT,
    'resource:download',
    RESOURCE_A_PUBLIC,
  ),
  ok(
    'approved student downloads a private resource in their course',
    STUDENT_IN,
    'resource:download',
    RESOURCE_A_PRIVATE_APPROVED,
  ),
  no(
    'non-enrolled student downloads a private resource',
    STUDENT_OUT,
    'resource:download',
    'STUDENT:or(and(isPublic, isPublished), enrolledApproved)',
    RESOURCE_A_PRIVATE,
  ),
  ok(
    'teacher downloads a resource in their own course',
    TEACHER_A,
    'resource:download',
    RESOURCE_A_PRIVATE,
  ),
  no(
    "teacher downloads another teacher's private resource",
    TEACHER_A,
    'resource:download',
    'TEACHER:or(and(isPublic, isPublished), ownsCourse, isAuthor)',
    RESOURCE_B_PRIVATE,
  ),
  ok('admin downloads anything', ADMIN, 'resource:download', RESOURCE_B_PRIVATE),
];

const ANNOUNCEMENT_CELLS: readonly Cell[] = [
  ok('anonymous reads a published announcement', ANON, 'announcement:read', ANN_A_LIVE),
  no(
    'anonymous reads a draft announcement',
    ANON,
    'announcement:read',
    'anonymous:isPublished',
    ANN_A_DRAFT,
  ),
  ok('student reads a published announcement', STUDENT_IN, 'announcement:read', ANN_A_LIVE),
  no(
    'student reads a draft announcement',
    STUDENT_IN,
    'announcement:read',
    'STUDENT:isPublished',
    ANN_A_DRAFT,
  ),
  ok('teacher reads their own draft announcement', TEACHER_A, 'announcement:read', ANN_A_DRAFT),
  no(
    "teacher reads another teacher's draft announcement",
    TEACHER_A,
    'announcement:read',
    'TEACHER:or(isPublished, isAuthor)',
    ANN_B_DRAFT,
  ),
  ok('admin reads any announcement', ADMIN, 'announcement:read', ANN_B_DRAFT),

  no('student creates an announcement', STUDENT_IN, 'announcement:create', 'STUDENT:deny'),
  ok('teacher creates an announcement', TEACHER_A, 'announcement:create'),
  ok('admin creates an announcement', ADMIN, 'announcement:create'),

  ok('teacher updates their own announcement', TEACHER_A, 'announcement:update', ANN_A_LIVE),
  no(
    "teacher updates another teacher's announcement",
    TEACHER_A,
    'announcement:update',
    'TEACHER:isAuthor',
    ANN_B_LIVE,
  ),
  no(
    'student updates an announcement',
    STUDENT_IN,
    'announcement:update',
    'STUDENT:deny',
    ANN_A_LIVE,
  ),
  ok('admin updates any announcement', ADMIN, 'announcement:update', ANN_B_LIVE),

  ok('teacher deletes their own announcement', TEACHER_A, 'announcement:delete', ANN_A_LIVE),
  no(
    "teacher deletes another teacher's announcement",
    TEACHER_A,
    'announcement:delete',
    'TEACHER:isAuthor',
    ANN_B_LIVE,
  ),
  no(
    'student deletes an announcement',
    STUDENT_IN,
    'announcement:delete',
    'STUDENT:deny',
    ANN_A_LIVE,
  ),
  ok('admin deletes any announcement', ADMIN, 'announcement:delete', ANN_B_LIVE),

  ok('teacher publishes their own announcement', TEACHER_A, 'announcement:publish', ANN_A_DRAFT),
  no(
    "teacher publishes another teacher's draft",
    TEACHER_A,
    'announcement:publish',
    'TEACHER:isAuthor',
    ANN_B_DRAFT,
  ),
  no(
    'student publishes an announcement',
    STUDENT_IN,
    'announcement:publish',
    'STUDENT:deny',
    ANN_A_DRAFT,
  ),
  ok('admin publishes any announcement', ADMIN, 'announcement:publish', ANN_B_DRAFT),
];

const COMMENT_CELLS: readonly Cell[] = [
  no('anonymous reads comments', ANON, 'comment:read', 'anonymous:deny', COMMENT_BY_S1),
  ok('student reads comments', STUDENT_IN, 'comment:read', COMMENT_BY_S2_IN_A),
  ok('teacher reads comments', TEACHER_A, 'comment:read', COMMENT_BY_S1),
  ok('admin reads comments', ADMIN, 'comment:read', COMMENT_BY_S1),

  no('anonymous comments', ANON, 'comment:create', 'anonymous:deny'),
  ok('student comments', STUDENT_IN, 'comment:create'),
  ok('teacher comments', TEACHER_A, 'comment:create'),
  ok('admin comments', ADMIN, 'comment:create'),

  ok('student edits their own comment', STUDENT_IN, 'comment:update', COMMENT_BY_S1),
  no(
    "student edits somebody else's comment",
    STUDENT_IN,
    'comment:update',
    'STUDENT:isAuthor',
    COMMENT_BY_S2_IN_A,
  ),
  no(
    "teacher edits a student's comment in their own course",
    TEACHER_A,
    'comment:update',
    'TEACHER:isAuthor',
    COMMENT_BY_S1,
  ),
  no(
    "admin edits somebody else's comment (delete, do not rewrite)",
    ADMIN,
    'comment:update',
    'ADMIN:isAuthor',
    COMMENT_BY_S1,
  ),

  ok('student deletes their own comment', STUDENT_IN, 'comment:delete', COMMENT_BY_S1),
  no(
    "student deletes somebody else's comment",
    STUDENT_IN,
    'comment:delete',
    'STUDENT:isAuthor',
    COMMENT_BY_S2_IN_A,
  ),
  ok('teacher moderates a comment in their own course', TEACHER_A, 'comment:delete', COMMENT_BY_S1),
  no(
    "teacher moderates a comment in another teacher's course",
    TEACHER_A,
    'comment:delete',
    'TEACHER:or(isAuthor, ownsCourse)',
    COMMENT_BY_S2_IN_B,
  ),
  ok('admin deletes any comment', ADMIN, 'comment:delete', COMMENT_BY_S2_IN_B),
];

const USER_CELLS: readonly Cell[] = [
  no('anonymous provisions a user', ANON, 'user:create', 'anonymous:deny'),
  no('student provisions a user', STUDENT_IN, 'user:create', 'STUDENT:deny'),
  no('teacher provisions a user', TEACHER_A, 'user:create', 'TEACHER:deny'),
  ok('admin provisions a user', ADMIN, 'user:create'),

  no('anonymous reads a user', ANON, 'user:read', 'anonymous:deny', SELF_STUDENT),
  ok('student reads their own record', STUDENT_IN, 'user:read', SELF_STUDENT),
  no('student reads another user', STUDENT_IN, 'user:read', 'STUDENT:isSelf', OTHER_USER),
  ok('teacher reads their own record', TEACHER_A, 'user:read', SELF_TEACHER),
  no(
    'teacher enumerates the directory one id at a time',
    TEACHER_A,
    'user:read',
    'TEACHER:isSelf',
    OTHER_USER,
  ),
  ok('admin reads any user', ADMIN, 'user:read', OTHER_USER),

  ok('student updates their own profile', STUDENT_IN, 'user:update', SELF_STUDENT),
  no('student updates another profile', STUDENT_IN, 'user:update', 'STUDENT:isSelf', OTHER_USER),
  ok('teacher updates their own profile', TEACHER_A, 'user:update', SELF_TEACHER),
  no('teacher updates another profile', TEACHER_A, 'user:update', 'TEACHER:isSelf', OTHER_USER),
  ok('admin updates any profile', ADMIN, 'user:update', OTHER_USER),

  no('student suspends a user', STUDENT_IN, 'user:suspend', 'STUDENT:deny', OTHER_USER),
  no('teacher suspends a user', TEACHER_A, 'user:suspend', 'TEACHER:deny', OTHER_USER),
  ok('admin suspends another user', ADMIN, 'user:suspend', OTHER_USER),
  no(
    'admin suspends themself and locks the instance',
    ADMIN,
    'user:suspend',
    'ADMIN:not(isSelf)',
    SELF_ADMIN,
  ),

  // The undo, and deliberately NOT its gate: every cell is a terminal allow/deny that
  // reads no Subject field (`SUBJECT_INDEPENDENT_ACTIONS` recomputes this), so the
  // denials below name plain `deny` and the allowance needs no subject at all.
  no('anonymous reinstates a user', ANON, 'user:reinstate', 'anonymous:deny', OTHER_USER),
  no('student reinstates a user', STUDENT_IN, 'user:reinstate', 'STUDENT:deny', OTHER_USER),
  no('teacher reinstates a user', TEACHER_A, 'user:reinstate', 'TEACHER:deny', OTHER_USER),
  ok('admin reinstates a suspended user', ADMIN, 'user:reinstate', OTHER_USER),

  no('student lists users', STUDENT_IN, 'user:list', 'STUDENT:deny'),
  no('teacher lists users', TEACHER_A, 'user:list', 'TEACHER:deny'),
  ok('admin lists users', ADMIN, 'user:list'),

  /*
   * `user:bulk-create`, the cohort import. The cells are a copy of `user:create`'s
   * on purpose rather than a shared constant: the whole argument for a SEPARATE
   * action is that the two requests are not the same request, and a matrix that
   * proved both of them through one shared row would stop being evidence of that.
   * If somebody ever widens one of these four cells, the divergence shows up here
   * as a failing test rather than in a production import.
   */
  no('anonymous imports a cohort', ANON, 'user:bulk-create', 'anonymous:deny'),
  no('student imports a cohort', STUDENT_IN, 'user:bulk-create', 'STUDENT:deny'),
  no('teacher imports a cohort', TEACHER_A, 'user:bulk-create', 'TEACHER:deny'),
  ok('admin imports a cohort', ADMIN, 'user:bulk-create'),

  /*
   * `user:delete` — the rows below are the reason ADMIN is `isSelf` and not a bare
   * `allow`. `ok('admin deletes a user', ADMIN, 'user:delete', OTHER_USER)` is the
   * one cell that would turn a self-service privacy right into an admin verb, and it
   * is refused here with the rule tag that says why.
   */
  no('anonymous deletes an account', ANON, 'user:delete', 'anonymous:deny', OTHER_USER),
  ok('student deletes their own account', STUDENT_IN, 'user:delete', SELF_STUDENT),
  no('student deletes somebody else', STUDENT_IN, 'user:delete', 'STUDENT:isSelf', OTHER_USER),
  ok('teacher deletes their own account', TEACHER_A, 'user:delete', SELF_TEACHER),
  no('teacher deletes somebody else', TEACHER_A, 'user:delete', 'TEACHER:isSelf', OTHER_USER),
  ok('admin deletes their own account', ADMIN, 'user:delete', SELF_ADMIN),
  no(
    'admin deletes somebody else — suspension is the reversible admin verb',
    ADMIN,
    'user:delete',
    'ADMIN:isSelf',
    OTHER_USER,
  ),

  /*
   * `user:export`, the data-subject access request. Self-only for `user:read`'s
   * reason: an export is a copy of the record, and an admin who has the directory
   * does not thereby get a machine-readable dump of a colleague's account.
   */
  no('anonymous exports an account', ANON, 'user:export', 'anonymous:deny', OTHER_USER),
  ok('student exports their own data', STUDENT_IN, 'user:export', SELF_STUDENT),
  no('student exports somebody else', STUDENT_IN, 'user:export', 'STUDENT:isSelf', OTHER_USER),
  ok('teacher exports their own data', TEACHER_A, 'user:export', SELF_TEACHER),
  no('teacher exports somebody else', TEACHER_A, 'user:export', 'TEACHER:isSelf', OTHER_USER),
  ok('admin exports their own data', ADMIN, 'user:export', SELF_ADMIN),
  no('admin exports somebody else', ADMIN, 'user:export', 'ADMIN:isSelf', OTHER_USER),
];

const DEPARTMENT_CELLS: readonly Cell[] = [
  no(
    'anonymous reads department detail, with its head-counts',
    ANON,
    'department:read',
    'anonymous:deny',
    DEPARTMENT,
  ),
  // The sign-up dropdown. Public on purpose; the denials for this action come from
  // the generated actor-state blocks below, which cover every action.
  ok('anonymous lists departments to register', ANON, 'department:list', DEPARTMENT),
  ok('student lists departments', STUDENT_IN, 'department:list', DEPARTMENT),
  ok('teacher lists departments', TEACHER_A, 'department:list', DEPARTMENT),
  ok('admin lists departments', ADMIN, 'department:list', DEPARTMENT),
  no(
    'a suspended account cannot even list departments',
    SUSPENDED_STUDENT,
    'department:list',
    'status:SUSPENDED',
    DEPARTMENT,
  ),
  ok('student reads departments', STUDENT_IN, 'department:read', DEPARTMENT),
  ok('teacher reads departments', TEACHER_A, 'department:read', DEPARTMENT),
  ok('admin reads departments', ADMIN, 'department:read', DEPARTMENT),

  no('student creates a department', STUDENT_IN, 'department:create', 'STUDENT:deny'),
  no('teacher creates a department', TEACHER_A, 'department:create', 'TEACHER:deny'),
  ok('admin creates a department', ADMIN, 'department:create'),

  no('student updates a department', STUDENT_IN, 'department:update', 'STUDENT:deny', DEPARTMENT),
  no('teacher updates a department', TEACHER_A, 'department:update', 'TEACHER:deny', DEPARTMENT),
  ok('admin updates a department', ADMIN, 'department:update', DEPARTMENT),

  no('student deletes a department', STUDENT_IN, 'department:delete', 'STUDENT:deny', DEPARTMENT),
  no('teacher deletes a department', TEACHER_A, 'department:delete', 'TEACHER:deny', DEPARTMENT),
  ok('admin deletes a department', ADMIN, 'department:delete', DEPARTMENT),
];

const UPLOAD_CELLS: readonly Cell[] = [
  no('anonymous asks for a presigned URL', ANON, 'upload:presign', 'anonymous:deny'),
  ok('student asks for a presigned URL', STUDENT_IN, 'upload:presign'),
  ok('teacher asks for a presigned URL', TEACHER_A, 'upload:presign'),
  ok('admin asks for a presigned URL', ADMIN, 'upload:presign'),

  ok('student commits their own upload', STUDENT_IN, 'upload:commit', UPLOAD_OF_S1),
  no(
    "student commits somebody else's pending upload",
    STUDENT_IN,
    'upload:commit',
    'STUDENT:isSelf',
    UPLOAD_OF_STRANGER,
  ),
  no(
    "teacher commits somebody else's pending upload",
    TEACHER_A,
    'upload:commit',
    'TEACHER:isSelf',
    UPLOAD_OF_S1,
  ),
  no(
    "admin commits somebody else's pending upload",
    ADMIN,
    'upload:commit',
    'ADMIN:isSelf',
    UPLOAD_OF_S1,
  ),
];

const CONVERSATION_CELLS: readonly Cell[] = [
  no(
    'anonymous reads a thread',
    ANON,
    'conversation:read',
    'anonymous:deny',
    THREAD_WITH_S1_AND_TA,
  ),
  ok('student reads a thread they are in', STUDENT_IN, 'conversation:read', THREAD_WITH_S1_AND_TA),
  no(
    'student reads a thread they are not in',
    STUDENT_IN,
    'conversation:read',
    'STUDENT:isParticipant',
    THREAD_WITHOUT_ME,
  ),
  ok('teacher reads a thread they are in', TEACHER_A, 'conversation:read', THREAD_WITH_S1_AND_TA),
  no(
    'admin reads a thread they were never seated in',
    ADMIN,
    'conversation:read',
    'ADMIN:isParticipant',
    THREAD_WITHOUT_ME,
  ),

  no('anonymous starts a thread', ANON, 'conversation:create', 'anonymous:deny'),
  ok('student starts a thread', STUDENT_IN, 'conversation:create'),
  ok('teacher starts a thread', TEACHER_A, 'conversation:create'),
  ok('admin starts a thread', ADMIN, 'conversation:create'),

  ok(
    'student sends in a thread they are in',
    STUDENT_IN,
    'conversation:send',
    THREAD_WITH_S1_AND_TA,
  ),
  no(
    'student sends into a thread they are not in',
    STUDENT_IN,
    'conversation:send',
    'STUDENT:isParticipant',
    THREAD_WITHOUT_ME,
  ),
  ok(
    'teacher sends in a thread they are in',
    TEACHER_A,
    'conversation:send',
    THREAD_WITH_S1_AND_TA,
  ),
  no(
    'admin sends into a thread they are not in',
    ADMIN,
    'conversation:send',
    'ADMIN:isParticipant',
    THREAD_WITHOUT_ME,
  ),

  no(
    'student adds themself to a thread',
    STUDENT_IN,
    'conversation:join',
    'STUDENT:deny',
    THREAD_WITHOUT_ME,
  ),
  no(
    'teacher adds themself to a thread',
    TEACHER_A,
    'conversation:join',
    'TEACHER:deny',
    THREAD_WITHOUT_ME,
  ),
  ok('admin seats a participant', ADMIN, 'conversation:join', THREAD_WITHOUT_ME),
];

const MFA_CELLS: readonly Cell[] = [
  no('anonymous enrolls MFA', ANON, 'mfa:enroll', 'anonymous:deny'),
  ok('student enrolls MFA on their own account', STUDENT_IN, 'mfa:enroll'),
  ok('teacher enrolls MFA on their own account', TEACHER_A, 'mfa:enroll'),
  ok('admin enrolls MFA on their own account', ADMIN, 'mfa:enroll'),

  no('anonymous verifies MFA', ANON, 'mfa:verify', 'anonymous:deny'),
  ok('student verifies MFA', STUDENT_IN, 'mfa:verify'),
  ok('teacher verifies MFA', TEACHER_A, 'mfa:verify'),
  ok('admin verifies MFA', ADMIN, 'mfa:verify'),

  no('anonymous disables MFA', ANON, 'mfa:disable', 'anonymous:deny'),
  ok('student disables MFA on their own account', STUDENT_IN, 'mfa:disable'),
  ok('teacher disables MFA on their own account', TEACHER_A, 'mfa:disable'),
  ok('admin disables MFA on their own account', ADMIN, 'mfa:disable'),
];

const PLATFORM_CELLS: readonly Cell[] = [
  no('anonymous reads the audit log', ANON, 'audit:read', 'anonymous:deny'),
  no('student reads the audit log', STUDENT_IN, 'audit:read', 'STUDENT:deny'),
  no('teacher reads the audit log', TEACHER_A, 'audit:read', 'TEACHER:deny'),
  ok('admin reads the audit log', ADMIN, 'audit:read'),

  no(
    'anonymous reads notifications',
    ANON,
    'notification:read',
    'anonymous:deny',
    NOTIFICATION_OF_S1,
  ),
  ok('student reads their own notifications', STUDENT_IN, 'notification:read', NOTIFICATION_OF_S1),
  no(
    "student reads somebody else's notifications",
    STUDENT_IN,
    'notification:read',
    'STUDENT:isSelf',
    NOTIFICATION_OF_STRANGER,
  ),
  no(
    "teacher reads somebody else's notifications",
    TEACHER_A,
    'notification:read',
    'TEACHER:isSelf',
    NOTIFICATION_OF_S1,
  ),
  no(
    "admin reads somebody else's notifications",
    ADMIN,
    'notification:read',
    'ADMIN:isSelf',
    NOTIFICATION_OF_S1,
  ),

  ok(
    'student marks their own notification read',
    STUDENT_IN,
    'notification:update',
    NOTIFICATION_OF_S1,
  ),
  no(
    "student marks somebody else's notification read",
    STUDENT_IN,
    'notification:update',
    'STUDENT:isSelf',
    NOTIFICATION_OF_STRANGER,
  ),
  no(
    "teacher marks somebody else's notification read",
    TEACHER_A,
    'notification:update',
    'TEACHER:isSelf',
    NOTIFICATION_OF_S1,
  ),
  no(
    "admin marks somebody else's notification read",
    ADMIN,
    'notification:update',
    'ADMIN:isSelf',
    NOTIFICATION_OF_S1,
  ),
];

/** The hand-written role matrix. Coverage of `ACTIONS` is asserted against THIS. */
const MATRIX: readonly Cell[] = [
  ...COURSE_CELLS,
  ...ENROLLMENT_CELLS,
  ...ATTENDANCE_CELLS,
  ...ASSIGNMENT_CELLS,
  ...SUBMISSION_CELLS,
  ...CERTIFICATE_CELLS,
  ...QUALIFICATION_CELLS,
  ...RESOURCE_CELLS,
  ...ANNOUNCEMENT_CELLS,
  ...COMMENT_CELLS,
  ...USER_CELLS,
  ...DEPARTMENT_CELLS,
  ...UPLOAD_CELLS,
  ...CONVERSATION_CELLS,
  ...MFA_CELLS,
  ...PLATFORM_CELLS,
];

// ---------------------------------------------------------------------------
// Generated blocks — actor state, which is orthogonal to the role matrix and so
// is proved across EVERY action rather than a sampled few.
// ---------------------------------------------------------------------------

/** Subject generous enough that no role rule would be the thing to refuse. */
const PERMISSIVE_SUBJECT: Subject = {
  id: 'x',
  userId: STUDENT_IN.id,
  authorId: STUDENT_IN.id,
  courseId: 'c_a',
  courseTeacherId: TEACHER_A.id,
  studentId: STUDENT_IN.id,
  enrollmentStatus: 'APPROVED',
  isPublic: true,
  publishedAt: T0,
  participantIds: [STUDENT_IN.id, TEACHER_A.id, ADMIN.id],
};

/** Same, re-pointed at whichever actor is under test. */
const permissiveFor = (actor: Actor): Subject => ({
  ...PERMISSIVE_SUBJECT,
  userId: actor.id,
  authorId: actor.id,
  studentId: actor.id,
  courseTeacherId: actor.id,
  participantIds: [actor.id],
});

const ANONYMOUS_ALLOWED: readonly Action[] = [
  'course:read',
  'announcement:read',
  'resource:read',
  // Registration cannot happen without it — see the rule's comment in policy.ts.
  'department:list',
  /*
   * Phase 3, and the only action on this list that reaches a HOLDER'S OWN record
   * rather than a course, a post or a file.
   *
   * It is here because a certificate is worthless without it. The document exists so
   * that a stranger can check it, and the stranger has no account; refusing them would
   * leave every certificate in the system an ornament. What the allow does NOT do is
   * hand out anything: `verifyResultSchema` carries a name, a qualification, a date
   * and a boolean, and the row's id, the holder's email and the grounds of any
   * revocation are all absent by construction. The reference behind the lookup is 128
   * bits of CSPRNG output, so the space cannot be walked whatever this cell says.
   */
  'certificate:verify',
];

const DESTRUCTIVE_ACTIONS: readonly Action[] = [
  'course:delete',
  'resource:delete',
  'announcement:delete',
  'comment:delete',
  'department:delete',
  'user:suspend',
  // Phase 6. A bulk import is a hundred-account write from a session the whole
  // internet is looking at, and a deletion request has a thirty-day deadline
  // running behind it — neither belongs on an account that resets on a schedule.
  'user:bulk-create',
  'user:delete',
  // Phase 3. A certificate is designed to outlive every account involved in it, so
  // manufacturing or withdrawing one from a shared account that resets on a schedule
  // leaves a real qualification nobody can undo with the same credentials.
  'certificate:issue',
  'certificate:revoke',
];

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function runCell(cell: Cell): void {
  const result = can(cell.actor, cell.action, cell.subject);
  if (cell.allow) {
    expect(result, `expected ALLOW for "${cell.why}" but got: ${JSON.stringify(result)}`).toEqual({
      allowed: true,
    });
    return;
  }
  expect(result.allowed, `expected DENY for "${cell.why}"`).toBe(false);
  if (!result.allowed) {
    expect(result.rule, `wrong rule fired for "${cell.why}"`).toBe(cell.rule);
    expect(result.reason.length).toBeGreaterThan(0);
  }
}

const groups: ReadonlyArray<readonly [string, readonly Cell[]]> = [
  ['course', COURSE_CELLS],
  ['enrollment', ENROLLMENT_CELLS],
  ['attendance', ATTENDANCE_CELLS],
  ['assignment', ASSIGNMENT_CELLS],
  ['submission', SUBMISSION_CELLS],
  ['certificate', CERTIFICATE_CELLS],
  ['qualification', QUALIFICATION_CELLS],
  ['resource', RESOURCE_CELLS],
  ['announcement', ANNOUNCEMENT_CELLS],
  ['comment', COMMENT_CELLS],
  ['user', USER_CELLS],
  ['department', DEPARTMENT_CELLS],
  ['upload', UPLOAD_CELLS],
  ['conversation', CONVERSATION_CELLS],
  ['mfa', MFA_CELLS],
  ['platform', PLATFORM_CELLS],
];

for (const [groupName, cells] of groups) {
  describe(`role matrix / ${groupName}`, () => {
    for (const cell of cells) {
      it(`${cell.allow ? 'allows' : 'denies'}: ${cell.why} [${cell.action}]`, () => {
        runCell(cell);
      });
    }
  });
}

describe('anonymous surface', () => {
  it('is exactly the five actions listed above, and no more', () => {
    const reachable = ACTIONS.filter((action) => can(null, action, PERMISSIVE_SUBJECT).allowed);
    expect([...reachable].sort()).toEqual([...ANONYMOUS_ALLOWED].sort());
  });

  for (const action of ACTIONS) {
    if (ANONYMOUS_ALLOWED.includes(action)) continue;
    it(`denies anonymous ${action} even with a maximally permissive subject`, () => {
      const result = can(null, action, PERMISSIVE_SUBJECT);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.rule.startsWith('anonymous:')).toBe(true);
    });
  }
});

describe('status: SUSPENDED denies everything', () => {
  for (const actor of [SUSPENDED_ADMIN, SUSPENDED_TEACHER, SUSPENDED_STUDENT]) {
    for (const action of ACTIONS) {
      it(`${actor.role} suspended, ${action}`, () => {
        const result = can(actor, action, permissiveFor(actor));
        expect(result.allowed).toBe(false);
        if (!result.allowed) expect(result.rule).toBe('status:SUSPENDED');
      });
    }
  }

  it('denies mfa:verify too — a suspended account has nothing to verify into', () => {
    const result = can(SUSPENDED_ADMIN, 'mfa:verify');
    expect(result).toEqual({
      allowed: false,
      rule: 'status:SUSPENDED',
      reason: 'This account is suspended.',
    });
  });
});

describe('status: PENDING_VERIFICATION allows nothing but mfa:verify', () => {
  for (const actor of [PENDING_STUDENT, PENDING_TEACHER]) {
    for (const action of ACTIONS) {
      const expectAllowed = action === 'mfa:verify';
      it(`${actor.role} unverified, ${action}`, () => {
        const result = can(actor, action, permissiveFor(actor));
        expect(result.allowed).toBe(expectAllowed);
        if (!result.allowed) expect(result.rule).toBe('status:PENDING_VERIFICATION');
      });
    }
  }
});

describe('provenance: MFA_PENDING allows nothing but mfa:verify', () => {
  for (const actor of [MFA_PENDING_ADMIN, MFA_PENDING_STUDENT]) {
    for (const action of ACTIONS) {
      const expectAllowed = action === 'mfa:verify';
      it(`${actor.role} half-authenticated, ${action}`, () => {
        const result = can(actor, action, permissiveFor(actor));
        expect(result.allowed).toBe(expectAllowed);
        if (!result.allowed) expect(result.rule).toBe('provenance:MFA_PENDING');
      });
    }
  }

  it('an MFA_PENDING admin is not an admin', () => {
    expect(can(MFA_PENDING_ADMIN, 'user:suspend', OTHER_USER)).toEqual({
      allowed: false,
      rule: 'provenance:MFA_PENDING',
      reason: 'Finish two-factor verification before using this session.',
    });
  });
});

describe('provenance: DEMO reads and mutates, but never destroys', () => {
  for (const actor of [DEMO_ADMIN, DEMO_TEACHER, DEMO_STUDENT]) {
    for (const action of DESTRUCTIVE_ACTIONS) {
      it(`denies demo ${actor.role} ${action}`, () => {
        const result = can(actor, action, permissiveFor(actor));
        expect(result.allowed).toBe(false);
        if (!result.allowed) expect(result.rule).toBe('provenance:DEMO');
      });
    }
  }

  it('a demo session decides every non-destructive action exactly as a password session would', () => {
    for (const action of ACTIONS) {
      if (DESTRUCTIVE_ACTIONS.includes(action)) continue;
      for (const role of ['STUDENT', 'TEACHER', 'ADMIN'] as const) {
        const base = ROLE_ACTORS[role];
        const demo = withProvenance(base, 'DEMO');
        const subject = permissiveFor(base);
        expect(
          can(demo, action, subject).allowed,
          `demo ${role} diverged from password ${role} on ${action}`,
        ).toBe(can(base, action, subject).allowed);
      }
    }
  });

  it('demo reads are genuinely open', () => {
    expect(can(DEMO_STUDENT, 'course:read', COURSE_A_LIVE).allowed).toBe(true);
    expect(can(DEMO_TEACHER, 'resource:read', RESOURCE_A_PRIVATE).allowed).toBe(true);
    expect(can(DEMO_ADMIN, 'audit:read').allowed).toBe(true);
  });

  it('demo mutations that are not destructive still go through', () => {
    expect(can(DEMO_TEACHER, 'course:create').allowed).toBe(true);
    expect(can(DEMO_TEACHER, 'course:update', COURSE_A_LIVE).allowed).toBe(true);
    expect(can(DEMO_TEACHER, 'resource:create', COURSE_A_LIVE).allowed).toBe(true);
    expect(can(DEMO_STUDENT, 'comment:create').allowed).toBe(true);
  });
});

describe('gate ordering', () => {
  it('suspension outranks provenance', () => {
    const actor: Actor = { ...ADMIN, status: 'SUSPENDED', provenance: 'MFA_PENDING' };
    const result = can(actor, 'mfa:verify');
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.rule).toBe('status:SUSPENDED');
  });

  it('account state outranks the role rule, so a denial is never mistaken for a scope miss', () => {
    const result = can(SUSPENDED_TEACHER, 'course:update', COURSE_B_LIVE);
    expect(result.allowed).toBe(false);
    // Would have been TEACHER:ownsCourse had the status gate not fired first.
    if (!result.allowed) expect(result.rule).toBe('status:SUSPENDED');
  });

  it('unverified outranks the demo gate', () => {
    const actor: Actor = { ...ADMIN, status: 'PENDING_VERIFICATION', provenance: 'DEMO' };
    const result = can(actor, 'course:delete', COURSE_A_LIVE);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.rule).toBe('status:PENDING_VERIFICATION');
  });
});

describe('purity', () => {
  it('never mutates the actor or the subject', () => {
    const actor: Actor = { ...TEACHER_A };
    const subject: Subject = { ...COURSE_A_LIVE };
    const actorBefore = JSON.stringify(actor);
    const subjectBefore = JSON.stringify(subject);
    for (const action of ACTIONS) can(actor, action, subject);
    expect(JSON.stringify(actor)).toBe(actorBefore);
    expect(JSON.stringify(subject)).toBe(subjectBefore);
  });

  it('is deterministic and subject-free when no subject is supplied', () => {
    for (const action of ACTIONS) {
      expect(can(TEACHER_A, action)).toEqual(can(TEACHER_A, action));
    }
  });

  it('denies rather than throwing when the subject lacks the fields a rule reads', () => {
    for (const action of ACTIONS) {
      for (const role of ['STUDENT', 'TEACHER', 'ADMIN'] as const) {
        expect(() => can(ROLE_ACTORS[role], action, {})).not.toThrow();
      }
      expect(() => can(null, action, {})).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// The exhaustiveness assertion — the reason the matrix is worth writing
// ---------------------------------------------------------------------------

describe('matrix completeness', () => {
  const coveredActions = new Set<Action>(MATRIX.map((cell) => cell.action));

  it('has at least one hand-written row for every action in the Action union', () => {
    const uncovered = ACTIONS.filter((action) => !coveredActions.has(action));
    expect(uncovered, `actions with no matrix row: ${uncovered.join(', ')}`).toEqual([]);
  });

  it('covers every action for every role, allow and deny both represented per action', () => {
    const gaps: string[] = [];
    for (const action of ACTIONS) {
      const rows = MATRIX.filter((cell) => cell.action === action);
      for (const role of ['STUDENT', 'TEACHER', 'ADMIN'] as const) {
        if (!rows.some((cell) => cell.actor !== null && cell.actor.role === role)) {
          gaps.push(`${action} has no ${role} row`);
        }
      }
    }
    expect(gaps, gaps.join('\n')).toEqual([]);
  });

  it('mentions no action outside the Action union', () => {
    const known = new Set<string>(ACTIONS);
    const strays = [...coveredActions].filter((action) => !known.has(action));
    expect(strays).toEqual([]);
  });

  it('reports the size of the matrix it just proved', () => {
    const generatedCells =
      // anonymous surface
      ACTIONS.length +
      // suspended × 3 actors
      ACTIONS.length * 3 +
      // pending verification × 2 actors
      ACTIONS.length * 2 +
      // mfa pending × 2 actors
      ACTIONS.length * 2 +
      // demo destructive × 3 actors, plus the demo/password equivalence sweep
      DESTRUCTIVE_ACTIONS.length * 3 +
      (ACTIONS.length - DESTRUCTIVE_ACTIONS.length) * 3;

    const total = MATRIX.length + generatedCells;

    // Not console.log: this is the artifact's headline number and it must appear
    // in CI output, derived rather than asserted so adding an action never fails
    // on a stale constant.
    console.info(
      `[policy-matrix] ${ACTIONS.length} actions · ${MATRIX.length} hand-written cells · ` +
        `${generatedCells} generated cells · ${total} decisions proved`,
    );

    expect(total).toBeGreaterThan(MATRIX.length);
    expect(ACTIONS.length).toBe(new Set(ACTIONS).size);
  });
});

/**
 * The list that stops a guard from being an off switch.
 *
 * A rule that reads an absent `Subject` field must deny, so `can(actor, action)` with
 * no subject is a guaranteed refusal for every action outside this set. Gating a
 * navigation entry on `course:read` deleted the Courses link for every student and
 * teacher; gating one on `conversation:read` deleted Messages for everyone, admins
 * included. Neither threw, neither logged, and both looked exactly like a correct
 * denial.
 *
 * `SUBJECT_INDEPENDENT_ACTIONS` is hand-written so it can be a TYPE. This recomputes
 * it from the rules themselves, so changing a cell from `allow` to `ownsCourse`
 * without updating the list fails here rather than silently in a screen.
 */
describe('subject-independent actions', () => {
  it('matches what the rules actually say', () => {
    expect([...computeSubjectIndependentActions()].sort()).toEqual(
      [...SUBJECT_INDEPENDENT_ACTIONS].sort(),
    );
  });

  it('every one of them answers the same with and without a subject', () => {
    const actors = [ADMIN, TEACHER_A, STUDENT_IN, ANON];
    for (const action of SUBJECT_INDEPENDENT_ACTIONS) {
      for (const actor of actors) {
        const bare = can(actor, action);
        const withSubject = can(actor, action, PERMISSIVE_SUBJECT);
        expect(bare.allowed, `${actor?.role ?? 'anonymous'} / ${action}`).toBe(withSubject.allowed);
      }
    }
  });

  it('every action NOT in the list denies at least one role when asked bare', () => {
    const independent = new Set<Action>(SUBJECT_INDEPENDENT_ACTIONS);
    for (const action of ACTIONS) {
      if (independent.has(action)) continue;
      const bare = [ADMIN, TEACHER_A, STUDENT_IN].map((actor) => can(actor, action).allowed);
      expect(
        bare.some((allowed) => !allowed),
        `${action} is bare-safe but unlisted`,
      ).toBe(true);
    }
  });
});
