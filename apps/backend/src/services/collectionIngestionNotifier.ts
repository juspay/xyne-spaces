import { ActivityClassification, IngestionStatus, NotificationType } from '@xyne/shared';
import { db } from '@/database/client';
import { redisService } from '@/services/redisService';
import { notificationService } from '@/notification-service';
import { activityService } from '@/services/activity/activityService';
import { logger } from '@/utils/logger';

/** Guards only against near-simultaneous "last file" finishers (a race) sending
 *  twice — kept short so a genuinely separate upload a few seconds later still
 *  notifies. */
const DEDUP_TTL_SECONDS = 5;

/**
 * Sends the collection owner a one-time "ingestion complete" notification once
 * EVERY file in the collection has reached a terminal state (COMPLETED/FAILED)
 * — i.e. none are left PENDING/PROCESSING.
 *
 * Call this after a collection item is moved to a terminal ingestion status,
 * passing that item's `fileId`. It re-reads the DB, so it is safe to call from
 * either ingestion pipeline (sync Vespa worker or async docling scheduler).
 * Fully self-contained and error-swallowing — it must never break ingestion.
 */
export async function maybeNotifyCollectionIngestionComplete(fileId: string): Promise<void> {
  try {
    const item = await db.collectionItem.findFirst({
      where: { fileId, isLatest: true },
      select: { rootCollectionId: true },
    });
    if (!item?.rootCollectionId) return;
    const rootCollectionId = item.rootCollectionId;

    // Any file still in flight ⇒ collection not done yet. Because each caller
    // updates its own row before invoking us, the last file to finish observes 0.
    const inFlight = await db.collectionItem.count({
      where: {
        rootCollectionId,
        isLatest: true,
        deletedAt: null,
        ingestionStatus: { in: [IngestionStatus.PENDING, IngestionStatus.PROCESSING] },
      },
    });
    if (inFlight > 0) return;

    // Dedup: only the first finisher within the TTL sends. Guards against
    // concurrent finishers and re-fires from a later upload wave.
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

    const send = (): Promise<string> =>
      notificationService.sendNotification(
        collection.ownerId,
        NotificationType.COLLECTION_INGESTION_COMPLETED,
        'Ingestion complete',
        `All files in "${collection.name}" have been processed — ${String(succeeded)} succeeded, ${String(failed)} failed.`,
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
      // The producer is only initialized in some worker processes; the process
      // running ingestion may not have done so. Initialize on demand and retry.
      if (sendErr instanceof Error && /not initialized/i.test(sendErr.message)) {
        console.log('notification service not intitialize initializing');
        await notificationService.initialize();
        await send();
      } else {
        throw sendErr;
      }
    }

    // Also record a persistent Activity so the owner can find it later in the
    // Activity feed (the toast is ephemeral). Rendered by KbIngestionActivity.
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
  } catch (err) {
    logger.warn('[KB_INGEST_NOTIFY] Failed to send ingestion-complete notification', {
      fileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
