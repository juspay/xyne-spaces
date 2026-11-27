import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { findOrCreateConversation, updateConversation, deleteConversationMessage, getChannelHistory, getConversationReplies } from '../core/conversationUtils';
import { repositories } from '@/database/repositories';
import { SlackAttachment } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitTypes';
import { config } from '@/config/env';
import { resolveChannelId } from '../utils/channelUtils';
import { api, MessageType, appsChatPostMessageFields, refineAppsChatPostMessage, conversationsSendClient, derivedNames, findSlackMentionIds, mergeSlackMentionIds, slackMessageContentTemplate, markdownContentTemplate, makeUnreadable, deriveFactsFromPlaintext, requestContractOf, type RequestContract, type RouteBody, UnreadableString, type ExtractorName, type DerivedFacts, type FieldFacts, type appsChatPostEphemeralResponseSchema, type appsChatDeleteMessageBodySchema, type appsChatAgentProgressBodySchema, type appsChatAgentProgressResponseSchema } from '@xyne/shared';
import { ContractError } from '@/framework/api';
import { validateFlowDefinition, formatValidationErrors, flowFallbackLabel } from '@xyne/shared';
import { deliverEphemeralMessage } from '../core/ephemeralDelivery';
import { checkBotMessageDelete } from '../core/botMessageDelete';
import { composeForStorage, deriveStoredFacts } from '@/services/encryption/compose';
import { resolveSlackMentionTargets } from '@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver';
import { ContentFormat, type ChatActionResponse } from '../types';
import { updateAppActionStatus } from '@/utils/appActionMarkdownUtils';
import { isAlphanumericId, encodeHtmlAttr } from '@/utils/contentUtils';
import { redisService } from '@/services/redisService';
import { safeWebhookFetch } from '@/utils/ssrfGuard';

