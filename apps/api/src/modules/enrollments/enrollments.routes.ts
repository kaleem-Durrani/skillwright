import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { paginated } from '@skillwright/shared';
import { authorize, requireActor } from '../../plugins/auth.plugin.js';
import {
  approveEnrollmentSchema,
  enrollmentSchema,
  idParamSchema,
  listEnrollmentsQuerySchema,
  rejectEnrollmentSchema,
  requestEnrollmentSchema,
  withdrawEnrollmentSchema,
} from './enrollments.schema.js';
import * as enrollmentService from './enrollments.service.js';

/**
 * A `SubjectLoader` receives the BARE FastifyRequest (auth.plugin.ts:94-96), not the
 * type-provider-narrowed one, so `request.params` and `request.body` are `unknown`
 * there. The two casts live here and nowhere else — handlers read the narrowed types.
 */
function idOf(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}

function courseIdOfBody(request: FastifyRequest): string {
  return (request.body as { courseId: string }).courseId;
}

const enrollmentsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /*
   * No `authorize('enrollment:read')` here, deliberately.
   *
   * A cross-course list has no single subject, and the gate with an empty one denies
   * every non-admin: `isEnrolledStudent` and `ownsCourse` both read absent fields and
   * a rule that reads an absent field must deny (actor.ts:46-51). So this route gates
   * on authentication and the policy becomes a WHERE clause — `visibilityWhere` in
   * the service, which mirrors policy.ts:160-165 row for row.
   */
  app.get(
    '/',
    {
      schema: {
        querystring: listEnrollmentsQuerySchema,
        response: { 200: paginated(enrollmentSchema) },
      },
    },
    async (request) => enrollmentService.list(requireActor(request), request.query),
  );

  app.post(
    '/',
    {
      schema: { body: requestEnrollmentSchema, response: { 201: enrollmentSchema } },
      // policy.ts:155 — the subject is the COURSE, not an enrollment: a draft course
      // cannot accumulate a waiting list.
      preHandler: authorize('enrollment:request', (request) =>
        enrollmentService.loadRequestedCourseSubject(courseIdOfBody(request)),
      ),
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await enrollmentService.requestEnrollment(requireActor(request), request.body)),
  );

  app.get(
    '/:id',
    {
      schema: { params: idParamSchema, response: { 200: enrollmentSchema } },
      preHandler: authorize('enrollment:read', (request) =>
        enrollmentService.loadEnrollmentSubject(idOf(request)),
      ),
    },
    async (request) => enrollmentService.getById(request.params.id),
  );

  app.post(
    '/:id/approve',
    {
      schema: {
        params: idParamSchema,
        body: approveEnrollmentSchema,
        response: { 200: enrollmentSchema },
      },
      preHandler: authorize('enrollment:approve', (request) =>
        enrollmentService.loadEnrollmentSubject(idOf(request)),
      ),
    },
    async (request) =>
      enrollmentService.approve(requireActor(request), request.params.id, request.body),
  );

  app.post(
    '/:id/reject',
    {
      schema: {
        params: idParamSchema,
        body: rejectEnrollmentSchema,
        response: { 200: enrollmentSchema },
      },
      preHandler: authorize('enrollment:reject', (request) =>
        enrollmentService.loadEnrollmentSubject(idOf(request)),
      ),
    },
    async (request) =>
      enrollmentService.reject(requireActor(request), request.params.id, request.body),
  );

  // policy.ts:178-185 denies TEACHER outright. Withdrawal is not an alias for reject.
  app.post(
    '/:id/withdraw',
    {
      schema: {
        params: idParamSchema,
        body: withdrawEnrollmentSchema,
        response: { 200: enrollmentSchema },
      },
      preHandler: authorize('enrollment:withdraw', (request) =>
        enrollmentService.loadEnrollmentSubject(idOf(request)),
      ),
    },
    async (request) =>
      enrollmentService.withdraw(requireActor(request), request.params.id, request.body),
  );
};

export default enrollmentsRoutes;
