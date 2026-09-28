import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { idParamSchema, paginated } from '@skillwright/shared';
import { authorize } from '../../plugins/auth.plugin.js';
import {
  auditEventDetailSchema,
  auditEventSchema,
  exportAuditEventsQuerySchema,
  listAuditEventsQuerySchema,
} from './audit.schema.js';
import * as auditService from './audit.service.js';

/**
 * The audit feed, and nothing else.
 *
 * This module performs NO writes, and must not grow any. Audit rows are written by the
 * Prisma client extension in packages/db (audit.ts:288-427), which is the whole reason
 * no service can forget to write one; and a trigger in migration 0012 refuses UPDATE,
 * DELETE and TRUNCATE on the table, so the append-only property is enforced by Postgres
 * rather than by this file's restraint. (It was previously described here as a REVOKE in
 * migration 0002 — that REVOKE is commented out at 0002_constraints/migration.sql:107-110
 * and never protected anything, because the API connects as the table's owner.)
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

  /*
   * Phase 8: the feed as a file, same gate as the feed itself — a bare
   * `authorize('audit:read')`, because that policy row is four terminal cells and no
   * subject loader can change the answer (the argument at the top of this file).
   * Filters ride the feed's own query schema minus paging; the columns mirror
   * `auditEventSchema`, so the forensics stay detail-only surface and are NOT in the
   * file. The handler returns a Readable (lib/csv.ts) that Fastify streams, so a
   * growing table is never assembled in memory.
   */
  app.get(
    '/export',
    {
      schema: { querystring: exportAuditEventsQuerySchema },
      preHandler: authorize('audit:read'),
    },
    async (request, reply) => {
      reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="audit-events.csv"');
      return auditService.streamFeed(request.query);
    },
  );

  /*
   * Phase 8: one event with its stored forensics — `before`/`after`/`ip`/
   * `userAgent`/`requestId` (packages/db/src/audit.ts:259-269), which the LIST DTO
   * deliberately drops. Same bare gate as the feed, so the wider shape reaches admins
   * only. This module still performs no writes of any kind.
   */
  app.get(
    '/:id',
    {
      schema: {
        params: idParamSchema,
        response: { 200: auditEventDetailSchema },
      },
      preHandler: authorize('audit:read'),
    },
    async (request) => auditService.getById(request.params.id),
  );
};

export default auditRoutes;
