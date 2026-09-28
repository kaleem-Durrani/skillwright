import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { paginated } from '@skillwright/shared';
import { authorize, requireActor } from '../../plugins/auth.plugin.js';
import {
  announcementDetailSchema,
  announcementSummarySchema,
  createAnnouncementSchema,
  idParamSchema,
  listAnnouncementsQuerySchema,
  publishAnnouncementSchema,
  updateAnnouncementSchema,
} from './announcements.schema.js';
import * as announcementsService from './announcements.service.js';

/**
 * A `SubjectLoader` receives the BARE FastifyRequest (auth.plugin.ts:106-108), not the
 * type-provider-narrowed one, so `request.params` is `unknown` there. The cast lives
 * here and nowhere else — handlers read the narrowed type instead.
 */
function idOf(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}

const announcementsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /*
   * No `authorize('announcement:read')` here, deliberately.
   *
   * A cross-post list has no single subject, and the gate with an empty one denies
   * EVERY caller including admins: `or(isPublished, isAuthor)` reads
   * `subject.publishedAt` and `subject.authorId`, both absent, and a rule that reads an
   * absent field must deny (actor.ts:49-51). The failure is silent in both directions —
   * nothing throws, nothing logs. docs/LESSONS-LEARNED.md #15 and #31 are the write-ups.
   *
   * So visibility is a WHERE clause instead: `visibilityWhere` in the service, which
   * mirrors policy.ts row for row. `GET /announcements/:id` below still runs the
   * per-row decision, because there it has a subject to run it against.
   *
   * `request.actor`, not `requireActor(request)`: the anonymous row of
   * `announcement:read` is `isPublished` (`POLICY`, anonymous), so a logged-out visitor is a
   * legitimate caller and gets the published feed.
   */
  app.get(
    '/',
    {
      schema: {
        querystring: listAnnouncementsQuerySchema,
        response: { 200: paginated(announcementSummarySchema) },
      },
    },
    async (request) => announcementsService.list(request.actor, request.query),
  );

  app.get(
    '/:id',
    {
      schema: { params: idParamSchema, response: { 200: announcementDetailSchema } },
      preHandler: authorize('announcement:read', (request) =>
        announcementsService.loadAnnouncementSubject(idOf(request)),
      ),
    },
    async (request) => announcementsService.getById(request.params.id),
  );

  app.post(
    '/',
    {
      schema: { body: createAnnouncementSchema, response: { 201: announcementDetailSchema } },
      // No subject loader: `announcement:create` is TEACHER/ADMIN `allow`
      // (`POLICY`) and is in `SUBJECT_INDEPENDENT_ACTIONS` — there is no row
      // yet to load a subject for, on the same shape as `course:create`
      // (courses.routes.ts:73).
      preHandler: authorize('announcement:create'),
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await announcementsService.create(requireActor(request), request.body)),
  );

  app.patch(
    '/:id',
    {
      schema: {
        params: idParamSchema,
        body: updateAnnouncementSchema,
        response: { 200: announcementDetailSchema },
      },
      preHandler: authorize('announcement:update', (request) =>
        announcementsService.loadAnnouncementSubject(idOf(request)),
      ),
    },
    async (request) => announcementsService.update(request.params.id, request.body),
  );

  app.post(
    '/:id/publish',
    {
      schema: {
        params: idParamSchema,
        body: publishAnnouncementSchema,
        response: { 200: announcementDetailSchema },
      },
      preHandler: authorize('announcement:publish', (request) =>
        announcementsService.loadAnnouncementSubject(idOf(request)),
      ),
    },
    async (request) =>
      announcementsService.publish(requireActor(request), request.params.id, request.body),
  );

  /*
   * SOFT delete — the service sets `deletedAt` and every read in it filters the
   * column.
   *
   * `announcement:delete` is in `DEMO_DENIED` (can.ts:24-30), so a demo session is
   * refused here with rule `provenance:DEMO` before the role rule is ever consulted.
   */
  app.delete(
    '/:id',
    {
      schema: { params: idParamSchema },
      preHandler: authorize('announcement:delete', (request) =>
        announcementsService.loadAnnouncementSubject(idOf(request)),
      ),
    },
    async (request, reply) => {
      await announcementsService.remove(request.params.id);
      return reply.status(204).send();
    },
  );
};

export default announcementsRoutes;
