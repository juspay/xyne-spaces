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
import { validateFlowDefinition, formatValidationErrors } from '@xyne/shared';
import { ContentFormat } from '../types';
import { updateAppActionStatus } from '@/utils/appActionMarkdownUtils';
import { redisService } from '@/services/redisService';

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
  // Flow-based UI support — v2 only
  flow: z.object({
    version: z.literal('2.0'),
    screenId: z.string().optional(),
    title: z.string().optional(),
    components: z.array(z.record(z.any())).optional(),
    data: z.record(z.unknown()).optional(),
    state: z.object({
      values: z.record(z.unknown()),
      touched: z.record(z.boolean()),
      errors: z.record(z.string()),
      submitting: z.boolean(),
      submitted: z.boolean(),
      history: z.array(z.string()),
      loadingComponentIds: z.array(z.string()).optional(),
    }),
  }).optional(),
}).refine(
  data => !!data.text || !!data.markdownText || !!data.flow || (data.attachments && data.attachments.length > 0),
  { message: 'Either text, markdownText, flow, or attachments is required', path: ['text'] }
).refine(
  data => !!data.channelId || !!data.channelName || !!data.conversationId,
  { message: 'Either channelId, channelName, or conversationId is required', path: ['channelId'] }
);

const UpdateMessageBodySchema = ChatActionBodySchema.extend({
  messageId: z.string().min(1, 'Message ID is required').trim(),
  channelId: z.string().optional(),
  channelName: z.string().trim().optional(),
  flowJSON: z.record(z.unknown()).optional(),
}).refine(
  data => !!data.text || !!data.markdownText || !!data.flowJSON || (data.attachments && data.attachments.length > 0),
  { message: 'Either text, markdownText, flowJSON, or attachments is required', path: ['text'] }
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

/**
 * Ephemeral agent progress signal — no DB write, just Redis pub/sub.
 * Published by xyne-claw-auth while an agent is running. Consumed by the dashboard
 * to render <AgentSpinner /> inline (same transport as the typing indicator).
 */
const AgentProgressBodySchema = z.object({
  conversationId: z.string().min(1).trim(),
  channelId: z.string().min(1).trim().optional(),
  userId: z.string().min(1).trim(),     // agent's spacesAppUserId — must be channel participant
  agentSlug: z.string().min(1).trim().optional(),
  toolLabel: z.string().optional(),
  status: z.enum(['working', 'done']).default('working'),
});

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
   * - metadata: object - Additional metadata
   * - flow: object - v2 Flow UI definition
   */
  postMessage = async (req: Request, res: Response): Promise<void> => {
    try {
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
        flow,
        conversationId,
        attachments,
        userId,
        uploadedFiles,
        metadata,
        contentFormat,
      } = bodyResult.data;

      const resolvedChannelId = await resolveChannelId(channelId, conversationId, channelName);

      let content: string;
      let isMarkdown = !!markdownText || contentFormat === ContentFormat.MARKDOWN;

      if (flow) {
        const flowId = crypto.randomUUID();
        const appId = (req.body as Record<string, unknown>).appId as string;
        const flowJSON = {
          version: '2.0' as const,
          screenId: flow.screenId ?? flowId,
          title: flow.title,
          components: flow.components ?? [],
          data: flow.data,
          state: {
            ...flow.state,
            loadingComponentIds: flow.state.loadingComponentIds ?? [],
          },
        };

        // Validate against the strict schema before storing
        const flowResult = validateFlowDefinition(flowJSON);
        if (!flowResult.success) {
          res.status(400).json({
            error: 'Invalid flowJSON',
            code: 'VALIDATION_ERROR',
            details: formatValidationErrors(flowResult),
          });
          return;
        }

        const escapedJSON = JSON.stringify(flowResult.data).replace(/"/g, '&quot;');
        content = `<div data-flow-json="${escapedJSON}" data-flow-appid="${appId ?? ''}" data-flow-id="${flowId}">Flow JSON</div>`;
        isMarkdown = false;
      } else if (markdownText) {
        content = markdownText;
      } else if (contentFormat === ContentFormat.MARKDOWN) {
        content = text || '';
      } else {
          content = await this.processMessageContent(text, attachments);
      }

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
      const bodyResult = UpdateMessageBodySchema.safeParse(req.body);

      if (!bodyResult.success) {
        res.status(400).json({
          error: `Validation error`,
          code: 'VALIDATION_ERROR',
          details: bodyResult.error.errors
        });
        return;
      }

      const { messageId, text, markdownText, flowJSON, attachments } = bodyResult.data;

      let content: string;

      if (flowJSON) {
        const flowResult = validateFlowDefinition(flowJSON);
        if (!flowResult.success) {
          res.status(400).json({
            error: 'Invalid flowJSON',
            code: 'VALIDATION_ERROR',
            details: formatValidationErrors(flowResult),
          });
          return;
        }
        const appId = (req.body as Record<string, unknown>).appId as string | undefined;
        const flowId = (flowResult.data.screenId) ?? crypto.randomUUID();
        const escapedJSON = JSON.stringify(flowResult.data).replace(/"/g, '&quot;');
        content = `<div data-flow-json="${escapedJSON}" data-flow-appid="${appId ?? ''}" data-flow-id="${flowId}">Flow JSON</div>`;
      } else if (markdownText) {
        content = markdownText;
      } else {
          content = await this.processMessageContent(text, attachments);
      }

      const result = await updateConversation(messageId, content);

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
   * Publish an ephemeral agent progress signal (no DB write).
   * POST /api/apps/chat/agentProgress
   *
   * Body: { conversationId, channelId?, userId (agent), agentSlug?, toolLabel?, status }
   * Delivery: Redis pub/sub on `session:{channelId}:messages` — same channel as typing indicator,
   * so the dashboard WebSocket already subscribes. msgType=SYSTEM so it does not persist.
   */
  agentProgress = async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = AgentProgressBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: parsed.error.errors });
        return;
      }
      const { conversationId, channelId, userId, agentSlug, toolLabel, status } = parsed.data;

      // Resolve channelId if only conversationId was given — dashboard subscribes on channel.
      const resolvedChannelId = await resolveChannelId(channelId, conversationId);

      const now = new Date().toISOString();
      const payload = {
        conversationId,
        channelId: resolvedChannelId,
        agentSlug,
        agentUserId: userId,
        toolLabel: toolLabel ?? null,
        status,
        timestamp: now,
      };

      // Persist current state in a Redis hash so clients that open the thread mid-run
      // (or reload) can rehydrate. TTL = 10 min matches the client's stale backstop;
      // a single tool step may run for minutes without emitting new progress events,
      // so anything shorter would vanish the spinner even though the agent is still working.
      const stateKey = `agent_progress:conversation:${conversationId}`;
      const stateTtlSeconds = 10 * 60;
      if (status === 'done') {
        await redisService.deleteHashField(stateKey, userId);
      } else {
        await redisService.setHashField(stateKey, userId, JSON.stringify(payload), stateTtlSeconds);
      }

      // Broadcast the live event to subscribed sockets.
      const event = {
        messageId: `agent_progress_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        conversationId,
        senderId: userId,
        senderName: agentSlug ?? 'agent',
        content: JSON.stringify({ type: 'agent_progress', data: payload }),
        msgType: 'SYSTEM' as const,
        createdAt: new Date(),
      };
      await redisService.broadcastMessageToSession(resolvedChannelId, event);

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[agentProgress] publish error:', error);
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
    const callerUserId = req.user?.id;

    if (!actionId || !actionableUrl || !messageId || !conversationId) {
      res.status(400).json({ error: 'actionId, actionableUrl, messageId, conversationId are required' });
      return;
    }


    // Acknowledge immediately so the frontend isn't blocked
    res.status(200).json({ success: true });

    // Forward to the external URL server-side (no CORS issues)
    // callerUserId is derived from the authenticated session (XYNE-12145)
    try {
      const callbackRes = await fetch(actionableUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId, context, messageId, conversationId, callerUserId }),
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