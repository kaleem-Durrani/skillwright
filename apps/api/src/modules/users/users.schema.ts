/**
 * The users module binds request and response shapes from @skillwright/shared rather
 * than declaring its own. A second definition of what a user body is would drift from
 * the SPA's within a sprint, and the drift would only surface at runtime.
 *
 * This file exists to name the exact subset the routes bind, so the wire surface of
 * the module is readable in one place. Helpers that are not wire shapes — `paginated`,
 * `paginationMeta`, `toSkipTake`, `Actor`, `Subject` — are imported straight from
 * '@skillwright/shared' at their point of use; re-exporting a function through here
 * would make this file look like an API when it is an index.
 *
 * There is NO local zod declaration in this file, deliberately. Every param this
 * module binds is `{ id }`, which common.ts:24 already exports as `idParamSchema` —
 * unlike courses/enrollments, which needed a `{ courseId }` shape shared has no export
 * for (courses.schema.ts:49-55). Adding one here would be restating a rule that exists.
 *
 * `reinstateUserSchema` (user.ts:147) was re-exported here from the day `user:reinstate`
 * shipped (Phase 5 of the UI roadmap): the action exists in the Action union, the route
 * binds it `.nullish()` like suspend, and the SPA's admin console calls it. It lives in
 * shared beside `suspendUserSchema` because the two are one decision written twice.
 * `createUserSchema` IS re-exported since Phase 4b wired `POST /users` behind
 * the `user:create` action.
 */
export {
  accountDeletionSchema,
  accountDeletionStatusSchema,
  bulkImportSchema,
  bulkImportResultSchema,
  createUserSchema,
  listUsersQuerySchema,
  reinstateUserSchema,
  suspendUserSchema,
  updateUserSchema,
  userDetailSchema,
  userExportSchema,
  // Supporting shapes the routes bind directly.
  idParamSchema,
} from '@skillwright/shared';

export type {
  AccountDeletionInput,
  AccountDeletionStatus,
  BulkImportInput,
  BulkImportResult,
  CreateUserInput,
  ListUsersQuery,
  ReinstateUserInput,
  SuspendUserInput,
  UpdateUserInput,
  UserDetail,
  IdParam,
} from '@skillwright/shared';
