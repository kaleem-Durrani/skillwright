/**
 * The enrollments module binds request and response shapes from @skillwright/shared
 * rather than declaring its own. A second definition of what a login body is would
 * drift from the SPA's within a sprint, and the drift would only surface at runtime.
 *
 * This file exists to name the exact subset the routes bind, so the wire surface of
 * the module is readable in one place. Helpers that are not wire shapes — `paginated`,
 * `paginationMeta`, `toSkipTake`, `Actor`, `Subject` — are imported straight from
 * '@skillwright/shared' at their point of use; re-exporting a function through here
 * would make this file look like an API when it is an index.
 */
import { z } from 'zod';
import { idSchema, listEnrollmentsQuerySchema } from '@skillwright/shared';

/**
 * THE ONE LOCAL DECLARATION, and the reason it is allowed.
 *
 * `@skillwright/shared/schema` exports `idParamSchema` (`{ id }`) and
 * `slugParamSchema` (`{ slug }`) from common.ts:6,16 and nothing for a nested param
 * name — there is no shared `{ courseId }`. The leaf rule is still imported so the
 * cuid definition is not restated here.
 *
 * It lives in this module because the two course-nested routes,
 * `GET`/`POST /courses/:courseId/enrollments`, are enrollment wire surface even
 * though they are DECLARED under the /courses prefix in courses.routes.ts.
 */
export const courseIdParamSchema = z.object({ courseId: idSchema });
export type CourseIdParam = z.infer<typeof courseIdParamSchema>;

/**
 * The query `GET /enrollments/export` binds — the list's filters and ordering with the
 * paging keys dropped, because a register is one file, not pages.
 *
 * Derived from `listEnrollmentsQuerySchema` rather than restated, so a filter added to
 * the list arrives here automatically; an export that silently ignored a filter the
 * list honours would serve rows the caller did not ask for under the name of the ones
 * they had. The CSV endpoints are API-local wire surface (the audit.schema.ts:1-18
 * argument), so this declaration is not migrated into @skillwright/shared.
 */
export const exportEnrollmentsQuerySchema = listEnrollmentsQuerySchema.omit({
  page: true,
  limit: true,
});
export type ExportEnrollmentsQuery = z.infer<typeof exportEnrollmentsQuerySchema>;

export {
  approveEnrollmentSchema,
  enrollmentSchema,
  enrollmentStatusSchema,
  idParamSchema,
  listEnrollmentsQuerySchema,
  rejectEnrollmentSchema,
  requestEnrollmentSchema,
  withdrawEnrollmentSchema,
} from '@skillwright/shared';

export type {
  ApproveEnrollmentInput,
  CourseSummary,
  DepartmentSummary,
  EnrollmentDto,
  EnrollmentStatusValue,
  IdParam,
  ListEnrollmentsQuery,
  RejectEnrollmentInput,
  RequestEnrollmentInput,
  UserSummary,
  WithdrawEnrollmentInput,
} from '@skillwright/shared';
