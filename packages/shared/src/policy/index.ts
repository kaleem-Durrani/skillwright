export type { Actor, ActorStatus, EnrollmentState, Provenance, Role, Subject } from './actor.js';
export { ACTOR_STATUSES, EMPTY_SUBJECT, PROVENANCES, ROLES } from './actor.js';

export type { Rule } from './combinators.js';
export {
  allow,
  and,
  deny,
  enrolledApproved,
  isAuthor,
  isEnrolledStudent,
  isParticipant,
  isPublic,
  isPublished,
  isSelf,
  isSender,
  not,
  notDeleted,
  or,
  ownsCourse,
  rule,
} from './combinators.js';

export type { Action, ActionRules, PolicyTable, SubjectIndependentAction } from './policy.js';
export {
  ACTIONS,
  POLICY,
  SUBJECT_INDEPENDENT_ACTIONS,
  computeSubjectIndependentActions,
  isAction,
} from './policy.js';

export type { PolicyResult } from './can.js';
export { PolicyError, allowed, assertCan, can } from './can.js';
