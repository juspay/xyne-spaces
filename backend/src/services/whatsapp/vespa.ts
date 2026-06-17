import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import { channelSchema } from '@/vespa/src/types';
import { NAMESPACE } from '@/vespa/vespaConfig';

const db = DatabaseClient.getInstance();

export const queueWhatsAppChannelVespaJob = (channelId: string, userId: string, workspaceId?: string): void => {
  logger.info('[WhatsAppMigration] Queueing channel Vespa job', {
    channelId,
    userId,
    workspaceId,
  });
  vespaQueue.addJob({
    schema: channelSchema,
    jobType: 'feed',
    docId: channelId,
    ...(workspaceId ? { workspaceId } : {}),
  }).catch(async error => {
    logger.error('[WhatsAppMigration] Error queuing Vespa job for channel', error, { channelId });
    try {
      await db.vespaInsertionLogs.create({
        data: {
          status: 'FAILED',
          type: 'INSERT',
          entityId: channelId,
          entityType: channelSchema,
          namespace: NAMESPACE,
          errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
          errorDetails: JSON.stringify(error),
          userId,
          createdAt: new Date(),
        },
      });
    } catch (dbError) {
      logger.error('[WhatsAppMigration] Failed to log Vespa channel insertion error', dbError, { channelId });
    }
  });
};
