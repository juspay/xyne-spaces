import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { findOrCreateConversation, updateConversation, getChannelHistory, getConversationReplies } from '../core/conversationUtils';
import { repositories } from '@/database/repositories';
import { resolveSlackMentions } from '@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver';
import { SlackBlockKitParser } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser';
import { SlackAttachment } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitTypes';
import { config } from '@/config/env';
import { resolveChannelId } from '../utils/channelUtils';
import { MessageType } from '@xyne/shared';
import { validateFlowDefinition, formatValidationErrors } from '@xyne/shared';
import { ContentFormat } from '../types';
import { updateAppActionStatus } from '@/utils/appActionMarkdownUtils';
import { sanitizeMessageContent, isAlphanumericId, encodeHtmlAttr } from '@/utils/contentUtils';
import { redisService } from '@/services/redisService';
import { assertWebhookUrlSafe } from '@/utils/ssrfGuard';

const ChatActionBodySchema = z.object({
  text: z.string().optional(), // plain text or Slack BlockKit — processed through parser
  markdownText: z.string().optional(), // raw markdown (with optional frontmatter) — stored as-is
  attachments: z.array(z.any()).optional(),
  metadata: z.record(z.unknown()).optional(), // message metadata (e.g. hasAppActions, appId)
  // Only the internal S2S /api/internal/postAsUser route (no app auth) supplies this;
  // app-token callers are identified via req.user set by authenticateApp.
  userId: z.string().min(1, 'User ID is required').trim().optional(),
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
  agentSlug: z.string().min(1).trim().optional(),
  agentName: z.string().min(1).trim().optional(),
  toolLabel: z.string().optional(),
  status: z.enum(['working', 'done']).default('working'),
  triggeredByUserId: z.string().min(1).trim().optional(), // human who started the run — gates the Stop button
  sessionId: z.string().min(1).trim().optional(),         // run id — scopes done-suppression so a straggler from a finished run can't resurrect the spinner
});

const ConversationRepliesQuerySchema = z.object({
  channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
  channelName: z.string().min(1, 'Channel name is required').trim().optional(),
  conversationId: z.string().min(1, 'Conversation ID is required').trim(),
  limit: z.string().optional().transform(val => val ? parseInt(val, 10) : 1000),
  cursor: z.string().optional(),
});

const ConversationAttachmentsQuerySchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required').trim(),
});

