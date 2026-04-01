import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { findOrCreateConversation, updateConversation, getChannelHistory, getConversationReplies } from '../core/conversationUtils';
import { resolveSlackMentions } from '@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver';
import { SlackBlockKitParser } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser';
import { SlackAttachment } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitTypes';
import { config } from '@/config/env';
import { resolveChannelId } from '../utils/channelUtils';
import { MessageType, ContentFormat } from '@xyne/shared';

const ChatActionBodySchema = z.object({
  text: z.string().optional(),
  attachments: z.array(z.any()).optional(),
  userId: z.string().min(1, 'User ID is required').trim(),
  uploadedFiles: z.array(z.object({
    originalName: z.string(),
    fileName: z.string(),
    fileSize: z.number(),
    mimeType: z.string(),
    fileUrl: z.string(),
    thumbnailUrl: z.string().optional(),
  })).optional(),
  contentFormat: z.nativeEnum(ContentFormat).optional(),
});

const PostMessageBodySchema = ChatActionBodySchema.extend({
  channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
  conversationId: z.string().trim().optional(),
}).refine(
  data => !!data.channelId || !!data.conversationId,
  { message: 'Either channelId or conversationId is required', path: ['channelId'] }
);

const UpdateMessageBodySchema = ChatActionBodySchema.extend({
  messageId: z.string().min(1, 'Message ID is required').trim(),
  channelId: z.string().optional(),
});

const ChannelHistoryQuerySchema = z.object({
  channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
  conversationId: z.string().min(1, 'Conversation ID is required').trim().optional(),
  limit: z.string().optional().transform(val => val ? parseInt(val, 10) : 1000),
  cursor: z.string().optional(),
}).refine(
  data => !!data.channelId || !!data.conversationId,
  { message: 'Either channelId or conversationId is required', path: ['channelId'] }
);

const ConversationRepliesQuerySchema = z.object({
  channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
  conversationId: z.string().min(1, 'Conversation ID is required').trim(),
  limit: z.string().optional().transform(val => val ? parseInt(val, 10) : 1000),
  cursor: z.string().optional(),
});

export class ChatController {
  private blockKitParser: SlackBlockKitParser;

  constructor() {
    this.blockKitParser = new SlackBlockKitParser();
  }

  /**
   * Helper function to resolve Slack mentions and parse content with BlockKit parser
   * Follows the same pattern as transformer.ts
   */
  private async processMessageContent(
    text?: string,
    attachments?: SlackAttachment[]
  ): Promise<string> {
    const botOauthToken = config.slackBotToken;
    let resolvedText = text;
    let resolvedAttachments = attachments;

    // Resolve mentions in text if text exists
    if (resolvedText) {
      resolvedText = await resolveSlackMentions(resolvedText, botOauthToken);
    }

    // Resolve mentions in attachments if attachments exist
    if (resolvedAttachments && resolvedAttachments.length > 0) {
      const attachmentsJson = JSON.stringify(resolvedAttachments);
      const resolvedJson = await resolveSlackMentions(attachmentsJson, botOauthToken, true);
      resolvedAttachments = JSON.parse(resolvedJson);
    }

    // Parse with Block Kit parser (same as transformer.ts)
    return this.blockKitParser.parse({
      text: resolvedText,
      attachments: resolvedAttachments,
    });
  }

  /**
   * Post a message to a channel or conversation
   * POST /api/external-event/chat/postMessage
   * 
   * Required fields:
   * - userId: string - User ID posting the message
   * - channelId or conversationId: string - Target channel or conversation
   * 
   * Optional fields:
   * - text: string - Message text content
   * - attachments: array - Slack-style attachments (will be parsed)
   * - uploadedFiles: array - Pre-uploaded files to attach
   * - msgType: 'USER' | 'BOT' | 'SYSTEM' - Message type (defaults to USER)
   * - metadata: object - Additional metadata
   * - replyBroadcast: boolean - Show reply in channel
   * - lastActivityAt: string - Custom last activity timestamp
   * - isBot: boolean - Whether the message is from a bot
   * - createdAt: string - Custom creation timestamp
   */
  postMessage = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body with Zod
      const bodyResult = PostMessageBodySchema.safeParse(req.body);
      
      if (!bodyResult.success) {
        res.status(400).json({ 
          error: `Validation error`,
          code: 'VALIDATION_ERROR',
          details: bodyResult.error.errors
        });
        return;
      }

