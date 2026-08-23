import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { paginated } from '@skillwright/shared';
import { authorize, requireActor } from '../../plugins/auth.plugin.js';
import {
  commentSchema,
  createCommentSchema,
  idParamSchema,
  listCommentsQuerySchema,
  updateCommentSchema,
} from './comments.schema.js';
import * as commentService from './comments.service.js';

/**
 * A `SubjectLoader` receives the BARE FastifyRequest (auth.plugin.ts), not the
 * type-provider-narrowed one, so `request.params` is `unknown` there. The cast
 * lives here and nowhere else — handlers below read the narrowed type instead.
 */
function idOf(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}

const commentsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /*
   * No `authorize('comment:read')` here, deliberately, even though every cell of
   * that action is subject-independent (`SUBJECT_INDEPENDENT_ACTIONS`, policy.ts).
   * A list spanning one resource's or announcement's whole thread has no single
   * subject a per-row rule could run against, and `comment:read` itself decides
   * nothing about which rows come back anyway — it is `allow` for every
   * authenticated role. What actually bounds the rows is the PARENT's visibility,
   * enforced as a WHERE clause in `commentService.list` (`listWhere`, mirroring
   * `resource:read`/`announcement:read`) — see docs/LESSONS-LEARNED.md #33.
   *
   * `requireActor`, not `request.actor`: `comment:read`'s anonymous cell is `deny`
   * (policy.ts) — comments are never part of the logged-out surface, even on a
   * published announcement — so a missing session is a 401 here, not an empty page.
   */
  app.get(
    '/',
    {
      schema: {
        querystring: listCommentsQuerySchema,
        response: { 200: paginated(commentSchema) },
      },
    },
    async (request) => commentService.list(requireActor(request), request.query),
  );

  app.post(
    '/',
    {
      schema: { body: createCommentSchema, response: { 201: commentSchema } },
      // `comment:create` (policy.ts) is role-only — deny anonymous, allow every
      // authenticated role — so no subject loader here: there is no row yet, and
      // WHICH parent the caller may attach to is a business rule the service
      // enforces against `resource:read`/`announcement:read`, not this action.
      preHandler: authorize('comment:create'),
    },
    // The author is `requireActor(request)`, never the body.
    async (request, reply) =>
      reply.status(201).send(await commentService.create(requireActor(request), request.body)),
  );

  app.patch(
    '/:id',
    {
      schema: {
        params: idParamSchema,
        body: updateCommentSchema,
        response: { 200: commentSchema },
      },
      preHandler: authorize('comment:update', (request) =>
        commentService.loadCommentSubject(idOf(request)),
      ),
    },
    async (request) =>
      commentService.update(request.params.id, requireActor(request), request.body),
  );

  /*
   * SOFT delete — the service sets `deletedAt` and every read filters the column.
   *
   * `comment:delete` is in DEMO_DENIED (can.ts), so a demo session is refused here
   * with rule `provenance:DEMO` before the role rule — `isAuthor` for a student,
   * `or(isAuthor, ownsCourse)` for a teacher moderating their own course, `allow`
   * for an admin — is ever consulted.
   */
  app.delete(
    '/:id',
    {
      schema: { params: idParamSchema },
      preHandler: authorize('comment:delete', (request) =>
        commentService.loadCommentSubject(idOf(request)),
      ),
    },
    async (request, reply) => {
      await commentService.remove(request.params.id);
      return reply.status(204).send();
    },
  );
};

export default commentsRoutes;
