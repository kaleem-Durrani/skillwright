import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authorize } from '../../plugins/auth.plugin.js';
import {
  createDepartmentSchema,
  departmentDetailSchema,
  departmentSummarySchema,
  idParamSchema,
  listDepartmentsQuerySchema,
  paginated,
  updateDepartmentSchema,
} from './departments.schema.js';
import * as departmentService from './departments.service.js';

/**
 * Departments are the one module whose whole policy surface is role-only: every cell
 * of policy.ts:328-354 is `allow` or `deny`, so each route is fully gated by a bare
 * `authorize(action)` and no handler needs `requireActor` — `authorize` has already
 * thrown `unauthenticated()` for a null actor by the time a handler runs, and no
 * service below reads the caller.
 *
 * The two reads are guarded by DIFFERENT actions on purpose. `GET /` answers
 * `department:list`, which anonymous callers may perform because Register.tsx fills a
 * required department select before any session exists, and the {id, name, slug} it
 * returns is already public inside every course DTO. `GET /:id` answers
 * `department:read`, which stays closed to anonymous because the detail view adds
 * teacher and student head-counts. The distinction lives in the policy table, not in
 * a branch here (CONTRIBUTING.md:50).
 */
const departmentsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/',
    {
      schema: {
        querystring: listDepartmentsQuerySchema,
        response: { 200: paginated(departmentSummarySchema) },
      },
      preHandler: authorize('department:list'),
    },
    async (request) => departmentService.list(request.query),
  );

  app.get(
    '/:id',
    {
      schema: { params: idParamSchema, response: { 200: departmentDetailSchema } },
      preHandler: authorize('department:read'),
    },
    async (request) => departmentService.get(request.params.id),
  );

  app.post(
    '/',
    {
      schema: { body: createDepartmentSchema, response: { 201: departmentDetailSchema } },
      preHandler: authorize('department:create'),
    },
    async (request, reply) => reply.status(201).send(await departmentService.create(request.body)),
  );

  app.patch(
    '/:id',
    {
      schema: {
        params: idParamSchema,
        body: updateDepartmentSchema,
        response: { 200: departmentDetailSchema },
      },
      preHandler: authorize('department:update'),
    },
    async (request) => departmentService.update(request.params.id, request.body),
  );

  // Soft delete. A DEMO admin is refused here with rule `provenance:DEMO` before the
  // role rule is consulted — `department:delete` is in DEMO_DENIED (can.ts:24-31).
  app.delete(
    '/:id',
    {
      schema: { params: idParamSchema },
      preHandler: authorize('department:delete'),
    },
    async (request, reply) => {
      await departmentService.remove(request.params.id);
      return reply.status(204).send();
    },
  );
};

export default departmentsRoutes;
