import { MessageRepository } from '@/database/repositories/messageRepository';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { Message } from '@prisma/client';
import { logger } from '@/utils/logger';
import { websocketService } from '../websocketService';
import { redisService } from '../redisService';
import { getBotInfo } from '@/bots/core/bot-utils';
import { FlowJsonUtils } from '@/utils/flowJsonUtils';
import type { FlowJson } from '@/bots/json-ui/types';
import { createFlowJson, createSingleLineText, createMultiLineText, createFlexLayout, createTag } from '@/bots/json-ui';

export interface BotMessageMetadata {
  botExecutionId: string;
  botName: string;
  messageType: 'trigger' | 'processing' | 'response' | 'error';
  data?: Record<string, any>;
}

export class BotExecutionSession {
  private messageRepository: MessageRepository;
  private conversationRepository: ConversationRepository;
  private channelRepository: ChannelRepository;

  constructor(
    private executionId: string,
    private conversationId: string,
    private botName: string
  ) {
    this.messageRepository = new MessageRepository();
    this.conversationRepository = new ConversationRepository();
    this.channelRepository = new ChannelRepository();
  }

  async sendMessage(content: string, data?: Record<string, any>, messageType: 'processing' | 'response' | 'error' = 'response'): Promise<Message> {
    try {
      
      

      const metadata: BotMessageMetadata = {
        botExecutionId: this.executionId,
        botName: this.botName,
        messageType,
        data: data
      };

      // Content should always be stringified JSON
      const jsonContent = content;

      const message = await this.messageRepository.create({
        conversationId: this.conversationId,
        senderId: this.botName, // Use bot name as sender ID
        content: jsonContent,
        msgType: 'BOT',
        metadata
      });

      // Get bot info for consistent formatting
      const botInfo = getBotInfo(this.botName);
      const senderName = botInfo ? botInfo.name : `${this.botName} Bot`;
      const senderPicture = botInfo ? botInfo.picture : undefined;

      // Broadcast message via WebSocket and Redis
      const chatMessage = {
        messageId: message.messageId,
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderName,
        senderPicture,
        content: jsonContent, // Always stringified JSON
        msgType: message.msgType,
        createdAt: message.createdAt,
      };

      // Update conversation reply count and last activity (like regular user replies)
      await this.conversationRepository.incrementReplyCount(this.conversationId);

      // Update channel last activity
      const conversation = await this.conversationRepository.findById(this.conversationId);
      if (conversation) {
        await this.channelRepository.updateLastActivity(conversation.channelId);
      }

      await websocketService.broadcastToSession(this.conversationId, 'new_message', chatMessage);
      await redisService.broadcastMessageToSession(this.conversationId, chatMessage);

      logger.info(`Bot session ${this.executionId} sent ${messageType} message: ${message.messageId}`);
      return message;
    } catch (error) {
      logger.error(`Failed to send message in bot session ${this.executionId}:`, error);
      throw error;
    }
  }

