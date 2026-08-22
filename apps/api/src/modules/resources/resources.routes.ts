import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { paginated } from '@skillwright/shared';
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

  /*
   * NOT BUILT, deliberately:
   *
   *   GET /resources/:id/download — `resource:download` exists in the Action union
   *                            (policy.ts:44) with its own row (policy.ts:217-226), and
   *                            it is strictly narrower than `resource:read`: anonymous is
   *                            `deny`, so a logged-out visitor may SEE that a public
   *                            resource exists but may not pull the bytes. The gate is
   *                            therefore already specified — `authorize('resource:download',
   *                            loadResourceSubject)` — and the SPA already computes it
   *                            client-side (CourseDetail.tsx:77-95).
   *
   *                            What is missing is the object store, not the policy. The
   *                            endpoint has to presign a time-limited GET against MinIO
   *                            from `Upload.key`/`Upload.bucket` (schema.prisma:396-397),
   *                            which means a bucket client, an expiry policy and a
   *                            decision about whether the URL is redirected to or returned
   *                            in a body — none of which exists anywhere in the API yet
   *                            (`toUserSummary` still carries a TODO(uploads) for the same
   *                            reason, lib/dto.ts:73-74).
   *
   *                            It also collides with a live schema conflict:
   *                            `Resource.uploadId` is `onDelete: SetNull` while migration
   *                            0002 adds `CHECK (num_nonnulls("uploadId","externalUrl") = 1)`,
   *                            so deleting an Upload nulls the column, the CHECK fails and
   *                            the DELETE aborts — NEXT.md:42 records it, and it is a
   *                            migration to resolve, not a route. Shipping a download URL
   *                            first would put real traffic on top of an unresolved
   *                            constraint. The uploads module owns both.
   */
};

export default resourcesRoutes;
