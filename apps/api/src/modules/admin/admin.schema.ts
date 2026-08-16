/**
 * The admin module binds request and response shapes from @skillwright/shared rather
 * than declaring its own, for the same reason courses and enrollments do: a second
 * definition of a wire shape drifts from the SPA's within a sprint, and the drift only
 * surfaces at runtime.
 *
 * This module is the one place that rule cannot be followed, and the exception is
 * declared below rather than assumed. Helpers that are not wire shapes — `paginated`,
 * `paginationMeta`, `toSkipTake`, `Actor`, `Subject` — would still be imported straight
 * from '@skillwright/shared' at their point of use; re-exporting a function through
 * here would make this file look like an API when it is an index. This module happens
 * to need none of them: `/admin/stats` takes no query, no params and no body.
 */
import { z } from 'zod';

/**
 * THE ONE LOCAL DECLARATION, and why it is allowed.
 *
 * The precedent is `courseIdParamSchema` (courses.schema.ts:49-55): a local zod
 * declaration is permitted only where '@skillwright/shared' genuinely has no export,
 * and it must still compose the shared leaf rules rather than restate them. Here there
 * is no shared export AND no shared leaf to compose — packages/shared/src/schema/index.ts
 * re-exports fourteen modules and none of them is a stats module, and a case-insensitive
 * search for `Stats` across packages/shared/src returns nothing. The shape is four
 * counters; `z.number().int()` is the whole rule, so there is nothing left to import.
 *
 * This SHOULD live in shared so the SPA infers it instead of hand-declaring it — see
 * the interface at apps/web/src/pages/AdminOverview.tsx:12-17, which is exactly the
 * "type hand-written on the client that the schema already describes" that
 * CONTRIBUTING.md:50 sends back. Moving it there is a change to packages/**, which is
 * not this module's to make.
 *
 * THE FOUR KEY NAMES ARE FIXED BY THE SPA AND MUST NOT BE RENAMED. AdminOverview.tsx
 * reads them at :51, :59, :67 and :74, and renders each through `{tile.value ?? 0}`
 * (:99) — so a renamed key does not fail, it renders a confident, wrong zero.
 */
export const adminStatsSchema = z.object({
  users: z.number().int(),
  suspendedUsers: z.number().int(),
  departments: z.number().int(),
  auditEventsToday: z.number().int(),
});

export type AdminStats = z.infer<typeof adminStatsSchema>;