export class ChatController {
  /**
   * Get all attachments for a conversation
   * GET /api/external-event/chat/conversationAttachments?conversationId=xxx
   */
  getConversationAttachments = async (req: Request, res: Response): Promise<void> => {
    try {
      const queryResult = ConversationAttachmentsQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: queryResult.error.errors });
        return;
      }

      const { conversationId } = queryResult.data;
      const attachments = await repositories.messageAttachments.findByConversationId(conversationId);

      res.status(200).json({ conversationId, attachments });
    } catch (error) {
      logger.error('Error fetching conversation attachments:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

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
    attachments?: SlackAttachment[],
    workspaceId?: string,
  ): Promise<string> {
    const botOauthToken = config.slackBotToken;
    let resolvedText = text;
    let resolvedAttachments = attachments;

    // Resolve mentions in text if text exists
    if (resolvedText) {
      resolvedText = await resolveSlackMentions(resolvedText, botOauthToken, false, workspaceId);
    }

    // Resolve mentions in attachments if attachments exist
    if (resolvedAttachments && resolvedAttachments.length > 0) {
      const attachmentsJson = JSON.stringify(resolvedAttachments);
      const resolvedJson = await resolveSlackMentions(attachmentsJson, botOauthToken, true, workspaceId);
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
   * - channelId or conversationId: string - Target channel or conversation
   *
   * The posting user is taken from the app token (req.user); only the internal
   * S2S postAsUser route passes userId in the body.
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

      // App-token callers post as the authenticated bot user; the S2S postAsUser
      // route has no req.user and passes the human user's id in the body.
      const senderUserId = req.user?.id ?? userId;
      if (!senderUserId) {
        res.status(400).json({ error: 'userId is required', code: 'VALIDATION_ERROR' });
        return;
      }

      const resolvedChannelId = await resolveChannelId(channelId, conversationId, channelName);

      let content: string;
      let isMarkdown = !!markdownText || contentFormat === ContentFormat.MARKDOWN;

      if (flow) {
        const flowId = crypto.randomUUID();
        // Verified token appId for app callers; the S2S postAsUser route may pass it in the body.
        const appId = (req as any).auth?.appId ?? (req.body as Record<string, unknown>).appId;
        if (appId !== undefined && !isAlphanumericId(appId)) {
          res.status(400).json({ error: 'Invalid appId', code: 'VALIDATION_ERROR' });
          return;
        }
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

        const escapedJSON = encodeHtmlAttr(JSON.stringify(flowResult.data));
        // Inner text = notification/preview fallback (shown when the widget
        // isn't rendered). Prefer flow.data.fallbackText, then the flow title,
        // else a generic label — never worse than the old hardcoded "Flow JSON".
        const fbRaw = (flowResult.data.data as Record<string, unknown> | undefined)?.['fallbackText'];
        const flowFallback = encodeHtmlAttr(
          (typeof fbRaw === 'string' && fbRaw.trim() ? fbRaw : flowResult.data.title) || 'Flow JSON',
        );
        content = `<div data-flow-json="${escapedJSON}" data-flow-appid="${encodeHtmlAttr(appId)}" data-flow-id="${encodeHtmlAttr(flowId)}">${flowFallback}</div>`;
        isMarkdown = false;
      } else if (markdownText) {
        content = sanitizeMessageContent(markdownText);
      } else if (contentFormat === ContentFormat.MARKDOWN) {
        content = sanitizeMessageContent(text || '');
      } else {
          content = await this.processMessageContent(text, attachments, req.user?.workspaceId);
      }

      // Messages posted via the internal /api/internal/postAsUser route are authored
      // on behalf of a real human user (Digital Twin approvals), so they must be
      // persisted as USER messages — otherwise the dashboard renders them with the
      // Xyne bot avatar/name instead of the user's profile picture. Every other
      // (app-token) caller stays BOT. Gated on the trusted S2S route marker so an
      // app token can never forge a message that appears to come from a human.
      const messageType = (req as Request & { isPostAsUser?: boolean }).isPostAsUser
        ? MessageType.USER
        : MessageType.BOT;

      const result = await findOrCreateConversation(
        resolvedChannelId,
        senderUserId,
        content,
        isMarkdown,
        conversationId,
        uploadedFiles,
        messageType,
        { ...(isMarkdown && { contentFormat: ContentFormat.MARKDOWN }), ...metadata },
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
        const appId = (req as any).auth?.appId ?? (req.body as Record<string, unknown>).appId;
        if (appId !== undefined && !isAlphanumericId(appId)) {
          res.status(400).json({ error: 'Invalid appId', code: 'VALIDATION_ERROR' });
          return;
        }
        const flowId = (flowResult.data.screenId) ?? crypto.randomUUID();
        const escapedJSON = encodeHtmlAttr(JSON.stringify(flowResult.data));
        // Inner text = notification/preview fallback (see postMessage above).
        const fbRaw = (flowResult.data.data as Record<string, unknown> | undefined)?.['fallbackText'];
        const flowFallback = encodeHtmlAttr(
          (typeof fbRaw === 'string' && fbRaw.trim() ? fbRaw : flowResult.data.title) || 'Flow JSON',
        );
        content = `<div data-flow-json="${escapedJSON}" data-flow-appid="${encodeHtmlAttr(appId)}" data-flow-id="${encodeHtmlAttr(flowId)}">${flowFallback}</div>`;
      } else if (markdownText) {
        content = sanitizeMessageContent(markdownText);
      } else {
          content = await this.processMessageContent(text, attachments, req.user?.workspaceId);
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
   * Body: { conversationId, channelId?, agentSlug?, toolLabel?, status }
   * The agent's spacesAppUserId comes from the app token (req.user) — it must be a channel participant.
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
      const { conversationId, channelId, agentSlug, agentName, toolLabel, status, triggeredByUserId, sessionId } = parsed.data;
      const userId = req.user!.id; // agent's spacesAppUserId from the verified app token

      // Resolve channelId if only conversationId was given — dashboard subscribes on channel.
      const resolvedChannelId = await resolveChannelId(channelId, conversationId);

      const stateKey = `agent_progress:conversation:${conversationId}`;
      const stateTtlSeconds = 10 * 60;
      // Session-scoped done marker. The terminal `done` and a late tool-label
      // `working` arrive as separate webhook requests and can race across the
      // multi-hop async chain (claw → claw-auth → spaces → redis), sometimes by
      // more than a few seconds. Keying the marker by sessionId (the run id) makes
      // suppression deterministic: a straggler `working` from the finished run is
      // always dropped, while a brand-new run (new sessionId) is never suppressed —
      // unlike a time-window guard, which both misfires on slow stragglers and
      // wrongly eats the early `working` of an immediate re-run.
      const doneSessionKey = sessionId ? `agent_progress_done_session:${sessionId}` : null;
      const doneSessionTtlSeconds = 120;

      if (status !== 'done' && doneSessionKey && (await redisService.get(doneSessionKey))) {
        res.status(200).json({ success: true, suppressed: true });
        return;
      }

      // Tool-label updates from the runner don't carry all presentation metadata;
      // carry it forward from the existing hash field so the Stop button and display
      // name survive across the whole run (and after a thread reopen/rehydrate).
      let resolvedTriggeredBy = triggeredByUserId ?? null;
      let resolvedAgentName = agentName ?? null;
      if ((!resolvedTriggeredBy || !resolvedAgentName) && status !== 'done') {
        const existingRaw = await redisService.getHashField(stateKey, userId);
        if (existingRaw) {
          try {
            const existing = JSON.parse(existingRaw) as { triggeredByUserId?: string; agentName?: string };
            resolvedTriggeredBy = resolvedTriggeredBy ?? existing.triggeredByUserId ?? null;
            resolvedAgentName = resolvedAgentName ?? existing.agentName ?? null;
          } catch { /* ignore malformed */ }
        }
      }

      const now = new Date().toISOString();
      const payload = {
        conversationId,
        channelId: resolvedChannelId,
        agentSlug,
        agentName: resolvedAgentName ?? agentSlug ?? null,
        agentUserId: userId,
        sessionId: sessionId ?? null,
        toolLabel: toolLabel ?? null,
        status,
        triggeredByUserId: resolvedTriggeredBy,
        timestamp: now,
      };

      // Persist current state in a Redis hash so clients that open the thread mid-run
      // (or reload) can rehydrate. TTL = 10 min matches the client's stale backstop;
      // a single tool step may run for minutes without emitting new progress events,
      // so anything shorter would vanish the spinner even though the agent is still working.
      if (status === 'done') {
        if (doneSessionKey) await redisService.set(doneSessionKey, now, doneSessionTtlSeconds);
        await redisService.deleteHashField(stateKey, userId);
      } else {
        await redisService.setHashField(stateKey, userId, JSON.stringify(payload), stateTtlSeconds);
      }

      // Broadcast the live event to subscribed sockets.
      const event = {
        messageId: `agent_progress_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        conversationId,
        senderId: userId,
        senderName: resolvedAgentName ?? agentSlug ?? 'agent',
        content: JSON.stringify({ type: 'agent_progress', data: payload }),
        msgType: MessageType.SYSTEM as const,
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
    // `actionableUrl` is caller-supplied, so it goes through `assertWebhookUrlSafe`.
    // The first-party internal callback (same origin as backendUrl, authenticated
    // with the S2S key) is exempt so it works even when backendUrl is a private/dev host.
    try {
      const isInternalSpacesCallback = (() => {
        try {
          return new URL(actionableUrl).origin === new URL(config.backendUrl).origin;
        } catch {
          return false;
        }
      })();

      if (!isInternalSpacesCallback) {
        // Throws on a blocked target; caught below, so the action simply isn't dispatched.
        await assertWebhookUrlSafe(actionableUrl);
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (isInternalSpacesCallback) {
        const s2sKey = config.internalS2sKey;
        if (s2sKey) {
          headers['x-s2s-key'] = s2sKey;
        } else {
          logger.error('[dispatchAction] INTERNAL_S2S_KEY is missing; internal callback cannot be authenticated');
        }
      }

      const callbackRes = await fetch(actionableUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ actionId, context, messageId, conversationId, callerUserId }),
        redirect: 'manual', // don't follow 3xx redirects
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
