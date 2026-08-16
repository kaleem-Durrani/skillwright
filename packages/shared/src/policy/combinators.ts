import type { Actor, Subject } from './actor.js';

/**
 * A rule is a pure predicate that carries its own name.
 *
 * The name is the whole reason this is not a bare arrow function: when `can()`
 * denies, the caller gets the identifier of the rule that said no, which is what
 * turns a 403 body into something a developer can act on and what lets the
 * generated permissions matrix cite a rule per cell.
 */
export interface Rule {
  (actor: Actor | null, subject: Subject): boolean;
  readonly ruleName: string;
}

/**
 * Wraps a predicate with a stable name. Always allocates a new function object so
 * that naming one rule can never rename another that shares the same predicate.
 */
export function rule(
  ruleName: string,
  predicate: (actor: Actor | null, subject: Subject) => boolean,
): Rule {
  const wrapped = (actor: Actor | null, subject: Subject): boolean => predicate(actor, subject);
  return Object.defineProperty(wrapped, 'ruleName', {
    value: ruleName,
    enumerable: false,
    writable: false,
  }) as Rule;
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

/** Unconditional yes. Spelled out so a permissive cell is a deliberate keystroke. */
export const allow: Rule = rule('allow', () => true);

/** Unconditional no. */
export const deny: Rule = rule('deny', () => false);

/**
 * Subject belongs to the actor. Matches on `Subject.userId`, so the caller must
 * populate it — an absent `userId` denies rather than defaulting to the actor.
 */
export const isSelf: Rule = rule(
  'isSelf',
  (actor, subject) => actor !== null && subject.userId !== undefined && subject.userId === actor.id,
);

/**
 * Actor is the teacher of the course this subject hangs off. This is the rule that
 * stops teacher A from planting content in teacher B's course.
 */
export const ownsCourse: Rule = rule(
  'ownsCourse',
  (actor, subject) =>
    actor !== null && subject.courseTeacherId !== undefined && subject.courseTeacherId === actor.id,
);

/** Actor has an APPROVED enrollment in the relevant course. PENDING is not enough. */
export const enrolledApproved: Rule = rule(
  'enrolledApproved',
  (actor, subject) => actor !== null && subject.enrollmentStatus === 'APPROVED',
);

/** Actor wrote it. */
export const isAuthor: Rule = rule(
  'isAuthor',
  (actor, subject) =>
    actor !== null && subject.authorId !== undefined && subject.authorId === actor.id,
);

/** Actor is the student the enrollment row is about. */
export const isEnrolledStudent: Rule = rule(
  'isEnrolledStudent',
  (actor, subject) =>
    actor !== null && subject.studentId !== undefined && subject.studentId === actor.id,
);

/** Actor is an active participant of the conversation. */
export const isParticipant: Rule = rule(
  'isParticipant',
  (actor, subject) => actor !== null && (subject.participantIds?.includes(actor.id) ?? false),
);

/** Actor sent the message. */
export const isSender: Rule = rule(
  'isSender',
  (actor, subject) =>
    actor !== null && subject.senderId !== undefined && subject.senderId === actor.id,
);

/** Subject is live. Actor-independent, so it is the only thing anonymous reads lean on. */
export const isPublished: Rule = rule(
  'isPublished',
  (_actor, subject) => subject.publishedAt !== undefined && subject.publishedAt !== null,
);

/** `Resource.isPublic`. Actor-independent. */
export const isPublic: Rule = rule('isPublic', (_actor, subject) => subject.isPublic === true);

/** Subject has not been soft-deleted. */
export const notDeleted: Rule = rule(
  'notDeleted',
  (_actor, subject) => subject.deletedAt === undefined || subject.deletedAt === null,
);

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Short-circuiting disjunction. The composed name lists every branch, so a denial
 * reports `or(isPublic, enrolledApproved)` rather than an anonymous lambda.
 */
export function or(...rules: readonly Rule[]): Rule {
  const name = `or(${rules.map((r) => r.ruleName).join(', ')})`;
  return rule(name, (actor, subject) => rules.some((r) => r(actor, subject)));
}

/** Short-circuiting conjunction. */
export function and(...rules: readonly Rule[]): Rule {
  const name = `and(${rules.map((r) => r.ruleName).join(', ')})`;
  return rule(name, (actor, subject) => rules.every((r) => r(actor, subject)));
}

/** Negation. Used for `user:suspend`, where an admin must not be able to suspend themself. */
export function not(inner: Rule): Rule {
  return rule(`not(${inner.ruleName})`, (actor, subject) => !inner(actor, subject));
}
