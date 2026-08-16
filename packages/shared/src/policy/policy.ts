import type { Role } from './actor.js';
import {
  allow,
  deny,
  enrolledApproved,
  isAuthor,
  isEnrolledStudent,
  isParticipant,
  isPublic,
  isPublished,
  isSelf,
  not,
  or,
  ownsCourse,
  type Rule,
} from './combinators.js';

/**
 * Every verb the system can perform, as `entity:verb`.
 *
 * This union is hand-written and exhaustive; `PolicyTable` is keyed by it, so a
 * new action is a type error until it has a rule for the anonymous case and for
 * all three roles. That is the compile-time half of the exhaustiveness claim —
 * `ACTIONS` plus the matrix test is the runtime half.
 */
export type Action =
  // course
  | 'course:read'
  | 'course:create'
  | 'course:update'
  | 'course:delete'
  | 'course:publish'
  // enrollment
  | 'enrollment:request'
  | 'enrollment:read'
  | 'enrollment:approve'
  | 'enrollment:reject'
  | 'enrollment:withdraw'
  // resource
  | 'resource:read'
  | 'resource:create'
  | 'resource:update'
  | 'resource:delete'
  | 'resource:download'
  // announcement
  | 'announcement:read'
  | 'announcement:create'
  | 'announcement:update'
  | 'announcement:delete'
  | 'announcement:publish'
  // comment
  | 'comment:read'
  | 'comment:create'
  | 'comment:update'
  | 'comment:delete'
  // user
  | 'user:read'
  | 'user:update'
  | 'user:suspend'
  | 'user:list'
  // department
  | 'department:read'
  | 'department:create'
  | 'department:update'
  | 'department:delete'
  // upload
  | 'upload:presign'
  | 'upload:commit'
  // conversation
  | 'conversation:read'
  | 'conversation:create'
  | 'conversation:send'
  | 'conversation:join'
  // mfa
  | 'mfa:enroll'
  | 'mfa:verify'
  | 'mfa:disable'
  // platform
  | 'audit:read'
  | 'notification:read'
  | 'notification:update';

/**
 * One rule per caller class. `anonymous` is required rather than optional: a new
 * action must state, in writing, what a logged-out visitor may do with it. An
 * optional key would let that decision be made by forgetting.
 */
export type ActionRules = {
  readonly [R in Role]: Rule;
} & {
  readonly anonymous: Rule;
};

export type PolicyTable = { readonly [A in Action]: ActionRules };

/**
 * Identity function whose only job is to apply `PolicyTable` to an object literal.
 *
 * Because the parameter is the exact mapped type (not a generic), TypeScript
 * reports a missing action, a missing role and an unknown action all as errors at
 * the definition site. Removing this wrapper removes the guarantee.
 */
function definePolicy(table: PolicyTable): PolicyTable {
  return table;
}

// Reused compositions, named once so the generated permissions doc reads the same
// way in every row that uses them.
const teacherOrPublishedCourse = or(isPublished, ownsCourse);
const studentCourseVisible = or(isPublished, enrolledApproved);
const resourceVisibleToStudent = or(isPublic, enrolledApproved);
const resourceVisibleToTeacher = or(isPublic, ownsCourse, isAuthor);

