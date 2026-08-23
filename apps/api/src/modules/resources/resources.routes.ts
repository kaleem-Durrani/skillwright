import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
// `downloadUrlResponseSchema` is declared in schema/upload.ts (upload.ts:107-113) and is
// shared with the uploads module, so it is imported straight from '@skillwright/shared'
// rather than through resources.schema.ts — that barrel names this module's OWN wire
// shapes, and a resource is not the only thing that will ever be handed back as a signed
// URL.
import { downloadUrlResponseSchema, paginated } from '@skillwright/shared';
import { authorize, requireActor } from '../../plugins/auth.plugin.js';
import {
  createResourceSchema,
  idParamSchema,
  listResourcesQuerySchema,
  resourceSchema,
  updateResourceSchema,
} from './resources.schema.js';
import * as resourceService from './resources.service.js';

/**
 * A `SubjectLoader` receives the BARE FastifyRequest (auth.plugin.ts:106-108), not the
 * type-provider-narrowed one, so `request.params` and `request.body` are `unknown`
 * there. The two casts live here and nowhere else — handlers read the narrowed types.
 */
function idOf(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}

function courseIdOfBody(request: FastifyRequest): string {
  return (request.body as { courseId: string }).courseId;
}

const resourcesRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /*
   * No `authorize('resource:read')` here, deliberately.
   *
   * A cross-course list has no single subject, and the gate with an empty one denies
   * EVERY caller including admins: `or(isPublic, enrolledApproved)` and
   * `or(isPublic, ownsCourse, isAuthor)` read `subject.isPublic`,
   * `subject.enrollmentStatus`, `subject.courseTeacherId` and `subject.authorId`, all of
   * which are absent, and a rule that reads an absent field must deny (actor.ts:49-51).
   * The failure is silent in both directions — nothing throws, nothing logs, and the
   * type system is perfectly happy. That exact mistake has shipped six times in this
   * repository; docs/LESSONS-LEARNED.md #15 is the write-up, and the same shape is
   * described in auth.plugin.ts:70-80.
   *
   * So visibility is a WHERE clause instead: `visibilityWhere` in the service, which
   * mirrors policy.ts:191-196 row for row. `GET /resources/:id` below still runs the
   * per-row decision, because there it has a subject to run it against.
   *
   * `request.actor` and not `requireActor(request)`: the anonymous row of
   * `resource:read` is `isPublic` (policy.ts:192), so a logged-out visitor is entitled
   * to the public shelf and a null actor is a legitimate caller rather than a 401.
   */
  app.get(
    '/',
    {
      schema: {
        querystring: listResourcesQuerySchema,
        response: { 200: paginated(resourceSchema) },
      },
    },
    async (request) => resourceService.list(request.actor, request.query),
  );

  app.post(
    '/',
    {
      schema: { body: createResourceSchema, response: { 201: resourceSchema } },
      // policy.ts:197-204 — the subject is the COURSE NAMED IN THE BODY, not a resource:
      // there is no row yet, and `ownsCourse` is what stops a teacher filing material
      // into a colleague's course by guessing a courseId. Same arrangement as
      // `enrollment:request` (enrollments.routes.ts:58-60).
      preHandler: authorize('resource:create', (request) =>
        resourceService.loadResourceCourseSubject(courseIdOfBody(request)),
      ),
    },
    // The author is `requireActor(request)`, never the body.
    async (request, reply) =>
      reply.status(201).send(await resourceService.create(requireActor(request), request.body)),
  );

  app.get(
    '/:id',
    {
      schema: { params: idParamSchema, response: { 200: resourceSchema } },
      // `request.actor` is passed to the loader so the subject can carry the caller's OWN
      // enrolment status; without it `enrolledApproved` can never fire and an approved
      // student is 403'd off a private resource in their own course.
      preHandler: authorize('resource:read', (request) =>
        resourceService.loadResourceSubject(idOf(request), request.actor),
      ),
    },
    async (request) => resourceService.getById(request.params.id),
  );

  /*
   * Deliberately NOT `resource:read`, and the difference is the whole point of the
   * endpoint: `resource:download` denies anonymous outright (policy.ts:217-226) where
   * `resource:read` gives them `isPublic` (policy.ts:192). A logged-out visitor may SEE
   * that a public resource exists and may not pull the bytes out of the private bucket.
   * That is the anti-scraping line, and it is why a logged-out caller is answered 401
   * here rather than 403 — `authorize` reports the missing session first
   * (auth.plugin.ts:121).
   *
   * The same loader as `GET /:id`, `request.actor` included for the same reason: without
   * the caller's own enrolment status `enrolledApproved` can never fire and an approved
   * student is 403'd off a private file in their own course.
   *
   * The signed URL comes back in a BODY rather than as a 302 to MinIO. A redirect is
   * opaque to the SPA's fetch layer, and `downloadUrlResponseSchema` also carries
   * `expiresAt` and `filename`, which a `Location` header cannot — the client names the
   * file it is offering and knows when the URL has gone stale, instead of retrying one
   * the object store has already stopped honouring.
   */
  app.get(
    '/:id/download',
    {
      schema: { params: idParamSchema, response: { 200: downloadUrlResponseSchema } },
      preHandler: authorize('resource:download', (request) =>
        resourceService.loadResourceSubject(idOf(request), request.actor),
      ),
    },
    async (request) => resourceService.buildDownloadUrl(request.params.id),
  );

  app.patch(
    '/:id',
    {
      schema: {
        params: idParamSchema,
        body: updateResourceSchema,
        response: { 200: resourceSchema },
      },
      preHandler: authorize('resource:update', (request) =>
        resourceService.loadResourceSubject(idOf(request), request.actor),
      ),
    },
    async (request) => resourceService.update(request.params.id, request.body),
  );

  /*
   * SOFT delete — the service sets `deletedAt` and every read in it filters the column.
   *
   * `resource:delete` is in DEMO_DENIED (can.ts:24-31), so a demo session is refused
   * here with rule `provenance:DEMO` before the role rule is ever consulted.
   */
  app.delete(
    '/:id',
    {
      schema: { params: idParamSchema },
      preHandler: authorize('resource:delete', (request) =>
        resourceService.loadResourceSubject(idOf(request), request.actor),
      ),
    },
    async (request, reply) => {
      await resourceService.remove(request.params.id);
      return reply.status(204).send();
    },
  );
};

export default resourcesRoutes;
