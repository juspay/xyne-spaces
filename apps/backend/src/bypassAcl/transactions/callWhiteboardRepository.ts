import { transaction } from '../base';
import { CallWhiteboardRepository, SaveCallWhiteboardAttachmentInput } from '@/database/repositories/callWhiteboardRepository';
import { AttachmentEntityType, MessageType, serializeRepliesMd, addReplyToData, parseRepliesMd } from '@xyne/shared';
import { advisoryXactLock } from '@/bypassAcl/lockServices';


export function saveCallWhiteboardAttachmentTx(self: CallWhiteboardRepository, lockKey: string, data: SaveCallWhiteboardAttachmentInput) {
  return transaction(['Conversation', 'ConversationParticipant', 'Message', 'MessageAttachment'], 'saveCallWhiteboardAttachment: whiteboard message, attachment and conversation counters must commit atomically; tx is not ACL-wrapped', self.db, 
    async tx => {
      await advisoryXactLock(tx, ['MessageAttachment'],
        'call whiteboard: serialize get-or-create of the whiteboard attachment for a call page',
        lockKey);

      const existing = await tx.messageAttachment.findFirst({
        where: {
          AND: [
            { metadata: { path: ['callId'], equals: data.callId } },
            ...(data.pageId ? [{ metadata: { path: ['pageId'], equals: data.pageId } }] : []),
            { metadata: { path: ['type'], equals: 'whiteboard' } },
            { entityType: AttachmentEntityType.CHAT },
            { isDeleted: false },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        return {
          attachment: existing,
          alreadyExists: true,
          whiteboardMessageId: existing.entityId,
        };
      }

      const now = new Date();
      const whiteboardMessage = await tx.message.create({
        data: {
          conversationId: data.conversationId,
          workspaceId: data.workspaceId,
          senderId: data.botUserId,
          content: '',
          msgType: MessageType.BOT,
          hasAttachment: true,
          showInChannel: false,
          metadata: {
            callId: data.callId,
            type: 'whiteboard',
            messageSubtype: 'call_whiteboard',
            callMessageId: data.callMessageId,
            savedByUserId: data.savedByUserId,
            ...(data.pageId && { pageId: data.pageId }),
            ...(data.pageLabel && { pageLabel: data.pageLabel }),
            ...(data.pageOrder !== undefined && { pageOrder: data.pageOrder }),
          },
        },
      });

      const attachment = await tx.messageAttachment.create({
        data: {
          entityId: whiteboardMessage.messageId,
          entityType: AttachmentEntityType.CHAT,
          workspaceId: data.workspaceId,
          originalFilename: data.originalFilename,
          size: data.size,
          mimetype: 'image/png',
          url: data.url,
          ...(data.width !== undefined && { width: data.width }),
          ...(data.height !== undefined && { height: data.height }),
          uploadedByUserId: data.savedByUserId,
          createdBy: data.savedByUserId,
          storageProvider: data.storageProvider,
          conversationId: data.conversationId,
          metadata: {
            callId: data.callId,
            type: 'whiteboard',
            callMessageId: data.callMessageId,
            messageId: whiteboardMessage.messageId,
            savedByUserId: data.savedByUserId,
            ...(data.pageId && { pageId: data.pageId }),
            ...(data.pageLabel && { pageLabel: data.pageLabel }),
            ...(data.pageOrder !== undefined && { pageOrder: data.pageOrder }),
            ...(data.width !== undefined && { width: data.width }),
            ...(data.height !== undefined && { height: data.height }),
          },
        },
      });

      const conversation = await tx.conversation.findUnique({
        where: { conversationId: data.conversationId },
        select: { replies_md: true },
      });
      const updatedRepliesMd = serializeRepliesMd(
        addReplyToData(parseRepliesMd(conversation?.replies_md), data.botUserId),
      );

      await tx.conversation.update({
        where: { conversationId: data.conversationId },
        data: {
          replyCount: { increment: 1 },
          lastActivityAt: now,
          replies_md: updatedRepliesMd,
        },
      });

      await tx.conversationParticipant.updateMany({
        where: { conversationId: data.conversationId },
        data: { lastReplyAt: now },
      });

      return {
        attachment,
        alreadyExists: false,
        whiteboardMessageId: whiteboardMessage.messageId,
      };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}
