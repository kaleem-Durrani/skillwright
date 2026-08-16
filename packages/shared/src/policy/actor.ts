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

  /** `Message.senderId`. */
  senderId?: string;
}

/** Shared frozen blank so `can(actor, action)` with no subject allocates nothing. */
export const EMPTY_SUBJECT: Subject = Object.freeze({});
