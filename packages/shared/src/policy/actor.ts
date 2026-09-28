/**
 * The two plain-data types the policy layer reasons over.
 *
 * Neither of them is a Prisma model on purpose. `Actor` is what a session proves,
 * `Subject` is what the caller has already loaded. Keeping both structural means
 * `@skillwright/shared` never imports `@prisma/client`, which is what lets the
 * browser bundle the exact same rules the server enforces.
 */

export type Role = 'STUDENT' | 'TEACHER' | 'ADMIN';

export type ActorStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';

/** Why the session exists. Mirrors `SessionProvenance` in the Prisma schema. */
export type Provenance = 'PASSWORD' | 'DEMO' | 'MFA_PENDING';

/** Mirrors `EnrollmentStatus` in the Prisma schema. */
export type EnrollmentState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'COMPLETED';

export const ROLES: readonly Role[] = Object.freeze(['STUDENT', 'TEACHER', 'ADMIN'] as const);

export const ACTOR_STATUSES: readonly ActorStatus[] = Object.freeze([
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
] as const);

export const PROVENANCES: readonly Provenance[] = Object.freeze([
  'PASSWORD',
  'DEMO',
  'MFA_PENDING',
] as const);

/**
 * Everything a decision may know about the caller. Four fields, all of which the
 * session row already carries — so authorization never needs a database round
 * trip of its own.
 */
export interface Actor {
  id: string;
  role: Role;
  status: ActorStatus;
  provenance: Provenance;
}

/**
 * Everything a decision may know about the thing being acted on.
 *
 * Every field is optional because different actions carry different shapes, and
 * because a rule that reads an absent field must deny rather than throw. The
 * caller loads these fields; policy NEVER loads anything.
 */
export interface Subject {
  /** Primary key of the entity itself. */
  id?: string;

  /** Owning user for user-scoped rows: User, Notification, Upload. */
  userId?: string;

  /** Author of a Resource, Announcement, Comment. */
  authorId?: string;

  /** Course the subject belongs to (or is). */
  courseId?: string;

  /** `Course.teacherId` of the owning course. Resolved by the caller via one join. */
  courseTeacherId?: string;

  /** `Enrollment.studentId` — who the enrollment belongs to. */
  studentId?: string;

  /**
   * The REQUESTING actor's enrollment status in the relevant course, not the
   * status of some arbitrary enrollment row. The caller must scope the lookup to
   * the actor; passing someone else's status here is the one way to misuse this.
   *
   * Since Phase 9's template/offering split a student holds one enrollment PER
   * INTAKE of a course. This field answers "their status in the COURSE": an
   * APPROVED seat on any live offering of it reads APPROVED here, which is what
   * `enrolledApproved` has always meant ("may this student be here").
   */
  enrollmentStatus?: EnrollmentState | null;

  /** `Resource.isPublic`. */
  isPublic?: boolean;

  /** Non-null means live. Covers `Course.publishedAt` and `Announcement.publishedAt`. */
  publishedAt?: Date | string | null;

  /** Soft-delete marker; a deleted subject is invisible to every non-admin read. */
  deletedAt?: Date | string | null;

  departmentId?: string;

  /** Active participants of a Conversation (rows with `leftAt` null). */
  participantIds?: readonly string[];

  /**
   * Everybody who has EVER held a seat in a Conversation — every
   * `ConversationParticipant` row, including the ones with a `leftAt`.
   *
   * A separate field rather than a flag on `participantIds`, because the two answer
   * different questions and conflating them is the bug this exists to prevent. Every
   * rule written so far describes access to something that still EXISTS, so they read
   * the live set: `isParticipant` is what `conversation:read` and `conversation:send`
   * are, and a seat you gave up is not a seat. But an action that DESTROYS a
   * membership cannot be decided by the same predicate — a gate reading
   * `participantIds` would authorise `conversation:leave` against the exact
   * condition the request makes false, and there is no second reading of that.
   *
   * So the vocabulary is stated twice, deliberately. `participantIds` is "is here
   * now"; `memberIds` is "was ever here", which is the only fact that survives the
   * write. An ABSENT `memberIds` denies, like every other absent field.
   */
  memberIds?: readonly string[];

  /**
   * The subject COURSE's own requirement: the id of the course a student must
   * complete first, or null when the course names no prerequisite.
   *
   * ABSENT (the key left off) DENIES `hasCompletedPrerequisite`. Only explicit
   * null means "no requirement" — so a loader that forgot to select the column
   * refuses rather than silently waving students through an ungated course,
   * which is LESSONS-LEARNED #15/#31 pointed in the dangerous direction.
   */
  prerequisiteCourseId?: string | null;

  /**
   * The REQUESTING actor's completed courses — the ids they hold an APPROVED
   * enrollment for. Viewer-relative exactly like `enrollmentStatus`: it is the
   * caller's own record, never some other student's, and passing someone else's
   * list is the one documented way to misuse it. Loaded by whichever subject
   * loader feeds a rule that reads it (`hasCompletedPrerequisite`).
   */
  completedCourseIds?: readonly string[];
}

/** Shared frozen blank so `can(actor, action)` with no subject allocates nothing. */
export const EMPTY_SUBJECT: Subject = Object.freeze({});
