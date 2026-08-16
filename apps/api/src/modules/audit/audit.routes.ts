import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { paginated } from '@skillwright/shared';
import { authorize } from '../../plugins/auth.plugin.js';
import { auditEventSchema, listAuditEventsQuerySchema } from './audit.schema.js';
import * as auditService from './audit.service.js';

/**
 * The audit feed, and nothing else.
 *
 * This module performs NO writes, and must not grow any. Audit rows are written by the
 * Prisma client extension in packages/db (audit.ts:288-427), which is the whole reason
 * no service can forget to write one; and migration 0002:107-108 documents the grant
 * that revokes UPDATE and DELETE on the table from the application role, so the
 * append-only property is enforced by Postgres rather than by this file's restraint.
 * A `POST /audit-events` would either duplicate a row the extension already wrote or
 * fail at the database — there is no third outcome.
 *
 * There is exactly one route and it is fully gated by a bare `authorize('audit:read')`.
 * policy.ts:452-457 is anonymous deny / STUDENT deny / TEACHER deny / ADMIN allow:
 * four terminal cells, none of which reads a Subject field, so no subject loader can
 * change the answer and none is passed — the same argument departments.routes.ts:15-29
 * makes for that whole module. This is also why the handler needs no `requireActor`:
 * `authorize` has already thrown `unauthenticated()` for a null actor by the time it
 * runs, and the service below reads no caller because an admin sees every row.
 *
 * `audit:read` is absent from DEMO_DENIED (can.ts:24-31) on purpose — reading the feed
 * is non-destructive, and the demo admin is meant to be able to see it.
 */
const auditRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/',
    {
      schema: {
        querystring: listAuditEventsQuerySchema,
        response: { 200: paginated(auditEventSchema) },
      },
      preHandler: authorize('audit:read'),
    },
    async (request) => auditService.list(request.query),
  );
};

export default auditRoutes;
