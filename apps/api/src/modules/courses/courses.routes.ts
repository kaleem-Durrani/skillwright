import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authorize, requireActor } from '../../plugins/auth.plugin.js';
// The two enrollment routes below live under the /courses prefix because that is the
// URL the SPA calls (CourseDetail.tsx:65,70). A URL prefix is not a module boundary:
// they are declared here and served by the enrollments module, which stays the single
// owner of enrollment logic. The plugin itself is registered once, under /enrollments.
import * as enrollmentsService from '../enrollments/enrollments.service.js';
import {
  courseIdParamSchema,
  courseDetailSchema,
  courseListItemSchema,
  createCourseSchema,
  enrollmentSchema,
  idParamSchema,
  listCoursesQuerySchema,
  listEnrollmentsQuerySchema,
  paginated,
  publishCourseSchema,
  requestEnrollmentSchema,
  updateCourseSchema,
} from './courses.schema.js';
import * as courseService from './courses.service.js';

/**
 * `request.params` is only narrowed by the type provider inside a handler. A
 * SubjectLoader receives the bare `FastifyRequest` (auth.plugin.ts:94-96), so the cast
 * lives here — at the one site that needs it — and never in a handler.
 */
function idOf(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}

function courseIdOf(request: FastifyRequest): string {
  return (request.params as { courseId: string }).courseId;
}

const coursesRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // The catalogue is anonymous-reachable, so there is no authorize() here: the rule
  // set is a WHERE clause rather than a yes/no, and the service builds it from the
  // possibly-null actor.
  //
  // The row is `courseListItemSchema`, which is `courseSummarySchema` plus the blurb and
  // the viewer's own enrollment status — the badge that tells a student which courses
  // they have already applied to. The status is per-VIEWER, so the response is not
  // shared-cacheable; nothing here sets a public Cache-Control today, and nothing should.
  app.get(
    '/',
    {
      schema: {
        querystring: listCoursesQuerySchema,
        response: { 200: paginated(courseListItemSchema) },
      },
    },
    async (request) => courseService.list(request.actor, request.query),
  );

  app.post(
    '/',
    {
      schema: { body: createCourseSchema, response: { 201: courseDetailSchema } },
      preHandler: authorize('course:create'),
    },
    async (request, reply) =>
      reply.status(201).send(await courseService.create(requireActor(request), request.body)),
  );

  app.get(
    '/:id',
    {
      schema: { params: idParamSchema, response: { 200: courseDetailSchema } },
      preHandler: authorize('course:read', (request) =>
        courseService.loadCourseSubjectForActor(idOf(request), request.actor),
      ),
    },
    async (request) => courseService.getById(request.actor, request.params.id),
  );

  app.patch(
    '/:id',
    {
      schema: {
        params: idParamSchema,
        body: updateCourseSchema,
        response: { 200: courseDetailSchema },
      },
      preHandler: authorize('course:update', (request) =>
        courseService.loadCourseSubject(idOf(request)),
      ),
    },
    async (request) => courseService.update(requireActor(request), request.params.id, request.body),
  );

  app.post(
    '/:id/publish',
    {
      schema: {
        params: idParamSchema,
        body: publishCourseSchema,
        response: { 200: courseDetailSchema },
      },
      preHandler: authorize('course:publish', (request) =>
        courseService.loadCourseSubject(idOf(request)),
      ),
    },
    async (request) =>
      courseService.publish(requireActor(request), request.params.id, request.body),
  );

  app.delete(
    '/:id',
    {
      schema: { params: idParamSchema },
      preHandler: authorize('course:delete', (request) =>
        courseService.loadCourseSubject(idOf(request)),
      ),
    },
    async (request, reply) => {
      await courseService.remove(request.params.id);
      return reply.status(204).send();
    },
  );

  // --- Enrollments under a course -------------------------------------------

  app.get(
    '/:courseId/enrollments',
    {
      schema: {
        params: courseIdParamSchema,
        // The path owns the course; a client-supplied `courseId` is dropped rather
        // than allowed to disagree with the one that was just authorized.
        querystring: listEnrollmentsQuerySchema.omit({ courseId: true }),
        response: { 200: paginated(enrollmentSchema) },
      },
      preHandler: authorize('enrollment:read', (request) =>
        courseService.loadCourseEnrollmentSubject(courseIdOf(request), request.actor),
      ),
    },
    // The gate above passes for any student (`isEnrolledStudent` matches the subject's
    // own `studentId`), so the enrollments service is what narrows a STUDENT's rows to
    // their own — it owns that WHERE clause, and duplicating it here would give the
    // rule two homes.
    async (request) =>
      enrollmentsService.listForCourse(
        requireActor(request),
        request.params.courseId,
        request.query,
      ),
  );

  app.post(
    '/:courseId/enrollments',
    {
      schema: {
        params: courseIdParamSchema,
        // The SPA posts no body at all (CourseDetail.tsx:70) while
        // `requestEnrollmentSchema` requires `courseId`, so the path supplies it and
        // the rest of the body is optional. There is no shared schema for this shape.
        // `.nullish()`, not `.optional()`: Fastify hands a bodyless POST to the
        // validator as `null`, which `.optional()` rejects — so the SPA's own call
        // answered 422 before the policy gate ever ran.
        body: requestEnrollmentSchema.omit({ courseId: true }).nullish(),
        response: { 201: enrollmentSchema },
      },
      // Subject is the COURSE: a draft course cannot accumulate a waiting list
      // (policy.ts:153-159).
      preHandler: authorize('enrollment:request', (request) =>
        courseService.loadCourseEnrollmentSubject(courseIdOf(request), request.actor),
      ),
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await enrollmentsService.requestForCourse(
            requireActor(request),
            request.params.courseId,
            request.body ?? undefined,
          ),
        ),
  );
};

export default coursesRoutes;
