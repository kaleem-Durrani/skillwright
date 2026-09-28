import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { paginated } from '@skillwright/shared';
import { authorize, requireActor } from '../../plugins/auth.plugin.js';
import {
  approveEnrollmentSchema,
  completeEnrollmentSchema,
  enrollmentSchema,
  exportEnrollmentsQuerySchema,
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
   * the service, which mirrors `POLICY`'s `enrollment:read` row for row.
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

  /*
   * Phase 8: the same list as a CSV register. The gate is the LIST'S — no
   * `authorize('enrollment:read')` here, for exactly the reason the route above
   * states: with no subject, both non-admin row rules read absent fields and deny,
   * which would 403 every legitimate caller (LESSONS-LEARNED #15). Authentication is
   * checked in the handler and the policy becomes the service's `visibilityWhere`,
   * so this file can never serve a row `GET /enrollments` would refuse.
   *
   * No response schema and no pagination envelope: the handler returns a Readable
   * (lib/csv.ts) that Fastify streams to the socket, so a full intake register is
   * never assembled in memory. Content-Disposition makes the browser file it rather
   * than navigate to it; the filename names its scope.
   */
  app.get(
    '/export',
    {
      schema: { querystring: exportEnrollmentsQuerySchema },
    },
    async (request, reply) => {
      const query = request.query;
      reply.type('text/csv; charset=utf-8').header(
        'content-disposition',
        // A bare id keeps the filename filesystem-safe; the course's name lives in
        // the first data rows anyway.
        `attachment; filename="enrollments${query.courseId ? `-${query.courseId}` : ''}.csv"`,
      );
      return enrollmentService.streamRegister(requireActor(request), query);
    },
  );

  app.post(
    '/',
    {
      schema: { body: requestEnrollmentSchema, response: { 201: enrollmentSchema } },
      // `enrollment:request` in `POLICY` — the subject is the COURSE, not an enrollment:
      // a draft course cannot accumulate a waiting list. The actor rides along so the subject can
      // carry the requester's completed courses for `hasCompletedPrerequisite`.
      preHandler: authorize('enrollment:request', (request) =>
        enrollmentService.loadRequestedCourseSubject(courseIdOfBody(request), request.actor),
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
        // `.nullish()`, not the bare schema: Fastify hands a POST sent with no body
        // to the validator as `null`, and an all-optional object rejects it — so a
        // bodyless approve answered 422 before `authorize` ran, and a caller who was
        // never entitled to this enrolment learned "malformed" instead of "forbidden".
        // Same reason as courses.routes.ts:165 and users.routes.ts:151.
        body: approveEnrollmentSchema.nullish(),
        response: { 200: enrollmentSchema },
      },
      preHandler: authorize('enrollment:approve', (request) =>
        enrollmentService.loadEnrollmentSubject(idOf(request)),
      ),
    },
    async (request) =>
      enrollmentService.approve(
        requireActor(request),
        request.params.id,
        request.body ?? undefined,
      ),
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

  // `enrollment:withdraw` in `POLICY` denies TEACHER outright. Withdrawal is not an
  // alias for reject.
  app.post(
    '/:id/withdraw',
    {
      schema: {
        params: idParamSchema,
        // `.nullish()` for the same reason as approve above: the reason is optional,
        // so a student who withdraws without giving one sends no body at all.
        body: withdrawEnrollmentSchema.nullish(),
        response: { 200: enrollmentSchema },
      },
      preHandler: authorize('enrollment:withdraw', (request) =>
        enrollmentService.loadEnrollmentSubject(idOf(request)),
      ),
    },
    async (request) =>
      enrollmentService.withdraw(
        requireActor(request),
        request.params.id,
        request.body ?? undefined,
      ),
  );

  /*
   * Recording a qualification, and taking it back.
   *
   * Two verbs and not a PATCH, on the rule policy.ts states for withdraw: a status
   * column written by one endpoint carries one audit action, and a reader asking
   * "which completions were erased" would find them filed as the same rows as the ones
   * that stand. It is also why the SPA will have two buttons to wire rather than a
   * status dropdown — and that is the honest shape for an irreversible-looking
   * correction, because a correction should look like one.
   */
  app.post(
    '/:id/complete',
    {
      schema: {
        params: idParamSchema,
        // `.nullish()`, never `.optional()` — the note is optional, so the caller
        // sends no body at all and Fastify hands the validator `null`. Same reason as
        // approve above, and the same regression it caused there (LESSONS-LEARNED #12
        // and #24: a 422 would reach the caller before `authorize` ever ran).
        body: completeEnrollmentSchema.nullish(),
        response: { 200: enrollmentSchema },
      },
      preHandler: authorize('enrollment:complete', (request) =>
        enrollmentService.loadEnrollmentSubject(idOf(request)),
      ),
    },
    async (request) =>
      enrollmentService.complete(
        requireActor(request),
        request.params.id,
        request.body ?? undefined,
      ),
  );

  app.post(
    '/:id/uncomplete',
    {
      schema: {
        params: idParamSchema,
        // Bodyless BY CONTRACT, so `.nullish()` rather than a schema: a reversal has
        // nothing to say, and a body schema that demanded an object would 422 the
        // exact caller this route exists to serve.
        body: completeEnrollmentSchema.nullish(),
        response: { 200: enrollmentSchema },
      },
      preHandler: authorize('enrollment:uncomplete', (request) =>
        enrollmentService.loadEnrollmentSubject(idOf(request)),
      ),
    },
    async (request) => enrollmentService.uncomplete(requireActor(request), request.params.id),
  );
};

export default enrollmentsRoutes;
