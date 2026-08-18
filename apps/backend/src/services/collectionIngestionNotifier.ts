import { ActivityClassification, IngestionStatus, NotificationType } from '@xyne/shared';
import { db } from '@/database/client';
import { redisService } from '@/services/redisService';
import { notificationService } from '@/notification-service';
import { activityService } from '@/services/activity/activityService';
import { logger } from '@/utils/logger';

/** Guards only against near-simultaneous "last file" finishers (a race) sending
 *  twice — kept short so a genuinely separate upload a few seconds later still
 *  notifies. */
const DEDUP_TTL_SECONDS = 20;

/** Safety TTL on the "import in progress" flag, so a crashed importer can't
 *  suppress notifications forever. Importers clear it explicitly when done. */
const IMPORT_ACTIVE_TTL_SECONDS = 3600;

const importActiveKey = (rootCollectionId: string): string => `kb:import-active:${rootCollectionId}`;

/**
 * Mark a collection as actively receiving files. While set, the completion notifier
 * will NOT fire even if no files are currently in flight — because more files are
 * still being created/enqueued (e.g. a Drive import downloading one file at a time).
 * Pair every call with {@link clearCollectionImportActive} (in a finally).
 */
export async function markCollectionImportActive(rootCollectionId: string): Promise<void> {
  try {
    await redisService.set(importActiveKey(rootCollectionId), '1', IMPORT_ACTIVE_TTL_SECONDS);
  } catch (err) {
    logger.warn('[KB_INGEST_NOTIFY] Failed to set import-active flag', {
      rootCollectionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function clearCollectionImportActive(rootCollectionId: string): Promise<void> {
  try {
    await redisService.del(importActiveKey(rootCollectionId));
  } catch (err) {
    logger.warn('[KB_INGEST_NOTIFY] Failed to clear import-active flag', {
      rootCollectionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Sends the collection owner a one-time "ingestion complete" notification once
 * EVERY file in the collection has reached a terminal state (COMPLETED/FAILED)
 * — i.e. none are left PENDING/PROCESSING — AND the collection is not still
 * actively receiving files (import-active flag).
 *
 * Call after a collection item is moved to a terminal ingestion status, passing
 * that item's `fileId`. Safe to call from either ingestion pipeline (sync Vespa
 * worker or async docling scheduler). Fully error-swallowing — never breaks ingestion.
 */
export async function maybeNotifyCollectionIngestionComplete(fileId: string): Promise<void> {
  try {
    const item = await db.collectionItem.findFirst({
      where: { fileId, isLatest: true },
      select: { rootCollectionId: true },
    });
    if (!item?.rootCollectionId) return;
    await notifyIfCollectionDone(item.rootCollectionId);
  } catch (err) {
    logger.warn('[KB_INGEST_NOTIFY] Failed to send ingestion-complete notification', {
      fileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Same check, but keyed directly by collection id. An importer calls this after it
 * has finished creating ALL files (and cleared the import-active flag), to cover the
 * case where the last file's ingestion already completed while the flag was still set.
 */
export async function maybeNotifyCollectionIngestionCompleteByCollection(
  rootCollectionId: string,
): Promise<void> {
  try {
    await notifyIfCollectionDone(rootCollectionId);
  } catch (err) {
    logger.warn('[KB_INGEST_NOTIFY] Failed to send ingestion-complete notification', {
      rootCollectionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function notifyIfCollectionDone(rootCollectionId: string): Promise<void> {
  // Any file still in flight ⇒ collection not done yet. Because each caller updates
  // its own row before invoking us, the last file to finish observes 0.
  const inFlight = await db.collectionItem.count({
    where: {
      rootCollectionId,
      isLatest: true,
      deletedAt: null,
      ingestionStatus: { in: [IngestionStatus.PENDING, IngestionStatus.PROCESSING] },
    },
  });
  if (inFlight > 0) return;

  // Import still adding files (e.g. a Drive import downloading one at a time). The
  // current 0-in-flight is only because later files don't exist yet — don't fire.
  const importActive = await redisService.get(importActiveKey(rootCollectionId));
  if (importActive) return;

  // Dedup: only the first finisher within the TTL sends. Guards concurrent finishers
  // and re-fires from a later upload wave.
  const acquired = await redisService.set(
    `kb:ingest-notified:${rootCollectionId}`,
    '1',
    DEDUP_TTL_SECONDS,
    true,
  );
  if (!acquired) return;

  const collection = await db.collection.findFirst({
    where: { id: rootCollectionId },
    select: { id: true, name: true, ownerId: true, workspaceId: true },
  });
  if (!collection?.ownerId) return;

  const total = await db.collectionItem.count({
    where: { rootCollectionId, isLatest: true, deletedAt: null },
  });
  const failed = await db.collectionItem.count({
    where: {
      rootCollectionId,
      isLatest: true,
      deletedAt: null,
      ingestionStatus: IngestionStatus.FAILED,
    },
  });
  const succeeded = total - failed;

  // Match the Activity-feed card's three outcomes and plain-language phrasing.
  let title: string;
  let body: string;
  if (failed === 0) {
    title = `"${collection.name}" is ready`;
    body = `${String(succeeded)} file${succeeded === 1 ? '' : 's'} added, no failures`;
  } else if (succeeded === 0) {
    title = `"${collection.name}" import failed`;
    body = `None of the ${String(total)} file${total === 1 ? '' : 's'} could be added`;
  } else {
    title = `"${collection.name}" needs attention`;
    body = `${String(succeeded)} of ${String(total)} files added, ${String(failed)} failed`;
  }

  const send = (): Promise<string> =>
    notificationService.sendNotification(
      collection.ownerId,
      NotificationType.COLLECTION_INGESTION_COMPLETED,
      title,
      body,
      {
        workspaceId: collection.workspaceId,
        collectionId: rootCollectionId,
        total,
        succeeded,
        failed,
      },
      `/${collection.workspaceId}/knowledge-base?cl=${rootCollectionId}`,
    );

  try {
    await send();
  } catch (sendErr) {
    // The producer is only initialized in some worker processes; the process running
    // ingestion may not have done so. Initialize on demand and retry.
    if (sendErr instanceof Error && /not initialized/i.test(sendErr.message)) {
      logger.info('[KB_INGEST_NOTIFY] Notification producer not initialized; initializing on demand and retrying', {
        rootCollectionId,
      });
      await notificationService.initialize();
      await send();
    } else {
      throw sendErr;
    }
  }

  // Also record a persistent Activity so the owner can find it later in the Activity
  // feed (the toast is ephemeral). Rendered by KbIngestionActivity.
  try {
    await activityService.createActivity({
      userId: collection.ownerId,
      actorId: collection.ownerId,
      actorAction: 'kb_ingestion_completed',
      actionSource: 'collection',
      actionSourceId: rootCollectionId,
      workspaceId: collection.workspaceId,
      classification: ActivityClassification.ACTIONABLE,
      // Freeze this run's counts in blockId (unused for KB activities) so each
      // notification keeps its own numbers instead of the UI recomputing live.
      // Format: "succeeded,failed".
      blockId: `${String(succeeded)},${String(failed)}`,
    });
  } catch (activityErr) {
    logger.warn('[KB_INGEST_NOTIFY] Failed to create ingestion-complete activity', {
      rootCollectionId,
      error: activityErr instanceof Error ? activityErr.message : String(activityErr),
    });
  }

  logger.info('[KB_INGEST_NOTIFY] Sent ingestion-complete notification', {
    rootCollectionId,
    ownerId: collection.ownerId,
    total,
    succeeded,
    failed,
  });
}
