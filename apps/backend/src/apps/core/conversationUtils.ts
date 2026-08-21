import { conversationService } from '@/services/conversationService';
import { AttachmentEntityType, MessageType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { ChatEventType, ChatActionResponse, ChannelHistoryResponse, ChannelHistoryCursor, ChannelHistoryItem, ConversationRepliesResponse, ConversationRepliesCursor, ConversationRepliesItem } from '../types';
import { UploadedFileResult } from '@/services/fileUploadService';
import { repositories } from '@/database/repositories';
import { db } from '@/database/client';
import { storageService } from '@/services/storage';
import { decodeCursor, paginateResults } from './paginationUtils';
import { MessagesSideEffectHandler } from '@/zero/side-effects/tables/messages-handler';
import { buildUserQueryContext } from '@/utils/queryContext';

/**
 * Find or create a conversation and add a message
 * 
 * If conversationId is provided, adds the message as a reply to that conversation.
 * If conversationId is not provided, creates a new conversation with the message.
 * 
 * @param channelId - Channel ID where the message should be posted (required)
 * @param userId - User ID of the app user posting the message (required)
 * @param content - Message text content (required)
 * @param conversationId - Conversation ID to reply to (optional)
 * @param uploadedFiles - Pre-uploaded files to attach to the message (optional)
 * @param msgType - Message type (optional, defaults to USER)
 * @param metadata - Additional metadata (optional)
 * @param replyBroadcast - Show reply in channel (optional)
 * @param lastActivityAt - Custom last activity timestamp (optional)
 * @param isBot - Whether the message is from a bot (optional)
 * @param createdAt - Custom creation timestamp (optional)
 * @returns The result containing conversation and message IDs
 */
export async function findOrCreateConversation(
    channelId: string,
    userId: string,
    content: string,
    isMarkdown?: boolean,
    conversationId?: string,
    uploadedFiles?: UploadedFileResult[],
    msgType?: MessageType,
    metadata?: Record<string, any>,
): Promise<ChatActionResponse> {
  try {
    // Default to USER message type if not provided
    const messageType = msgType || MessageType.USER;

    if (conversationId) {
      logger.info(`[INGEST-CONVERSATION] Adding reply to conversation ${conversationId}`);

      const result = await conversationService.addMessageToConversation({
        conversationId: conversationId,
        userId: userId,
        content: content,
        msgType: messageType,
        isMarkdown: isMarkdown,
        metadata: metadata,
        uploadedFiles: uploadedFiles,
      });

      // Trigger side effects for notifications, activities, and unread counts
      const ctx = await buildUserQueryContext(userId);
      const handler = new MessagesSideEffectHandler(ctx);
      handler.onInsert({
        entityId: result.message.messageId,
        entityType: 'messages',
        operation: 'insert'
      }).catch(err => logger.error('[INGEST-CONVERSATION] Side-effect handler error: addMessageToConversation', err));

      return {
        eventType: ChatEventType.MESSAGE_POSTED,
        conversationId: result.conversation.conversationId,
        messageId: result.message.messageId,
        ticketId: result.conversation.ticketId || undefined,
      };
    } else {
      logger.info(`[INGEST-CONVERSATION] Creating new conversation in channel ${channelId}`);

      const result = await conversationService.createConversationWithMessage({
        channelId: channelId,
        userId: userId,
        content: content,
        msgType: messageType,
        isMarkdown: isMarkdown,
        messageMetadata: metadata,
        uploadedFiles: uploadedFiles,
      });

      // Trigger side effects for notifications, activities, and unread counts
      const ctx = await buildUserQueryContext(userId);
      const handler = new MessagesSideEffectHandler(ctx);
      handler.onInsert({
        entityId: result.message.messageId,
        entityType: 'messages',
        operation: 'insert'
      }).catch(err => logger.error('[INGEST-CONVERSATION] Side-effect handler error: createConversationWithMessage', err));

      return {
        eventType: ChatEventType.MESSAGE_POSTED,
        conversationId: result.conversation.conversationId,
        messageId: result.message.messageId,
        ticketId: result.conversation.ticketId || undefined,
      };
    }
  } catch (error) {
    logger.error('[INGEST-CONVERSATION] Error ingesting conversation:', error);
    throw error;
  }
}

/**
 * Update an existing message in a conversation
 * 
 * @param messageId - Message ID to update (required)
 * @param text - Updated message text content (optional)
 * @returns The result containing conversation and message IDs
 */
export async function updateConversation(
  messageId: string,
  text?: string
): Promise<ChatActionResponse> {
  try {
    logger.info(`[UPDATE-CONVERSATION] Updating message ${messageId}`);
    
    const result = await conversationService.updateMessageContent({
      messageId: messageId,
      content: text,
    });

    return {
      eventType: ChatEventType.MESSAGE_UPDATED,
      conversationId: result.conversation.conversationId,
      messageId: result.message.messageId,
      ticketId: result.conversation.ticketId || undefined,
    };
  } catch (error) {
    logger.error('[UPDATE-CONVERSATION] Error updating conversation:', error);
    throw error;
  }
}


/**
 * Delete an app-authored message using the same soft-vs-hard policy as the UI:
 * root-with-replies is soft-deleted; replies and root-without-replies are hard-deleted.
 * The caller validates actor ownership and channel access before calling.
 */
export async function deleteConversationMessage(
  messageId: string,
  actorUserId: string,
): Promise<ChatActionResponse> {
  try {
    logger.info(`[DELETE-CONVERSATION] Deleting message ${messageId} by ${actorUserId}`);

    const message = await repositories.messages.findById(messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);

    const conversation = await repositories.conversations.findById(message.conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${message.conversationId}`);

    const previousValue = {
      messageId: message.messageId,
      conversationId: message.conversationId,
      senderId: message.senderId,
      msgType: message.msgType,
      content: message.content,
      isDeleted: message.isDeleted,
      channelId: conversation.channelId,
      isThreadReply: conversation.initialMessageId !== message.messageId,
    };

    if (message.isDeleted) {
      return {
        eventType: ChatEventType.MESSAGE_DELETED,
        conversationId: conversation.conversationId,
        messageId: message.messageId,
        channelId: conversation.channelId,
        ticketId: conversation.ticketId || undefined,
      };
    }

    const attachments = await db.messageAttachment.findMany({
      where: { entityId: messageId, entityType: AttachmentEntityType.CHAT },
      select: { url: true, thumbnailUrl: true },
    });

    const deleteResult = await db.$transaction(async (tx) => {
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
      const shouldSoftDelete = isInitialMessage && otherMessages.length > 0;

      await tx.messageAttachment.deleteMany({
        where: { entityId: messageId, entityType: AttachmentEntityType.CHAT },
      });
      await tx.reaction.deleteMany({ where: { messageId } });
      await tx.reactionCount.deleteMany({ where: { messageId } });
      await tx.messageSearch.deleteMany({ where: { messageId } });

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

      if (otherMessages.length === 0 || isOnlyOtherInitialDeleted) {
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
        where: { initialMessageId: messageId, NOT: { conversationId: currentConversation.conversationId } },
        select: { conversationId: true },
      });
      for (const channelCopy of channelCopies) {
        await tx.conversationParticipant.deleteMany({ where: { conversationId: channelCopy.conversationId } });
        await tx.message.deleteMany({ where: { conversationId: channelCopy.conversationId } });
        await tx.conversation.deleteMany({ where: { conversationId: channelCopy.conversationId } });
      }

      return { mutated: true, hardDeleted: true, softDeleted: false };
    });

    if (deleteResult.mutated) {
      for (const attachment of attachments) {
        for (const url of [attachment.url, attachment.thumbnailUrl].filter(Boolean)) {
          storageService.deleteFile(url as string).catch((err: unknown) => logger.error('[DELETE-CONVERSATION] Failed to delete attachment blob', err));
        }
      }

      const ctx = await buildUserQueryContext(actorUserId);
      const handler = new MessagesSideEffectHandler(ctx);
      if (deleteResult.softDeleted) {
        handler.onUpdate({
          entityId: messageId,
          entityType: 'messages',
          operation: 'update',
          previousValue,
        }).catch(err => logger.error('[DELETE-CONVERSATION] Side-effect update handler error', err));
      } else if (deleteResult.hardDeleted) {
        handler.onDelete({
          entityId: messageId,
          entityType: 'messages',
          operation: 'delete',
          previousValue,
        }).catch(err => logger.error('[DELETE-CONVERSATION] Side-effect delete handler error', err));
      }
    }

    return {
      eventType: ChatEventType.MESSAGE_DELETED,
      conversationId: conversation.conversationId,
      messageId: message.messageId,
      channelId: conversation.channelId,
      ticketId: conversation.ticketId || undefined,
    };
  } catch (error) {
    logger.error('[DELETE-CONVERSATION] Error deleting message:', error);
    throw error;
  }
}

/**
 * Get channel history with cursor-based pagination
 * 
 * @param channelId - Channel ID to fetch history for (required)
 * @param limit - Maximum number of items to return (optional, default: 1000, max: 1000)
 * @param cursor - Base64 encoded cursor for pagination (optional)
 * @returns Channel history response with items, next cursor, and hasMore flag
 */
export async function getChannelHistory(
  channelId: string,
  limit?: number,
  cursor?: string
): Promise<ChannelHistoryResponse> {
  try {
    const actualLimit = Math.min(limit || 1000, 1000);

    const decodedCursor = decodeCursor<ChannelHistoryCursor>(cursor);

    const conversations = await repositories.conversations.findManyWithCursor(
      channelId,
      actualLimit + 1,
      decodedCursor
    );

    const initialMessageIds = conversations
      .map(c => c.initialMessageId)
      .filter((id): id is string => !!id);

    const initialMessages = await repositories.messages.findByIds(initialMessageIds);
    const messageById = new Map(initialMessages.map(m => [m.messageId, m]));

    const messageIdsWithAttachments = initialMessages
      .filter(m => m.hasAttachment)
      .map(m => m.messageId);

    const allAttachments = await repositories.messageAttachments.findByMessageIds(messageIdsWithAttachments);
    const attachmentsByMessageId = new Map<string, typeof allAttachments>();
    for (const att of allAttachments) {
      const key = att.entityId;
      const existing = attachmentsByMessageId.get(key);
      if (existing) {
        existing.push(att);
      } else {
        attachmentsByMessageId.set(key, [att]);
      }
    }

    const validItems: ChannelHistoryItem[] = [];
    for (const conversation of conversations) {
      if (!conversation.initialMessageId) {
        continue;
      }

      const message = messageById.get(conversation.initialMessageId);
      if (!message) {
        logger.warn(`[CHANNEL-HISTORY] Initial message not found for conversation ${conversation.conversationId}`);
        continue;
      }

      const fullConversation = await repositories.conversations.findById(conversation.conversationId);
      if (!fullConversation) {
        logger.warn(`[CHANNEL-HISTORY] Conversation details not found for ${conversation.conversationId}`);
        continue;
      }

      let cleanContent = message.content.replace(/<[^>]*>/g, '');
      if (!cleanContent.trim() && message.hasAttachment) {
        cleanContent = 'Sent an attachment';
      }

      const attachments = message.hasAttachment
        ? (attachmentsByMessageId.get(message.messageId) ?? [])
        : [];

      const item: ChannelHistoryItem = {
        initialMessageId: message.messageId,
        conversationId: conversation.conversationId,
        content: message.content, 
        cleanContent: cleanContent,
        userId: message.senderId,
        createdAt: message.createdAt,
        ticketId: fullConversation.ticketId || undefined,
      };

      if (attachments.length > 0) {
        item.attachments = attachments.map(att => ({
          attachmentId: att.id,
          fileName: att.originalFilename,
          fileSize: att.size,
          mimeType: att.mimetype,
          fileUrl: att.url,
        }));
      }

      validItems.push(item);
    }

    const paginationResult = paginateResults(
      validItems,
      actualLimit,
      (item): ChannelHistoryCursor => ({
        conversationId: item.conversationId,
        createdAt: item.createdAt.getTime(),
      })
    );

    return {
      items: paginationResult.items,
      nextCursor: paginationResult.nextCursor,
      hasMore: paginationResult.hasMore,
      channelId,
    };
  } catch (error) {
    logger.error('[CHANNEL-HISTORY] Error fetching channel history:', error);
    throw error;
  }
}

/**
 * Get conversation replies with cursor-based pagination
 * 
 * @param channelId - Channel ID (required for validation)
 * @param conversationId - Conversation ID to fetch replies for (required)
 * @param limit - Maximum number of items to return (optional, default: 1000, max: 1000)
 * @param cursor - Base64 encoded cursor for pagination (optional)
 * @returns Conversation replies response with items, next cursor, and hasMore flag
 */
export async function getConversationReplies(
  channelId: string,
  conversationId: string,
  limit?: number,
  cursor?: string
): Promise<ConversationRepliesResponse> {
  try {
    const conversation = await repositories.conversations.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    if (conversation.channelId !== channelId) {
      throw new Error('Conversation does not belong to the specified channel');
    }

    const actualLimit = Math.min(limit || 1000, 1000);

    const decodedCursor = decodeCursor<ConversationRepliesCursor>(cursor);

    const messages = await repositories.messages.findManyWithCursor(
      conversationId,
      actualLimit + 1,
      decodedCursor
    );

    const messageIdsWithAttachments = messages
      .filter(m => m.hasAttachment)
      .map(m => m.messageId);

    const allAttachments = await repositories.messageAttachments.findByMessageIds(messageIdsWithAttachments);
    const attachmentsByMessageId = new Map<string, typeof allAttachments>();
    for (const att of allAttachments) {
      const key = att.entityId;
      const existing = attachmentsByMessageId.get(key);
      if (existing) {
        existing.push(att);
      } else {
        attachmentsByMessageId.set(key, [att]);
      }
    }

    const itemsResults: ConversationRepliesItem[] = messages.map((message) => {
      const attachments = message.hasAttachment
        ? (attachmentsByMessageId.get(message.messageId) ?? [])
        : [];

      let cleanContent = message.content.replace(/<[^>]*>/g, '');
      if (!cleanContent.trim() && message.hasAttachment) {
        cleanContent = 'Sent an attachment';
      }

      const item: ConversationRepliesItem = {
        messageId: message.messageId,
        conversationId: message.conversationId,
        parentMessageId: conversation.initialMessageId,
        content: message.content, 
        cleanContent: cleanContent, 
        userId: message.senderId,
        createdAt: message.createdAt,
        ticketId: conversation.ticketId || undefined,
      };

      if (attachments.length > 0) {
        item.attachments = attachments.map(att => ({
          attachmentId: att.id,
          fileName: att.originalFilename,
          fileSize: att.size,
          mimeType: att.mimetype,
          fileUrl: att.url,
        }));
      }

      return item;
    });

    const paginationResult = paginateResults(
      itemsResults,
      actualLimit,
      (item): ConversationRepliesCursor => ({
        messageId: item.messageId,
        createdAt: item.createdAt.getTime(),
      })
    );

    return {
      items: paginationResult.items,
      nextCursor: paginationResult.nextCursor,
      hasMore: paginationResult.hasMore,
      channelId,
    };
  } catch (error) {
    logger.error('[CONVERSATION-REPLIES] Error fetching conversation replies:', error);
    throw error;
  }
}
