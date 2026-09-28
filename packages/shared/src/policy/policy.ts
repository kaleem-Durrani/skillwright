import type { Role } from './actor.js';
import {
  allow,
  and,
  deny,
  enrolledApproved,
  hasCompletedPrerequisite,
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
  | 'enrollment:complete'
  | 'enrollment:uncomplete'
  // attendance
  | 'attendance:mark'
  | 'attendance:read'
  // assignment
  | 'assignment:read'
  | 'assignment:create'
  // submission
  | 'submission:read'
  | 'submission:grade'
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
  | 'user:create'
  | 'user:bulk-create'
  | 'user:suspend'
  | 'user:reinstate'
  | 'user:list'
  | 'user:delete'
  | 'user:export'
  // department
  | 'department:read'
  | 'department:list'
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
/*
 * A resource is never more visible than the course it hangs off.
 *
 * `isPublic` alone was not enough, and the gap was reachable rather than theoretical:
 * a teacher may create resources in a course they have not published yet
 * (`resource:create` is `ownsCourse`, with no publication term), so a draft course
 * could hold a resource flagged public. Measured on 2026-08-23 against the real API:
 * an anonymous caller was refused the COURSE with a 401 and simultaneously served that
 * resource with a 200, plus its title in `GET /resources`. The nested list under
 * `/courses/:id/resources` was safe only because it is gated on `course:read`.
 *
 * So the public branch now carries the course's own publication state, exactly as
 * `course:read`'s anonymous cell does. `publicAndLive` is `and(isPublic, isPublished)`
 * and reads `subject.publishedAt` — which is why `loadResourceSubject` must supply it;
 * a subject that omits it denies silently, the failure mode LESSONS-LEARNED #31 is
 * about.
 *
 * The other branches are deliberately NOT narrowed. An approved student keeps access to
 * material in a course that was later unpublished — the same allowance
 * `studentCourseVisible` makes one line above — and a teacher who owns the course or
 * wrote the file is exactly who is meant to see a draft.
 */
const publicAndLive = and(isPublic, isPublished);
const resourceVisibleToStudent = or(publicAndLive, enrolledApproved);
const resourceVisibleToTeacher = or(publicAndLive, ownsCourse, isAuthor);

/*
 * A seat request climbs the ladder. The course must be live — the same term
 * `enrollment:request` carried on its own before prerequisites existed — and
 * where it names a prerequisite, the REQUESTING actor must hold an APPROVED
 * seat there. Composed and named once for the same reason `studentCourseVisible`
 * is: the generated permissions doc cites the composition verbatim.
 *
 * The second conjunct reads `prerequisiteCourseId` and `completedCourseIds`, so
 * the subject loader MUST carry both (actor.ts) — a subject that omits either
 * denies silently, which is LESSONS-LEARNED #15/#31.
 */
const studentSeatRequest = and(isPublished, hasCompletedPrerequisite);

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
    // Subject is the COURSE. A draft course cannot accumulate a waiting list, and
    // where the course names a prerequisite the requesting student must have
    // completed it (`studentSeatRequest` above). Admins keep `allow`: enrolling
    // someone by hand IS how a teacher's "I'll allow it" is exercised.
    STUDENT: studentSeatRequest,
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
  /*
   * Recording a completion, and taking it back.
   *
   * Both cells are `enrollment:approve` verbatim, and deliberately so: a teacher who
   * may seat a student may record that the seat was filled, and an admin who may seat
   * one by hand is the registrar of last resort for exactly the same reason. A
   * separate pair of rules would have been a place to write down who signs off a
   * qualification, and nothing in this repository answers that better than the rule
   * that already answers who may approve the seat it hangs on.
   *
   * `uncomplete` is a SEPARATE verb rather than a PATCH back to APPROVED, on the rule
   * quoted one cell above — "separate verb, separate audit action, separate
   * notification" — and the correction path is exactly where that rule earns its
   * keep. A status column written by two different URLs carries one audit action, so
   * the trail cannot distinguish "recorded a completion" from "erased one" and the
   * reader is left diffing two JSON blobs. A verb of its own writes its own row, and
   * a terminal state that cannot be corrected is a data-entry trap rather than a
   * safety property.
   */
  'enrollment:complete': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: ownsCourse,
    ADMIN: allow,
  },
  'enrollment:uncomplete': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: ownsCourse,
    ADMIN: allow,
  },

  // -------------------------------------------------------------------------
  // Attendance
  //
  // One action, two subject shapes, exactly as `enrollment:read` has one rule
  // and two loaders:
  //   - the COURSE, for marking and reading a whole register — `ownsCourse`
  //     scopes the teacher; a student's `isEnrolledStudent` reads an absent
  //     `studentId` there and denies, so nobody reads a class list one row at
  //     a time by guessing ids;
  //   - the ENROLLMENT row, for a student's own summary — `isEnrolledStudent`
  //     passes only when the summary is theirs.
  // -------------------------------------------------------------------------

  'attendance:mark': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: ownsCourse,
    ADMIN: allow,
  },
  'attendance:read': {
    anonymous: deny,
    STUDENT: isEnrolledStudent,
    TEACHER: ownsCourse,
    ADMIN: allow,
  },

  // -------------------------------------------------------------------------
  // Assignment
  //
  // Two actions covering the four verbs the module exposes (list, create, update,
  // delete), exactly as `course:update` already covers the three offering routes.
  // The subject shape differs by verb and that difference is the whole design:
  //   - `assignment:read` and `:create` act on the INTAKE, so a student is gated by
  //     `enrolledApproved` on `subject.enrollmentStatus` (the VIEWER's own status in
  //     that course) and a teacher by `ownsCourse` on `subject.courseTeacherId`;
  //   - `submission:read` and `:grade` act on ONE HAND-IN, whose subject carries the
  //     ENROLLMENT's `studentId`. That is the #31 shape this phase is named for: a
  //     student's rule reads a subject field, so a loader that forgets the join
  //     denies silently — and an absent field must DENY, in the safe direction.
  // -------------------------------------------------------------------------
  'assignment:read': {
    anonymous: deny,
    // A task set to a cohort is not a published syllabus, and an unpublished draft
    // intake is not a course. `enrolledApproved` reads `enrollmentStatus`, which the
    // subject loader scopes to the REQUESTING actor — a student without an APPROVED
    // seat denies here, as does a teacher who does not own the course and reads
    // nothing at all.
    STUDENT: enrolledApproved,
    TEACHER: ownsCourse,
    ADMIN: allow,
  },
  'assignment:create': {
    anonymous: deny,
    STUDENT: deny,
    // Scoped to the OFFERING named in the body, on the same reasoning as
    // `resource:create`: there is no row yet, and `ownsCourse` is precisely what
    // stops a teacher setting work on a colleague's intake by guessing an offeringId.
    //
    // It is also the gate for PATCH and DELETE. Three offering routes already ride
    // `course:update` (opening an intake IS editing the course); this is the same
    // economy, and the argument is the same one. The authority to SET work on an
    // intake is the authority to correct it and to withdraw it, and a verb per verb
    // would be three restatements of one rule that could drift apart — which is what
    // lesson 28 is about.
    //
    // A fifth action for `assignment:delete` was available and is deliberately NOT
    // taken. Deleting an assignment is a SOFT delete that leaves the hand-ins and
    // their grades standing for the register, which makes it a correction rather
    // than the destruction `course:delete` is; and adding the verb would put the
    // four-cell-per-role shape below out of step with a six-cell one for no
    // authorization gain.
    TEACHER: ownsCourse,
    ADMIN: allow,
  },

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------
  'submission:read': {
    anonymous: deny,
    /*
     * Own hand-ins only, and this is the cell the whole phase turns on.
     *
     * The subject is a SUBMISSION, and `studentId` is read off the ENROLLMENT the
     * hand-in was made on — deliberately not off a `studentId` column the submission
     * does not have, because a second copy of "who is this student" is a second
     * thing that can disagree with the register.
     *
     * An ABSENT `studentId` denies, which is the safe direction and also the
     * invisible one: a loader that forgets the join does not leak, it turns every
     * student's list empty with no log line and no type error (LESSONS-LEARNED #31,
     * which has cost three features). The same rule on a whole assignment is a
     * different answer — a teacher reads their class's work, and that is decided per
     * assignment by the list's WHERE clause rather than assembled one hand-in at a
     * time.
     */
    STUDENT: isEnrolledStudent,
    TEACHER: ownsCourse,
    ADMIN: allow,
  },
  'submission:grade': {
    anonymous: deny,
    STUDENT: deny,
    // The SAME cell as `submission:read` for a teacher, and deliberately so, on the
    // reasoning `enrollment:complete` states verbatim: the authority to read a
    // class's hand-ins is the authority to mark them. A narrower "grader" role would
    // be a place to write down who signs off a qualification, and nothing in this
    // repository answers that better than the rule that already answers who may read.
    TEACHER: ownsCourse,
    ADMIN: allow,
  },

  // -------------------------------------------------------------------------
  // Resource
  // -------------------------------------------------------------------------
  'resource:read': {
    anonymous: publicAndLive,
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
    // public resource on a PUBLISHED course exists, but pulling the bytes out of the
    // private bucket requires a session. That is the anti-scraping line, and it keeps
    // the anonymous surface to four actions — `course:read`, `resource:read`,
    // `department:read` and `department:list`.
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
  'user:create': {
    // The hiring verb. Self-service registration creates STUDENTS only
    // (auth.routes.ts register), so every teacher and admin in the system has to
    // arrive through this gate — which is why it is subject-free: provisioning is
    // decided by role alone, before any target exists to load a subject for.
    anonymous: deny,
    STUDENT: deny,
    TEACHER: deny,
    ADMIN: allow,
  },
  /*
   * Cohort import — the same verb as `user:create`, at the same authority.
   *
   * A separate action rather than a widening of `user:create`, and the reason is
   * the one that made the two differ: a bulk import is a DIFFERENT request shape
   * with different blast radius. It is capped at BULK_IMPORT_MAX_ROWS rather than
   * being one call, it is rate-limited on its own bucket rather than sharing
   * `/users`'s, and it answers a per-row result instead of a single 201. Those are
   * three separate decisions an operator has to be able to reason about, and a
   * matrix that cannot tell you which gate a request passed through cannot answer
   * "who created 60 accounts last Tuesday".
   *
   * Subject-free for the same reason `user:create` is — before the first row
   * exists there is no target to load — and therefore eligible for
   * SUBJECT_INDEPENDENT_ACTIONS, which is what lets the SPA gate the affordance
   * with a bare `can()` rather than building a subject it has no data for.
   */
  'user:bulk-create': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: deny,
    ADMIN: allow,
  },
  /*
   * Deleting your OWN account. `isSelf` for every role, ADMIN included.
   *
   * The ADMIN cell is the one worth arguing about, because `user:update` gives
   * ADMIN a bare `allow` and it would be consistent to do the same here. It would
   * also mean `POST /users/:id/delete` deletes anybody, which is not a thing this
   * product should have: an administrator who needs somebody gone has
   * `user:suspend`, which is reversible, leaves the enrolment record intact, and
   * writes its own audit verb. Self-service deletion is a different act with a
   * different consequence — it ends the account — so it stays self-only, and the
   * `not(isSelf)` guard `user:suspend` carries is deliberately NOT mirrored here
   * because the whole point of this verb is that it acts on the caller.
   */
  'user:delete': {
    anonymous: deny,
    STUDENT: isSelf,
    TEACHER: isSelf,
    ADMIN: isSelf,
  },
  /*
   * `GET /users/me/export` — a data-subject access request, satisfied by the API
   * instead of by a hand-written database query.
   *
   * Self-only for the same reason and with the same consequence as `user:read`:
   * the subject is the caller, the route takes no id, and an ADMIN gets no bypass
   * here. An admin who wants somebody's record has the directory; this verb exists
   * for the person whose record it is, and widening it would make a GDPR request
   * an export of a third party.
   */
  'user:export': {
    anonymous: deny,
    STUDENT: isSelf,
    TEACHER: isSelf,
    ADMIN: isSelf,
  },
  'user:suspend': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: deny,
    // Self-suspension would lock the last admin out of the instance.
    ADMIN: not(isSelf),
  },
  /*
   * The undo of `user:suspend`, and deliberately its mirror image: every cell is
   * terminal allow/deny decided by role alone, so no Subject field is read anywhere.
   * `not(isSelf)` is NOT carried over — an ACTIVE admin reinstating their own id is a
   * service-level no-op (there is nothing to reinstate), and a SUSPENDED session is
   * already refused by the status gate in can.ts before any role rule runs. The action
   * is subject-free for the same reason `user:create` is, which is what lets the SPA
   * gate its affordance with a bare `can('user:reinstate')`.
   */
  'user:reinstate': {
    anonymous: deny,
    STUDENT: deny,
    TEACHER: deny,
    ADMIN: allow,
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
    // The DETAIL view, which adds teacher and student head-counts. No logged-out
    // visitor needs those, so this stays closed and `department:list` carries the
    // public surface instead.
    anonymous: deny,
    STUDENT: allow,
    TEACHER: allow,
    ADMIN: allow,
  },
  'department:list': {
    /**
     * Registration needs department names before a session can exist: the sign-up
     * form's department select is required (`registerSchema.departmentId`) and is
     * filled from `GET /departments` while logged out. Denying it did not protect
     * anything — the same {id, name, slug} triple is already published inside every
     * course DTO on the anonymous catalogue — it just made self-registration
     * impossible.
     *
     * A separate action rather than opening `department:read`, because the two
     * answers genuinely differ: names for a dropdown are public, head-counts are not.
     * That distinction belongs in the matrix, where it is visible, rather than in a
     * service branch, where it is not.
     */
    anonymous: allow,
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

/**
 * The actions whose answer does not depend on the subject.
 *
 * Every other action resolves, for at least one caller class, to a rule that reads a
 * `Subject` field — and a rule that reads an absent field must deny. So asking
 * `can(actor, action)` with no subject for anything NOT in this list is a guaranteed
 * refusal dressed up as a permission check. That is not theoretical: gating a
 * navigation entry on `course:read` deleted the Courses link for every student and
 * teacher, and gating one on `conversation:read` deleted Messages for everyone
 * including admins, silently, because a denial and a typo look identical at runtime.
 *
 * Anything that must decide without a subject — a nav destination, a "can this role
 * use the feature at all" gate — may only use an action from here. The list is
 * hand-written so it can be a TYPE; `policy-matrix.test.ts` recomputes it from the
 * rules themselves and fails if the two disagree, so it cannot silently rot.
 */
export const SUBJECT_INDEPENDENT_ACTIONS = [
  'course:create',
  'announcement:create',
  'comment:read',
  'comment:create',
  'user:create',
  'user:bulk-create',
  'user:list',
  'user:reinstate',
  'department:read',
  'department:list',
  'department:create',
  'department:update',
  'department:delete',
  'upload:presign',
  'conversation:create',
  'conversation:join',
  'mfa:enroll',
  'mfa:verify',
  'mfa:disable',
  'audit:read',
] as const satisfies readonly Action[];

export type SubjectIndependentAction = (typeof SUBJECT_INDEPENDENT_ACTIONS)[number];

/** The rule names that ignore the subject entirely. */
const SUBJECT_FREE_RULE_NAMES: ReadonlySet<string> = new Set(['allow', 'deny']);

/** Recomputed from the rules, so the list above can be proved rather than trusted. */
export function computeSubjectIndependentActions(): Action[] {
  return ACTIONS.filter((action) => {
    const entry = POLICY[action];
    return (['anonymous', 'STUDENT', 'TEACHER', 'ADMIN'] as const).every((caller) =>
      SUBJECT_FREE_RULE_NAMES.has(entry[caller].ruleName),
    );
  });
}
