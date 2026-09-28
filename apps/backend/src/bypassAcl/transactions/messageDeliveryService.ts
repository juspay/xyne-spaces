import { transaction } from '../base';
import { db } from '@/database/client';
import { AttachmentEntityType, DelayedMessageStatus } from '@xyne/shared';


export function cleanupSourceTransactionTx(sourceId: string, attachmentEntityType: AttachmentEntityType, kind: string, senderId: string, timestamp: number) {
  return transaction(['DelayedMessage', 'DraftMessage', 'MessageAttachment'], 'cleanupSourceTransaction: attachment cleanup plus draft or delayed-message state change must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    // Delete old DRAFT attachment rows — conversationService already created the CHAT
    // copies when it processed uploadedFiles.
    await tx.messageAttachment.deleteMany({
      where: {
        entityId: sourceId,
        entityType: attachmentEntityType,
      },
    });

    if (kind === 'DRAFT') {
      const draft = await tx.draftMessage.findUnique({
        where: { id: sourceId },
        select: { id: true, userId: true },
      });
      if (!draft) {
        throw new Error('Draft not found during cleanup');
      }
      if (draft.userId !== senderId) {
        throw new Error('Not authorized to deliver this draft');
      }
      await tx.draftMessage.delete({ where: { id: sourceId } });
      return;
    }

    // DELAYED_MESSAGE
    const delayedMessage = await tx.delayedMessage.findUnique({
      where: { id: sourceId },
      select: { id: true, senderId: true, status: true },
    });

    if (!delayedMessage) {
      throw new Error('Delayed message not found during cleanup');
    }
    if (delayedMessage.senderId !== senderId) {
      throw new Error('Not authorized to deliver this delayed message');
    }
    if (delayedMessage.status !== 'SENDING') {
      throw new Error('Delayed message must be in sending state');
    }

    await tx.delayedMessage.update({
      where: { id: sourceId },
      data: {
        status: DelayedMessageStatus.SENT,
        sentAt: new Date(timestamp),
      },
    });
  });
}
