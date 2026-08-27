import { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { getOtelTraceId } from '@juspay-jaf/jaf';
import {
  getAskAIQueriesTotal,
  getAskAIQueryDuration,
  getAskAIContextChannels,
  getAskAIFeedbackTotal,
} from '@/services/otel';
import {
  runClawAgentStream,
  cancelClawAgentRun,
  listClawConversations,
  getClawConversationMessages,
  rateClawRun,
  streamClawConversationLive,
  getClawDebugArtifacts,
  approveClawAction,
  downloadClawAttachment,
  listAccessibleClawAgents,
  listClawAgentModels,
  deleteClawConversation,
  type ClawRunRequest,
} from '@/services/clawAgentService';

const emptyToUndefined = (val: unknown) => (val === '' ? undefined : val);

// Research context schema - selected product or repository from frontend
const ResearchContextSchema = z.object({
  type: z.enum(['product', 'repository']),
  id: z.string().min(1).optional(),
  name: z.string().min(1),
});

// Selection context schema - selected text from canvas.
// `canvas_view_access_id` / `canvasViewAccessId` are legacy aliases for
// canvas_id accepted for backward compatibility with clients that predate
// XYNE-17290. At least one must be provided; the newer name wins if multiple
// are set.
const SelectionContextSchema = z.object({
  canvas_id: z.string().min(1).optional(),
  canvasId: z.string().min(1).optional(),
  canvas_view_access_id: z.string().min(1).optional(),
  canvasViewAccessId: z.string().min(1).optional(),
  selected_text: z.string().min(1),
  canvas_title: z.string().optional(),
}).refine(
  (ctx) => Boolean(ctx.canvas_id || ctx.canvasId || ctx.canvas_view_access_id || ctx.canvasViewAccessId),
  { message: 'canvas_id is required', path: ['canvas_id'] },
);

// Attached context item schema - for Add Context feature.
// `collection` and `file` are appended below from top-level `collection_ids`
// and `file_ids` so the dashboard can keep its existing payload shape.
const AttachedContextItemSchema = z.object({
  type: z.enum(['channel', 'ticket', 'canvas', 'call', 'activity', 'collection', 'file']),
  id: z.string().min(1),
  title: z.string().min(1),
  threadId: z.string().optional(),
  // Activity-specific fields
  eventName: z.string().optional(),
  eventCategory: z.string().optional(),
  timestamp: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  relatedData: z.record(z.unknown()).optional(),
});

// Attached context schema
const AttachedContextSchema = z.array(AttachedContextItemSchema).optional();

// Request validation schema
const XyneAIRequestSchemaV2 = z.object({
  query: z.string().min(1, 'Query cannot be empty'),
  sessionId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  session_id: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  channelIds: z.array(z.string().min(1)).default([]),
  channel_ids: z.array(z.string().min(1)).default([]),
  conversationId: z.preprocess(emptyToUndefined, z.string().optional()),
  conversation_id: z.preprocess(emptyToUndefined, z.string().optional()),
  canvasId: z.string().optional(),
  canvas_id: z.string().optional(),
  // Legacy aliases for canvasId (pre-XYNE-17290). Merged into canvasId below.
  canvasViewAccessId: z.string().optional(),
  canvas_view_access_id: z.string().optional(),
  selectionContexts: z.array(SelectionContextSchema).optional(),
  createCanvasEnabled: z.boolean().optional().default(false),
  create_canvas_enabled: z.boolean().optional().default(false),
  webSearchEnabled: z.boolean().optional().default(false),
  web_search_enabled: z.boolean().optional().default(false),
  deepResearchEnabled: z.boolean().optional().default(false),
  deep_research_enabled: z.boolean().optional().default(false),
  // Single search + single answer pass instead of the full agentic tool
  // loop — see xyne-claw-auth's run-stream.ts POST / instant branch. Single
  // word, so camelCase and snake_case are identical — no dual key needed
  // (unlike webSearchEnabled/web_search_enabled above).
  instant: z.boolean().optional().default(false),
  researchContext: ResearchContextSchema.optional().nullable(),
  research_context: ResearchContextSchema.optional().nullable(),
  attachments: z
    .array(
      z.object({
        id: z.string().optional(),
        data: z.string().optional(),
        mimeType: z.string().optional().default('application/octet-stream'),
        mime_type: z.string().optional(),
        filename: z.string().optional(),
        downloadUrl: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
      })
    )
    .transform((arr) =>
      arr?.map((att) => ({
        ...att,
        mimeType: att.mimeType || att.mime_type || 'application/octet-stream',
      }))
    )
    .optional(),
  messageAttachmentIds: z.array(z.string().min(1)).optional(),
  // Branching: same names the JAF (v1) path uses, so the dashboard composes
  // requests identically for both backends. `parentMessageId` plays two
  // roles, disambiguated by the `isRegenerate` / `isEditUserMessage` flags:
  //   - normal send:      tree parent the new user msg attaches under
  //   - regenerate:       id of the user message being replayed
  //   - edit-user:        id of the user message being replaced (the
  //                       original); the new sibling lives under the same
  //                       parentAssistantMessageId.
  //
  // The xyneAIStream web worker serializes branching params in snake_case
  // (matches `parent_message_id`, `is_regenerate`, etc.). Zod's default is
  // to STRIP unknown keys — without the snake_case aliases below, every
  // branching flag was dropped at the schema layer and never reached
  // claw-auth (so regen/edit silently behaved like normal sends).
  parentMessageId: z.string().optional(),
  parent_message_id: z.string().optional(),
  parentAssistantMessageId: z.string().optional(),
  parent_assistant_message_id: z.string().optional(),
  editedUserMessageId: z.string().optional(),
  edited_user_message_id: z.string().optional(),
  isRegenerate: z.boolean().optional().default(false),
  is_regenerate: z.boolean().optional().default(false),
  isEditUserMessage: z.boolean().optional().default(false),
  is_edit_user_message: z.boolean().optional().default(false),
  canvasIds: z.array(z.string().min(1)).optional(),
  canvas_ids: z.array(z.string().min(1)).optional(),
  ticketIds: z.array(z.string().min(1)).optional(),
  ticket_ids: z.array(z.string().min(1)).optional(),
  callIds: z.array(z.string().min(1)).optional(),
  call_ids: z.array(z.string().min(1)).optional(),
  // KB context. The dashboard sends these at the top level (legacy shape);
  // we convert them into attached_context items of type 'collection' / 'file'
  // below so the agent's prompt-prefix mechanism picks them up uniformly.
  // `fileIds` arrive as stable CollectionItem.fileId UUIDs (the dashboard's
  // Vespa identifier); we resolve them to CollectionItem.id (cuid) before
  // forwarding because that's what claw-auth's KB tools expect.
  collectionIds: z.array(z.string().min(1)).optional(),
  collection_ids: z.array(z.string().min(1)).optional(),
  fileIds: z.array(z.string().min(1)).optional(),
  file_ids: z.array(z.string().min(1)).optional(),
  attachedContext: AttachedContextSchema,
  attached_context: AttachedContextSchema,
  displayQuery: z.string().optional(),
  draftMode: z.boolean().optional().default(false),
  provider: z.enum(['spaces', 'copilot', 'claude', 'codex']).optional().default('spaces'),
  /** Per-run model pin from the composer's model picker. Rides the agent's
   *  shared LiteLLM credential, so it names a model from that key's own
   *  /v1/models list (see GET /agents/:slug/models). claw-auth re-validates and
   *  no-ops the pin when it can't serve it, so an unservable id can't silently
   *  swap the model. */
  model: z.string().min(1).optional(),
  agentSlug: z.string().optional().default('ask-ai'),
});

// Feedback request validation schema
const FeedbackRequestSchema = z.object({
  traceId: z.string().min(1, 'traceId is required'),
  value: z.enum(['LIKE', 'DISLIKE'], { required_error: 'value must be LIKE or DISLIKE' }),
});

/**
 * Controller for Xyne AI v2 - delegates all claw operations to clawAgentService.
 */
export class XyneAIControllerV2 {
  /**
   * GET /api/xyne-ai/config
   * Public capability flags for the Ask AI UI. (Re-homed from the removed
   * v1/v2 factory — Ask AI now always runs on claw.)
   */
  getConfig = async (_req: Request, res: Response): Promise<void> => {
    res.json({
      webSearchAccessible: config.xyneAiExtended.url ? true : false,
      deepResearchAccessible: config.xyneAiExtended.url ? true : false,
      version: 'v2',
      v2Enabled: true,
    });
  };

  /**
   * POST /api/xyne-ai
   * Main query endpoint - proxies to xyne-claw via clawAgentService.
   */
  query = async (req: Request, res: Response): Promise<void> => {
    const parseResult = XyneAIRequestSchemaV2.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid input',
        details: parseResult.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    const {
      query,
      sessionId,
      session_id,
      channelIds,
      channel_ids,
      conversationId,
      conversation_id,
      canvasId,
      canvas_id,
      canvasViewAccessId,
      canvas_view_access_id,
      selectionContexts: _selectionContexts,
      createCanvasEnabled: createCanvasEnabledCC,
      create_canvas_enabled: createCanvasEnabledSC,
      webSearchEnabled: webSearchEnabledCC,
      web_search_enabled: webSearchEnabledSC,
      deepResearchEnabled: deepResearchEnabledCC,
      deep_research_enabled: deepResearchEnabledSC,
      instant,
      researchContext,
      research_context,
      attachments,
      messageAttachmentIds,
      parentMessageId: parentMessageIdCC,
      parent_message_id: parentMessageIdSC,
      parentAssistantMessageId: parentAssistantMessageIdCC,
      parent_assistant_message_id: parentAssistantMessageIdSC,
      editedUserMessageId: editedUserMessageIdCC,
      edited_user_message_id: editedUserMessageIdSC,
      isRegenerate: isRegenerateCC,
      is_regenerate: isRegenerateSC,
      isEditUserMessage: isEditUserMessageCC,
      is_edit_user_message: isEditUserMessageSC,
      canvasIds,
      canvas_ids,
      ticketIds,
      ticket_ids,
      callIds,
      call_ids,
      collectionIds,
      collection_ids,
      fileIds,
      file_ids,
      attachedContext,
      attached_context,
      displayQuery: _displayQuery,
      draftMode,
      provider,
      model,
      agentSlug,
    } = parseResult.data;

    // Use snake_case as fallback for camelCase (Web Worker sends snake_case)
    const effectiveSessionId = sessionId || session_id;
    const effectiveChannelIds = channelIds.length > 0 ? channelIds : channel_ids;
    const effectiveResearchContext = researchContext || research_context;
    const effectiveConversationId = conversationId || conversation_id;
    // Legacy pre-XYNE-17290 clients may still send canvasViewAccessId or
    // canvas_view_access_id — coalesce them into effectiveCanvasId.
    const effectiveCanvasId =
      canvasId || canvas_id || canvasViewAccessId || canvas_view_access_id;
    const effectiveAttachedContext = attachedContext || attached_context;
    const createCanvasEnabled = createCanvasEnabledCC || createCanvasEnabledSC;
    const webSearchEnabled = webSearchEnabledCC || webSearchEnabledSC;
    const deepResearchEnabled = deepResearchEnabledCC || deepResearchEnabledSC;

    // Snake-case fallback for IDs sent by Web Worker
    const effectiveCanvasIds = canvasIds?.length ? canvasIds : canvas_ids;
    const effectiveTicketIds = ticketIds?.length ? ticketIds : ticket_ids;
    const effectiveCallIds = callIds?.length ? callIds : call_ids;
    const effectiveCollectionIds = collectionIds?.length ? collectionIds : collection_ids;
    const effectiveFileIds = fileIds?.length ? fileIds : file_ids;
    // Same snake-case fallback rationale for branching params — the worker
    // sends snake_case; HTTP callers may use either.
    const effectiveParentMessageId = parentMessageIdCC || parentMessageIdSC;
    const effectiveParentAssistantMessageId = parentAssistantMessageIdCC || parentAssistantMessageIdSC;
    const effectiveEditedUserMessageId = editedUserMessageIdCC || editedUserMessageIdSC;
    const effectiveIsRegenerate = isRegenerateCC || isRegenerateSC;
    const effectiveIsEditUserMessage = isEditUserMessageCC || isEditUserMessageSC;
    logger.info(
      `[XyneAIv2] Request context: ticketIds=${JSON.stringify(effectiveTicketIds)}, canvasIds=${JSON.stringify(effectiveCanvasIds)}, callIds=${JSON.stringify(effectiveCallIds)}, attachedContextCount=${effectiveAttachedContext?.length ?? 0}`
    );

    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const mode = draftMode ? 'draft' : 'ask';

    try {
      // Authorization check - verify user has access to ALL specified channels
      if (effectiveChannelIds.length > 0) {
        const userChannelAccess = await db.channelParticipant.findMany({
          where: {
            userId,
            channelId: { in: effectiveChannelIds },
          },
          select: { channelId: true },
        });

        const accessibleChannelIds = userChannelAccess.map((c) => c.channelId);
        const inaccessibleChannels = effectiveChannelIds.filter(
          (id: string) => !accessibleChannelIds.includes(id)
        );

        if (inaccessibleChannels.length > 0) {
          logger.warn('[XyneAIv2] auth: forbidden channels', {
            flow: 'xyne-ai-v2',
            mode,
            userId,
            inaccessibleChannels,
          });
          res.status(403).json({
            error: 'Forbidden: You do not have access to some channels',
            inaccessibleChannels,
          });
          return;
        }
      }

      // Fetch user information for agent context
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true },
      });

      // Track metrics: context channels count
      getAskAIContextChannels().record(effectiveChannelIds.length);

      const startTime = Date.now();
      let status = 'success';

      logger.info('[XyneAIv2] stream invoke', {
        flow: 'xyne-ai-v2',
        mode,
        userId,
        sessionId: effectiveSessionId,
        conversationId: effectiveConversationId,
        channelCount: effectiveChannelIds.length,
        provider,
        agentSlug,
      });

      // Resolve KB context (collections + files) → attached_context items so
      // claw-auth's existing prompt-prefix mechanism surfaces them in the
      // agent's prompt. We translate:
      //   • Collection.id (cuid)         → 'collection' attached_context item
      //   • CollectionItem.fileId (UUID) → CollectionItem.id (cuid) +
      //                                    'file' attached_context item
      // The cuid is what the agent's kb-* tools expect as fileId — see the
      // KB-tools handlers and the validateKbGrants files-set in claw-auth.
      const kbAttachedContextItems: Array<{
        type: 'collection' | 'file';
        id: string;
        title: string;
      }> = [];
      if (effectiveCollectionIds && effectiveCollectionIds.length > 0) {
        const rows = await db.collection.findMany({
          where: { id: { in: effectiveCollectionIds }, deletedAt: null },
          select: { id: true, name: true },
        });
        for (const row of rows) {
          kbAttachedContextItems.push({ type: 'collection', id: row.id, title: row.name });
        }
      }
      if (effectiveFileIds && effectiveFileIds.length > 0) {
        // The dashboard sends the stable `fileId` UUID, but the agent's
        // kb-read-file expects CollectionItem.id (cuid). Resolve UUIDs to
        // latest-version row ids in a single query.
        const items = await db.collectionItem.findMany({
          where: { fileId: { in: effectiveFileIds }, isLatest: true, deletedAt: null },
          select: { id: true, name: true },
        });
        for (const it of items) {
          kbAttachedContextItems.push({ type: 'file', id: it.id, title: it.name });
        }
      }
      const mergedAttachedContext = [
        ...(effectiveAttachedContext ?? []),
        ...kbAttachedContextItems,
      ];

      try {
        // Build the ClawRunRequest
        const runReq: ClawRunRequest = {
          userId,
          spacesWorkspaceId: req.user?.workspaceId,
          userName: user?.name || 'Unknown',
          userEmail: user?.email || '',
          query,
          agentSlug,
          provider,
          // Build the pin here rather than forwarding a caller-supplied
          // agentConfig: claw-auth merges that over the agent's stored config,
          // and its platform-key strip covers secrets but NOT `tools` /
          // `subagents` / `outputFormat`. A bare model id can't reach those.
          ...(model && { providerOverride: { provider: 'litellm', model } }),
          conversationId: effectiveConversationId || '',
          channelId: effectiveChannelIds[0] || '',
          canvasIds: effectiveCanvasIds,
          ticketIds: effectiveTicketIds,
          callIds: effectiveCallIds,
          ...(effectiveCanvasId && { canvasId: effectiveCanvasId }),
          attachedContext: mergedAttachedContext,
          attachments,
          messageAttachmentIds,
          webSearchEnabled,
          deepResearchEnabled,
          instant,
          researchContext: effectiveResearchContext,
          createCanvasEnabled,
          generateFollowUpSuggestions: true,
          sessionId: effectiveSessionId,
          // Branching: forward intent + tree position to claw-auth. The
          // `parentMessageId` is the JAF/v1-shared name; here it doubles as
          // `parentUserMessageId` for regenerate (the user msg being
          // replayed) and as `parentAssistantMessageId` for normal sends
          // (the tree parent the new user attaches under). Edit-user uses
          // `editedUserMessageId` separately.
          isRegenerate: effectiveIsRegenerate,
          isEditUserMessage: effectiveIsEditUserMessage,
          ...(effectiveParentMessageId ? { parentMessageId: effectiveParentMessageId } : {}),
          ...(effectiveParentAssistantMessageId ? { parentAssistantMessageId: effectiveParentAssistantMessageId } : {}),
          ...(effectiveEditedUserMessageId ? { editedUserMessageId: effectiveEditedUserMessageId } : {}),
        };

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Content-Encoding', 'none');
        if (res.socket) res.socket.setNoDelay(true);
        res.flushHeaders();

        // Ping every 20s to prevent idle timeout
        const pingInterval = setInterval(() => {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
            if (typeof (res as any).flush === 'function') (res as any).flush();
          }
        }, 20_000);

        // Tear down the upstream claw-auth fetch the moment the dashboard's
        // SSE connection drops (e.g. tab closed). Without this, claw-auth →
        // claw keep running, the `done` callback can race past us, and partial
        // state never reaches the message store. The explicit /cancel endpoint
        // is the well-behaved path; this is the safety net for raw disconnects.
        const upstreamAbort = new AbortController();
        const onClientClose = () => {
          if (!upstreamAbort.signal.aborted) upstreamAbort.abort();
        };
        res.on('close', onClientClose);

        try {
          const result = await runClawAgentStream(req, res, runReq, {
            signal: upstreamAbort.signal,
          });
          if (result.error) {
            status = 'error';
            res.write(
              `data: ${JSON.stringify({ type: 'error', error: result.error })}\n\n`,
            );
          }
        } catch (streamError) {
          status = 'error';
          logger.error('[XyneAIv2] stream failed', {
            flow: 'xyne-ai-v2',
            mode,
            userId,
            sessionId: effectiveSessionId,
            conversationId: effectiveConversationId,
            durationMs: Date.now() - startTime,
            error: streamError,
          });
          const errorMessage =
            streamError instanceof Error ? streamError.message : String(streamError);
          res.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`);
        } finally {
          res.off('close', onClientClose);
          clearInterval(pingInterval);
        }

        // Always send the end event after all processing (success or handled error)
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
          if (!res.writableEnded) res.end();
        }
      } catch (unexpectedError) {
        status = 'error';
        logger.error('[XyneAIv2] unexpected error', unexpectedError);
        if (!res.writableEnded) {
          const errorMessage =
            unexpectedError instanceof Error ? unexpectedError.message : 'Unexpected error';
          res.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`);
          res.end();
        }
      } finally {
        try {
          const duration = Date.now() - startTime;
          getAskAIQueryDuration().record(duration, { status });
          getAskAIQueriesTotal().add(1, { status });
          logger.info('[XyneAIv2] query done', {
            flow: 'xyne-ai-v2',
            mode,
            userId,
            sessionId: effectiveSessionId,
            conversationId: effectiveConversationId,
            status,
            durationMs: duration,
          });
        } catch (metricsError) {
          logger.error('[XyneAIv2] Error recording metrics:', metricsError);
        }
      }
    } catch (error) {
      this.handleError(res, error, 'xyne-ai v2 query');
    }
  };

  /**
   * POST /api/xyne-ai/v2/cancel/:sessionId
   *
   * Stop an in-flight Ask AI v2 run. Forwards through claw-auth to claw, which
   * aborts the run's AbortController. Claw then emits a done frame with
   * status="cancelled" carrying partial assistant text + tool invocations, and
   * claw-auth's existing callback persists that partial state — so the
   * conversation reload still shows whatever was generated before the stop.
   */
  cancelRun = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id as string | undefined;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const sessionId = req.params['sessionId'];
      if (!sessionId) {
        res.status(400).json({ error: 'sessionId is required' });
        return;
      }
      const result = await cancelClawAgentRun(
        req,
        userId,
        sessionId,
        req.user?.workspaceId,
      );
      if (!result.success) {
        res.status(502).json({ success: false, error: result.error ?? 'Cancel failed' });
        return;
      }
      res.json({ success: true, sessionId, status: result.status });
    } catch (error) {
      this.handleError(res, error, 'xyne-ai v2 cancel');
    }
  };

  /**
   * POST /api/xyne-ai/feedback
   */
  feedback = async (req: Request, res: Response): Promise<void> => {
    const parseResult = FeedbackRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid input',
        details: parseResult.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    const { traceId: jafTraceId, value } = parseResult.data;
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const { secretKey, publicKey, baseUrl: langfuseBaseUrl } = config.langfuse;

      if (!secretKey || !publicKey) {
        logger.warn('[XyneAIv2] Langfuse credentials not configured');
        res.status(500).json({ error: 'Langfuse credentials not configured' });
        return;
      }

      const otelTraceId = getOtelTraceId(jafTraceId);
      if (!otelTraceId) {
        logger.warn(`[XyneAIv2] Could not find OTEL trace ID for JAF traceId: ${jafTraceId}`);
        res.status(404).json({
          error: 'Trace not found',
          details: 'Could not find the corresponding OTEL trace ID. The trace may have expired.',
        });
        return;
      }

      const baseUrl = langfuseBaseUrl || 'https://periscope.breeze.in';
      const periscopeUrl = baseUrl.endsWith('/')
        ? `${baseUrl}api/public/scores`
        : `${baseUrl}/api/public/scores`;
      const authKey = `${publicKey}:${secretKey}`;

      logger.info(
        `[XyneAIv2] Submitting feedback to: ${periscopeUrl}, traceId: ${otelTraceId}, value: ${value}`
      );

      const response = await fetch(periscopeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(authKey).toString('base64')}`,
        },
        body: JSON.stringify({
          traceId: otelTraceId,
          name: 'XYNE_AI_FEEDBACK',
          value,
          dataType: 'CATEGORICAL',
          comment: 'Evaluation from the user',
          id: otelTraceId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[XyneAIv2] Failed to submit feedback: ${response.status} ${errorText}`);
        res.status(response.status).json({ error: 'Failed to submit feedback' });
        return;
      }

      getAskAIFeedbackTotal().add(1, { value });
      logger.info(`[XyneAIv2] Feedback submitted successfully for traceId: ${otelTraceId}`);
      res.json({ success: true });
    } catch (error) {
      logger.error('[XyneAIv2] Error submitting feedback:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * POST /api/xyne-ai/v2/action
   */
  handleActionApproval = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const { sessionId, actionId, approved, params, serverType, tool, signature } = req.body as {
        sessionId?: string;
        actionId?: string;
        approved?: boolean;
        params?: Record<string, unknown>;
        serverType?: string;
        tool?: string;
        signature?: string;
      };

      if (!sessionId || !actionId) {
        res.status(400).json({ success: false, error: 'sessionId and actionId are required' });
        return;
      }

      const result = await approveClawAction(
        { headers: req.headers, userId },
        {
          sessionId,
          actionId,
          approved,
          params,
          serverType,
          tool,
          signature,
        }
      );

      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      logger.error('[XyneAIv2] approve-action error:', error);
      res.status(500).json({ success: false, error: message });
    }
  };

  /**
   * GET /api/xyne-ai/v2/conversations
   * Query param: agentSlug (optional, defaults to 'ask-ai')
   */
  listConversations = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const agentSlug = (req.query.agentSlug as string) || 'ask-ai';
    const allRuns = req.query.allRuns === '1';

    try {
      const result = await listClawConversations({ headers: req.headers, userId }, agentSlug, { allRuns });
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      logger.error('[XyneAIv2] listConversations error:', error);
      res.status(503).json({ success: false, error: message });
    }
  };

  /**
   * GET /api/xyne-ai/v2/conversations/:convId/messages
   * Query param: agentSlug (optional, defaults to 'ask-ai')
   */
  getConversationMessages = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const { convId } = req.params;
    if (!convId) {
      res.status(400).json({ success: false, error: 'convId is required' });
      return;
    }

    const agentSlug = (req.query.agentSlug as string) || 'ask-ai';
    const allRuns = req.query.allRuns === '1';

    try {
      const result = await getClawConversationMessages({ headers: req.headers, userId }, convId, agentSlug, { allRuns });
      res.json({
        ...result,
        ...(result.toolInvocations && { toolInvocations: result.toolInvocations }),
        ...(result.invocationsByMsgId && { invocationsByMsgId: result.invocationsByMsgId }),
        ...(result.runByMsgId && { runByMsgId: result.runByMsgId }),
        ...(result.ratingByMsgId && { ratingByMsgId: result.ratingByMsgId }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      logger.error('[XyneAIv2] getMessages error:', error);
      res.status(503).json({ success: false, error: message });
    }
  };

  /**
   * POST /api/xyne-ai/v2/messages/:messageId/rate — persist a 👍/👎 (+ optional
   * comment) for the AgentRun that produced an assistant message. Proxies to
   * claw-auth so the rating lands in agent_runs.rating (metrics SentimentPanel
   * + reload state). messageId is the assistant ChatMessage id.
   */
  rateRun = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const { messageId } = req.params;
    if (!messageId) {
      res.status(400).json({ success: false, error: 'messageId is required' });
      return;
    }

    const { rating, comment } = req.body as { rating?: string; comment?: string | null };
    if (rating !== 'up' && rating !== 'down') {
      res.status(400).json({ success: false, error: "rating must be 'up' or 'down'" });
      return;
    }
    // Clamp the optional comment to 500 chars (matches the UI limit).
    const clampedComment = typeof comment === 'string' ? comment.slice(0, 500) : null;

    try {
      const result = await rateClawRun({ headers: req.headers, userId }, messageId, rating, clampedComment);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      logger.error('[XyneAIv2] rateRun error:', error);
      res.status(503).json({ success: false, error: message });
    }
  };

  /**
   * GET /api/xyne-ai/v2/conversations/:convId/live
   * SSE proxy to claw-auth's live stream so a Spaces AI tab that reloaded
   * mid-run can re-attach and stream the in-flight answer (snapshot + deltas)
   * instead of waiting for the run to finish. Verbatim frame passthrough.
   */
  streamConversationLive = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const { convId } = req.params;
    if (!convId) {
      res.status(400).json({ success: false, error: 'convId is required' });
      return;
    }
    const agentSlug = (req.query.agentSlug as string) || 'ask-ai';
    const allRuns = req.query.allRuns === '1';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'none');
    if (res.socket) res.socket.setNoDelay(true);
    res.flushHeaders();

    const pingInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`: ping\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      }
    }, 20_000);

    const upstreamAbort = new AbortController();
    res.on('close', () => {
      clearInterval(pingInterval);
      if (!upstreamAbort.signal.aborted) upstreamAbort.abort();
    });

    try {
      await streamClawConversationLive({ headers: req.headers, userId }, res, convId, agentSlug, { signal: upstreamAbort.signal, allRuns });
    } catch (error) {
      logger.error('[XyneAIv2] live proxy error:', error);
    } finally {
      clearInterval(pingInterval);
      if (!res.writableEnded) res.end();
    }
  };

  /**
   * DELETE /api/xyne-ai/v2/conversations/:convId
   * Proxies to claw-auth to delete a conversation and all of its messages.
   */
  deleteConversation = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const { convId } = req.params;
    if (!convId) {
      res.status(400).json({ success: false, error: 'convId is required' });
      return;
    }

    const agentSlug = (req.query.agentSlug as string) || 'ask-ai';

    try {
      const result = await deleteClawConversation({ headers: req.headers, userId }, convId, agentSlug);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      logger.error('[XyneAIv2] deleteConversation error:', error);
      res.status(503).json({ success: false, error: message });
    }
  };

  getConversationDebug = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const { convId } = req.params;
    if (!convId) {
      res.status(400).json({ success: false, error: 'convId is required' });
      return;
    }
    try {
      const result = await getClawDebugArtifacts(
        { headers: req.headers, userId },
        convId,
        (req.query.agentSlug as string) || 'ask-ai'
      );
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      res
        .status(message === 'Debug artifacts not found' ? 404 : 503)
        .json({ success: false, error: message });
    }
  };

  /**
   * GET /api/xyne-ai/v2/attachments/:attachmentId/download
   */
  downloadAttachment = async (req: Request, res: Response): Promise<void> => {
    const { attachmentId } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!attachmentId) {
      res.status(400).json({ error: 'attachmentId is required' });
      return;
    }

    try {
      const result = await downloadClawAttachment({ headers: req.headers, userId }, attachmentId);
      res.setHeader('Content-Type', result.contentType);
      if (result.contentDisposition) {
        res.setHeader('Content-Disposition', result.contentDisposition);
      }
      if (result.contentLength) {
        res.setHeader('Content-Length', result.contentLength);
      }
      res.end(result.buffer);
    } catch (error) {
      this.handleError(res, error, 'download attachment');
    }
  };

  /**
   * GET /api/xyne-ai/agents
   * List all claw agents accessible to the current user.
   */
  listAccessibleAgents = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const result = await listAccessibleClawAgents({ headers: req.headers, userId });
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      logger.error('[XyneAIv2] listAccessibleAgents error:', error);
      res.status(503).json({ success: false, error: message });
    }
  };

  /**
   * GET /api/xyne-ai/agents/:slug/models
   * Models the agent's shared LiteLLM credential can serve, for the composer's
   * model picker. Agent-scoped by design: the list comes off that agent's own
   * key, so the picker can't offer a model the run would reject. Agents with no
   * litellm credential return `[]` and the picker hides.
   */
  listAgentModels = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const result = await listClawAgentModels({ headers: req.headers, userId }, req.params['slug']);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      logger.error('[XyneAIv2] listAgentModels error:', error);
      res.status(503).json({ success: false, error: message });
    }
  };

  private handleError(res: Response, error: unknown, operation: string): void {
    logger.error(`Error in ${operation}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    if (!res.headersSent) {
      res.status(500).json({ success: false, error: errorMessage });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`);
      if (!res.writableEnded) res.end();
    }
  }
}

export const xyneAIControllerV2 = new XyneAIControllerV2();
