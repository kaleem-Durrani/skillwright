/**
 * The resources module binds request and response shapes from @skillwright/shared
 * rather than declaring its own. A second definition of what a resource looks like
 * would drift from the SPA's within a sprint, and the drift would only surface at
 * runtime — as a response-validation 500, or worse, as a silently missing field.
 *
 * This file exists to name the exact subset the routes bind, so the wire surface of
 * the module is readable in one place. Helpers that are not wire shapes — `paginated`,
 * `paginationMeta`, `toSkipTake`, `Actor`, `Subject` — are imported straight from
 * '@skillwright/shared' at their point of use; re-exporting a function through here
 * would make this file look like an API when it is an index.
 *
 * Unlike enrollments.schema.ts there is NO local declaration here. That file owns a
 * `courseIdParamSchema` because its two course-nested routes are enrolment wire
 * surface; the one resource route that hangs off `/courses/:courseId`
 * (courses.routes.ts:210-230) binds the `courseIdParamSchema` the courses module
 * already declares, so a second copy would buy nothing.
 */
export {
  createResourceSchema,
  idParamSchema,
  listResourcesQuerySchema,
  resourceSchema,
  resourceTypeSchema,
  updateResourceSchema,
} from '@skillwright/shared';

export type {
  CreateResourceInput,
  IdParam,
  ListResourcesQuery,
  ResourceDto,
  ResourceTypeValue,
  UpdateResourceInput,
} from '@skillwright/shared';
