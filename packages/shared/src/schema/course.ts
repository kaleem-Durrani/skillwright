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

/**
 * One scheduled run of a course — an intake, a cohort. Phase 9 moved everything that
 * repeats per intake OFF `courseSummarySchema` and into this shape: dates and the
 * guarded seat numbers live on an offering because seats are sold per intake, not per
 * course.
 *
 * This base schema carries NO viewer-relative field, so it is safe to embed anywhere —
 * including inside an enrollment DTO, where "the viewer's status in this offering" is
 * already the enrollment's own `status` and a second copy would read as a
 * contradiction (the same reasoning course.ts documented for the pre-split summary).
 */
export const courseOfferingSchema = z.object({
  id: idSchema,
  startDate: nullableIsoDateTimeSchema,
  endDate: nullableIsoDateTimeSchema,
  /** Admissions bound on THIS intake. */
  capacity: z.number().int(),
  /** Second guarded bound; null means unbound — no workshop on this run. */
  workshopCapacity: z.number().int().nullable(),
  approvedCount: z.number().int(),
  /** Derived, so the SPA never recomputes capacity arithmetic and drifts. */
  seatsRemaining: z.number().int(),
  isFull: z.boolean(),
  /** Derived like `seatsRemaining`; null whenever the bound itself is null. */
  workshopSeatsRemaining: z.number().int().nullable(),
});
export type CourseOffering = z.infer<typeof courseOfferingSchema>;

/** The viewer-relative extension of an offering, used ONLY inside top-level course payloads a viewer asked for by id. */
const viewerOfferingStatusValues = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
  'COMPLETED',
] as const;

/**
 * An offering as it appears inside `courseDetail`/`courseListItem`: the offering's own
 * facts plus THE REQUESTING ACTOR'S enrollment state on that specific intake. Null for
 * anonymous callers, teachers and admins — exactly the old top-level rule.
 */
export const viewerCourseOfferingSchema = courseOfferingSchema.extend({
  viewerEnrollmentStatus: z.enum(viewerOfferingStatusValues).nullable(),
});
export type ViewerCourseOffering = z.infer<typeof viewerCourseOfferingSchema>;

/**
 * The course TEMPLATE as it is serialised anywhere. Since Phase 9 it names and
 * describes the course; it deliberately carries no seat arithmetic — ask the offerings.
 */
export const courseSummarySchema = z.object({
  id: idSchema,
  code: z.string(),
  slug: slugSchema,
  name: z.string(),
  department: departmentSummarySchema,
  teacher: userSummarySchema,
  duration: durationSchema,
  publishedAt: nullableIsoDateTimeSchema,
});
export type CourseSummary = z.infer<typeof courseSummarySchema>;

/**
 * The minimal naming block for a course's prerequisite — just enough for the UI
 * to say "Requires: SMAW Level 1" without a second fetch. Deliberately NOT the
 * whole `courseSummarySchema`: a summary embeds a department and a teacher, and
 * nesting a course inside a course that way would drag half the catalogue onto
 * every row.
 */
export const coursePrerequisiteSchema = z.object({
  id: idSchema,
  code: z.string(),
  name: z.string(),
});
export type CoursePrerequisite = z.infer<typeof coursePrerequisiteSchema>;