export const POLICY: PolicyTable = definePolicy({
  // -------------------------------------------------------------------------
  // Course
  // -------------------------------------------------------------------------
  'course:read': {
    anonymous: isPublished,
    // An enrolled student keeps access to a course that was later unpublished.
    STUDENT: studentCourseVisible,
    TEACHER: teacherOrPublishedCourse,
    ADMIN: allow,
  },
  'course:create': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: allow,
    ADMIN: allow,
  },
  'course:update': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: ownsCourse,
    ADMIN: allow,
  },
  'course:delete': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: ownsCourse,
    ADMIN: allow,
  },
  'course:publish': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: ownsCourse,
    ADMIN: allow,
  },

  // -------------------------------------------------------------------------
  // Enrollment
  // -------------------------------------------------------------------------
  'enrollment:request': {
    anonymous: deny,
    // Subject is the COURSE. A draft course cannot accumulate a waiting list.
    STUDENT: isPublished,
    TEACHER: deny,
    ADMIN: allow,
  },
  'enrollment:read': {
    anonymous: deny,
    STUDENT: isEnrolledStudent,
    TEACHER: ownsCourse,
    ADMIN: allow,
  },
  'enrollment:approve': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: ownsCourse,
    ADMIN: allow,
  },
  'enrollment:reject': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: ownsCourse,
    ADMIN: allow,
  },
  'enrollment:withdraw': {
    anonymous: deny,
    STUDENT: isEnrolledStudent,
    // A teacher removing a student is a rejection, not a withdrawal; separate verb,
    // separate audit action, separate notification.
    TEACHER: deny,
    ADMIN: allow,
  },

  // -------------------------------------------------------------------------
  // Resource
  // -------------------------------------------------------------------------
  'resource:read': {
    anonymous: isPublic,
    STUDENT: resourceVisibleToStudent,
    TEACHER: resourceVisibleToTeacher,
    ADMIN: allow,
  },
  'resource:create': {
    anonymous: deny,
    STUDENT: deny,
    // Scoped, not blanket: without this a teacher could file a resource into a
    // colleague's course by guessing a courseId.
    TEACHER: ownsCourse,
    ADMIN: allow,
  },
  'resource:update': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: ownsCourse,
    ADMIN: allow,
  },
  'resource:delete': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: ownsCourse,
    ADMIN: allow,
  },
  'resource:download': {
    // Strictly narrower than `resource:read`: a logged-out visitor may SEE that a
    // public resource exists, but pulling the bytes out of the private bucket
    // requires a session. That is the anti-scraping line, and it keeps the
    // anonymous surface to exactly three actions.
    anonymous: deny,
    STUDENT: resourceVisibleToStudent,
    TEACHER: resourceVisibleToTeacher,
    ADMIN: allow,
  },

  // -------------------------------------------------------------------------
  // Announcement
  // -------------------------------------------------------------------------
  'announcement:read': {
    anonymous: isPublished,
    STUDENT: isPublished,
    TEACHER: or(isPublished, isAuthor),
    ADMIN: allow,
  },
  'announcement:create': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: allow,
    ADMIN: allow,
  },
  'announcement:update': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: isAuthor,
    ADMIN: allow,
  },
  'announcement:delete': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: isAuthor,
    ADMIN: allow,
  },
  'announcement:publish': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: isAuthor,
    ADMIN: allow,
  },

  // -------------------------------------------------------------------------
  // Comment
  // -------------------------------------------------------------------------
  'comment:read': {
    // Comments are never part of the logged-out surface, even on published posts.
    anonymous: deny,
    STUDENT: allow,
    TEACHER: allow,
    ADMIN: allow,
  },
  'comment:create': {
    anonymous: deny,
    STUDENT: allow,
    TEACHER: allow,
    ADMIN: allow,
  },
  'comment:update': {
    anonymous: deny,
    // Editing is authorship only, for everyone. An admin who wants text gone
    // deletes it, which leaves an audit row.
    STUDENT: isAuthor,
    TEACHER: isAuthor,
    ADMIN: isAuthor,
  },
  'comment:delete': {
    anonymous: deny,
    STUDENT: isAuthor,
    // Moderation inside one's own course is the teacher's job.
    TEACHER: or(isAuthor, ownsCourse),
    ADMIN: allow,
  },

  // -------------------------------------------------------------------------
  // User
  // -------------------------------------------------------------------------
  'user:read': {
    anonymous: deny,
    STUDENT: isSelf,
    // Reading an enrolled student's details goes through `enrollment:read`, which
    // is already scoped by `ownsCourse`. This action stays self-only so that a
    // teacher cannot enumerate the directory one id at a time.
    TEACHER: isSelf,
    ADMIN: allow,
  },
  'user:update': {
    anonymous: deny,
    STUDENT: isSelf,
    TEACHER: isSelf,
    ADMIN: allow,
  },
  'user:suspend': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: deny,
    // Self-suspension would lock the last admin out of the instance.
    ADMIN: not(isSelf),
  },
  'user:list': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: deny,
    ADMIN: allow,
  },

  // -------------------------------------------------------------------------
  // Department
  // -------------------------------------------------------------------------
  'department:read': {
    // The public catalogue embeds a `department` summary inside every course DTO,
    // so the logged-out marketing pages never need this action. Keeping it closed
    // holds the anonymous surface to the three read actions the contract names.
    anonymous: deny,
    STUDENT: allow,
    TEACHER: allow,
    ADMIN: allow,
  },
  'department:create': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: deny,
    ADMIN: allow,
  },
  'department:update': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: deny,
    ADMIN: allow,
  },
  'department:delete': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: deny,
    ADMIN: allow,
  },

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------
  'upload:presign': {
    anonymous: deny,
    STUDENT: allow,
    TEACHER: allow,
    ADMIN: allow,
  },
  'upload:commit': {
    anonymous: deny,
    // Subject is the Upload row; `userId` is its owner. Committing someone else's
    // pending upload would let an attacker attach bytes they never uploaded.
    STUDENT: isSelf,
    TEACHER: isSelf,
    ADMIN: isSelf,
  },

  // -------------------------------------------------------------------------
  // Conversation
  // -------------------------------------------------------------------------
  'conversation:read': {
    anonymous: deny,
    STUDENT: isParticipant,
    TEACHER: isParticipant,
    // Admins moderate threads they were seated in; the schema can seat them, so
    // there is no need for a bypass.
    ADMIN: isParticipant,
  },
  'conversation:create': {
    anonymous: deny,
    STUDENT: allow,
    TEACHER: allow,
    ADMIN: allow,
  },
  'conversation:send': {
    anonymous: deny,
    STUDENT: isParticipant,
    TEACHER: isParticipant,
    ADMIN: isParticipant,
  },
  'conversation:join': {
    anonymous: deny,
    // Self-joining an arbitrary thread is the whole attack. Only an admin adds a
    // participant, and only to a thread that already exists.
    STUDENT: deny,
    TEACHER: deny,
    ADMIN: allow,
  },

  // -------------------------------------------------------------------------
  // MFA — always acts on the session's own user; no id appears in these routes,
  // so `allow` here cannot be turned into acting on somebody else.
  // -------------------------------------------------------------------------
  'mfa:enroll': {
    anonymous: deny,
    STUDENT: allow,
    TEACHER: allow,
    ADMIN: allow,
  },
  'mfa:verify': {
    anonymous: deny,
    STUDENT: allow,
    TEACHER: allow,
    ADMIN: allow,
  },
  'mfa:disable': {
    anonymous: deny,
    STUDENT: allow,
    TEACHER: allow,
    ADMIN: allow,
  },

  // -------------------------------------------------------------------------
  // Platform
  // -------------------------------------------------------------------------
  'audit:read': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: deny,
    ADMIN: allow,
  },
  'notification:read': {
    anonymous: deny,
    // Notification rows are per-user; list endpoints pass `{ userId: actor.id }`.
    STUDENT: isSelf,
    TEACHER: isSelf,
    ADMIN: isSelf,
  },
  'notification:update': {
    anonymous: deny,
    STUDENT: isSelf,
    TEACHER: isSelf,
    ADMIN: isSelf,
  },
});

/**
 * Every action, derived from the policy object rather than declared beside it.
 *
 * This is the point of the whole module: a route that guards an action the policy
 * does not define is impossible, and the matrix test iterates THIS array, so an
 * action nobody tested fails CI rather than shipping.
 */
// The cast is sound by construction: POLICY is typed as `PolicyTable`, whose keys
// are exactly `Action`. `Object.keys` merely loses that on the way out.
export const ACTIONS: readonly Action[] = Object.freeze(Object.keys(POLICY) as Action[]);

/** Runtime membership test, for parsing an action name off the wire. */
export function isAction(value: string): value is Action {
  return Object.prototype.hasOwnProperty.call(POLICY, value);
}
