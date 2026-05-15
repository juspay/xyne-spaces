import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

const BATCH_SIZE = 50;
const BATCH_GAP_MS = 3_000; // 3 seconds between batches

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class MigrationCleanupController {
  /**
   * DELETE /api/migration/cleanup/orphan-conversations
   * Deletes conversations with initialMessageId = 'temp' (orphaned from failed migrations).
   * Body: { channelId?: string } — omit to delete across ALL channels (use with caution).
   * Deletes in batches of 50 with a 10s gap between batches.
   */
  cleanupOrphanConversations = async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.body as { channelId?: string };

      const where = channelId
        ? { initialMessageId: 'temp', channelId }
        : { initialMessageId: 'temp' };

      // Respond immediately — batched deletion runs in background
      res.json({
        success: true,
        message: `Deletion started in batches of ${BATCH_SIZE} with ${BATCH_GAP_MS / 1000}s gap (~${BATCH_SIZE}/sec). Check server logs for progress.`,
        channelId: channelId ?? 'ALL',
      });

      // Run batched deletion in background
      (async () => {
        let totalDeleted = 0;
        let batch = 0;

        while (true) {
          // Fetch a batch of IDs to delete
          const rows = await db.conversation.findMany({
            where,
            select: { conversationId: true },
            take: BATCH_SIZE,
          });

          if (rows.length === 0) break;

          const ids = rows.map(r => r.conversationId);

          // Fetch messageIds for this batch (needed to delete message-level children)
          const messageRows = await db.message.findMany({
            where: { conversationId: { in: ids } },
            select: { messageId: true },
          });
          const messageIds = messageRows.map(m => m.messageId);

          // Delete all child records in dependency order to avoid FK violations
          if (messageIds.length > 0) {
            await db.reaction.deleteMany({ where: { messageId: { in: messageIds } } });
            await db.reactionCount.deleteMany({ where: { messageId: { in: messageIds } } });
          }
          await db.conversationParticipant.deleteMany({ where: { conversationId: { in: ids } } });
          await db.messageAttachment.deleteMany({ where: { conversationId: { in: ids } } });
          await db.message.deleteMany({ where: { conversationId: { in: ids } } });

          const { count } = await db.conversation.deleteMany({
            where: { conversationId: { in: ids } },
          });

          totalDeleted += count;
          batch++;

          logger.info('[MigrationCleanupController] Batch deleted', {
            batch,
            batchSize: count,
            totalDeleted,
            channelId: channelId ?? 'ALL',
          });

          if (rows.length < BATCH_SIZE) break; // Last batch

          await sleep(BATCH_GAP_MS);
        }

        logger.info('[MigrationCleanupController] Deletion complete', {
          totalBatches: batch,
          totalDeleted,
          channelId: channelId ?? 'ALL',
        });
      })().catch(error => {
        logger.error('[MigrationCleanupController] Batch deletion failed', { error });
      });
    } catch (error) {
      logger.error('[MigrationCleanupController] cleanupOrphanConversations failed', { error });
      res.status(500).json({ error: 'Failed to cleanup orphan conversations' });
    }
  };
}
