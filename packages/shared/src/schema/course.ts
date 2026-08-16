import { z } from 'zod';
import { idSchema, isoDateTimeSchema, nullableIsoDateTimeSchema, slugSchema } from './common.js';
import { departmentSummarySchema } from './department.js';
import { paginationQuerySchema } from './pagination.js';
import { userSummarySchema } from './user.js';

export const durationUnitSchema = z.enum(['HOUR', 'DAY', 'WEEK', 'MONTH']);
export type DurationUnitValue = z.infer<typeof durationUnitSchema>;

/**
 * Duration is a value and a unit, never the free-text "6 months" the old system
 * stored — a string cannot be sorted, filtered or summed.
 */
export const durationSchema = z.object({
  value: z.number().int().min(1).max(1000),
  unit: durationUnitSchema,
});
export type Duration = z.infer<typeof durationSchema>;

/** Course code: uppercase letters then digits, e.g. `WELD-101`. */
export const courseCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2,8}-[0-9]{2,4}$/, 'Use a code like WELD-101.');

export const courseSummarySchema = z.object({
  id: idSchema,
  code: z.string(),
  slug: slugSchema,
  name: z.string(),
  department: departmentSummarySchema,
  teacher: userSummarySchema,
  duration: durationSchema,
  capacity: z.number().int(),
  approvedCount: z.number().int(),
  /** Derived, so the SPA never recomputes capacity arithmetic and drifts. */
  seatsRemaining: z.number().int(),
  isFull: z.boolean(),
  publishedAt: nullableIsoDateTimeSchema,
});
export type CourseSummary = z.infer<typeof courseSummarySchema>;

export const courseDetailSchema = courseSummarySchema.extend({
  description: z.string().nullable(),
  startDate: nullableIsoDateTimeSchema,
  endDate: nullableIsoDateTimeSchema,
  syllabusUploadId: idSchema.nullable(),
  syllabusUrl: z.string().url().nullable(),
  resourceCount: z.number().int(),
  /** The requesting actor's own enrollment state; null for anonymous or teachers. */
  viewerEnrollmentStatus: z
    .enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'COMPLETED'])
    .nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type CourseDetail = z.infer<typeof courseDetailSchema>;

/**
 * One row of the catalogue: the summary plus the two fields the browse screen renders
 * on every card — the blurb, and whether the viewer has already applied.
 *
 * It is a THIRD schema rather than two more fields on `courseSummarySchema`, and the
 * reason is `enrollmentSchema.course` (enrollment.ts:20): the summary is EMBEDDED in
 * other DTOs. `viewerEnrollmentStatus` is relative to whoever is asking, and nested
 * inside an enrollment — a row that already names its own student and status — it has
 * no meaning at all; it would read as a second, contradictory status on the same
 * record. A viewer-relative field belongs only to the top-level shape a viewer asked
 * for, which is this one and `courseDetailSchema`.
 *
 * The enum is taken from `courseDetailSchema` rather than restated so the catalogue and
 * the detail page can never drift apart. It cannot come from `enrollmentStatusSchema`
 * (enrollment.ts:7-13) instead: enrollment.ts imports this file, so importing it back
 * would be a cycle.
 */
export const courseListItemSchema = courseSummarySchema.extend({
  description: z.string().nullable(),
  viewerEnrollmentStatus: courseDetailSchema.shape.viewerEnrollmentStatus,
});
export type CourseListItem = z.infer<typeof courseListItemSchema>;

const courseDatesRefinement = (
  body: { startDate?: string | null | undefined; endDate?: string | null | undefined },
  ctx: z.RefinementCtx,
): void => {
  if (
    body.startDate !== undefined &&
    body.startDate !== null &&
    body.endDate !== undefined &&
    body.endDate !== null &&
    new Date(body.endDate).getTime() <= new Date(body.startDate).getTime()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'The end date must come after the start date.',
    });
  }
};

export const createCourseSchema = z
  .object({
    code: courseCodeSchema,
    name: z.string().trim().min(3).max(160),
    slug: slugSchema.optional(),
    description: z.string().trim().max(5000).optional(),
    departmentId: idSchema,
    /** Admin-only field; the API ignores it for a teacher, who always gets themself. */
    teacherId: idSchema.optional(),
    duration: durationSchema,
    capacity: z.number().int().min(1).max(10_000),
    startDate: z.string().datetime({ offset: true }).nullish(),
    endDate: z.string().datetime({ offset: true }).nullish(),
    syllabusUploadId: idSchema.optional(),
  })
  .superRefine(courseDatesRefinement);
export type CreateCourseInput = z.infer<typeof createCourseSchema>;

export const updateCourseSchema = z
  .object({
    name: z.string().trim().min(3).max(160),
    description: z.string().trim().max(5000).nullable(),
    departmentId: idSchema,
    teacherId: idSchema,
    duration: durationSchema,
    /** Lowering capacity below `approvedCount` is rejected by the DB CHECK, and by the service first. */
    capacity: z.number().int().min(1).max(10_000),
    startDate: z.string().datetime({ offset: true }).nullable(),
    endDate: z.string().datetime({ offset: true }).nullable(),
    syllabusUploadId: idSchema.nullable(),
  })
  .partial()
  .superRefine(courseDatesRefinement);
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;

/** Publish and unpublish are the same verb with a boolean, so both leave one audit shape. */
export const publishCourseSchema = z.object({ published: z.boolean() });
export type PublishCourseInput = z.infer<typeof publishCourseSchema>;

export const listCoursesQuerySchema = paginationQuerySchema.extend({
  departmentId: idSchema.optional(),
  teacherId: idSchema.optional(),
  /** Ignored for anonymous callers, who only ever see published courses. */
  published: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  hasSeats: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().min(1).max(120).optional(),
});
export type ListCoursesQuery = z.infer<typeof listCoursesQuerySchema>;
