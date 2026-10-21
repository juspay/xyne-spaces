import { transaction } from '../base';
import { db } from '@/services/whatsappMigrationService';


export function purgeImportTx(attachments: { id: string; url: string; thumbnailUrl: string | null; }[], messageId: string, shouldSoftDelete: boolean, shouldDeleteConversation: boolean, conversation: any) {
  return transaction(['Conversation', 'ConversationParticipant', 'Message', 'MessageAttachment', 'Reaction', 'ReactionCount'], 'purgeImport: import message, attachment, reaction, and conversation deletes must commit atomically; tx is not ACL-wrapped', db, async tx => {
    if (attachments.length > 0) {
      await tx.messageAttachment.deleteMany({
        where: {
          id: { in: attachments.map(attachment => attachment.id) },
        },
      });
    }

    await tx.reactionCount.deleteMany({ where: { messageId } });
    await tx.reaction.deleteMany({ where: { messageId } });

    if (shouldSoftDelete) {
      await tx.message.update({
        where: { messageId },
        data: {
          isDeleted: true,
          content: '',
          hasAttachment: false,
          edited: false,
          link_preview_md: '',
        },
      });
    } else {
      await tx.message.deleteMany({ where: { messageId } });

      if (shouldDeleteConversation) {
        await tx.conversationParticipant.deleteMany({
          where: { conversationId: conversation.conversationId },
        });
        await tx.conversation.deleteMany({
          where: { conversationId: conversation.conversationId },
        });
      }
    }
  });
}
export function purgeImportTx2(sourceId: string) {
  return transaction(['ExternalMessage', 'ExternalSource'], 'purgeImport: external message plus source deletes must commit atomically; tx is not ACL-wrapped', db, async tx => {
    const externalDeleteResult = await tx.externalMessage.deleteMany({
      where: { externalSourceId: sourceId },
    });
    await tx.externalSource.delete({ where: { id: sourceId } });
    return externalDeleteResult.count;
  });
}