      const { 
        channelId, 
        text, 
        conversationId, 
        attachments, 
        userId,
        uploadedFiles,
        contentFormat,
      } = bodyResult.data;

      // Resolve channelId from conversationId if not provided
      const resolvedChannelId = await resolveChannelId(channelId, conversationId);

      let content = text || '';
      console.log(`Received message content for posting:`, { text, attachments, contentFormat });
      if(contentFormat !== ContentFormat.MARKDOWN){
        // Process message content (resolve mentions and parse with BlockKit)
        content = await this.processMessageContent(text, attachments);
      }

      // Post the message with all features
      const result = await findOrCreateConversation(
        resolvedChannelId,
        userId,
        content,
        conversationId,
        uploadedFiles,
        contentFormat as ContentFormat | undefined,
        MessageType.BOT
      );

      res.status(201).json(result);
    } catch (error) {
      logger.error('Error posting message:', error);

      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          res.status(404).json({
            error: error.message,
            code: 'NOT_FOUND',
          });
          return;
        }
        if (error.message.includes('required')) {
          res.status(400).json({
            error: error.message,
            code: 'VALIDATION_ERROR',
          });
          return;
        }
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Update a message in a conversation
   * POST /api/external-event/chat/updateMessage
   */
  updateMessage = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body with Zod
      const bodyResult = UpdateMessageBodySchema.safeParse(req.body);
      
      if (!bodyResult.success) {
        res.status(400).json({ 
          error: `Validation error`,
          code: 'VALIDATION_ERROR',
          details: bodyResult.error.errors
        });
        return;
      }

      const { messageId, text, attachments } = bodyResult.data;

      // Process message content (resolve mentions and parse with BlockKit)
      const content = await this.processMessageContent(text, attachments);

      // Update the message
      const result = await updateConversation(
        messageId,
        content
      );

      res.status(200).json(result);
    } catch (error) {
      logger.error('Error updating message:', error);

      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          res.status(404).json({
            error: error.message,
            code: 'NOT_FOUND',
          });
          return;
        }
        if (error.message.includes('required')) {
          res.status(400).json({
            error: error.message,
            code: 'VALIDATION_ERROR',
          });
          return;
        }
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Get channel history with cursor-based pagination
   * GET /api/external-event/chat/channelHistory?channelId=xxx&limit=1000&cursor=xxx
   */
  channelHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const queryResult = ChannelHistoryQuerySchema.safeParse(req.query);
      
      if (!queryResult.success) {

        res.status(400).json({ 
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
        });
        return;
      }

      const { channelId, conversationId, limit, cursor } = queryResult.data;

      // Resolve channelId from conversationId if not provided
      const resolvedChannelId = await resolveChannelId(channelId, conversationId);

      const response = await getChannelHistory(resolvedChannelId, limit, cursor);

      res.status(200).json(response);
    } catch (error) {
      logger.error('Error fetching channel history:', error);

      if (error instanceof Error) {
        if (error.message.includes('Invalid cursor format')) {
          res.status(400).json({
            error: error.message,
            code: 'INVALID_CURSOR',
          });
          return;
        }
        if (error.message.includes('not found')) {
          res.status(404).json({
            error: error.message,
            code: 'NOT_FOUND',
          });
          return;
        }
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Get conversation replies with cursor-based pagination
   * GET /api/external-event/chat/conversationReplies?channelId=xxx&conversationId=xxx&limit=1000&cursor=xxx
   */
  conversationReplies = async (req: Request, res: Response): Promise<void> => {
    try {
      const queryResult = ConversationRepliesQuerySchema.safeParse(req.query);
      
      if (!queryResult.success) {
        res.status(400).json({ 
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
        });
        return;
      }

      const { channelId, conversationId, limit, cursor } = queryResult.data;

      // Resolve channelId from conversationId if not provided
      const resolvedChannelId = await resolveChannelId(channelId, conversationId);

      const response = await getConversationReplies(resolvedChannelId, conversationId, limit, cursor);

      res.status(200).json(response);
    } catch (error) {
      logger.error('Error fetching conversation replies:', error);

      if (error instanceof Error) {
        if (error.message.includes('Invalid cursor format')) {
          res.status(400).json({
            error: error.message,
            code: 'INVALID_CURSOR',
          });
          return;
        }
        if (error.message.includes('not found')) {
          res.status(404).json({
            error: error.message,
            code: 'NOT_FOUND',
          });
          return;
        }
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
