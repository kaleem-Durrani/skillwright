/**
 * The comments module binds request and response shapes from @skillwright/shared
 * rather than declaring its own. A second definition of what a comment looks like
 * would drift from the SPA's within a sprint, and the drift would only surface at
 * runtime — as a response-validation 500, or worse, as a silently missing field.
 *
 * This file exists to name the exact subset the routes bind, so the wire surface of
 * the module is readable in one place, on the same reasoning resources.schema.ts
 * states for itself. Helpers that are not wire shapes — `paginated`, `can`, `Actor`,
 * `Subject` — are imported straight from '@skillwright/shared' at their point of
 * use; re-exporting them through here would make this file look like an API when it
 * is an index.
 *
 * NO local declaration here, unlike enrollments.schema.ts's `courseIdParamSchema`:
 * every comment route hangs off the bare `/comments` prefix and takes only the
 * shared `idParamSchema` (`{ id }`), never a nested path segment.
 */
export {
  commentSchema,
  createCommentSchema,
  idParamSchema,
  listCommentsQuerySchema,
  updateCommentSchema,
} from '@skillwright/shared';

export type {
  CommentDto,
  CreateCommentInput,
  IdParam,
  ListCommentsQuery,
  UpdateCommentInput,
} from '@skillwright/shared';
