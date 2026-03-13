import { conversationService } from '@/services/conversationService';
import { logger } from '@/utils/logger';
import { MessageType } from '@prisma/client';
import { ChatEventType, ChatActionResponse } from '../types';
import { UploadedFileResult } from '@/services/fileUploadService';

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
 * @returns The result containing conversation and message IDs
 */
export async function findOrCreateConversation(
    channelId: string,
    userId: string,
    content: string,
    conversationId?: string,
    uploadedFiles?: UploadedFileResult[],
    msgType?: MessageType
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
        uploadedFiles: uploadedFiles,
      });

      return {
        eventType: ChatEventType.MESSAGE_POSTED,
        conversationId: result.conversation.conversationId,
        messageId: result.message.messageId,
      };
    } else {
      logger.info(`[INGEST-CONVERSATION] Creating new conversation in channel ${channelId}`);
      
      const result = await conversationService.createConversationWithMessage({
        channelId: channelId,
        userId: userId,
        content: content,
        msgType: messageType,
        uploadedFiles: uploadedFiles,
      });

      return {
        eventType: ChatEventType.MESSAGE_POSTED,
        conversationId: result.conversation.conversationId,
        messageId: result.message.messageId,
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
    };
  } catch (error) {
    logger.error('[UPDATE-CONVERSATION] Error updating conversation:', error);
    throw error;
  }
}
