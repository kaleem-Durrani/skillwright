import { prisma } from '@skillwright/db';
import type { AdminStats } from './admin.schema.js';

/**
 * No `loadSubject` helper and no `Actor` parameter live here, deliberately.
 *
 * The single route is gated by `authorize('user:list')`, whose four cells
 * in `POLICY` are bare `allow`/`deny` and read no `Subject` field — the same
 * argument departments.service.ts:14-27 makes for its whole module. A loader would cost
 * a query per request and hand `can()` data no rule consults, and nothing below branches
 * on the caller: these are instance-wide counters, identical for every admin who may
 * see them at all.
 *
 * Nothing here writes, so nothing here audits. The Prisma extension
 * (`auditExtension`, whose `record()` calls `base.auditEvent.create` on the un-extended
 * client) writes a row per mutation on a second pool; a
 * read-only module gives it nothing to do, and `prisma.$transaction([...])` below is a
 * BATCH (an array of promises), not an interactive callback, so TRAP 3 — a second
 * connection acquired while an interactive transaction is open — cannot arise.
 */

// ---------------------------------------------------------------------------
// The time window
// ---------------------------------------------------------------------------

/**
 * "Today" is UTC midnight. That is a decision, not a detail, so it is written down
 * once here instead of being re-litigated at 2am local time.
 *
 * Postgres stores `AuditEvent.createdAt` as timestamptz (it is a Prisma `DateTime`,
 * which maps to `timestamptz`) and the
 * tile is an activity gauge — "is anything happening on this instance right now" — not
 * a billing figure that has to reconcile against a human's calendar. A server-local or
 * per-viewer-local midnight would make the same instance answer two different numbers
 * to two admins in different timezones, which is a worse lie than a boundary that is
 * consistently a few hours off someone's wall clock.
 *
 * `now` is a parameter with a default rather than a bare `new Date()` so the boundary
 * is testable without freezing the process clock.
 */
function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The four counters behind the admin overview tiles (AdminOverview.tsx:46-77).
 *
 * One `$transaction` so the four numbers describe one instant: four sequential counts
 * can straddle a suspension and report a `suspendedUsers` that is not a subset of the
 * `users` it is drawn from, which is the kind of inconsistency that gets read as a bug
 * in the tile rather than in the query.
 *
 * `deletedAt: null` on the first three because soft delete is not enforced by the ORM
 * (schema.prisma's header rule 3) — `deletedAt` is a plain nullable column on User
 * and Department alike, so a tile that skipped the filter would count rows that appear
 * in no list, no lookup and no admin screen. A tile that counts deleted rows is a lying
 * tile, and the `/admin/users` link under it would land on a shorter list than the
 * number promised.
 *
 * `auditEvent` deliberately carries NO soft-delete filter: the model has no `deletedAt`
 * column at all and the table is append-only by design (the "Append-only" comment on
 * `model AuditEvent`), with
 * UPDATE and DELETE revoked from the application role in production (migration
 * 0002:107-113). There is nothing to filter out, and a `deletedAt: null` here would not
 * compile — which is the safest kind of reminder.
 */
export async function stats(): Promise<AdminStats> {
  const [users, suspendedUsers, departments, auditEventsToday] = await prisma.$transaction([
    prisma.user.count({ where: { deletedAt: null } }),
    // `UserStatus.SUSPENDED` is set by an admin and destroys every
    // live session; `@@index([status])` (:181) and `@@index([deletedAt])` (:182) cover
    // both predicates.
    prisma.user.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
    prisma.department.count({ where: { deletedAt: null } }),
    prisma.auditEvent.count({ where: { createdAt: { gte: startOfUtcDay() } } }),
  ]);

  return { users, suspendedUsers, departments, auditEventsToday };
}
