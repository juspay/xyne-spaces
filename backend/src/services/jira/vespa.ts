import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, messageSchema, ticketSchema, SubApp } from '@/vespa/src/types';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { isSupportedMimeType } from '@/services/fileProcessor';

const db = DatabaseClient.getInstance();

export const queueJiraImportMessageVespaJob = (messageId: string, userId: string): void => {
  vespaQueue.addJob({
    schema: messageSchema,
    jobType: 'feed',
    docId: messageId,
  }).catch(async (error) => {
    logger.error('[JiraMigrationImport] Error queuing Vespa job for message', error, { messageId });
    try {
      await db.vespaInsertionLogs.create({
        data: {
          status: 'FAILED',
          type: 'INSERT',
          entityId: messageId,
          entityType: messageSchema,
          namespace: NAMESPACE,
          errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
          errorDetails: JSON.stringify(error),
          userId,
          createdAt: new Date(),
        },
      });
    } catch (dbError) {
      logger.error('[JiraMigrationImport] Failed to log Vespa message insertion error', dbError, { messageId });
    }
  });
};

export const queueJiraImportAttachmentVespaJob = async (attachmentId: string, userId: string, mimetype?: string): Promise<void> => {
  try {
    let resolvedMimetype = mimetype;

    if (!resolvedMimetype) {
      const attachment = await db.messageAttachment.findUnique({
        where: { id: attachmentId },
        select: { mimetype: true }
      });
      resolvedMimetype = attachment?.mimetype;
    }

    if (!resolvedMimetype || !isSupportedMimeType(resolvedMimetype)) {
      logger.info('[JiraMigrationImport] Skipping Vespa job for attachment due to unsupported MIME type or not found', {
        attachmentId,
        mimetype: resolvedMimetype
      });
      return;
    }

    vespaQueue.addJob({
      schema: fileSchema,
      jobType: 'feed',
      docId: attachmentId,
      app: SubApp.CHAT_ATTACHMENT,
    }).catch(async (error) => {
      logger.error('[JiraMigrationImport] Error queuing Vespa job for attachment', error, { attachmentId });
      try {
        await db.vespaInsertionLogs.create({
          data: {
            status: 'FAILED',
            type: 'INSERT',
            entityId: attachmentId,
            entityType: fileSchema,
            namespace: NAMESPACE,
            errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
            errorDetails: JSON.stringify(error),
            userId,
            createdAt: new Date(),
          },
        });
      } catch (dbError) {
        logger.error('[JiraMigrationImport] Failed to log Vespa attachment insertion error', dbError, { attachmentId });
      }
    });
  } catch (error) {
    logger.error('[JiraMigrationImport] Error checking attachment for Vespa job', error, { attachmentId });
  }
};


export const queueJiraImportTicketVespaJob = (ticketId: string, userId: string): void => {
  vespaQueue.addJob({
    schema: ticketSchema,
    jobType: 'feed',
    docId: ticketId,
    userId,
  }).catch(async (error) => {
    logger.error('[JiraMigrationImport] Error queuing Vespa job for ticket', error, { ticketId });
    try {
      await db.vespaInsertionLogs.create({
        data: {
          status: 'FAILED',
          type: 'INSERT',
          entityId: ticketId,
          entityType: ticketSchema,
          namespace: NAMESPACE,
          errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
          errorDetails: JSON.stringify(error),
          userId,
          createdAt: new Date(),
        },
      });
    } catch (dbError) {
      logger.error('[JiraMigrationImport] Failed to log Vespa ticket insertion error', dbError, { ticketId });
    }
  });
};
