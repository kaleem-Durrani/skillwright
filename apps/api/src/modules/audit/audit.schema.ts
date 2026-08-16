/**
 * The audit module is the one module whose wire shapes are NOT re-exported from
 * @skillwright/shared, because shared has no audit module to re-export from:
 * packages/shared/src/schema/index.ts:7-21 enumerates every schema file in the package
 * and none of them is an audit one. There is no `auditEventSchema`, no
 * `auditActionSchema` and no `listAuditEventsQuerySchema` upstream, so an import of
 * any of those would simply fail to resolve.
 *
 * The local declarations below are therefore the courses.schema.ts:49-55 exception
 * rather than a second opinion: every leaf rule is imported (`idSchema`,
 * `isoDateTimeSchema`, `paginationQuerySchema`) so no id, date or paging rule is
 * restated here, and only the shapes shared genuinely lacks are written out.
 *
 * Helpers that are not wire shapes — `paginated`, `paginationMeta`, `toSkipTake` — are
 * imported straight from '@skillwright/shared' at their point of use; re-exporting a
 * function through here would make this file look like an API when it is an index
 * (enrollments.schema.ts:6-11).
 */
import { z } from 'zod';
import { idSchema, isoDateTimeSchema, paginationQuerySchema } from '@skillwright/shared';

/**
 * Mirrors the `AuditAction` enum in schema.prisma:108-122, value for value.
 *
 * Restating it is unavoidable — the Prisma enum is a database type, not a wire type,
 * and the SPA needs the wire type. The mirror is checked at compile time for free:
 * `toAuditEvent` in audit.service.ts assigns Prisma's `AuditAction` into this union,
 * so a value added to the schema and not added here is a build error in the mapper
 * rather than a response-validation 500 in production.
 */
export const auditActionSchema = z.enum([
  'CREATE',
  'UPDATE',
  'DELETE',
  'RESTORE',
  'LOGIN',
  'LOGOUT',
  'SUSPEND',
  'REINSTATE',
  'APPROVE',
  'REJECT',
  'PUBLISH',
  'MFA_ENABLE',
  'MFA_DISABLE',
]);
export type AuditActionValue = z.infer<typeof auditActionSchema>;

/**
 * The six fields AdminOverview.tsx:19-26 declares and renders at :141-148, plus
 * `actorId` so a caller can pivot the feed onto one actor without a second lookup.
 *
 * `before` / `after` / `ip` / `userAgent` / `requestId` are deliberately absent. The
 * diffs are redacted (audit.ts:61-66) but redaction is a denylist, and an audit trail
 * is read by more people than the users table is — shipping them to a page that draws
 * none of them widens the blast radius for nothing.
 *
 * `entityId` is `z.string()` here and NOT `idSchema`: audit.ts:203-206 writes the
 * empty string when a `createMany` row carried no id, so a stricter response rule
 * would turn one historical row into a 500 for the whole page. On the QUERY below it
 * IS `idSchema`, because a caller filtering by id is filtering by a real one.
 *
 * `actorId` is nullable because the relation is `onDelete: SetNull` and null is the
 * documented shape for system-initiated work (schema.prisma:623-625).
 */
export const auditEventSchema = z.object({
  id: idSchema,
  action: auditActionSchema,
  entityType: z.string(),
  entityId: z.string(),
  actorId: idSchema.nullable(),
  actorName: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type AuditEventDto = z.infer<typeof auditEventSchema>;

/**
 * Offset paging plus the four filters the table's indexes actually support:
 * `[actorId, createdAt]`, `[entityType, entityId, createdAt]` and `[action, createdAt]`
 * (schema.prisma:641-644). Every one of them is optional, so the SPA's bare
 * `?limit=8` (AdminOverview.tsx:36-40) is a valid request.
 *
 * `entityType` is free text rather than an enum because the extension writes it
 * straight from the Prisma model name (audit.ts:255); pinning it to today's
 * AUDITED_MODELS (audit.ts:51-59) would 422 a filter on a model added tomorrow.
 */
export const listAuditEventsQuerySchema = paginationQuerySchema.extend({
  action: auditActionSchema.optional(),
  entityType: z.string().trim().min(1).max(60).optional(),
  entityId: idSchema.optional(),
  actorId: idSchema.optional(),
});
export type ListAuditEventsQuery = z.infer<typeof listAuditEventsQuerySchema>;
