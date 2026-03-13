import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { findOrCreateConversation, updateConversation } from '../core/conversationUtils';
import { resolveSlackMentions } from '@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver';
import { SlackBlockKitParser } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser';
import { SlackAttachment } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitTypes';
import { config } from '@/config/env';


const ChatActionBodySchema = z.object({
  text: z.string().optional(),
  attachments: z.array(z.any()).optional(),
  userId: z.string().min(1, 'User ID is required').trim(),
});

const PostMessageBodySchema = ChatActionBodySchema.extend({
  channelId: z.string().min(1, 'Channel ID is required').trim(),
  conversationId: z.string().trim().optional(),
});

const UpdateMessageBodySchema = ChatActionBodySchema.extend({
  messageId: z.string().min(1, 'Message ID is required').trim(),
  channelId: z.string().optional(),
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

      const { channelId, text, conversationId, attachments, userId } = bodyResult.data;

      // Process message content (resolve mentions and parse with BlockKit)
      const content = await this.processMessageContent(text, attachments);

      // Post the message
      const result = await findOrCreateConversation(
        channelId,
        userId,
        content,
        conversationId
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
}
