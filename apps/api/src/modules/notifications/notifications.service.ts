import { prisma, type Notification, type Prisma } from '@skillwright/db';
import { paginationMeta, toSkipTake, type Actor, type Paginated } from '@skillwright/shared';
import { baseLogger } from '../../lib/logger.js';
import { notificationPayloadSchema } from './notifications.schema.js';
import type {
  ListNotificationsQuery,
  MarkNotificationsReadInput,
  NotificationDto,
  NotificationPayload,
  UnreadCountResponse,
} from './notifications.schema.js';

/**
 * There is no `as const` include constant in this module, and its absence is a
 * decision rather than an omission: `notificationSchema` (notification.ts:30-37) has
 * no nested DTO. The row IS the payload, so the mapper takes the bare Prisma model
 * type and an include would load a `user` relation nothing serialises.
 */

/**
 * The module logger, used by exactly one code path — the malformed-payload branch in
 * `toPayload`. auth.service.ts:59 is the precedent: a service gets a child logger only
 * when it genuinely logs.
 */
const log = baseLogger.child({ module: 'notifications' });

/**
 * Substituted for a payload that does not parse, so one bad row costs its own text
 * rather than the whole page. See `toPayload` for why that trade is the right one.
 * Copied at each use rather than shared by reference: two malformed rows in one page
 * must not end up holding the same object.
 */
const UNRENDERABLE_PAYLOAD: NotificationPayload = { title: '', body: '' };

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/**
 * `Notification.payload` is Prisma `Json` (schema.prisma:604), which types as
 * `Prisma.JsonValue` — genuinely unstructured, since Postgres will store whatever
 * jsonb the writer handed it. `notificationSchema.payload` is
 * `notificationPayloadSchema`, which REQUIRES `{ title, body }` (notification.ts:22-27).
 *
 * Nothing in the type system bridges those two, and `as NotificationPayload` would be
 * a lie the response serialiser catches at runtime as a 500 — for the whole page, not
 * for the one row. So this is the one place in the module where a runtime re-parse is
 * justified: `safeParse` narrows honestly, and a row that fails is logged and rendered
 * blank rather than taking the caller's entire notification list down with it.
 *
 * The alternative — a `Json` column with an `any` cast — is what the no-`any` rule
 * exists to prevent.
 */
function toPayload(notification: Notification): NotificationPayload {
  const parsed = notificationPayloadSchema.safeParse(notification.payload);
  if (parsed.success) return parsed.data;

  log.warn(
    { notificationId: notification.id, type: notification.type },
    'Notification payload does not match notificationPayloadSchema; rendering it blank',
  );
  return { ...UNRENDERABLE_PAYLOAD };
}

/**
 * The ONLY shape a notification is serialised as.
 *
 * `userId` is deliberately absent from the wire (notification.ts:30-37): every row this
 * module serves belongs to the caller, so echoing the id back would be the one field
 * capable of confusing that invariant.
 *
 * Dates are stringified here even though the response schema would normalise a `Date`:
 * the return type is the shared `NotificationDto`, whose `readAt` and `createdAt` are
 * strings, so the conversion makes a binding mistake a compile error rather than a
 * runtime surprise (lib/dto.ts:78-82).
 */
