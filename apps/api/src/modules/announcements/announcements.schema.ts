/**
 * The announcements module binds request and response shapes from @skillwright/shared
 * rather than declaring its own, on the same reasoning as resources.schema.ts: a second
 * definition of what an announcement looks like would drift from the SPA's within a
 * sprint, and the drift would only surface at runtime — as a response-validation 500,
 * or worse, as a silently missing field.
 *
 * This file exists to name the exact subset the routes bind, so the wire surface of
 * the module is readable in one place. Helpers that are not wire shapes — `paginated`,
 * `paginationMeta`, `toSkipTake`, `Actor`, `Subject` — are imported straight from
 * '@skillwright/shared' at their point of use; re-exporting a function through here
 * would make this file look like an API when it is an index.
 *
 * `idParamSchema` is declared once in schema/common.ts and shared by every module that
 * names a single row by id; it is re-exported here rather than duplicated, exactly as
 * resources.schema.ts re-exports it.
 */
export {
  announcementDetailSchema,
  announcementSummarySchema,
  announcementTypeSchema,
  createAnnouncementSchema,
  idParamSchema,
  listAnnouncementsQuerySchema,
  publishAnnouncementSchema,
  updateAnnouncementSchema,
} from '@skillwright/shared';

export type {
  AnnouncementDetail,
  AnnouncementSummary,
  AnnouncementTypeValue,
  CreateAnnouncementInput,
  IdParam,
  ListAnnouncementsQuery,
  PublishAnnouncementInput,
  UpdateAnnouncementInput,
} from '@skillwright/shared';
