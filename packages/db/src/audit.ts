import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, type PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Ambient actor context
// ---------------------------------------------------------------------------

/**
 * Who is performing the current unit of work.
 *
 * Carried in AsyncLocalStorage rather than threaded through every service signature,
 * because a parameter that thirty call sites must remember to pass is a parameter that
 * some call site will forget to pass — and a forgotten actor is an audit row that lies.
 */
export interface AuditContext {
  /** Null for system-initiated work: cron jobs, queue workers, the seed. */
  actorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

const storage = new AsyncLocalStorage<AuditContext>();

/**
 * Runs `fn` with the given actor attached to every write it performs, however deep.
 * The API calls this once per request, in middleware, before the router ever runs.
 */
export function withAuditContext<T>(ctx: AuditContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Reads the ambient actor. Undefined outside a `withAuditContext` scope. */
export function getAuditContext(): AuditContext | undefined {
  return storage.getStore();
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Models whose mutations produce an AuditEvent.
 *
 * Deliberately excludes Session, Verification, RecoveryCode, Upload, Message and
 * Notification: those are infrastructure that churns on every request, and burying seven
 * genuine administrative actions under fifty thousand session touches is how audit logs
 * become unreadable and therefore unread.
 */
export const AUDITED_MODELS: ReadonlySet<string> = new Set([
  'User',
  'Department',
  'Course',
  'Enrollment',
  'Resource',
  'Announcement',
  'Comment',
]);

/**
 * Fields never written to an audit row, in any model.
 *
 * An audit trail is read by more people than the users table is, so a credential that
 * leaks into a diff is a credential in a wider blast radius than where it started.
 */
const REDACTED_FIELDS: ReadonlySet<string> = new Set([
  'passwordHash',
  'totpSecret',
  'tokenHash',
  'codeHash',
  'totpLastUsedCounter',
]);

const REDACTED_MARKER = '[redacted]';

/** Guard rail for `updateMany`/`deleteMany`: beyond this we record a summary, not rows. */
const BULK_ROW_LIMIT = 1000;

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[binary ${value.byteLength}B]`;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === 'object') {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value as Row)) {
      out[k] = REDACTED_FIELDS.has(k) ? REDACTED_MARKER : toJsonValue(v);
    }
    return out;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  return String(value);
}

function snapshot(row: Row | null | undefined): { [k: string]: JsonValue } | null {
  if (!row) return null;
  const out: { [k: string]: JsonValue } = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = REDACTED_FIELDS.has(k) ? REDACTED_MARKER : toJsonValue(v);
  }
  return out;
}

/**
 * Keeps only the fields that actually moved, plus the primary key.
 *
 * Storing whole rows on both sides of an UPDATE triples the table's size and hides the one
 * column that changed among forty that did not.
 */
function diff(
  before: { [k: string]: JsonValue } | null,
  after: { [k: string]: JsonValue } | null,
): { before: { [k: string]: JsonValue } | null; after: { [k: string]: JsonValue } | null } {
  if (!before || !after) return { before, after };
  const changedBefore: { [k: string]: JsonValue } = {};
  const changedAfter: { [k: string]: JsonValue } = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'updatedAt') continue; // moves on every update; says nothing
    const a = before[key] ?? null;
    const b = after[key] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changedBefore[key] = a;
      changedAfter[key] = b;
    }
  }
  return { before: changedBefore, after: changedAfter };
}

// ---------------------------------------------------------------------------
// Action inference
// ---------------------------------------------------------------------------

type AuditActionName = Prisma.AuditEventCreateInput['action'];

function isSet(v: unknown): boolean {
  return v !== null && v !== undefined;
}

/**
 * Turns a physical UPDATE into the business action it represents.
 *
 * A reviewer asking "who suspended this account" should not have to diff two JSON blobs to
 * find out; the AuditAction enum already has the vocabulary, so we use it.
 */
function deriveUpdateAction(model: string, before: Row | null, after: Row | null): AuditActionName {
  if (!before || !after) return 'UPDATE';

  if (!isSet(before.deletedAt) && isSet(after.deletedAt)) return 'DELETE';
  if (isSet(before.deletedAt) && !isSet(after.deletedAt)) return 'RESTORE';

  if (model === 'User') {
    if (before.status === 'ACTIVE' && after.status === 'SUSPENDED') return 'SUSPEND';
    if (before.status === 'SUSPENDED' && after.status === 'ACTIVE') return 'REINSTATE';
    if (!isSet(before.totpEnabledAt) && isSet(after.totpEnabledAt)) return 'MFA_ENABLE';
    if (isSet(before.totpEnabledAt) && !isSet(after.totpEnabledAt)) return 'MFA_DISABLE';
  }

  if (model === 'Enrollment' && before.status !== after.status) {
    if (after.status === 'APPROVED') return 'APPROVE';
    if (after.status === 'REJECTED') return 'REJECT';
  }

  if (!isSet(before.publishedAt) && isSet(after.publishedAt)) return 'PUBLISH';

  return 'UPDATE';
}

// ---------------------------------------------------------------------------
// The extension
// ---------------------------------------------------------------------------

/** The minimum of a Prisma model delegate this extension needs to read before-images. */
interface ReadableDelegate {
  findUnique(args: { where: unknown }): Promise<Row | null>;
  findMany(args: { where?: unknown; take?: number }): Promise<Row[]>;
}

/**
 * Only the surface this extension actually touches.
 *
 * Depending on the full `PrismaClient` type would drag in the log-event generics of
 * whichever client was constructed, and then swapping a log level would break this file.
 */
type AuditBaseClient = Pick<PrismaClient, 'auditEvent'>;

function delegateFor(base: AuditBaseClient, model: string): ReadableDelegate | undefined {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  // Prisma exposes no public typed index from a model name to its delegate; the cast is
  // the narrowest shape we actually call.
  return (base as unknown as Record<string, ReadableDelegate | undefined>)[key];
}

function idOf(row: Row | null | undefined): string {
  const id = row?.id;
  return typeof id === 'string' ? id : '';
}

/**
 * Views a query result as a plain row for diffing, without re-typing the value the
 * interceptor hands back — the caller must still receive exactly what Prisma produced.
 */
function asRow(value: unknown): Row | null {
  return value !== null && typeof value === 'object' ? (value as Row) : null;
}

/**
 * Append-only audit trail, implemented as a Prisma client extension.
 *
 * It lives in the data-access layer for exactly one reason: no service can forget to write
 * an audit row. A service-level `auditService.record(...)` call is a line of code someone
 * will omit under deadline pressure, in the one code path that most needed it. Here the
 * only way to mutate an audited model is through this interceptor, so the audit row is a
 * property of the write itself rather than a convention.
 *
 * Two consequences worth stating plainly:
 *   - The audit row is written by `base`, the un-extended client, so it does not join an
 *     enclosing interactive transaction. A rolled-back transaction can therefore leave an
 *     audit row describing a change that never landed. We accept a false positive; a
 *     silent gap in the trail would be the far worse failure.
 *   - If the audit write fails we rethrow. The domain write has already committed, so the
 *     caller sees a 500 over an inconsistency that is real. Swallowing the error would
 *     leave the same inconsistency, invisible.
 */
export function auditExtension(base: AuditBaseClient) {
  async function record(params: {
    model: string;
    action: AuditActionName;
    entityId: string;
    before: Row | null;
    after: Row | null;
    diffOnly: boolean;
  }): Promise<void> {
    const ctx = getAuditContext();
    const beforeSnap = snapshot(params.before);
    const afterSnap = snapshot(params.after);
    const payload = params.diffOnly
      ? diff(beforeSnap, afterSnap)
      : { before: beforeSnap, after: afterSnap };

    try {
      await base.auditEvent.create({
        data: {
          actorId: ctx?.actorId ?? null,
          action: params.action,
          entityType: params.model,
          entityId: params.entityId,
          // Our JsonValue permits null inside objects; Prisma's InputJsonValue does not
          // model that, so the cast states what the runtime shape already guarantees.
          before:
            payload.before === null
              ? Prisma.DbNull
              : (payload.before as unknown as Prisma.InputJsonObject),
          after:
            payload.after === null
              ? Prisma.DbNull
              : (payload.after as unknown as Prisma.InputJsonObject),
          ip: ctx?.ip ?? null,
          userAgent: ctx?.userAgent ?? null,
          requestId: ctx?.requestId ?? null,
        },
      });
    } catch (error) {
      logger.error('audit.write_failed', {
        model: params.model,
        entityId: params.entityId,
        action: params.action,
        requestId: ctx?.requestId ?? null,
        error,
      });
      throw error;
    }
  }

  function audited(model: string | undefined): model is string {
    return typeof model === 'string' && AUDITED_MODELS.has(model);
  }

  return Prisma.defineExtension({
    name: 'skillwright-audit',
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const result = await query(args);
          if (!audited(model)) return result;
          const after = asRow(result);
          await record({
            model,
            action: 'CREATE',
            entityId: idOf(after),
            before: null,
            after,
            diffOnly: false,
          });
          return result;
        },

        async createMany({ model, args, query }) {
          const result = await query(args);
          if (!audited(model)) return result;
          const input = (args as unknown as { data?: Row | Row[] }).data;
          const rows = Array.isArray(input) ? input : input ? [input] : [];
          // createMany returns no rows, so the after-image is the caller's input and the
          // entity id is only present when the caller supplied one.
          for (const row of rows.slice(0, BULK_ROW_LIMIT)) {
            await record({
              model,
              action: 'CREATE',
              entityId: idOf(row),
              before: null,
              after: row,
              diffOnly: false,
            });
          }
          return result;
        },

        async update({ model, args, query }) {
          if (!audited(model)) return query(args);
          const delegate = delegateFor(base, model);
          const where = (args as unknown as { where: unknown }).where;
          const before = (await delegate?.findUnique({ where })) ?? null;
          const result = await query(args);
          const after = asRow(result);
          await record({
            model,
            action: deriveUpdateAction(model, before, after),
            entityId: idOf(after) || idOf(before),
            before,
            after,
            diffOnly: true,
          });
          return result;
        },

        async upsert({ model, args, query }) {
          if (!audited(model)) return query(args);
          const delegate = delegateFor(base, model);
          const where = (args as unknown as { where: unknown }).where;
          const before = (await delegate?.findUnique({ where })) ?? null;
          const result = await query(args);
          const after = asRow(result);
          await record({
            model,
            action: before ? deriveUpdateAction(model, before, after) : 'CREATE',
            entityId: idOf(after),
            before,
            after,
            diffOnly: before !== null,
          });
          return result;
        },

        async updateMany({ model, args, query }) {
          if (!audited(model)) return query(args);
          const delegate = delegateFor(base, model);
          const where = (args as unknown as { where?: unknown }).where;
          const before = (await delegate?.findMany({ where, take: BULK_ROW_LIMIT + 1 })) ?? [];
          const result = await query(args);
          if (before.length > BULK_ROW_LIMIT) {
            logger.warn('audit.bulk_truncated', { model, limit: BULK_ROW_LIMIT });
          }
          for (const row of before.slice(0, BULK_ROW_LIMIT)) {
            const after = (await delegate?.findUnique({ where: { id: row.id } })) ?? null;
            await record({
              model,
              action: deriveUpdateAction(model, row, after),
              entityId: idOf(row),
              before: row,
              after,
              diffOnly: true,
            });
          }
          return result;
        },

        async delete({ model, args, query }) {
          if (!audited(model)) return query(args);
          const delegate = delegateFor(base, model);
          const where = (args as unknown as { where: unknown }).where;
          const before = (await delegate?.findUnique({ where })) ?? null;
          const result = await query(args);
          const deleted = asRow(result);
          await record({
            model,
            action: 'DELETE',
            entityId: idOf(before) || idOf(deleted),
            before: before ?? deleted,
            after: null,
            diffOnly: false,
          });
          return result;
        },

        async deleteMany({ model, args, query }) {
          if (!audited(model)) return query(args);
          const delegate = delegateFor(base, model);
          const where = (args as unknown as { where?: unknown }).where;
          const before = (await delegate?.findMany({ where, take: BULK_ROW_LIMIT + 1 })) ?? [];
          const result = await query(args);
          if (before.length > BULK_ROW_LIMIT) {
            logger.warn('audit.bulk_truncated', { model, limit: BULK_ROW_LIMIT });
          }
          for (const row of before.slice(0, BULK_ROW_LIMIT)) {
            await record({
              model,
              action: 'DELETE',
              entityId: idOf(row),
              before: row,
              after: null,
              diffOnly: false,
            });
          }
          return result;
        },
      },
    },
  });
}