export function toNotificationDto(notification: Notification): NotificationDto {
  return {
    id: notification.id,
    type: notification.type,
    payload: toPayload(notification),
    linkPath: notification.linkPath,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type SortDirection = ListNotificationsQuery['order'];

/**
 * `sort` arrives as free-form text (pagination.ts:16), so it is matched against this
 * map and never interpolated into an `orderBy` key. An unrecognised value falls back
 * to the default rather than 422ing — a stale bookmark should still render a list.
 *
 * Only the two columns the index covers are offered: @@index([userId, readAt, createdAt])
 * (schema.prisma:612). Sorting by `type` would be a sequential scan on a table that
 * grows per user per event.
 */
const ORDER_BY: Record<
  string,
  (order: SortDirection) => Prisma.NotificationOrderByWithRelationInput
> = {
  createdAt: (order) => ({ createdAt: order }),
  readAt: (order) => ({ readAt: order }),
};

const DEFAULT_ORDER = (order: SortDirection): Prisma.NotificationOrderByWithRelationInput => ({
  createdAt: order,
});

function orderFor(query: ListNotificationsQuery): Prisma.NotificationOrderByWithRelationInput {
  const build = query.sort === undefined ? undefined : ORDER_BY[query.sort];
  return (build ?? DEFAULT_ORDER)(query.order);
}

/**
 * The `notification:read` policy row (policy.ts:458-464) expressed as a WHERE clause.
 *
 * All three roles are `isSelf` and anonymous is denied, so `authorize()` at the route
 * DOES answer this action completely — unlike the cross-collection lists in
 * enrollments.service.ts:199-215 and courses.service.ts:158-184, which have no
 * `authorize()` at all. The gate here is real; what a yes/no gate cannot do is scope
 * ROWS. That is what this clause is for.
 *
 * `userId: actor.id` is therefore NOT a filter and NOT optional: it is the whole
 * row-level authorization. policy.ts:460 states the contract in the policy table
 * itself — "Notification rows are per-user". Dropping this term serves every user's
 * notifications to every caller, and no test of the gate would notice.
 *
 * Notification has NO `deletedAt` column (schema.prisma:596-614), so — unlike every
 * other read in this codebase — there is deliberately no soft-delete term here.
 */
function scopedWhere(actor: Actor, query: ListNotificationsQuery): Prisma.NotificationWhereInput {
  return {
    userId: actor.id,
    // The caller's filters narrow WITHIN that scope; neither can widen it, because
    // both are plain AND terms on the same object rather than an `OR`.
    ...(query.unreadOnly === true ? { readAt: null } : {}),
    ...(query.type !== undefined ? { type: query.type } : {}),
  };
}

export async function list(
  actor: Actor,
  query: ListNotificationsQuery,
): Promise<Paginated<NotificationDto>> {
  const where = scopedWhere(actor, query);
  const [rows, total] = await prisma.$transaction([
    prisma.notification.findMany({ where, ...toSkipTake(query), orderBy: orderFor(query) }),
    prisma.notification.count({ where }),
  ]);
  return {
    data: rows.map((row) => toNotificationDto(row)),
    meta: paginationMeta(query.page, query.limit, total),
  };
}

/**
 * The badge number behind the bell (AppShell.tsx:103-108).
 *
 * `{ userId, readAt: null }` is covered exactly by @@index([userId, readAt, createdAt])
 * (schema.prisma:612), so this stays an index-only count however many rows a long-lived
 * account accumulates.
 */
export async function unreadCount(actor: Actor): Promise<UnreadCountResponse> {
  const unread = await prisma.notification.count({
    where: { userId: actor.id, readAt: null },
  });
  return { unread };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Marks the caller's notifications read, or unread with `{ read: false }`.
 *
 * `input` is optional because the SPA's "mark all read" is naturally a bodyless POST.
 * `markNotificationsReadSchema.read` carries a zod default of `true`, but a default
 * only fires once an OBJECT reaches the schema — an absent body never does. Hence the
 * `?? true` here rather than a reliance on the schema (courses.routes.ts:154-176 is
 * the same trap seen from the route side).
 *
 * `userId: actor.id` in the WHERE is the security boundary. `ids` is a caller-supplied
 * list of arbitrary ids: it is INTERSECTED with the actor's own rows, never trusted on
 * its own, so passing someone else's notification id matches nothing instead of
 * marking their bell read. `updateMany` reports a count and never throws P2025 for a
 * row that did not match, which is exactly the behaviour that makes the intersection
 * silent rather than an information leak about which ids exist.
 *
 * Notification is NOT in AUDITED_MODELS (audit.ts:51-59), so this write puts nothing on
 * the audit extension's second pool — no interactive transaction and none of
 * enrollments.service.ts:41-50's enlarged budget is needed here.
 */
export async function markRead(
  actor: Actor,
  input?: MarkNotificationsReadInput,
): Promise<UnreadCountResponse> {
  const read = input?.read ?? true;
  const ids = input?.ids;

  await prisma.notification.updateMany({
    where: {
      userId: actor.id,
      ...(ids !== undefined ? { id: { in: ids } } : {}),
      // Only the rows that would actually change. Without this term, "mark all read"
      // rewrites `readAt` on every row the user has ever read, so the list re-sorts
      // under a `sort=readAt` reader for no reason.
      ...(read ? { readAt: null } : { readAt: { not: null } }),
    },
    data: { readAt: read ? new Date() : null },
  });

  // The recomputed count travels back on the same response so the badge updates from
  // the mutation the SPA already awaited, rather than a second round trip that can
  // race with another tab.
  return unreadCount(actor);
}
