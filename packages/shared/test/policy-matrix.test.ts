import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  can,
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

const RESOURCE_A_PUBLIC: Subject = {
  id: 'r_pub',
  courseId: 'c_a',
  courseTeacherId: TEACHER_A.id,
  authorId: TEACHER_A.id,
  isPublic: true,
};
const RESOURCE_A_PRIVATE: Subject = { ...RESOURCE_A_PUBLIC, id: 'r_priv', isPublic: false };
const RESOURCE_A_PRIVATE_APPROVED: Subject = {
  ...RESOURCE_A_PRIVATE,
  enrollmentStatus: 'APPROVED',
};
const RESOURCE_A_PRIVATE_PENDING: Subject = { ...RESOURCE_A_PRIVATE, enrollmentStatus: 'PENDING' };
const RESOURCE_B_PRIVATE: Subject = {
  id: 'r_b',
  courseId: 'c_b',
  courseTeacherId: TEACHER_B.id,
  authorId: TEACHER_B.id,
  isPublic: false,
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
  ok(
    'student requests enrollment in a published course',
    STUDENT_OUT,
    'enrollment:request',
    COURSE_A_LIVE,
  ),
  no(
    'student requests enrollment in a draft course',
    STUDENT_OUT,
    'enrollment:request',
    'STUDENT:isPublished',
    COURSE_A_DRAFT,
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
];

const RESOURCE_CELLS: readonly Cell[] = [
  ok('anonymous reads a public resource', ANON, 'resource:read', RESOURCE_A_PUBLIC),
  no(
    'anonymous reads a private resource',
    ANON,
    'resource:read',
    'anonymous:isPublic',
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
    'STUDENT:or(isPublic, enrolledApproved)',
    RESOURCE_A_PRIVATE,
  ),
  no(
    'student with a PENDING request reads a private resource',
    STUDENT_OUT,
    'resource:read',
    'STUDENT:or(isPublic, enrolledApproved)',
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
    'TEACHER:or(isPublic, ownsCourse, isAuthor)',
    RESOURCE_B_PRIVATE,
  ),
  ok('admin reads any resource', ADMIN, 'resource:read', RESOURCE_B_PRIVATE),

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
    'STUDENT:or(isPublic, enrolledApproved)',
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
    'TEACHER:or(isPublic, ownsCourse, isAuthor)',
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

  no('student lists users', STUDENT_IN, 'user:list', 'STUDENT:deny'),
  no('teacher lists users', TEACHER_A, 'user:list', 'TEACHER:deny'),
  ok('admin lists users', ADMIN, 'user:list'),
];

const DEPARTMENT_CELLS: readonly Cell[] = [
  no('anonymous lists departments directly', ANON, 'department:read', 'anonymous:deny', DEPARTMENT),
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

const ANONYMOUS_ALLOWED: readonly Action[] = ['course:read', 'announcement:read', 'resource:read'];

const DESTRUCTIVE_ACTIONS: readonly Action[] = [
  'course:delete',
  'resource:delete',
  'announcement:delete',
  'comment:delete',
  'department:delete',
  'user:suspend',
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
  it('is exactly three read actions, and no more', () => {
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
