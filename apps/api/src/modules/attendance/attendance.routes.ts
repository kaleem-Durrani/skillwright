import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authorize, requireActor } from '../../plugins/auth.plugin.js';
import * as attendanceService from './attendance.service.js';
import {
  attendanceExportQuerySchema,
  attendanceRegisterSchema,
  attendanceSummarySchema,
  courseIdParamSchema,
  getRegisterQuerySchema,
  idParamSchema,
  markRegisterBodySchema,
  markRegisterResponseSchema,
} from './attendance.schema.js';

/**
 * A `SubjectLoader` receives the BARE FastifyRequest (auth.plugin.ts:94-96), so
 * `request.params` is `unknown` there. These casts live here and nowhere else —
 * handlers read the narrowed types.
 */
function courseIdOf(request: FastifyRequest): string {
  return (request.params as { courseId: string }).courseId;
}

function idOf(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}

const attendanceRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /*
   * This module spans two URL prefixes — the register hangs under /courses, a
   * student's own summary under /enrollments — so it registers at the API root
   * (app.ts) and spells each path in full. Splitting these across courses.routes.ts
   * and enrollments.routes.ts would scatter one domain's wire surface over other
   * modules' files; a module boundary and a URL prefix are not the same thing, but
   * they are also not strangers.
   *
   * Subject shapes mirror policy.ts's attendance rows:
   *   - mark / whole-register read act on the COURSE (`ownsCourse` scopes the
   *     teacher; `isEnrolledStudent` reads an absent `studentId` there and denies);
   *   - the personal summary acts on the ENROLLMENT row, so the same action lets a
   *     student read exactly their own.
   */
  app.put(
    '/courses/:courseId/attendance',
    {
      schema: {
        params: courseIdParamSchema,
        body: markRegisterBodySchema,
        response: { 200: markRegisterResponseSchema },
      },
      preHandler: authorize('attendance:mark', (request) =>
        attendanceService.loadCourseSubject(courseIdOf(request)),
      ),
    },
    async (request) =>
      attendanceService.markRegister(requireActor(request), request.params.courseId, request.body),
  );

  app.get(
    '/courses/:courseId/attendance',
    {
      schema: {
        params: courseIdParamSchema,
        querystring: getRegisterQuerySchema,
        response: { 200: attendanceRegisterSchema },
      },
      preHandler: authorize('attendance:read', (request) =>
        attendanceService.loadCourseSubject(courseIdOf(request)),
      ),
    },
    async (request) =>
      attendanceService.registerForDate(request.params.courseId, request.query.date),
  );

  /*
   * Phase 8: the register over a date range as a CSV stream. The gate is the
   * SINGLE-DATE READ'S — `attendance:read` with `loadCourseSubject` — so the file
   * cannot serve a row `GET …/attendance?date=` would refuse. No response schema and
   * no envelope: the handler returns a Readable (lib/csv.ts) that Fastify streams,
   * and Content-Disposition files it in the browser rather than navigating to it.
   */
  app.get(
    '/courses/:courseId/attendance/export',
    {
      schema: {
        params: courseIdParamSchema,
        querystring: attendanceExportQuerySchema,
      },
      preHandler: authorize('attendance:read', (request) =>
        attendanceService.loadCourseSubject(courseIdOf(request)),
      ),
    },
    async (request, reply) => {
      const { courseId } = request.params;
      const { from, to } = request.query;
      reply.type('text/csv; charset=utf-8').header(
        'content-disposition',
        // Filesystem-safe characters only; ids and bare dates need nothing escaped.
        `attachment; filename="attendance-${courseId}${from ? `-${from}` : ''}${to ? `-to-${to}` : ''}.csv"`,
      );
      return attendanceService.exportRegister(courseId, { from, to });
    },
  );

  app.get(
    '/enrollments/:id/attendance',
    {
      schema: {
        params: idParamSchema,
        response: { 200: attendanceSummarySchema },
      },
      preHandler: authorize('attendance:read', (request) =>
        attendanceService.loadEnrollmentSubject(idOf(request)),
      ),
    },
    async (request) => attendanceService.summaryForEnrollment(request.params.id),
  );
};

export default attendanceRoutes;
