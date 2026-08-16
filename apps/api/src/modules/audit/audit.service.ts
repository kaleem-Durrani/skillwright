import { prisma, type Prisma } from '@skillwright/db';
import { paginationMeta, toSkipTake, type Paginated } from '@skillwright/shared';
import type { AuditEventDto, ListAuditEventsQuery } from './audit.schema.js';

/**
 * Only the actor's display name is loaded, not the whole `User` row.
 *
 * `include: { actor: true }` would pull `passwordHash` and `totpSecret` into memory for
 * every row of every page of an endpoint whose entire purpose is to be read by humans.
 * The audit extension redacts exactly those columns before they reach an audit row
 * (audit.ts:61-73) for the same reason, so widening them back out here would undo that
 * on the read side.
 *
 * `deletedAt` is deliberately NOT filtered on this relation, against the house rule
 * that every read filters it by hand: an audit row records WHO acted, and blanking a
 * soft-deleted user's name would render the row as 'system' (AdminOverview.tsx:148),
 * where schema.prisma:623 reserves that meaning for genuinely system-initiated work.
 * A trail that lies about attribution is worse than one that names a departed user.
 */
const AUDIT_EVENT_INCLUDE = { actor: { select: { name: true } } } as const;

type AuditEventWithActor = Prisma.AuditEventGetPayload<{ include: typeof AUDIT_EVENT_INCLUDE }>;

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/**
 * The ONLY shape an AuditEvent is serialised as.
 *
 * The return type is the shared-style inferred DTO rather than a hand-written mirror,
 * so a renamed field is a compile error here instead of a response-validation 500
 * (lib/dto.ts:15-19). `event.action` is Prisma's `AuditAction`; assigning it into
 * `AuditEventDto['action']` is what pins `auditActionSchema` to schema.prisma:108-122
 * at build time.
 *
 * A null actor is normal, not an error: the relation is `onDelete: SetNull`
 * (schema.prisma:624) and system-initiated work carries no actor at all
 * (schema.prisma:623). The SPA already renders that case as 'system'.
 */
export function toAuditEvent(event: AuditEventWithActor): AuditEventDto {
  return {
    id: event.id,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    actorId: event.actorId,
    actorName: event.actor?.name ?? null,
    // Stringified in the mapper even though `isoDateTimeSchema` would normalise a Date
    // (common.ts:42-44), because the return type's field is `string` (lib/dto.ts:78-82).
    createdAt: event.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * No visibility clause and no soft-delete filter, both on purpose.
 *
 * There is no `visibilityWhere` here because there is nothing to mirror: `audit:read`
 * (policy.ts:452-457) is anonymous/STUDENT/TEACHER deny, ADMIN allow — four terminal
 * cells that read no Subject field — so the route's bare `authorize('audit:read')` is
 * the complete gate and every caller who reaches this function may see every row
 * (the departments.routes.ts:15-29 argument). Adding a WHERE here would give the rule
 * a second home that policy.ts could not see.
 *
 * `deletedAt` is not filtered because `AuditEvent` does not have the column: the table
 * is append-only, and migration 0002:107-108 documents the grant that revokes UPDATE
 * and DELETE from the application role.
 *
 * The four filters are spread rather than assigned so an absent one is an absent key
 * rather than an explicit `undefined`, which `exactOptionalPropertyTypes` rejects.
 */
function listWhere(query: ListAuditEventsQuery): Prisma.AuditEventWhereInput {
  return {
    ...(query.action !== undefined ? { action: query.action } : {}),
    ...(query.entityType !== undefined ? { entityType: query.entityType } : {}),
    ...(query.entityId !== undefined ? { entityId: query.entityId } : {}),
    ...(query.actorId !== undefined ? { actorId: query.actorId } : {}),
  };
}

/**
 * `sort` arrives as free-form text (pagination.ts:16), so it never reaches an `orderBy`
 * key. `createdAt` is the only column this endpoint will ever order by, so the
 * whitelist collapses to a constant: the other four columns are low-cardinality and
 * none of the table's indexes (schema.prisma:641-644) leads with one, which makes
 * sorting by them a full scan of a table that only ever grows.
 *
 * An unrecognised `sort` therefore falls back rather than 422ing, exactly as
 * departments.service.ts:81-97 does, so a stale bookmark still renders a page.
 * `order` is honoured because `?order=asc` is a legitimate way to read the feed
 * oldest-first; it defaults to `desc` (pagination.ts:17), which is the newest-first
 * order AdminOverview.tsx expects from its bare `?limit=8`.
 */
function orderFor(query: ListAuditEventsQuery): Prisma.AuditEventOrderByWithRelationInput {
  return { createdAt: query.order };
}

/**
 * The list is this module's whole surface. There is deliberately no create, update or
 * delete: rows are written by the Prisma extension (audit.ts:288-427), which reads the
 * actor from the AsyncLocalStorage seeded in logger.plugin.ts:26-28, and writing one
 * by hand from a service would double-count every mutation it accompanies.
 *
 * `$transaction` in its array form, not the interactive one — the page and its total
 * must agree, and the array form takes a single connection, so it cannot collide with
 * the second pool the audit extension writes on (packages/db/src/index.ts:10-13).
 */
export async function list(query: ListAuditEventsQuery): Promise<Paginated<AuditEventDto>> {
  const where = listWhere(query);
  const [rows, total] = await prisma.$transaction([
    prisma.auditEvent.findMany({
      where,
      ...toSkipTake(query),
      orderBy: orderFor(query),
      include: AUDIT_EVENT_INCLUDE,
    }),
    prisma.auditEvent.count({ where }),
  ]);

  return { data: rows.map(toAuditEvent), meta: paginationMeta(query.page, query.limit, total) };
}
