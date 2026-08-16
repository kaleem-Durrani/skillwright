/**
 * The courses module binds request shapes from @skillwright/shared rather than
 * declaring its own. A second definition of "what a login body is" would drift from
 * the SPA's within a sprint, and the drift would only surface at runtime.
 *
 * This file exists to name the exact subset the routes bind, so the wire surface of
 * the module is readable in one place.
 */
import { z } from 'zod';
import { idSchema } from '@skillwright/shared';

export {
  courseCodeSchema,
  courseDetailSchema,
  // The LIST response shape — the summary plus the blurb and the viewer's own enrollment
  // status (course.ts:60-81). Neither may live on `courseSummarySchema`, which is
  // embedded in `enrollmentSchema.course` (enrollment.ts:20).
  courseListItemSchema,
  // No route binds the summary directly any more; it is re-exported because it is the
  // nested piece of the two shapes that are bound, and modules read it from here.
  courseSummarySchema,
  createCourseSchema,
  durationSchema,
  durationUnitSchema,
  listCoursesQuerySchema,
  publishCourseSchema,
  updateCourseSchema,
  // Bound by the two enrollment routes that live under the /courses prefix. The
  // handlers call enrollments.service; only the wire shapes are named here.
  enrollmentSchema,
  listEnrollmentsQuerySchema,
  requestEnrollmentSchema,
  // Supporting shapes the routes bind directly.
  idParamSchema,
  paginated,
} from '@skillwright/shared';

export type {
  CourseDetail,
  CourseListItem,
  CourseSummary,
  CreateCourseInput,
  Duration,
  DurationUnitValue,
  ListCoursesQuery,
  PublishCourseInput,
  UpdateCourseInput,
  EnrollmentDto,
  ListEnrollmentsQuery,
  RequestEnrollmentInput,
  IdParam,
  Paginated,
  PaginationMeta,
} from '@skillwright/shared';

/**
 * The one exception to the re-export rule, and the reason is a gap in the shared
 * package: `@skillwright/shared` exports `idParamSchema` (`{ id }`, common.ts:6) and
 * `slugParamSchema` (`{ slug }`, common.ts:16) and nothing for a nested param name.
 * The leaf still comes from shared, so the cuid rule is not restated here.
 */
export const courseIdParamSchema = z.object({ courseId: idSchema });
