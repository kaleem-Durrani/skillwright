import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { searchResponseSchema, searchQuerySchema } from './search.schema.js';
import * as searchService from './search.service.js';

const searchRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /*
   * No `authorize()` here, deliberately — the dashboard module's reasoning, applied to
   * a second mixed-audience endpoint (dashboard.routes.ts is the write-up; only the
   * short version belongs here).
   *
   * A cross-entity search has no single subject: the route spans three models whose
   * read actions are all Subject-dependent for at least one role (`isPublished`,
   * `isPublic`, `enrolledApproved`, `ownsCourse`, `isAuthor`). Borrowing any ONE
   * entity's action would be lesson #31's category error — `can('resource:read', <a
   * page of mixed rows>)` reads fields a course or announcement does not carry and
   * denies callers who are entitled to part of what they asked for. And inventing
   * `search:read` would cost matrix cells plus a regenerated docs/permissions.md for a
   * gate whose only honest answer is "is there a subject at all" — the row scoping
   * lives in the WHERE clauses either way.
   *
   * So there is no yes/no gate at all, exactly like `GET /courses`, `GET /resources`
   * and `GET /announcements` (LESSONS-LEARNED #15: a list gets a WHERE clause, never a
   * subject gate). Each group is narrowed by its own module's imported
   * `visibilityWhere` inside search.service.ts. Anonymous callers are legitimate: every
   * anonymous branch of those mirrors serves the public catalogue/shelf/feed, and this
   * endpoint can leak nothing they would not already show.
   *
   * Skipping `authorize()` does NOT skip session-state gates — MFA_PENDING, SUSPENDED
   * and PENDING_VERIFICATION are enforced centrally by auth.plugin.ts's onRequest hook
   * for every route.
   *
   * `request.actor`, not `requireActor(request)`: null means anonymous, a real caller.
   */
  app.get(
    '/',
    {
      schema: {
        querystring: searchQuerySchema,
        response: { 200: searchResponseSchema },
      },
    },
    async (request) => searchService.search(request.actor, request.query),
  );
};

export default searchRoutes;
