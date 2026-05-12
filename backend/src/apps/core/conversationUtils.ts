import { conversationService } from '@/services/conversationService';
import { logger } from '@/utils/logger';
import { MessageType } from '@prisma/client';
import { ChatEventType, ChatActionResponse, ChannelHistoryResponse, ChannelHistoryCursor, ChannelHistoryItem, ConversationRepliesResponse, ConversationRepliesCursor, ConversationRepliesItem } from '../types';
import { UploadedFileResult } from '@/services/fileUploadService';
import { repositories } from '@/database/repositories';
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
