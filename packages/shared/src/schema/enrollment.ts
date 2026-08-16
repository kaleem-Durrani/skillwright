import { z } from 'zod';
import { idSchema, isoDateTimeSchema, nullableIsoDateTimeSchema } from './common.js';
import { courseSummarySchema } from './course.js';
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
  course: courseSummarySchema,
  requestedAt: isoDateTimeSchema,
  decidedAt: nullableIsoDateTimeSchema,
  decidedBy: userSummarySchema.nullable(),
  decisionNote: z.string().nullable(),
});
export type EnrollmentDto = z.infer<typeof enrollmentSchema>;

/**
 * The student is never in the body — it is the session's user. Admins acting on
 * behalf of a student use `studentId`, which the API accepts only for `ADMIN`.
 */
export const requestEnrollmentSchema = z.object({
  courseId: idSchema,
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

export const listEnrollmentsQuerySchema = paginationQuerySchema.extend({
  courseId: idSchema.optional(),
  studentId: idSchema.optional(),
  status: enrollmentStatusSchema.optional(),
});
export type ListEnrollmentsQuery = z.infer<typeof listEnrollmentsQuerySchema>;
