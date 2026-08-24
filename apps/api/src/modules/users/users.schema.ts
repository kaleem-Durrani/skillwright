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
 * `reinstateUserSchema` (user.ts:147) exists in shared and is NOT re-exported here:
 * there is no `user:reinstate` action in the Action union (policy.ts:27-84) and the SPA
 * does not call it. Naming it here would advertise a wire surface this module does not
 * serve. `createUserSchema` IS re-exported since Phase 4b wired `POST /users` behind
 * the `user:create` action.
 */
export {
  createUserSchema,
  listUsersQuerySchema,
  suspendUserSchema,
  updateUserSchema,
  userDetailSchema,
  // Supporting shapes the routes bind directly.
  idParamSchema,
} from '@skillwright/shared';

export type {
  CreateUserInput,
  ListUsersQuery,
  SuspendUserInput,
  UpdateUserInput,
  UserDetail,
  IdParam,
} from '@skillwright/shared';