const ChatActionBodySchema = z.object({
  text: z.string().optional(), // plain text or Slack BlockKit — processed through parser
  markdownText: z.string().optional(), // raw markdown (with optional frontmatter) — stored as-is
  attachments: z.array(z.any()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(), // message metadata (e.g. hasAppActions, appId)
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

// The internal S2S postAsUser route's body: the bot route's (api.apps.chat.postMessage in
// @xyne/shared) plus the `userId` it posts as.
const PostMessageBodySchema = refineAppsChatPostMessage(
  z.object({ ...appsChatPostMessageFields, userId: ChatActionBodySchema.shape.userId }),
);
/** postMessage's encrypted fields and their facts (from the route contract's one body schema). */
const postMessageRequest = requestContractOf(api.apps.chat.postMessage) as RequestContract;

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

const ConversationAttachmentsQuerySchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required').trim(),
});

// The checked body. Plain or ciphertext: the typed route hands over its fields branded as
// ciphertext (RouteBody), the internal postAsUser route plain ones; both are strings here.
/** The facts the message insert side effects read from the content (as for conversations.send). */
const MESSAGE_CONTENT_FACTS = (derivedNames(conversationsSendClient).content ?? []) as ExtractorName[];

type AppsChatPostMessageBody = RouteBody<typeof api.apps.chat.postMessage> & { userId?: string };
type AppsChatUpdateMessageBody = RouteBody<typeof api.apps.chat.updateMessage>;
type AppsChatPostEphemeralBody = RouteBody<typeof api.apps.chat.postEphemeral>;
type AppsChatPostEphemeralResponse = z.output<typeof appsChatPostEphemeralResponseSchema>;
type AppsChatDeleteMessageBody = z.output<typeof appsChatDeleteMessageBodySchema>;
type AppsChatAgentProgressBody = z.output<typeof appsChatAgentProgressBodySchema>;
type AppsChatAgentProgressResponse = z.output<typeof appsChatAgentProgressResponseSchema>;

/**
 * postMessage's and updateMessage's error answers, as they have always been: ContractError
 * passes through, a "not found" message is a 404, a "required" one a 400, anything else a 500.
 */
function toChatContractError(error: unknown, logMessage: string): ContractError {
  if (error instanceof ContractError) return error;
  logger.error(logMessage, error);
  if (error instanceof Error) {
    if (error.message.includes('not found')) {
      return new ContractError(404, { error: error.message, code: 'NOT_FOUND' });
    }
    if (error.message.includes('required')) {
      return new ContractError(400, { error: error.message, code: 'VALIDATION_ERROR' });
    }
  }
  return new ContractError(500, { error: 'Internal server error' });
}

function chatErrorAnswer(error: unknown, logMessage: string): { status: number; body: unknown } {
  const answer = toChatContractError(error, logMessage);
  return { status: answer.status, body: answer.body };
}

export class ChatController {
  /**
   * Get all attachments for a conversation
   * GET /api/external-event/chat/conversationAttachments?conversationId=xxx
   */
  getConversationAttachments = async (req: Request, res: Response): Promise<void> => {
    try {
      const queryResult = ConversationAttachmentsQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: queryResult.error.issues });
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

  /**
   * Message HTML from Slack-format `text` (mrkdwn, `<@U…>` mentions) and attachments: the
   * mentions' ids come from the facts of `text` (from the encryption service, or derived here
   * from plaintext), they are looked up here (plain ids and profile data), and the HTML is built
   * by compose (template slackMessageContent): by the encryption service while DB encryption is
   * on, here otherwise. The result is what is stored. The controller never reads the text.
   */
  private async buildSlackContent(
    text: UnreadableString | undefined,
    attachments: SlackAttachment[] | undefined,
    workspaceId: string,
    textFacts: FieldFacts | undefined,
  ): Promise<string> {
    const ids = mergeSlackMentionIds([
      {
        users: textFacts?.slackMentionUserIds ?? [],
        groups: textFacts?.slackMentionGroupIds ?? [],
        channels: textFacts?.slackMentionChannels ?? [],
      },
      // attachments are plaintext (the proxy encrypts top-level strings only): found here.
      ...(attachments?.length ? [findSlackMentionIds(JSON.stringify(attachments))] : []),
    ]);
    const mentions = await resolveSlackMentionTargets(ids, config.slackBotToken, workspaceId);
    return composeForStorage(
      {
        template: slackMessageContentTemplate,
        inputs: { text: text ?? null, attachments: attachments ?? null, blocks: null, mentions },
      },
      { workspaceId },
    );
  }

  /** Markdown content (`markdownText`, or `text` with contentFormat markdown), sanitized, built by compose. */
  private buildMarkdownContent(markdown: UnreadableString, workspaceId: string): Promise<string> {
    return composeForStorage({ template: markdownContentTemplate, inputs: { markdown } }, { workspaceId });
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
    // Only the internal S2S /api/internal/postAsUser route still calls this; bots' postMessage is
    // the typed route (apps/routes/chat.ts), which calls sendMessage directly.
    const bodyResult = PostMessageBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({
        error: `Validation error`,
        code: 'VALIDATION_ERROR',
        details: bodyResult.error.issues
      });
      return;
    }
    try {
      // As the typed route's framework does: the encrypted fields keep their value as sent (the
      // parse wrapped them), their facts are derived from it, then they are made unreadable.
      const sent = req.body as Record<string, unknown>;
      const checked = { ...(bodyResult.data as Record<string, unknown>) };
      for (const field of postMessageRequest.unreadableFields) {
        if (field in sent) checked[field] = sent[field];
      }
      const derived = deriveFactsFromPlaintext(checked, derivedNames(postMessageRequest));
      const result = await this.sendMessage({
        body: makeUnreadable(postMessageRequest, checked) as AppsChatPostMessageBody,
        markdownFacts: derived?.fields.markdownText,
        textFacts: derived?.fields.text,
        // App-token callers post as the authenticated bot user; the S2S postAsUser
        // route has no req.user and passes the human user's id in the body.
        senderUserId: req.user?.id ?? bodyResult.data.userId,
        workspaceId: req.user?.workspaceId,
        resolvedChannelId: req._resolvedChannelId,
        // Verified token appId for app callers; the S2S postAsUser route may pass it in the body.
        appId: (req as any).auth?.appId ?? (req.body as Record<string, unknown>).appId,
        isPostAsUser: !!(req as Request & { isPostAsUser?: boolean }).isPostAsUser,
      });
      res.status(201).json(result);
    } catch (error) {
      const answer = chatErrorAnswer(error, 'Error posting message:');
      res.status(answer.status).json(answer.body);
    }
  };

  /**
   * Post a message to a channel or conversation: what POST /api/apps/chat/postMessage (and the
   * internal S2S postAsUser route) run once the body is checked. Throws ContractError for the
   * answers that are not the 201.
   *
   * The posting user is taken from the app token (req.user); only the internal
   * S2S postAsUser route passes userId in the body.
   *
   * Body: channelId or channelName or conversationId; text (plain text or Slack BlockKit) or
   * markdownText or flow (v2 Flow UI) or attachments; uploadedFiles; metadata.
   */
  sendMessage = async (input: {
    body: AppsChatPostMessageBody;
    senderUserId: string | undefined;
    workspaceId: string | undefined;
    /** A `channelId` that named a user, already turned into the bot's DM channel by validateChannelAccessForPostWithDm. */
    resolvedChannelId: string | undefined;
    appId: unknown;
    /** Facts the encryption service extracted from the encrypted `markdownText`. */
    markdownFacts?: FieldFacts;
    /** Facts the encryption service extracted from the encrypted `text` (Slack mentions, content facts). */
    textFacts?: FieldFacts;
    isPostAsUser: boolean;
  }): Promise<ChatActionResponse> => {
    try {
      const {
        channelId,
        channelName,
        text,
        markdownText,
        flow,
        conversationId,
        attachments,
        uploadedFiles,
        metadata,
        contentFormat,
      } = input.body;

      const senderUserId = input.senderUserId;
      if (!senderUserId) {
        throw new ContractError(400, { error: 'userId is required', code: 'VALIDATION_ERROR' });
      }

      // A `channelId` that names a user was turned into the bot's DM channel by
      // validateChannelAccessForPostWithDm; the internal S2S postAsUser route
      // skips that middleware and resolves here as before.
      const resolvedChannelId =
        input.resolvedChannelId ?? (await resolveChannelId(channelId, conversationId, channelName));

      // The workspace whose key the content is stored under: the bot's; the internal postAsUser
      // route has no bot, so its channel's.
      const workspaceId =
        input.workspaceId ?? (await repositories.channels.findById(resolvedChannelId))?.workspaceId ?? config.defaultWorkspaceId;

      let content: string;
      /** Facts of `content`, for the insert side effects (they never parse it). */
      let contentFacts: FieldFacts | undefined;
      let isMarkdown = !!markdownText || contentFormat === ContentFormat.MARKDOWN;

      if (flow) {
        const flowId = crypto.randomUUID();
        const appId = input.appId;
        if (appId !== undefined && !isAlphanumericId(appId)) {
          throw new ContractError(400, { error: 'Invalid appId', code: 'VALIDATION_ERROR' });
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
          throw new ContractError(400, {
            error: 'Invalid flowJSON',
            code: 'VALIDATION_ERROR',
            details: formatValidationErrors(flowResult),
          });
        }

        const escapedJSON = JSON.stringify(flowResult.data).replace(/"/g, '&quot;');
        // Inner text = notification/preview fallback (shown when the widget
        // isn't rendered). Prefer flow.data.fallbackText, then the flow title,
        // else a generic label — never worse than the old hardcoded "Flow JSON".
        const flowFallback = encodeHtmlAttr(flowFallbackLabel(flowResult.data));
        content = `<div data-flow-json="${escapedJSON}" data-flow-appid="${encodeHtmlAttr(appId as string)}" data-flow-id="${encodeHtmlAttr(flowId)}">${flowFallback}</div>`;
        isMarkdown = false;
      } else if (markdownText) {
        content = await this.buildMarkdownContent(markdownText, workspaceId);
        contentFacts = input.markdownFacts;
      } else if (contentFormat === ContentFormat.MARKDOWN) {
        content = text ? await this.buildMarkdownContent(text, workspaceId) : '';
        contentFacts = input.textFacts;
      } else {
        content = await this.buildSlackContent(text, attachments, workspaceId, input.textFacts);
        contentFacts = await deriveStoredFacts(content, MESSAGE_CONTENT_FACTS, { workspaceId });
      }

      // The insert side effects read these facts as the message content's, as for
      // conversations.send (encrypted or not, they never parse the content). Never for a flow:
      // its content is the flow.
      const derived: DerivedFacts | undefined = contentFacts ? { version: 2, fields: { content: contentFacts } } : undefined;

      // Messages posted via the internal /api/internal/postAsUser route are authored
      // on behalf of a real human user (Digital Twin approvals), so they must be
      // persisted as USER messages — otherwise the dashboard renders them with the
      // Xyne bot avatar/name instead of the user's profile picture. Every other
      // (app-token) caller stays BOT. Gated on the trusted S2S route marker so an
      // app token can never forge a message that appears to come from a human.
      const messageType = input.isPostAsUser ? MessageType.USER : MessageType.BOT;

      return await findOrCreateConversation(
        resolvedChannelId,
        senderUserId,
        content,
        isMarkdown,
        conversationId,
        uploadedFiles,
        messageType,
        { ...(isMarkdown && { contentFormat: ContentFormat.MARKDOWN }), ...metadata },
        derived,
      );
    } catch (error) {
      throw toChatContractError(error, 'Error posting message:');
    }
  };

  /**
   * Post an ephemeral message — relayed to a single user over their user room and
   * never written to the messages table. What POST /api/apps/chat/postEphemeral (typed route,
   * apps/routes/chat.ts) runs once the body is checked; throws ContractError for the answers
   * that are not the 201.
   *
   * Same body as postMessage plus:
   * - user: string            — recipient's Xyne user id
   * - messageDelivery: string — EPHEMERAL (default) renders a card; OPENSCREEN
   *                             opens the flow as a popup wherever the recipient is
   *
   * The message vanishes on reload. An interactive `flow` stays actionable for the
   * lifetime of its signed token (30 minutes) without anything being stored, because
   * the token — not a DB row — is what tells FlowController which app owns the card.
   *
   * Delivery is best-effort and is NOT guaranteed by the 201: nothing is persisted,
   * so a recipient with no live socket never receives it and there is nothing to
   * catch up on when they reconnect.
   *
   * The minting and relaying live in core/ephemeralDelivery so this and the Slack
   * adapter's chat.postEphemeral cannot drift apart on authorization.
   */
  sendEphemeral = async (input: {
    body: AppsChatPostEphemeralBody;
    sender: { id: string; name: string } | undefined;
    workspaceId: string | undefined;
    /** Verified token appId (authenticateApp): safe to sign into the flow's capability. */
    appId: string | undefined;
    /** Facts the encryption service extracted from the encrypted `text` (Slack mentions). */
    textFacts?: FieldFacts;
  }): Promise<AppsChatPostEphemeralResponse> => {
    try {
      const {
        channelId, channelName, conversationId, user, messageDelivery,
        text, markdownText, flow, attachments, metadata, contentFormat,
      } = input.body;

      const sender = input.sender;
      if (!sender) {
        throw new ContractError(400, { error: 'userId is required', code: 'VALIDATION_ERROR' });
      }

      const targetUser = await repositories.users.findById(user);
      if (!targetUser) {
        throw new ContractError(404, { error: `User not found: ${user}`, code: 'NOT_FOUND' });
      }

      const resolvedChannelId = await resolveChannelId(channelId, conversationId, channelName);

      const appId = input.appId;
      if (flow && (typeof appId !== 'string' || !appId)) {
        throw new ContractError(400, { error: 'Invalid appId', code: 'VALIDATION_ERROR' });
      }

      let content: string | undefined;
      const isMarkdown = !!markdownText || contentFormat === ContentFormat.MARKDOWN;

      if (!flow) {
        // Through the ingress proxy the result is workspace-DEK ciphertext: delivery re-encrypts
        // it per recipient socket, and the browser decrypts it.
        const workspaceId = input.workspaceId ?? config.defaultWorkspaceId;
        if (markdownText) {
          content = await this.buildMarkdownContent(markdownText, workspaceId);
        } else if (contentFormat === ContentFormat.MARKDOWN) {
          content = text ? await this.buildMarkdownContent(text, workspaceId) : '';
        } else {
          content = await this.buildSlackContent(text, attachments, workspaceId, input.textFacts);
        }
      }

      const result = await deliverEphemeralMessage({
        channelId: resolvedChannelId,
        conversationId,
        recipientId: targetUser.id,
        senderId: sender.id,
        senderName: sender.name,
        messageDelivery,
        ...(flow && { appId: appId as string }),
        // Normalised to a full FlowDefinition here: the body schema allows an app
        // to omit screenId and loadingComponentIds, but validateFlowDefinition
        // downstream does not.
        ...(flow && {
          flow: {
            version: '2.0' as const,
            screenId: flow.screenId ?? crypto.randomUUID(),
            title: flow.title,
            components: flow.components ?? [],
            data: flow.data,
            state: { ...flow.state, loadingComponentIds: flow.state.loadingComponentIds ?? [] },
          },
        }),
        content,
        isMarkdown,
        metadata,
      });

      if (!result.ok) {
        if (result.reason === 'not_in_channel') {
          throw new ContractError(403, {
            error: 'Recipient is not a participant of this channel',
            code: 'USER_NOT_IN_CHANNEL',
          });
        }
        throw new ContractError(400, {
          error: result.reason === 'invalid_app' ? 'Invalid appId' : 'Invalid flowJSON',
          code: 'VALIDATION_ERROR',
          ...(result.details && { details: result.details }),
        });
      }

      return {
        messageId: result.messageId,
        channelId: resolvedChannelId,
        conversationId: conversationId ?? null,
        visibleTo: targetUser.id,
        messageDelivery,
        ephemeral: true,
        // Broadcast, not delivered: an offline recipient silently misses it.
        delivery: 'best-effort',
      };
    } catch (error) {
      if (error instanceof ContractError) throw error;
      logger.error('Error posting ephemeral message:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        throw new ContractError(404, { error: error.message, code: 'NOT_FOUND' });
      }
      throw new ContractError(500, { error: 'Internal server error' });
    }
  };

  /**
   * Update a message in a conversation: what POST /api/apps/chat/updateMessage runs once the
   * body is checked. Throws ContractError for the answers that are not the 200.
   */
  editMessage = async (input: {
    body: AppsChatUpdateMessageBody;
    workspaceId: string | undefined;
    appId: unknown;
    /** Facts the encryption service extracted from the encrypted `text` (Slack mentions). */
    textFacts?: FieldFacts;
  }): Promise<ChatActionResponse> => {
    try {
      const { messageId, text, markdownText, flowJSON, attachments } = input.body;

      let content: string;

      if (flowJSON) {
        const flowResult = validateFlowDefinition(flowJSON);
        if (!flowResult.success) {
          throw new ContractError(400, {
            error: 'Invalid flowJSON',
            code: 'VALIDATION_ERROR',
            details: formatValidationErrors(flowResult),
          });
        }
        const appId = input.appId;
        if (appId !== undefined && !isAlphanumericId(appId)) {
          throw new ContractError(400, { error: 'Invalid appId', code: 'VALIDATION_ERROR' });
        }
        const flowId = (flowResult.data.screenId) ?? crypto.randomUUID();
        const escapedJSON = JSON.stringify(flowResult.data).replace(/"/g, '&quot;');
        // Inner text = notification/preview fallback (see sendMessage above).
        const flowFallback = encodeHtmlAttr(flowFallbackLabel(flowResult.data));
        content = `<div data-flow-json="${escapedJSON}" data-flow-appid="${encodeHtmlAttr(appId as string)}" data-flow-id="${encodeHtmlAttr(flowId)}">${flowFallback}</div>`;
      } else if (markdownText) {
        content = await this.buildMarkdownContent(markdownText, input.workspaceId ?? config.defaultWorkspaceId);
      } else {
        content = await this.buildSlackContent(text, attachments, input.workspaceId ?? config.defaultWorkspaceId, input.textFacts);
      }

      return await updateConversation(messageId, content);
    } catch (error) {
      throw toChatContractError(error, 'Error updating message:');
    }
  };

  /**
   * Delete an app-authored bot message: what POST /api/apps/chat/deleteMessage (typed route,
   * apps/routes/chat.ts) runs once the body is checked. Only the app's own BOT messages, in
   * the channel the body names. Throws ContractError for the answers that are not the 200.
   */
  removeMessage = async (input: {
    body: AppsChatDeleteMessageBody;
    /** The bot user of the app token (authenticateApp). */
    userId: string | undefined;
  }): Promise<ChatActionResponse> => {
    try {
      const { messageId, channelId, channelName } = input.body;
      const userId = input.userId;
      if (!userId) {
        throw new ContractError(401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
      }

      const resolvedChannelId = await resolveChannelId(channelId, undefined, channelName);
      // The same check as the Slack-compatible chat.delete (core/botMessageDelete).
      const check = await checkBotMessageDelete(messageId, resolvedChannelId, userId);
      if (!check.ok) {
        if (check.reason === 'not_own') {
          throw new ContractError(403, { error: 'You can only delete bot messages posted by this app', code: 'FORBIDDEN' });
        }
        throw new ContractError(404, { error: 'Message not found', code: 'NOT_FOUND' });
      }

      return await deleteConversationMessage(messageId, userId);
    } catch (error) {
      if (error instanceof ContractError) throw error;
      logger.error('Error deleting message:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        throw new ContractError(404, { error: error.message, code: 'NOT_FOUND' });
      }
      throw new ContractError(500, { error: 'Internal server error' });
    }
  };

  /**
   * Publish an ephemeral agent progress signal (no DB write): what POST
   * /api/apps/chat/agentProgress (typed route) runs once the body is checked.
   *
   * The agent's spacesAppUserId comes from the app token — it must be a channel participant
   * (the route's channel access check).
   * Delivery: Redis pub/sub on `session:{channelId}:messages` — same channel as typing indicator,
   * so the dashboard WebSocket already subscribes. msgType=SYSTEM so it does not persist.
   */
  publishAgentProgress = async (input: {
    body: AppsChatAgentProgressBody;
    /** The agent's spacesAppUserId, from the verified app token. */
    userId: string;
  }): Promise<AppsChatAgentProgressResponse> => {
    try {
      const { conversationId, channelId, agentSlug, agentName, toolLabel, status, triggeredByUserId, sessionId } = input.body;
      const userId = input.userId;

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
        return { success: true, suppressed: true };
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

      return { success: true };
    } catch (error) {
      logger.error('[agentProgress] publish error:', error);
      throw new ContractError(500, { error: 'Internal server error' });
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
    // `actionableUrl` is caller-supplied, so it is dispatched via `safeWebhookFetch`,
    // which validates the destination and pins the connection to it (rebinding-safe).
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

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (isInternalSpacesCallback) {
        const s2sKey = config.internalS2sKey;
        if (s2sKey) {
          headers['x-s2s-key'] = s2sKey;
        } else {
          logger.error('[dispatchAction] INTERNAL_S2S_KEY is missing; internal callback cannot be authenticated');
        }
      }

      const callbackInit: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify({ actionId, context, messageId, conversationId, callerUserId }),
        redirect: 'manual', // don't follow 3xx redirects
        signal: AbortSignal.timeout(30_000),
      };
      // Internal S2S callbacks are trusted-config hosts (kept on the plain client);
      // external targets are caller-supplied, so validate + pin (rebinding-safe).
      const callbackRes = isInternalSpacesCallback
        ? await fetch(actionableUrl, callbackInit)
        : await safeWebhookFetch(actionableUrl, callbackInit);
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