  async sendError(error: string, details?: Record<string, any>): Promise<Message> {
    // Create a nice FlowJSON UI for the error instead of raw JSON
    const errorFlowJson = this.createErrorFlowJson(error, details);

    const errorData: Record<string, string> = {
      error: error,
      botName: this.botName,
      messageType: 'error'
    };

    // Add details as flattened string values
    if (details) {
      for (const [key, value] of Object.entries(details)) {
        errorData[key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
    }

    return this.sendMessage(
      JSON.stringify(errorFlowJson), // Use FlowJSON instead of plain JSON
      errorData,
      'error'
    );
  }

  async getTriggerMessage(): Promise<Message | null> {
    try {
      return await this.messageRepository.findById(this.executionId);
    } catch (error) {
      logger.error(`Failed to get trigger message for execution ${this.executionId}:`, error);
      return null;
    }
  }

  getExecutionId(): string {
    return this.executionId;
  }

  getConversationId(): string {
    return this.conversationId;
  }

  private createErrorFlowJson(error: string, _details?: Record<string, any>): FlowJson {
    // Create error title
    const titleComponent = createSingleLineText('Error', {
      weight: 'bold',
      size: 'lg',
      color: '#DC2626' // Red color for errors
    });

    // Create bot name tag
    const botTag = createTag(this.botName, {
      variant: 'subtle',
      color: 'error',
      size: 'sm'
    });

    // Create error message (clean up the error text)
    const cleanError = this.cleanErrorMessage(error);
    const errorComponent = createMultiLineText(cleanError, {
      weight: 'normal',
      size: 'sm',
      color: '#374151' // Gray color for error text
    });

    // Build components array
    const components = [
      titleComponent,
      botTag,
      errorComponent
    ];

    // Create layout
    const rootComponent = createFlexLayout(components, {
      direction: 'column',
      gap: 12,
      padding: 16,
      background: '#FEF2F2', // Light red background
      borderRadius: 8
    });

    const flowJsonResult = createFlowJson(this.botName, rootComponent);

    if (!flowJsonResult.success) {
      // Fallback to simple format
      const fallbackText = `❌ Error: ${cleanError}`;
      const fallbackComponent = createSingleLineText(fallbackText, {
        color: '#DC2626'
      });
      const fallbackResult = createFlowJson(this.botName, fallbackComponent);
      return fallbackResult.success ? fallbackResult.data : {
        version: '1.0',
        metadata: { botName: this.botName, timestamp: new Date().toISOString() },
        root: { type: 'singleLineText', props: { text: fallbackText, color: '#DC2626' } }
      };
    }

    return flowJsonResult.data;
  }

  private cleanErrorMessage(error: string): string {
    // Clean up common error patterns to make them more user-friendly
    let cleanedError = error;

    // Remove "Bot execution failed:" prefix
    cleanedError = cleanedError.replace(/Bot execution failed:\s*/, '');

    // For Prisma errors, extract the meaningful message at the end
    if (cleanedError.includes('Invalid `prisma.') && cleanedError.includes('A record with this')) {
      // Extract the meaningful message after the Prisma details
      const meaningfulMatch = cleanedError.match(/A record with this \w+ already exists/);
      if (meaningfulMatch) {
        return meaningfulMatch[0];
      }
    }

    // Handle other common Prisma constraint errors
    cleanedError = cleanedError.replace(/Unique constraint failed on the fields: \(`(\w+)`\)/, 'A record with this $1 already exists');

    // Remove Prisma invocation details (everything before the meaningful message)
    cleanedError = cleanedError.replace(/Invalid `prisma\.\w+\.\w+\(\)` invocation[\s\S]*?(?=A record with this|Unique constraint|$)/g, '');

    return cleanedError.trim();
  }

  getBotName(): string {
    return this.botName;
  }

  /**
   * Update a message by appending or replacing FlowJson from this bot
   */
  async updateMessageWithFlowJson(messageId: string, flowJson: FlowJson): Promise<Message> {
    try {
      // Get current message
      const currentMessage = await this.messageRepository.findById(messageId);
      if (!currentMessage) {
        throw new Error(`Message with ID ${messageId} not found`);
      }

      // Update content with FlowJson from this bot
      const updatedContent = FlowJsonUtils.updateFlowJsonFromBot(
        currentMessage.content,
        this.botName,
        flowJson
      );

      // Update the message
      const updatedMessage = await this.messageRepository.update(messageId, { 
        content: updatedContent 
      });

      // Broadcast the updated message
      await this.broadcastUpdatedMessage(updatedMessage);

      return updatedMessage;
    } catch (error) {
      logger.error(`Failed to update message ${messageId} with FlowJson:`, error);
      throw error;
    }
  }

  /**
   * Remove FlowJson from this bot in a specific message
   */
  async removeFlowJsonFromMessage(messageId: string): Promise<Message> {
    try {
      // Get current message
      const currentMessage = await this.messageRepository.findById(messageId);
      if (!currentMessage) {
        throw new Error(`Message with ID ${messageId} not found`);
      }

      // Remove FlowJson from this bot
      const updatedContent = FlowJsonUtils.removeFlowJsonFromBot(
        currentMessage.content,
        this.botName
      );

      // Update the message
      const updatedMessage = await this.messageRepository.update(messageId, { 
        content: updatedContent 
      });

      // Broadcast the updated message
      await this.broadcastUpdatedMessage(updatedMessage);

      return updatedMessage;
    } catch (error) {
      logger.error(`Failed to remove FlowJson from message ${messageId}:`, error);
      throw error;
    }
  }

  /**
   * Check if a message has FlowJson from this bot
   */
  async hasFlowJsonInMessage(messageId: string): Promise<boolean> {
    try {
      const message = await this.messageRepository.findById(messageId);
      if (!message) {
        return false;
      }

      return FlowJsonUtils.hasFlowJsonFromBot(message.content, this.botName);
    } catch (error) {
      logger.error(`Failed to check FlowJson in message ${messageId}:`, error);
      return false;
    }
  }

  /**
   * Broadcast updated message to all connected clients
   */
  private async broadcastUpdatedMessage(message: Message): Promise<void> {
    try {
      // Get bot info for consistent formatting
      const botInfo = getBotInfo(this.botName);
      const senderName = botInfo ? botInfo.name : `${this.botName} Bot`;
      const senderPicture = botInfo ? botInfo.picture : undefined;

      // Create chat message for broadcasting
      const chatMessage = {
        messageId: message.messageId,
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderName,
        senderPicture,
        content: message.content,
        msgType: message.msgType,
        createdAt: message.createdAt,
        isUpdate: true, // Flag to indicate this is an update
      };

      // Broadcast via WebSocket and Redis
      await websocketService.broadcastToSession(this.conversationId, 'message_updated', chatMessage);
      await redisService.broadcastMessageToSession(this.conversationId, chatMessage);

      logger.info(`Broadcasted updated message ${message.messageId} for bot ${this.botName}`);
    } catch (error) {
      logger.error(`Failed to broadcast updated message ${message.messageId}:`, error);
    }
  }
}