import { transaction } from '../base';
import { db } from '@/database/client';
import { AttachmentEntityType } from '@xyne/shared';
import { deleteMessageSearchRow } from '@/bypassAcl/searchIndexServices';


export function deleteConversationMessageTx(messageId: string) {
  return transaction(['Conversation', 'ConversationParticipant', 'Message', 'MessageAttachment', 'Reaction', 'ReactionCount', 'Ticket'], 'deleteConversationMessage: message delete with attachments, reactions and conversation cleanup must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const currentMessage = await tx.message.findUnique({
      where: { messageId },
      select: { messageId: true, isDeleted: true, conversationId: true },
    });
    if (!currentMessage || currentMessage.isDeleted) {
      return { mutated: false, hardDeleted: false, softDeleted: false };
    }

    const currentConversation = await tx.conversation.findUnique({
      where: { conversationId: currentMessage.conversationId },
      select: { conversationId: true, initialMessageId: true, replyCount: true },
    });
    if (!currentConversation) throw new Error(`Conversation not found: ${currentMessage.conversationId}`);

    const allMessages = await tx.message.findMany({
      where: { conversationId: currentMessage.conversationId },
      select: { messageId: true, isDeleted: true },
    });
    const otherMessages = allMessages.filter(m => m.messageId !== messageId);
    const isInitialMessage = currentConversation.initialMessageId === messageId;
    // A ticket thread must outlive its messages: Ticket.conversation is a required relation, so
    // hard-deleting the conversation would throw P2014. Tombstone the initial message instead.
    const hasTicket =
      (await tx.ticket.count({ where: { conversationId: currentConversation.conversationId } })) > 0;
    const shouldSoftDelete = isInitialMessage && (otherMessages.length > 0 || hasTicket);

    await tx.messageAttachment.deleteMany({
      where: { entityId: messageId, entityType: AttachmentEntityType.CHAT },
    });
    await tx.reaction.deleteMany({ where: { messageId } });
    await tx.reactionCount.deleteMany({ where: { messageId } });
    await deleteMessageSearchRow(tx, messageId);

    if (shouldSoftDelete) {
      const updateResult = await tx.message.updateMany({
        where: { messageId, isDeleted: false },
        data: { isDeleted: true, content: '', hasAttachment: false, edited: false, link_preview_md: '' },
      });
      return { mutated: updateResult.count === 1, hardDeleted: false, softDeleted: updateResult.count === 1 };
    }

    const deleteCount = await tx.message.deleteMany({ where: { messageId, isDeleted: false } });
    if (deleteCount.count !== 1) {
      return { mutated: false, hardDeleted: false, softDeleted: false };
    }

    const isOnlyOtherInitialDeleted =
      otherMessages.length === 1 &&
      otherMessages[0]?.messageId === currentConversation.initialMessageId &&
      otherMessages[0]?.isDeleted === true;

    if (!hasTicket && (otherMessages.length === 0 || isOnlyOtherInitialDeleted)) {
      if (isOnlyOtherInitialDeleted && otherMessages[0]) {
        await tx.message.deleteMany({ where: { messageId: otherMessages[0].messageId } });
      }
      await tx.conversationParticipant.deleteMany({ where: { conversationId: currentConversation.conversationId } });
      await tx.conversation.deleteMany({ where: { conversationId: currentConversation.conversationId } });
    } else {
      await tx.conversation.update({
        where: { conversationId: currentConversation.conversationId },
        data: { replyCount: Math.max(0, currentConversation.replyCount - 1) },
      });
    }

    const channelCopies = await tx.conversation.findMany({
      // Skip copies that carry a ticket — deleting them would throw P2014 (see hasTicket above).
      where: {
        initialMessageId: messageId,
        NOT: { conversationId: currentConversation.conversationId },
        tickets: { none: {} },
      },
      select: { conversationId: true },
    });
    for (const channelCopy of channelCopies) {
      await tx.conversationParticipant.deleteMany({ where: { conversationId: channelCopy.conversationId } });
      await tx.message.deleteMany({ where: { conversationId: channelCopy.conversationId } });
      await tx.conversation.deleteMany({ where: { conversationId: channelCopy.conversationId } });
    }

    return { mutated: true, hardDeleted: true, softDeleted: false };
  });
}
