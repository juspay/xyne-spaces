import { ChannelController } from '@/controllers/channelController';
import { transaction } from '../base';
import type { MessageAttachment } from '@prisma/client';
import { db } from '@/database/client';
import { ensureDmConversationAuthorParticipant } from '@/utils/dmConversationParticipants';
import { Prisma } from '@prisma/client';
import { MessageType, ChannelScopeType, AttachmentEntityType } from '@xyne/shared';


export function sendForwardedMessageTx(channelId: string, senderId: string, channelWorkspaceId: string, isCall: boolean, meta: any, xmlContent: string, originalAttachments: MessageAttachment[], targetChannel: any, originalMessage: any, self: ChannelController) {
  return transaction(['Channel', 'ChannelStats', 'ChannelUserStatus', 'Conversation', 'ConversationParticipant', 'Message', 'MessageAttachment'], 'sendForwardedMessage: forwarded conversation, message, attachment clones and channel stats must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    // Create conversation
  const conversation = await tx.conversation.create({
    data: {
      channelId: channelId,
      createdBy: senderId,
      initialMessageId: 'temp',
      workspaceId: channelWorkspaceId,
      lastActivityAt: new Date(),
      replyCount: 0,
      pinned: false,
    },
  });

    const forwardedMessageMetadata = {} as Record<string, unknown>;
    if (isCall) {
      forwardedMessageMetadata['isCallMessage'] = true;
      if (meta?.callId) {
        forwardedMessageMetadata['callId'] = meta.callId;
      }
    }

    // Create the forwarded message with XML content
    const createdMessage = await tx.message.create({
      data: {
        conversationId: conversation.conversationId,
        senderId: senderId,
        workspaceId: channelWorkspaceId,
        content: xmlContent,
        msgType: MessageType.FORWARDED,
        hasAttachment: originalAttachments.length > 0,
        metadata: forwardedMessageMetadata as Prisma.InputJsonValue,
      },
    });
    if (targetChannel) {
      await ensureDmConversationAuthorParticipant({
        channelId,
        conversationId: conversation.conversationId,
        senderId,
        scopeType: targetChannel.scopeType as ChannelScopeType,
        tx,
      });
    }

     // Copy attachments to the new message
     const copiedAttachments: any[] = [];
    if (originalAttachments.length > 0) {
       // Preserve the sender's display order: sort by explicit position
       // (falling back to createdAt/id for legacy rows), then stamp a fresh
       // strictly-increasing position + createdAt on each copy so the
       // forwarded message renders in the same order as the source.
       const orderedOriginalAttachments = [...originalAttachments].sort(
         (a, b) =>
           (a.position ?? Number.MAX_SAFE_INTEGER) -
             (b.position ?? Number.MAX_SAFE_INTEGER) ||
           a.createdAt.getTime() - b.createdAt.getTime() ||
           a.id.localeCompare(b.id)
       );
       const forwardCloneBaseTs = Date.now();
       for (const [attIndex, attachment] of orderedOriginalAttachments.entries()) {
         const copiedAttachment = await tx.messageAttachment.create({
           data: {
             entityId: createdMessage.messageId,
             entityType: AttachmentEntityType.CHAT,
             originalFilename: attachment.originalFilename,
             size: attachment.size,
             mimetype: attachment.mimetype,
             url: attachment.url,
             thumbnailUrl: attachment.thumbnailUrl || undefined,
             uploadedByUserId: senderId,
             createdBy: senderId,
             storageProvider: attachment.storageProvider,
             conversationId: conversation.conversationId,
             workspaceId: channelWorkspaceId,
            metadata: (attachment.metadata as Record<string, any>) || {},
             width: attachment.width ?? undefined,
             height: attachment.height ?? undefined,
             createdAt: new Date(forwardCloneBaseTs + attIndex),
             position: attIndex,
           },
         });
         copiedAttachments.push(copiedAttachment);
       }
     }

    let totalReplyCount = 0;

    // If it is a call message, we want to clone all non-user bot messages (like transcipts/summaries)
    if (isCall) {
      // Get all bot thread messages from the original conversation
      const botMessages = await tx.message.findMany({
        where: {
          conversationId: originalMessage.conversationId,
          msgType: MessageType.BOT
        }
      });

      totalReplyCount = botMessages.length;

      // Insert the cloned bot messages into the new conversation
      for (let i = 0; i < botMessages.length; i++) {
        const botMsg = botMessages[i]!;
        const clonedMessage = await tx.message.create({
          data: {
            conversationId: conversation.conversationId,
            senderId: botMsg.senderId,
            workspaceId: channelWorkspaceId,
            content: botMsg.content,
            msgType: botMsg.msgType,
            hasAttachment: botMsg.hasAttachment,
            edited: botMsg.edited,
            isDeleted: botMsg.isDeleted,
            isSent: botMsg.isSent,
            showInChannel: botMsg.showInChannel,
            childConversationId: botMsg.childConversationId,
            metadata: (botMsg.metadata as Prisma.InputJsonValue) || {},
            visibleTo: botMsg.visibleTo,
          }
        });

        // If the bot message had attachments, clone them too
        if (botMsg.hasAttachment) {
          const botOriginalAttachments = await tx.messageAttachment.findMany({
            where: {
              entityId: botMsg.messageId,
              entityType: AttachmentEntityType.CHAT
            }
          });

          const botChannelWorkspaceId = await self.channelRepository.getWorkspaceId(conversation.channelId);
          const orderedBotAttachments = [...botOriginalAttachments].sort(
            (a, b) =>
              (a.position ?? Number.MAX_SAFE_INTEGER) -
                (b.position ?? Number.MAX_SAFE_INTEGER) ||
              a.createdAt.getTime() - b.createdAt.getTime() ||
              a.id.localeCompare(b.id)
          );
          const botCloneBaseTs = Date.now();
          for (const [botAttIndex, originalAtt] of orderedBotAttachments.entries()) {
            await tx.messageAttachment.create({
              data: {
                entityId: clonedMessage.messageId,
                entityType: AttachmentEntityType.CHAT,
                originalFilename: originalAtt.originalFilename,
                size: originalAtt.size,
                mimetype: originalAtt.mimetype,
                url: originalAtt.url,
                thumbnailUrl: originalAtt.thumbnailUrl || undefined,
                uploadedByUserId: senderId,
                createdBy: senderId,
                storageProvider: originalAtt.storageProvider,
                conversationId: conversation.conversationId,
                workspaceId: botChannelWorkspaceId,
                metadata: (originalAtt.metadata as Prisma.InputJsonValue) || {},
                width: originalAtt.width ?? undefined,
                height: originalAtt.height ?? undefined,
                createdAt: new Date(botCloneBaseTs + botAttIndex),
                position: botAttIndex,
              }
            });
          }
        }
      }
    }

    // Update conversation with real initial message ID and replyCount
    await tx.conversation.update({
      where: { conversationId: conversation.conversationId },
      data: { 
        initialMessageId: createdMessage.messageId,
        replyCount: totalReplyCount,
      },
    });

    // Update channel last activity in channel_stats
    await tx.channelStats.upsert({
      where: { channelId },
      update: { lastActivityAt: new Date() },
      create: { channelId, lastActivityAt: new Date(), workspaceId: channelWorkspaceId },
    });

    // Reopen DM for all participants so they can see the message
    await tx.channelUserStatus.updateMany({
      where: { channelId: channelId, isClosed: true },
      data: { isClosed: false, updatedAt: new Date() },
    });

    return {
      conversation,
      createdMessage,
      copiedAttachments,
    };
  });
}