export const courseDetailSchema = courseSummarySchema.extend({
  description: z.string().nullable(),
  syllabusUploadId: idSchema.nullable(),
  syllabusUrl: z.string().url().nullable(),
  resourceCount: z.number().int(),
  /** The raw pointer, and the named block the enrol button reads. Both additive. */
  prerequisiteCourseId: idSchema.nullable(),
  prerequisite: coursePrerequisiteSchema.nullable(),
  /**
   * Every live intake of this course, soonest-start first. Each entry carries the
   * viewer's own status ON THAT INTAKE, so "you have a seat" and "this intake is full —
   * apply again for the spring cohort" are both answerable from one payload.
   */
  offerings: z.array(viewerCourseOfferingSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type CourseDetail = z.infer<typeof courseDetailSchema>;

/**
 * One row of the catalogue: the summary plus the blurb and every live intake with the
 * viewer's status on each.
 *
 * It is a THIRD schema rather than extra fields on `courseSummarySchema`, and the
 * reason is `enrollmentSchema.course` (enrollment.ts): the summary is EMBEDDED in other
 * DTOs. `viewerEnrollmentStatus` is relative to whoever is asking, and nested inside an
 * enrollment — a row that already names its own student and status — it has no meaning
 * at all. A viewer-relative field belongs only to the top-level shapes a viewer asked
 * for, which are this one and `courseDetailSchema`.
 *
 * The prerequisite block comes from `courseDetailSchema`'s shapes rather than being
 * restated, so the catalogue and the detail page can never drift apart.
 */
export const courseListItemSchema = courseSummarySchema.extend({
  description: z.string().nullable(),
  prerequisiteCourseId: courseDetailSchema.shape.prerequisiteCourseId,
  prerequisite: courseDetailSchema.shape.prerequisite,
  offerings: z.array(
    viewerCourseOfferingSchema.extend({
      // Same enum source as the detail page's offerings.
      viewerEnrollmentStatus:
        courseDetailSchema.shape.offerings.element.shape.viewerEnrollmentStatus,
    }),
  ),
});
export type CourseListItem = z.infer<typeof courseListItemSchema>;

const offeringDatesRefinement = (
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

/**
 * One intake in a create-course body. A course is created WITH its first intake(s) —
 * dates and capacity have nowhere else to live since Phase 9 — and may open several
 * intakes at once by sending more than one.
 */
export const createCourseOfferingInputSchema = z
  .object({
    capacity: z.number().int().min(1).max(10_000),
    /** Same ceiling as `capacity`; omitted means unbound — a lecture intake. */
    workshopCapacity: z.number().int().min(1).max(10_000).optional(),
    startDate: z.string().datetime({ offset: true }).nullish(),
    endDate: z.string().datetime({ offset: true }).nullish(),
  })
  .superRefine(offeringDatesRefinement);
export type CreateCourseOfferingInput = z.infer<typeof createCourseOfferingInputSchema>;

export const createCourseSchema = z.object({
  code: courseCodeSchema,
  name: z.string().trim().min(3).max(160),
  slug: slugSchema.optional(),
  description: z.string().trim().max(5000).optional(),
  departmentId: idSchema,
  /** Admin-only field; the API ignores it for a teacher, who always gets themself. */
  teacherId: idSchema.optional(),
  duration: durationSchema,
  /** At least one intake: a course without any has no dates and no seats. */
  offerings: z.array(createCourseOfferingInputSchema).min(1).max(50),
  syllabusUploadId: idSchema.optional(),
});
export type CreateCourseInput = z.infer<typeof createCourseSchema>;

/**
 * Edits the TEMPLATE. Seat numbers and dates are NOT here — they belong to intakes now;
 * retuning one means PATCH /courses/:courseId/offerings/:offeringId.
 */
export const updateCourseSchema = z
  .object({
    name: z.string().trim().min(3).max(160),
    description: z.string().trim().max(5000).nullable(),
    departmentId: idSchema,
    teacherId: idSchema,
    duration: durationSchema,
    syllabusUploadId: idSchema.nullable(),
    /**
     * Setting the ladder rung. Nullable, not just optional: explicit null CLEARS
     * the requirement. The service validates existence, non-self and acyclicity —
     * a foreign key the client chose is a 422, never a 500.
     */
    prerequisiteCourseId: idSchema.nullable(),
  })
  .partial();
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;

/**
 * Retunes ONE intake. Lowering either bound below `approvedCount` is refused by the
 * service first (a shrink would strand seating already committed); the CHECKs only
 * keep the stored row sane.
 */
export const updateCourseOfferingInputSchema = z
  .object({
    capacity: z.number().int().min(1).max(10_000),
    /**
     * Nullable, not just optional: explicit null CLEARS it — an intake that loses
     * its workshop degrades to unbound.
     */
    workshopCapacity: z.number().int().min(1).max(10_000).nullable(),
    startDate: z.string().datetime({ offset: true }).nullable(),
    endDate: z.string().datetime({ offset: true }).nullable(),
  })
  .partial()
  .superRefine(offeringDatesRefinement);
export type UpdateCourseOfferingInput = z.infer<typeof updateCourseOfferingInputSchema>;

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
  /** True narrows to courses with at least one live intake that still has seats. */
  hasSeats: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().min(1).max(120).optional(),
});
export type ListCoursesQuery = z.infer<typeof listCoursesQuerySchema>;
