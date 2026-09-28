import { z } from 'zod';
import { idSchema, isoDateTimeSchema, nullableIsoDateTimeSchema } from './common.js';
import { courseOfferingSchema, courseSummarySchema } from './course.js';
import { paginationQuerySchema } from './pagination.js';
import { userSummarySchema } from './user.js';

export const enrollmentStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
  'COMPLETED',
]);
export type EnrollmentStatusValue = z.infer<typeof enrollmentStatusSchema>;

export const enrollmentSchema = z.object({
  id: idSchema,
  status: enrollmentStatusSchema,
  student: userSummarySchema,
  /** The course TEMPLATE — identity and description only; no seat arithmetic. */
  course: courseSummarySchema,
  /**
   * The intake the seat is requested for. Since Phase 9 this is where the dates and
   * the guarded numbers live; a student may hold several rows across intakes of one
   * course, one per offering.
   */
  offering: courseOfferingSchema,
  requestedAt: isoDateTimeSchema,
  decidedAt: nullableIsoDateTimeSchema,
  decidedBy: userSummarySchema.nullable(),
  decisionNote: z.string().nullable(),
  /**
   * When the qualification was recorded, and by whom. Null on every row that is not
   * COMPLETED, and cleared again by `uncomplete` — which is what makes the pair
   * honest rather than two independently-editable fields that can disagree.
   */
  completedAt: nullableIsoDateTimeSchema,
  completedBy: userSummarySchema.nullable(),
});
export type EnrollmentDto = z.infer<typeof enrollmentSchema>;

/**
 * A seat request names an INTAKE. The student is never in the body — it is the
 * session's user. Admins acting on behalf of a student use `studentId`, which the API
 * accepts only for `ADMIN`.
 */
export const requestEnrollmentSchema = z.object({
  courseId: idSchema,
  offeringId: idSchema,
  studentId: idSchema.optional(),
  note: z.string().trim().max(500).optional(),
});
export type RequestEnrollmentInput = z.infer<typeof requestEnrollmentSchema>;

/** Approval carries no body beyond an optional note; capacity is checked server-side. */
export const approveEnrollmentSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ApproveEnrollmentInput = z.infer<typeof approveEnrollmentSchema>;

/** A rejection reason is mandatory — it is the only thing the student is shown. */
export const rejectEnrollmentSchema = z.object({
  reason: z.string().trim().min(4).max(500),
});
export type RejectEnrollmentInput = z.infer<typeof rejectEnrollmentSchema>;

export const withdrawEnrollmentSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type WithdrawEnrollmentInput = z.infer<typeof withdrawEnrollmentSchema>;

/**
 * Completion carries no body beyond an optional note, for the same reason approval
 * does: the decision the server can make alone is that the seat existed and the term
 * is over, and everything a teacher wants to say about it is a note.
 *
 * Unlike a rejection, the note is not shown to the student as THE reason — there is no
 * reason a student failed to finish, only a fact that they did — so it lands in
 * `decisionNote` the way an approval's does, and `uncomplete` takes it with it.
 */
export const completeEnrollmentSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type CompleteEnrollmentInput = z.infer<typeof completeEnrollmentSchema>;

export const listEnrollmentsQuerySchema = paginationQuerySchema.extend({
  courseId: idSchema.optional(),
  /** Narrows a course's list to one intake; without it every intake of the course is listed. */
  offeringId: idSchema.optional(),
  studentId: idSchema.optional(),
  status: enrollmentStatusSchema.optional(),
});
export type ListEnrollmentsQuery = z.infer<typeof listEnrollmentsQuerySchema>;
