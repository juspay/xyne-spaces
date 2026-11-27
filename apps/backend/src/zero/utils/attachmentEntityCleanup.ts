import { AttachmentEntityType } from '@xyne/shared';
import { derive } from '@xyne/contracts';
import { storageService } from '@/services/storage';
import { deleteHeicRenditions, isHeicAttachment } from '@/services/heicRenditionService';
import { deleteVideoRenditions, isVideoMimetype } from '@/services/videoRenditionService';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { zql } from '../queries';
import type { UnreadableTransaction } from '../unreadableTransaction';

async function deleteEntityAttachmentsByType(
  tx: UnreadableTransaction,
  asyncTasks: Array<() => Promise<void>>,
  entityId: string,
  entityType: AttachmentEntityType,
): Promise<void> {
  const attachments = await tx.read(
    zql.message_attachments.where('entityId', entityId).where('entityType', entityType),
    { originalFilename: { isHeic: derive.isHeic } },
  );

  for (const { row: attachment, facts } of attachments) {
    const url = attachment.url;
    const thumbnailUrl = attachment.thumbnailUrl;
    // isHeicAttachment's rule: the MIME type, else the file name's extension (the fact).
    const isHeic = isHeicAttachment(attachment.mimetype, '') || (facts.originalFilename?.isHeic ?? false);
    await tx.mutate.message_attachments.delete({ id: attachment.id });
    asyncTasks.push(async () => {
      try {
        if (url) {
          await storageService.deleteFile(url);
          if (thumbnailUrl) {
            await storageService.deleteFile(thumbnailUrl);
          }
          if (isHeic) {
            await deleteHeicRenditions(url);
          }
          if (isVideoMimetype(attachment.mimetype)) {
            await deleteVideoRenditions(url);
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
  tx: UnreadableTransaction,
  asyncTasks: Array<() => Promise<void>>,
  entityId: string,
): Promise<void> {
  return deleteEntityAttachmentsByType(tx, asyncTasks, entityId, AttachmentEntityType.DRAFT);
}

/**
 * Delete all DELAYED_MESSAGE-entity attachments for a delayed_messages row id.
 */
export async function deleteDelayedMessageEntityAttachments(
  tx: UnreadableTransaction,
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
      entityType: AttachmentEntityType.DELAYED_MESSAGE,
    },
  });

  for (const attachment of attachments) {
    await db.messageAttachment.delete({ where: { id: attachment.id } });
    try {
      if (attachment.url) {
        await storageService.deleteFile(attachment.url);
        if (attachment.thumbnailUrl) {
          await storageService.deleteFile(attachment.thumbnailUrl);
        }
        if (isHeicAttachment(attachment.mimetype, attachment.originalFilename)) {
          await deleteHeicRenditions(attachment.url);
        }
        if (isVideoMimetype(attachment.mimetype)) {
          await deleteVideoRenditions(attachment.url);
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
