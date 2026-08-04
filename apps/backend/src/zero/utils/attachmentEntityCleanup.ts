import type { Transaction } from '@rocicorp/zero';
import { AttachmentEntityType, type Schema } from '@xyne/shared';
import { AttachmentEntityType as PrismaAttachmentEntityType } from '@prisma/client';
import { storageService } from '@/services/storage';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { zql } from '../queries';
import { getVideoPreviewMetadata } from '@/services/videoPreviewMetadata';

async function deleteEntityAttachmentsByType(
  tx: Transaction<Schema>,
  asyncTasks: Array<() => Promise<void>>,
  entityId: string,
  entityType: AttachmentEntityType,
): Promise<void> {
  const attachments = await tx.run(
    zql.message_attachments.where('entityId', entityId).where('entityType', entityType),
  );

  for (const attachment of attachments) {
    const url = attachment.url;
    const thumbnailUrl = attachment.thumbnailUrl;
    const previewUrl = getVideoPreviewMetadata(attachment.metadata)?.previewUrl;
    await tx.mutate.message_attachments.delete({ id: attachment.id });
    asyncTasks.push(async () => {
      try {
        if (url) {
          await storageService.deleteFile(url);
          if (thumbnailUrl) {
            await storageService.deleteFile(thumbnailUrl);
          }
          if (previewUrl && previewUrl !== url) {
            await storageService.deleteFile(previewUrl);
          }
        }
      } catch (error) {
        logger.error(`Failed to delete GCS file for attachmentId ${attachment.id}:`, error);
      }
    });
  }
}

/**
 * Delete all DRAFT-entity attachments for an entityId inside a Zero transaction,
 * and enqueue best-effort GCS deletes after commit.
 */
export async function deleteDraftEntityAttachments(
  tx: Transaction<Schema>,
  asyncTasks: Array<() => Promise<void>>,
  entityId: string,
): Promise<void> {
  return deleteEntityAttachmentsByType(tx, asyncTasks, entityId, AttachmentEntityType.DRAFT);
}

/**
 * Delete all DELAYED_MESSAGE-entity attachments for a delayed_messages row id.
 */
export async function deleteDelayedMessageEntityAttachments(
  tx: Transaction<Schema>,
  asyncTasks: Array<() => Promise<void>>,
  entityId: string,
): Promise<void> {
  return deleteEntityAttachmentsByType(
    tx,
    asyncTasks,
    entityId,
    AttachmentEntityType.DELAYED_MESSAGE,
  );
}

/**
 * Prisma + GCS cleanup for delayed message attachments (worker / side-effects paths).
 * Deletes attachment rows then attempts GCS deletion; clears hasAttachment on the row.
 */
export async function cleanupDelayedMessageAttachmentsPrisma(
  delayedMessageId: string,
): Promise<void> {
  const attachments = await db.messageAttachment.findMany({
    where: {
      entityId: delayedMessageId,
      entityType: PrismaAttachmentEntityType.DELAYED_MESSAGE,
    },
  });

  for (const attachment of attachments) {
    const previewUrl = getVideoPreviewMetadata(attachment.metadata)?.previewUrl;
    await db.messageAttachment.delete({ where: { id: attachment.id } });
    try {
      if (attachment.url) {
        await storageService.deleteFile(attachment.url);
        if (attachment.thumbnailUrl) {
          await storageService.deleteFile(attachment.thumbnailUrl);
        }
        if (previewUrl && previewUrl !== attachment.url) {
          await storageService.deleteFile(previewUrl);
        }
      }
    } catch (error) {
      logger.error(`Failed to delete GCS file for attachmentId ${attachment.id}:`, error);
    }
  }

  try {
    await db.delayedMessage.update({
      where: { id: delayedMessageId },
      data: { hasAttachment: false },
    });
  } catch (error) {
    logger.warn(
      `Could not clear hasAttachment for delayed message ${delayedMessageId}:`,
      error,
    );
  }
}
