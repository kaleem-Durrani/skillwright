import { prisma } from '@skillwright/db';
import type { AppInstance } from '../../app.js';
import { env } from '../../env.js';
import { baseLogger } from '../../lib/logger.js';
import { deleteObject, stagingKeyFor } from '../../lib/storage.js';

const log = baseLogger.child({ module: 'uploads.sweeper' });

/**
 * The repository's first scheduled job, deliberately tiny.
 *
 * `presign` writes the Upload row BEFORE the bytes exist (uploads.service.ts:119-163),
 * so a user who opens an upload dialog and closes it leaves a PENDING row behind — a
 * claim that never became a fact. This is the job upload.ts:87 promised: on an interval,
 * delete rows still PENDING past a configurable age. It is a plain `setInterval`, not
 * BullMQ — the feature plan argues against queue subsystems for exactly this shape of
 * work ("a promise you do not await plus a nightly cron covers both"), and one timer
 * with one query does not justify one.
 *
 * Three rules the implementation does not get to renegotiate:
 *
 * PENDING-ONLY. The WHERE clause below is the entire safety argument. The upload client
 * reuses a COMMITTED upload across retries by design — commit is idempotent precisely
 * so a retried form resends the same id — and every attachment point requires COMMITTED.
 * A sweep that treated old committed rows as "orphaned" would delete files out from
 * under live resources, syllabi and avatars; age alone must never select a row.
 *
 * UNREFERENCED-ONLY. A PENDING row can still be pointed at by a legacy attachment
 * written before `assertUploadClaimable` began refusing PENDING claims, and
 * `Resource.uploadId` is `onDelete: Restrict` — deleting such a row is a foreign-key
 * error at best and a broken download at worst. Rows with anything pointing at them are
 * not abandoned by definition, whatever their status says.
 *
 * OBJECT FIRST, ROW SECOND. `deleteObject` then `upload.delete`. A crash between the
 * two leaves a row whose object is gone — which the next run re-sweeps for free,
 * because DeleteObject succeeds against a key that holds nothing. The reverse order
 * would leave bytes in a private bucket that no row remembers, which is the one
 * failure nothing can recover from.
 */

/** Small enough that one run cannot monopolise the event loop, big enough to catch up. */
const BATCH_SIZE = 20;

/**
 * One pass: reclaim up to `batchSize` abandoned uploads, returning how many were swept.
 *
 * Exported for the tests, which drive it directly with explicit options rather than
 * waiting on wall-clock intervals. Defaults come from the environment
 * (`UPLOAD_SWEEP_MAX_AGE_MS`), so production behaviour needs no code change to tune.
 *
 * Failures are per-row and logged, never thrown past one run: a bucket outage must not
 * crash the process from a background timer. The loop STOPS on the first object-store
 * error — every remaining row in the batch would fail identically, and hammering a
 * store that just refused a connection is not retry, it is noise. The rows stay queued
 * in creation order (`@@index([status, createdAt])` is the exact index this read walks)
 * and the next tick tries again.
 */
export async function sweepAbandonedUploads(options?: {
  maxAgeMs?: number;
  batchSize?: number;
}): Promise<number> {
  const maxAgeMs = options?.maxAgeMs ?? env.UPLOAD_SWEEP_MAX_AGE_MS;
  const batchSize = options?.batchSize ?? BATCH_SIZE;

  const stale = await prisma.upload.findMany({
    where: {
      status: 'PENDING',
      createdAt: { lt: new Date(Date.now() - maxAgeMs) },
      resource: null,
      courseSyllabus: null,
      userAvatar: null,
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, key: true },
    take: batchSize,
  });

  let swept = 0;
  for (const row of stale) {
    try {
      // The row's key is the object's FINAL home; while the row is PENDING the bytes
      // sit at its staging shadow (storage.ts `stagingKeyFor`) — the same mapping
      // presign signed and commit verified against. Idempotent by S3 semantics: a key
      // that holds no object still deletes cleanly, which is the common case — most
      // abandoned claims never received a PUT.
      await deleteObject(stagingKeyFor(row.key));
      await prisma.upload.delete({ where: { id: row.id } });
      swept += 1;
    } catch (error) {
      log.warn({ err: error, uploadId: row.id }, 'abandoned-upload sweep failed; will retry');
      break;
    }
  }

  if (swept > 0) log.info({ swept }, 'abandoned uploads swept');
  return swept;
}

/**
 * Register the interval against a built app, and die with it.
 *
 * Called from app.ts when NOT under test (`isTest` guards it there — the suites drive
 * `sweepAbandonedUploads` directly and must not race a background timer). The timer is
 * unref'd so it can never hold the process open by itself, and the onClose hook clears
 * it, so `app.close()` in main.ts's shutdown sequence is the sweeper's whole teardown.
 */
export function startUploadSweeper(app: AppInstance): void {
  const timer = setInterval(() => {
    void sweepAbandonedUploads().catch((error: unknown) => {
      log.error({ err: error }, 'scheduled upload sweep crashed');
    });
  }, env.UPLOAD_SWEEP_INTERVAL_MS);
  timer.unref();

  app.addHook('onClose', async () => {
    clearInterval(timer);
    log.info('upload sweeper stopped');
  });

  log.info(
    { intervalMs: env.UPLOAD_SWEEP_INTERVAL_MS, maxAgeMs: env.UPLOAD_SWEEP_MAX_AGE_MS },
    'upload sweeper started',
  );
}
