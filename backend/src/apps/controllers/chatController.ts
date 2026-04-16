import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { findOrCreateConversation, updateConversation, getChannelHistory, getConversationReplies } from '../core/conversationUtils';
import { resolveSlackMentions } from '@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver';
import { SlackBlockKitParser } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser';
import { SlackAttachment } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitTypes';
import { config } from '@/config/env';
import { resolveChannelId } from '../utils/channelUtils';
import { MessageType } from '@xyne/shared';
import { ContentFormat } from '../types';
import { updateAppActionStatus } from '@/utils/appActionMarkdownUtils';

const ChatActionBodySchema = z.object({
  text: z.string().optional(), // plain text or Slack BlockKit — processed through parser
  markdownText: z.string().optional(), // raw markdown (with optional frontmatter) — stored as-is
  attachments: z.array(z.any()).optional(),
  metadata: z.record(z.unknown()).optional(), // message metadata (e.g. hasAppActions, appId)
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
  channelName: z.string().min(1, 'Channel name is required').trim().optional(),
  conversationId: z.string().trim().optional(),
}).refine(
  data => !!data.text || !!data.markdownText,
  { message: 'Either text or markdownText is required', path: ['text'] }
).refine(
  data => !!data.channelId || !!data.channelName || !!data.conversationId,
  { message: 'Either channelId, channelName, or conversationId is required', path: ['channelId'] }
);

const UpdateMessageBodySchema = ChatActionBodySchema.extend({
  messageId: z.string().min(1, 'Message ID is required').trim(),
  channelId: z.string().optional(),
  channelName: z.string().trim().optional(),
}).refine(
  data => !!data.text || !!data.markdownText,
  { message: 'Either text or markdownText is required', path: ['text'] }
);

const ChannelHistoryQuerySchema = z.object({
  channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
  channelName: z.string().min(1, 'Channel name is required').trim().optional(),
  conversationId: z.string().min(1, 'Conversation ID is required').trim().optional(),
  limit: z.string().optional().transform(val => val ? parseInt(val, 10) : 1000),
  cursor: z.string().optional(),
}).refine(
  data => !!data.channelId || !!data.channelName || !!data.conversationId,
  { message: 'Either channelId, channelName, or conversationId is required', path: ['channelId'] }
);

const ConversationRepliesQuerySchema = z.object({
  channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
  channelName: z.string().min(1, 'Channel name is required').trim().optional(),
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
        channelName,
        text,
        markdownText,
        conversationId,
        attachments,
        userId,
        uploadedFiles,
        metadata,
        contentFormat,
      } = bodyResult.data;

      // Resolve channelId from channelName or conversationId if not provided
      const resolvedChannelId = await resolveChannelId(channelId, conversationId, channelName);

      let content: string;
      if (markdownText) {
        content = markdownText;
      } else if (contentFormat === ContentFormat.MARKDOWN) {
        content = text || '';
      } else {
        content = await this.processMessageContent(text, attachments);
      }

      // Post the message with all features
      const isMarkdown = !!markdownText || contentFormat === ContentFormat.MARKDOWN;
      const result = await findOrCreateConversation(
        resolvedChannelId,
        userId,
        content,
        isMarkdown,
        conversationId,
        uploadedFiles,
        MessageType.BOT,
        { contentFormat, ...metadata },
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

      const { messageId, text, markdownText, attachments } = bodyResult.data;

      let content: string;
      if (markdownText) {
        content = markdownText;
      } else {
        content = await this.processMessageContent(text, attachments);
      }

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

      const { channelId, channelName, conversationId, limit, cursor } = queryResult.data;

      // Resolve channelId from channelName or conversationId if not provided
      const resolvedChannelId = await resolveChannelId(channelId, conversationId, channelName);

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

      const { channelId, channelName, conversationId, limit, cursor } = queryResult.data;

      // Resolve channelId from channelName or conversationId if not provided
      const resolvedChannelId = await resolveChannelId(channelId, conversationId, channelName);

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

  /**
   * Proxy an app action to the external actionableUrl and update frontmatter.
   * POST /api/apps/chat/action
   */
  dispatchAction = async (req: Request, res: Response): Promise<void> => {
    const body = req.body as {
      actionId?: unknown;
      actionableUrl?: unknown;
      context?: unknown;
      messageId?: unknown;
      conversationId?: unknown;
    };

    const actionId = typeof body.actionId === 'string' ? body.actionId : '';
    const actionableUrl = typeof body.actionableUrl === 'string' ? body.actionableUrl : '';
    const context = typeof body.context === 'object' && body.context !== null ? body.context : {};
    const messageId = typeof body.messageId === 'string' ? body.messageId : '';
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';

    if (!actionId || !actionableUrl || !messageId || !conversationId) {
      res.status(400).json({ error: 'actionId, actionableUrl, messageId, conversationId are required' });
      return;
    }

    // Acknowledge immediately so the frontend isn't blocked
    res.status(200).json({ success: true });

    // Forward to the external URL server-side (no CORS issues)
    try {
      const callbackRes = await fetch(actionableUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId, context, messageId, conversationId }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!callbackRes.ok) {
        const text = await callbackRes.text().catch(() => '');
        logger.error(`[dispatchAction] Callback failed ${callbackRes.status}: ${text.slice(0, 300)}`);
      }
    } catch (err) {
      logger.error('[dispatchAction] Error calling actionableUrl:', err);
    }

    // Update message frontmatter (action → actioned)
    try {
      await updateAppActionStatus(messageId, actionId);
    } catch (err) {
      logger.error('[dispatchAction] Error updating app action status:', err);
    }
  };
}
