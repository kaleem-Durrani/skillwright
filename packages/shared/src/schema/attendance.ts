import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.js';
import { userSummarySchema } from './user.js';

/**
 * Presence, not assessment. The plan cuts certificates and grading explicitly;
 * this enum records supervised contact hours and reserves nothing else.
 */
export const attendanceStatusSchema = z.enum(['PRESENT', 'ABSENT', 'LATE']);
export type AttendanceStatusValue = z.infer<typeof attendanceStatusSchema>;

/**
 * A bare calendar date, `YYYY-MM-DD`. A session date is a DAY, not an instant —
 * no timezone arithmetic belongs anywhere near it.
 */
export const sessionDateSchema = z.string().date();
export type SessionDate = z.infer<typeof sessionDateSchema>;

/** One row of a register submission. */
export const attendanceMarkSchema = z.object({
  enrollmentId: idSchema,
  status: attendanceStatusSchema,
  note: z.string().trim().max(500).optional(),
});
export type AttendanceMarkInput = z.infer<typeof attendanceMarkSchema>;

/**
 * A whole register in one request, because an instructor marks a class, not a
 * row. Re-submitting the same date CORRECTS via the
 * `@@unique([enrollmentId, sessionDate])` upsert rather than duplicating.
 */
export const markRegisterBodySchema = z.object({
  date: sessionDateSchema,
  marks: z.array(attendanceMarkSchema).min(1).max(500),
});
export type MarkRegisterInput = z.infer<typeof markRegisterBodySchema>;

export const getRegisterQuerySchema = z.object({ date: sessionDateSchema });
export type GetRegisterQuery = z.infer<typeof getRegisterQuerySchema>;

/** A stored record, as serialised on its own or inside a summary. */
export const attendanceRecordSchema = z.object({
  id: idSchema,
  enrollmentId: idSchema,
  sessionDate: isoDateTimeSchema,
  status: attendanceStatusSchema,
  note: z.string().nullable(),
  markedBy: userSummarySchema.nullable(),
});
export type AttendanceRecordDto = z.infer<typeof attendanceRecordSchema>;

/**
 * One roster row of a register read: who sits here, and what (if anything) was
 * recorded for them on this date. `status: null` means not yet marked.
 */
export const attendanceRegisterRowSchema = z.object({
  enrollmentId: idSchema,
  student: userSummarySchema,
  status: attendanceStatusSchema.nullable(),
  note: z.string().nullable(),
  markedBy: userSummarySchema.nullable(),
});
export type AttendanceRegisterRow = z.infer<typeof attendanceRegisterRowSchema>;

export const attendanceRegisterSchema = z.object({
  date: sessionDateSchema,
  rows: z.array(attendanceRegisterRowSchema),
});
export type AttendanceRegisterDto = z.infer<typeof attendanceRegisterSchema>;

/** What marking a register wrote back — same shape as reading it back. */
export const markRegisterResponseSchema = attendanceRegisterSchema;
export type MarkRegisterResponse = AttendanceRegisterDto;

export const attendanceCountsSchema = z.object({
  present: z.number().int().nonnegative(),
  absent: z.number().int().nonnegative(),
  late: z.number().int().nonnegative(),
});
export type AttendanceCounts = z.infer<typeof attendanceCountsSchema>;

/** A student's own attendance on one enrollment: totals plus the recent rows. */
export const attendanceSummarySchema = z.object({
  counts: attendanceCountsSchema,
  total: z.number().int().nonnegative(),
  recent: z.array(attendanceRecordSchema),
});
export type AttendanceSummaryDto = z.infer<typeof attendanceSummarySchema>;
