/**
 * The dashboard module binds its wire shape from this file, the same way every other
 * module does — except that here there is nothing in @skillwright/shared to re-export.
 *
 * THE GAP, stated so the next reader does not go looking for the import that "must"
 * exist: `packages/shared/src/schema/index.ts:7-21` exports errors, common, pagination,
 * user, department, course, enrollment, upload, resource, announcement, comment,
 * message, conversation, notification and auth. There is no stats or dashboard module,
 * and a case-insensitive search for `dashboard|stats` across `packages/shared/src`
 * returns nothing. So the response shape is DECLARED here rather than re-exported.
 *
 * This is the same exception courses.schema.ts:49-55 takes for `courseIdParamSchema`,
 * and it carries the same obligation: it is the exception, not the rule. The moment
 * `@skillwright/shared` grows a `dashboardStatsSchema`, this declaration is deleted and
 * the shared one is re-exported in its place — otherwise the SPA and the API end up
 * with two definitions of the same four numbers, which drift and only surface at
 * runtime.
 *
 * Helpers that are not wire shapes — `Actor`, `paginated`, `toSkipTake` — are imported
 * straight from '@skillwright/shared' at their point of use rather than through here;
 * re-exporting a function would make this file look like an API when it is an index.
 */
import { z } from 'zod';

/**
 * The four counters the dashboard tiles render.
 *
 * The key names are FIXED by the client contract: `apps/web/src/lib/types.ts:120-125`
 * declares `DashboardStats`, and `Dashboard.tsx:53,57,63,66` reads
 * `stats.data?.courses`, `.pendingEnrollments`, `.unreadMessages` and `.resources`.
 * Renaming any of them renders "0" in a tile rather than failing loudly, so they are
 * not renamed.
 *
 * `z.number().int()` and not `z.number()`: counter 3 comes from raw SQL, and a
 * Postgres `COUNT(*)` that was not cast to `int` arrives as a JS BigInt. The integer
 * check is the second line of defence behind the `::int` in the SQL itself.
 */
export const dashboardStatsSchema = z.object({
  courses: z.number().int(),
  pendingEnrollments: z.number().int(),
  unreadMessages: z.number().int(),
  resources: z.number().int(),
});

export type DashboardStats = z.infer<typeof dashboardStatsSchema>;
