import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
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

const emptyToUndefined = (val: unknown) => (val === '' ? undefined : val);

// Validate base64 string
// const isValidBase64 = (str: string): boolean => {
//   if (!str || str.length === 0) return false;
//   const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
//   if (!base64Regex.test(str)) return false;
//   if (str.length % 4 !== 0) return false;
//   return true;
// };

// Research context schema - selected product or repository from frontend
const ResearchContextSchema = z.object({
  type: z.enum(['product', 'repository']),
  id: z.string().min(1).optional(),
  name: z.string().min(1),
});

// Selection context schema - selected text from canvas
const SelectionContextSchema = z.object({
  canvas_view_access_id: z.string().min(1),
  selected_text: z.string().min(1),
  canvas_title: z.string().optional(),
});

// Attached context item schema - for Add Context feature
const AttachedContextItemSchema = z.object({
  type: z.enum(['channel', 'ticket', 'canvas', 'call', 'activity']),
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
// NOTE: Field names use camelCase to match the frontend's actual request body.
// The XyneAIStreamManager sends camelCase JSON (sessionId, channelIds, etc.)
// However, the Web Worker converts to snake_case before sending (session_id, channel_ids, etc.)
const XyneAIRequestSchemaV2 = z.object({
  query: z.string().min(1, 'Query cannot be empty'),
  sessionId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  session_id: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  channelIds: z.array(z.string().min(1)).default([]),
  channel_ids: z.array(z.string().min(1)).default([]),
  conversationId: z.preprocess(emptyToUndefined, z.string().optional()),
  conversation_id: z.preprocess(emptyToUndefined, z.string().optional()),
  canvasViewAccessId: z.string().optional(),
  selectionContexts: z.array(SelectionContextSchema).optional(),
  createCanvasEnabled: z.boolean().optional().default(false),
  create_canvas_enabled: z.boolean().optional().default(false),
  webSearchEnabled: z.boolean().optional().default(false),
  web_search_enabled: z.boolean().optional().default(false),
  deepResearchEnabled: z.boolean().optional().default(false),
  deep_research_enabled: z.boolean().optional().default(false),
  researchContext: ResearchContextSchema.optional().nullable(),
  research_context: ResearchContextSchema.optional().nullable(),
  attachments: z.array(z.object({
    id: z.string().optional(),
    data: z.string().optional(),
    mimeType: z.string().optional().default('application/octet-stream'),
    mime_type: z.string().optional(),
    filename: z.string().optional(),
    downloadUrl: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  })).transform(arr => arr?.map(att => ({
    ...att,
    mimeType: att.mimeType || att.mime_type || 'application/octet-stream',
  }))).optional(),
  messageAttachmentIds: z.array(z.string().min(1)).optional(),
  parentMessageId: z.string().optional(),
  isRegenerate: z.boolean().optional().default(false),
  canvasIds: z.array(z.string().min(1)).optional(),
  canvas_ids: z.array(z.string().min(1)).optional(),
  ticketIds: z.array(z.string().min(1)).optional(),
  ticket_ids: z.array(z.string().min(1)).optional(),
  callIds: z.array(z.string().min(1)).optional(),
  call_ids: z.array(z.string().min(1)).optional(),
  attachedContext: AttachedContextSchema,
  attached_context: AttachedContextSchema,
  displayQuery: z.string().optional(),
  draftMode: z.boolean().optional().default(false),
  provider: z.enum(['spaces', 'copilot', 'claude', 'codex']).optional().default('spaces'),
  agentSlug: z.string().optional().default('ask-ai'),
});

// Feedback request validation schema
const FeedbackRequestSchema = z.object({
  traceId: z.string().min(1, 'traceId is required'),
  value: z.enum(['LIKE', 'DISLIKE'], { required_error: 'value must be LIKE or DISLIKE' }),
});

// Map to track active SSE responses for forwarding progress events
const activeStreams = new Map<string, Response>();

/**
 * Controller for Xyne AI v2 - Uses xyne-claw instead of xyneAIStream
 */
export class XyneAIControllerV2 {
  /**
   * POST /api/xyne-ai
   * Main query endpoint - proxies to xyne-claw /run endpoint
   */
  query = async (req: Request, res: Response): Promise<void> => {
    const parseResult = XyneAIRequestSchemaV2.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid input',
        details: parseResult.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
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
      canvasViewAccessId,
      selectionContexts,
      createCanvasEnabled: createCanvasEnabledCC,
      create_canvas_enabled: createCanvasEnabledSC,
      webSearchEnabled: webSearchEnabledCC,
      web_search_enabled: webSearchEnabledSC,
      deepResearchEnabled: deepResearchEnabledCC,
      deep_research_enabled: deepResearchEnabledSC,
      researchContext,
      research_context,
      attachments,
      messageAttachmentIds,
      parentMessageId,
      isRegenerate,
      canvasIds,
      canvas_ids,
      ticketIds,
      ticket_ids,
      callIds,
      call_ids,
      attachedContext,
      attached_context,
      displayQuery,
      draftMode,
      provider,
      agentSlug,
    } = parseResult.data;

    // Use snake_case as fallback for camelCase (Web Worker sends snake_case)
    const effectiveSessionId = sessionId || session_id;
    const effectiveChannelIds = channelIds.length > 0 ? channelIds : channel_ids;
    const effectiveResearchContext = researchContext || research_context;
    const effectiveConversationId = conversationId || conversation_id;
    const effectiveAttachedContext = attachedContext || attached_context;
    const createCanvasEnabled = createCanvasEnabledCC || createCanvasEnabledSC;
    const webSearchEnabled = webSearchEnabledCC || webSearchEnabledSC;
    const deepResearchEnabled = deepResearchEnabledCC || deepResearchEnabledSC;

    // Snake-case fallback for IDs sent by Web Worker
    const effectiveCanvasIds = canvasIds?.length ? canvasIds : canvas_ids;
    const effectiveTicketIds = ticketIds?.length ? ticketIds : ticket_ids;
    const effectiveCallIds = callIds?.length ? callIds : call_ids;

    logger.info(`[XyneAIv2] Request context: ticketIds=${JSON.stringify(effectiveTicketIds)}, canvasIds=${JSON.stringify(effectiveCanvasIds)}, callIds=${JSON.stringify(effectiveCallIds)}, attachedContextCount=${effectiveAttachedContext?.length ?? 0}`);

    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const mode = draftMode ? 'draft' : 'ask';
    logger.info('[XyneAIv2] query start', {
      flow: 'xyne-ai-v2',
      mode,
      userId,
      sessionId: effectiveSessionId,
      conversationId,
      channelCount: effectiveChannelIds.length,
      hasAttachments: (attachments?.length ?? 0) > 0,
      attachmentCount: attachments?.length ?? 0,
      messageAttachmentCount: messageAttachmentIds?.length ?? 0,
      canvasCount: canvasIds?.length ?? 0,
      ticketCount: ticketIds?.length ?? 0,
      callCount: callIds?.length ?? 0,
      isRegenerate,
      webSearchEnabled,
      deepResearchEnabled,
      provider,
      agentSlug,
      queryLen: query?.length ?? 0,
    });

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

        const accessibleChannelIds = userChannelAccess.map(c => c.channelId);
        const inaccessibleChannels = effectiveChannelIds.filter((id: string) => !accessibleChannelIds.includes(id));

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
        select: {
          id: true,
          name: true,
          email: true,
        },
      });

      const userInfo = {
        userId: user?.id || userId,
        userName: user?.name || 'Unknown',
        userEmail: user?.email || '',
      };

      logger.info(`[XyneAIv2] User context prepared for agent (userId: ${userInfo.userId})`);

      // Track metrics: context channels count
      getAskAIContextChannels().record(effectiveChannelIds.length);

      const startTime = Date.now();
      let status = 'success';

      logger.info('[XyneAIv2] stream invoke', {
        flow: 'xyne-ai-v2',
        mode,
        userId,
        sessionId: effectiveSessionId,
        conversationId,
        channelCount: effectiveChannelIds.length,
        provider,
        agentSlug,
      });
      try {
        await this.streamResponse(req, res, {
          query,
          sessionId: effectiveSessionId,
          channelIds: effectiveChannelIds,
          conversationId: effectiveConversationId,
          canvasViewAccessId,
          selectionContexts,
          createCanvasEnabled,
          webSearchEnabled,
          deepResearchEnabled,
          researchContext: effectiveResearchContext,
          attachments,
          messageAttachmentIds,
          parentMessageId,
          isRegenerate,
          canvasIds: effectiveCanvasIds,
          ticketIds: effectiveTicketIds,
          callIds: effectiveCallIds,
          attachedContext: effectiveAttachedContext,
          displayQuery,
          draftMode,
          provider,
          agentSlug,
          userId,
          userInfo,
        });
      } catch (streamError) {
        status = 'error';
        logger.error('[XyneAIv2] stream failed', {
          flow: 'xyne-ai-v2',
          mode,
          userId,
          sessionId: effectiveSessionId,
          conversationId,
          durationMs: Date.now() - startTime,
          error: streamError instanceof Error ? streamError.message : String(streamError),
        });
        throw streamError;
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
            conversationId,
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
   * Stream response from xyne-claw
   */
  private async streamResponse(
    req: Request,
    res: Response,
    request: {
      query: string;
      sessionId?: string;
      channelIds: string[];
      conversationId?: string;
      canvasViewAccessId?: string;
      selectionContexts?: Array<z.infer<typeof SelectionContextSchema>>;
      createCanvasEnabled: boolean;
      webSearchEnabled: boolean;
      deepResearchEnabled: boolean;
      researchContext: z.infer<typeof ResearchContextSchema> | null | undefined;
      attachments?: Array<{ id?: string; data?: string; mimeType: string; filename?: string; downloadUrl?: string; width?: number; height?: number }>;
      messageAttachmentIds?: string[];
      parentMessageId?: string;
      isRegenerate: boolean;
      canvasIds?: string[];
      ticketIds?: string[];
      callIds?: string[];
      attachedContext?: Array<z.infer<typeof AttachedContextItemSchema>>;
      displayQuery?: string;
      draftMode: boolean;
      provider: string;
      agentSlug: string;
      userId: string;
      userInfo: { userId: string; userName: string; userEmail: string };
    }
  ): Promise<void> {
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'none');

    if (res.socket) res.socket.setNoDelay(true);
    res.flushHeaders();

    // Send a ping every 20s to prevent idle connection timeouts
    const pingInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      }
    }, 20_000);

    let runResult: { success: boolean; sessionId?: string; error?: string } | undefined;
    
    try {
      // Build the request for xyne-claw via xyne-claw-auth /run/stream endpoint
      // The /run/stream endpoint provides SSE streaming instead of webhooks
      const xyneClawAuthUrl = `${config.xyneClaw.authUrl}/claw/api/v1/run/stream`;

      // IMPORTANT: conversationId management for claw session continuity.
      // claw uses this ID to persist/retrieve conversation history in its DB.
      // This is NOT the Spaces thread conversationId — that is passed separately
      // via agentConfig.SPACES_CONVERSATION_ID so the agent can use thread-aware
      // tools like fetch_thread_messages.
      const clawConversationId = request.sessionId || randomUUID();

      logger.info(`[XyneAIv2] Calling xyne-claw-auth /run/stream endpoint at ${xyneClawAuthUrl}`, {
        sessionId: request.sessionId,
        clawConversationId,
        isNewChat: !request.sessionId,
      });

      // Get cookies from incoming request to forward to xyne-claw-auth
      const cookieHeader = req.headers.cookie;


      // Process attachments and prepare text file contents for embedding in task
      let textFileContents: string | undefined;
      const imageAttachments: Array<{ fileName: string; mimeType: string; data: string }> = [];
      
      if (request.attachments?.length) {
        const inferMimeType = (filename: string | undefined, existingMimeType: string): string => {
          if (existingMimeType && existingMimeType !== 'application/octet-stream') {
            return existingMimeType;
          }
          if (!filename) return 'application/octet-stream';
          const ext = filename.split('.').pop()?.toLowerCase();
          const mimeMap: Record<string, string> = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml',
            'bmp': 'image/bmp',
            'txt': 'text/plain',
            'md': 'text/markdown',
            'json': 'application/json',
            'js': 'application/javascript',
            'ts': 'application/typescript',
            'py': 'text/x-python',
            'html': 'text/html',
            'css': 'text/css',
            'pdf': 'application/pdf',
          };
          return mimeMap[ext || ''] || 'application/octet-stream';
        };

        const attachmentsWithInferredMime = request.attachments.map(att => ({
          ...att,
          mimeType: inferMimeType(att.filename, att.mimeType),
        }));

        attachmentsWithInferredMime.forEach(att => {
          if (att.mimeType.startsWith('image/')) {
            imageAttachments.push({
              fileName: att.filename || 'attachment',
              mimeType: att.mimeType,
              data: att.data || '',
            });
          } else if (att.data) {
            // Decode base64 text content
            let content = '';
            try {
              content = Buffer.from(att.data, 'base64').toString('utf-8');
            } catch {
              content = att.data;
            }
            // Accumulate text file contents
            if (!textFileContents) textFileContents = '';
            textFileContents += `\n\n--- FILE: ${att.filename || 'untitled'} ---\n\`\`\`\n${content.slice(0, 100000)}\n\`\`\`\n--- END OF ${att.filename || 'untitled'} ---\n`;
          }
        });
      }

      // Embed text file contents into the task so LLM can see them
      let enhancedTask = request.query;
      if (textFileContents) {
        enhancedTask = `User query: ${request.query}\n\nThe user has attached the following files:\n${textFileContents}`;
      }

      // Make request to claw-auth SSE endpoint
      const runResponse = await fetch(xyneClawAuthUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
        },
        body: JSON.stringify({
          userId: request.userId,
          userName: request.userInfo.userName,
          userEmail: request.userInfo.userEmail,
          task: enhancedTask,
          agentSlug: request.agentSlug,
          provider: request.provider,
          conversationId: clawConversationId,
          channelId: request.channelIds[0] || '',
          ...(request.canvasIds?.length && { canvasIds: request.canvasIds }),
          ...(request.ticketIds?.length && { ticketIds: request.ticketIds }),
          ...(request.callIds?.length && { callIds: request.callIds }),
          ...(request.attachedContext?.length && { attachedContext: request.attachedContext }),
          // Separate attachments into images (for LLM vision) and context files (for text/code)
          ...(request.attachments?.length && (() => {
            // Helper to infer mimeType from filename
            const inferMimeType = (filename: string | undefined, existingMimeType: string): string => {
              if (existingMimeType && existingMimeType !== 'application/octet-stream') {
                return existingMimeType;
              }
              if (!filename) return 'application/octet-stream';
              const ext = filename.split('.').pop()?.toLowerCase();
              const mimeMap: Record<string, string> = {
                'png': 'image/png',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'gif': 'image/gif',
                'webp': 'image/webp',
                'svg': 'image/svg+xml',
                'bmp': 'image/bmp',
                'txt': 'text/plain',
                'md': 'text/markdown',
                'json': 'application/json',
                'js': 'application/javascript',
                'ts': 'application/typescript',
                'py': 'text/x-python',
                'html': 'text/html',
                'css': 'text/css',
                'pdf': 'application/pdf',
              };
              return mimeMap[ext || ''] || 'application/octet-stream';
            };

            const attachmentsWithInferredMime = request.attachments.map(att => ({
              ...att,
              mimeType: inferMimeType(att.filename, att.mimeType),
            }));

            const imageAttachments = attachmentsWithInferredMime.filter(att => 
              att.mimeType.startsWith('image/')
            );
            const textFiles = attachmentsWithInferredMime.filter(att => 
              !att.mimeType.startsWith('image/') && att.data
            ).map(att => {
              // Decode base64 to text for context files
              let content = att.data || '';
              if (att.data) {
                try {
                  content = Buffer.from(att.data, 'base64').toString('utf-8');
                } catch (e) {
                  // If decoding fails, keep original
                }
              }
              return {
                filename: att.filename || 'file.txt',
                content: content,
              };
            });

            return {
              ...(imageAttachments.length > 0 && {
                attachments: imageAttachments.map(att => ({
                  fileName: att.filename || 'attachment',
                  mimeType: att.mimeType,
                  data: att.data,
                }))
              }),
              // For text files, we embed them in the task so LLM can see them
              // contextFiles alone only writes to disk - LLM doesn't see them
              ...(textFiles.length > 0 && {
                contextFiles: textFiles.map(f => ({ path: f.filename, content: f.content })),
              }),
            };
          })()),
          ...(request.webSearchEnabled && { webSearchEnabled: true }),
          ...(request.deepResearchEnabled && { deepResearchEnabled: true }),
          ...(request.researchContext && { researchContext: request.researchContext }),
          agentConfig: {
            webSearchEnabled: String(request.webSearchEnabled),
            deepResearchEnabled: String(request.deepResearchEnabled),
            ...(config.xyneAiExtended.url && { XYNE_AI_EXTENDED_URL: config.xyneAiExtended.url }),
            ...(request.conversationId && { SPACES_CONVERSATION_ID: request.conversationId }),
          },
          ...(((request.researchContext || request.createCanvasEnabled || request.webSearchEnabled || request.deepResearchEnabled) && {
            additionalInstructions: [
              ...(request.researchContext ? [`You have access to the query-codebase and review-pull-request tools for codebase analysis. ` +
                `The user has selected "${request.researchContext.name}" ${request.researchContext.type} for research. ` +
                `Use these tools when the user asks about code, repositories, technical implementation, or needs a PR review.`] : []),
              ...(request.createCanvasEnabled ? [`You MUST create a canvas document with your response using the spaces-create-canvas tool (available in the spaces subagent). ` +
                `After completing your analysis, call spaces-create-canvas with a descriptive title and your complete response formatted in markdown. ` +
                `After the tool returns, include the canvas URL in your response so the user can click on it. ` +
                `This is MANDATORY - the user requires the output in a canvas document with a clickable link.`] : []),
              ...(request.webSearchEnabled ? [`The user has enabled web search. You have access to the web-search tool to find current information from the internet. ` +
                `Use it when the user asks about recent events, current data, or any topic requiring up-to-date information beyond your training data.`] : []),
              ...(request.deepResearchEnabled ? [`The user has enabled deep research. You have access to the deep-research tool for comprehensive multi-step research. ` +
                `Use it for complex research questions that require thorough investigation, multiple sources, and a detailed report. ` +
                `This tool takes 1-10 minutes to complete and generates a comprehensive report.`] : []),
            ].join('\n\n'),
          })),
        }),
      });

      if (!runResponse.ok) {
        const errorText = await runResponse.text();
        logger.error(`[XyneAIv2] DEBUG: SSE request failed: ${runResponse.status} ${errorText}`);
        throw new Error(`xyne-claw returned ${runResponse.status}: ${errorText}`);
      }


      if (!runResponse.body) {
        throw new Error('No response body from xyne-claw');
      }

      const reader = runResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventCount = 0;
      const streamStart = Date.now();
      let firstEventAt: number | null = null;
      let terminalType: string | undefined;
      let lastErrorMsg: string | undefined;

      try {
        let currentEventType = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            logger.info('[XyneAIv2] stream done', {
              flow: 'xyne-ai-v2',
              sessionId: clawConversationId,
              conversationId: request.conversationId,
              eventCount,
              terminalType: terminalType ?? 'closed',
              ttfbMs: firstEventAt ? firstEventAt - streamStart : null,
              streamDurationMs: Date.now() - streamStart,
              ...(lastErrorMsg && { errorMsg: lastErrorMsg }),
            });
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              // Empty line = end of event, reset event type
              currentEventType = '';
              continue;
            }

            // Parse SSE line
            if (trimmed.startsWith('event:')) {
              // Store the event type from the SSE event: line
              currentEventType = trimmed.slice(6).trim();
              continue;
            } else if (trimmed.startsWith('data:')) {
              const data = trimmed.slice(5).trim();
              try {
                const parsed = JSON.parse(data);
                eventCount++;
                if (firstEventAt === null) firstEventAt = Date.now();

                // Use SSE event type (from event: line) as the authoritative type
                // The data JSON from claw-auth does NOT contain a "type" field
                const eventType = currentEventType;
                
                

                // Map claw-auth SSE event types to Spaces frontend format
                if (eventType === 'meta') {
                  logger.debug('[XyneAIv2] SSE meta event:', parsed);
                } else if (eventType === 'run') {
                  res.write(`data: ${JSON.stringify({ 
                    type: 'start', 
                    sessionId: clawConversationId,
                    traceId: parsed.sessionId,
                  })}\n\n`);
                  if (typeof (res as any).flush === 'function') (res as any).flush();
                } else if (eventType === 'delta') {
                  res.write(`data: ${JSON.stringify({ 
                    type: 'delta', 
                    content: parsed.content || parsed.delta 
                  })}\n\n`);
                  if (typeof (res as any).flush === 'function') (res as any).flush();
                } else if (eventType === 'reasoning') {
                  res.write(`data: ${JSON.stringify({ 
                    type: 'reasoning_delta', 
                    reasoningDelta: parsed.delta || parsed.reasoningDelta 
                  })}\n\n`);
                  if (typeof (res as any).flush === 'function') (res as any).flush();
                } else if (eventType === 'invocation') {
                  res.write(`data: ${JSON.stringify({ 
                    type: 'tool_invocation', 
                    toolInvocation: parsed 
                  })}\n\n`);
                  if (typeof (res as any).flush === 'function') (res as any).flush();
                } else if (eventType === 'attachment') {
                  res.write(`data: ${JSON.stringify({ 
                    type: 'attachment', 
                    attachment: parsed 
                  })}\n\n`);
                  if (typeof (res as any).flush === 'function') (res as any).flush();
                } else if (eventType === 'done') {
                  terminalType = 'complete';
                  res.write(`data: ${JSON.stringify({
                    type: 'complete',
                    sessionId: clawConversationId,
                    content: parsed.content,
                    status: parsed.status,
                    ...(parsed.attachments?.length && { attachments: parsed.attachments }),
                    ...(parsed.pendingActions?.length && { pendingActions: parsed.pendingActions }),
                  })}\n\n`);
                  if (typeof (res as any).flush === 'function') (res as any).flush();
                } else if (eventType === 'error') {
                  terminalType = 'error';
                  lastErrorMsg = parsed.error || 'Unknown error';
                  res.write(`data: ${JSON.stringify({ 
                    type: 'error', 
                    error: parsed.error || 'Unknown error' 
                  })}\n\n`);
                  if (typeof (res as any).flush === 'function') (res as any).flush();
                } else {
                  logger.warn(`[XyneAIv2] Unknown SSE event type: ${eventType}`);
                }
              } catch (e) {
                logger.warn('[XyneAIv2] Failed to parse SSE data:', data);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

    } catch (error) {
      logger.error('[XyneAIv2] Stream error:', error);
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        error: error instanceof Error ? error.message : 'Internal server error' 
      })}\n\n`);
    } finally {
      clearInterval(pingInterval);
      res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
      res.end();
      // Clean up active stream on completion or error
      const sessionId = runResult?.sessionId;
      if (sessionId) {
        activeStreams.delete(sessionId);
      }
    }
  }

  // Webhook handlers removed - now using SSE streaming via /run/stream endpoint
  // The handleClawCallback and handleClawProgress methods are no longer needed
  // as the SSE stream from claw-auth handles all progress and completion events

  /**
   * POST /api/xyne-ai/feedback
   */
  feedback = async (req: Request, res: Response): Promise<void> => {
    const parseResult = FeedbackRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid input',
        details: parseResult.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
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
          details: 'Could not find the corresponding OTEL trace ID. The trace may have expired.'
        });
        return;
      }

      const baseUrl = langfuseBaseUrl || 'https://periscope.breeze.in';
      const periscopeUrl = baseUrl.endsWith('/') 
        ? `${baseUrl}api/public/scores` 
        : `${baseUrl}/api/public/scores`;
      const authKey = `${publicKey}:${secretKey}`;

      logger.info(`[XyneAIv2] Submitting feedback to: ${periscopeUrl}, traceId: ${otelTraceId}, value: ${value}`);
      
      const response = await fetch(periscopeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(authKey).toString('base64')}`,
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
   * Approve or decline a pending write action (human-in-the-loop)
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

      if (!approved) {
        // For decline, just acknowledge - the action will timeout on claw side
        res.json({ success: true, data: { declined: true } });
        return;
      }

      // Proxy to xyne-claw-auth to execute the write action
      const clawAuthUrl = `${config.xyneClaw.authUrl}/claw/api/v1/agent-chat/ask-ai/chat/approve-action`;
      
      // Construct the pendingAction in the format claw expects
      const pendingAction: Record<string, unknown> = {
        serverType: serverType || 'xyne-spaces',
        tool: tool || 'unknown',
        params: params || {},
        userId,
        signature: signature || '',
      };

      const response = await fetch(clawAuthUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
          ...(req.headers.cookie ? { 'Cookie': req.headers.cookie } : {}),

        },
        body: JSON.stringify({
          pendingAction,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[XyneAIv2] approve-action failed: ${response.status} ${errorText}`);
        
        // Do not forward 401 from upstream service to prevent frontend logout
        // User is authenticated with spaces; 401 from claw-auth is a service issue
        const statusCode = response.status === 401 ? 503 : response.status;
        
        // Parse error from upstream to show meaningful message in UI
        let errorMessage = 'Failed to execute action';
        try {
          const upstreamError = JSON.parse(errorText) as { error?: string; message?: string };
          errorMessage = upstreamError.error ?? upstreamError.message ?? errorText;
        } catch {
          // If not JSON, use raw error text (truncated if too long)
          errorMessage = errorText.length > 200 ? `${errorText.slice(0, 200)}...` : errorText;
        }
        
        res.status(statusCode).json({ 
          success: false, 
          error: errorMessage 
        });
        return;
      }

      const result = await response.json() as { success: boolean; data?: { content: string } };
      res.json({ success: true, data: result.data });
    } catch (error) {
      logger.error('[XyneAIv2] approve-action error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/xyne-ai/v2/conversations
   * Proxy to xyne-claw-auth conversation list endpoint
   */
  listConversations = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    try {
      const clawAuthUrl = `${config.xyneClaw.authUrl}/claw/api/v1/agent-chat/ask-ai/conversations?userId=${encodeURIComponent(userId)}`;
      const response = await fetch(clawAuthUrl, {
        headers: {
          'x-user-id': userId,
          ...(req.headers.cookie ? { 'Cookie': req.headers.cookie } : {}),
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[XyneAIv2] listConversations failed: ${response.status} ${errorText}`);
        
        // Do not forward 401 from upstream service to prevent frontend logout
        // User is authenticated with spaces; 401 from claw-auth is a service issue
        const statusCode = response.status === 401 ? 503 : response.status;
        res.status(statusCode).json({ success: false, error: 'Failed to fetch conversations' });
        return;
      }

      const result = await response.json() as { success: boolean; data: unknown };
      res.json(result);
    } catch (error) {
      logger.error('[XyneAIv2] listConversations error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/xyne-ai/v2/conversations/:convId/messages
   * Proxy to xyne-claw-auth messages endpoint
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

    try {
      const clawAuthUrl = `${config.xyneClaw.authUrl}/claw/api/v1/agent-chat/ask-ai/chat/${convId}/messages`;
      const response = await fetch(clawAuthUrl, {
        headers: {
            'x-user-id': userId,
            ...(req.headers.cookie ? { 'Cookie': req.headers.cookie } : {}),
        },      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[XyneAIv2] getMessages failed: ${response.status} ${errorText}`);
        
        // Do not forward 401 from upstream service to prevent frontend logout
        // User is authenticated with spaces; 401 from claw-auth is a service issue
        const statusCode = response.status === 401 ? 503 : response.status;
        res.status(statusCode).json({ success: false, error: 'Failed to fetch messages' });
        return;
      }
      
      const rawResponse = await response.json() as {
        success: boolean;
        data: unknown;
        toolInvocations?: unknown[];
        [key: string]: unknown;
      };
      
      logger.info('[XyneAIv2] Raw response from claw-auth messages:', {
        convId,
        hasData: !!rawResponse.data,
        hasToolInvocations: !!rawResponse.toolInvocations,
        toolInvocationsLength: rawResponse.toolInvocations?.length || 0,
        responseKeys: Object.keys(rawResponse),
      });
      
      const result = rawResponse;
      
      // Forward tool invocations from claw-auth if present
      res.json({
        ...result,
        ...(result.toolInvocations && { toolInvocations: result.toolInvocations }),
      });
    } catch (error) {
      logger.error('[XyneAIv2] getMessages error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/xyne-ai/v2/attachments/:attachmentId/download
   * Proxy attachment download from claw-auth
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
      // Proxy to xyne-claw-auth to download the attachment
      // Note: claw-auth route is /agent-chat/attachments/:id/download (confirmed from working claw chat)
      const clawAuthUrl = `${config.xyneClaw.authUrl}/claw/api/v1/agent-chat/attachments/${attachmentId}/download`;
      
      logger.info(`[XyneAIv2] Proxying attachment download: ${attachmentId}`);

      const response = await fetch(clawAuthUrl, {
        headers: {
          'x-user-id': userId,
          ...(req.headers.cookie ? { 'Cookie': req.headers.cookie } : {}),
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[XyneAIv2] Attachment download failed: ${response.status} ${errorText}`);
        
        // Do not forward 401 from upstream service to prevent frontend logout
        // User is authenticated with spaces; 401 from claw-auth is a service issue
        const statusCode = response.status === 401 ? 503 : response.status;
        res.status(statusCode).json({ 
          success: false, 
          error: 'Failed to download attachment' 
        });
        return;
      }

      // Stream the attachment back to the client
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const contentDisposition = response.headers.get('content-disposition');

      res.setHeader('Content-Type', contentType);
      if (contentDisposition) {
        res.setHeader('Content-Disposition', contentDisposition);
      }

      // Get file size if available
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      // Read the entire response as array buffer for binary integrity
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      res.end(buffer);
      logger.info(`[XyneAIv2] Attachment download completed: ${attachmentId} (${buffer.length} bytes)`);
    } catch (error) {
      this.handleError(res, error, 'download attachment');
    }
  };

  private handleError(res: Response, error: unknown, operation: string): void {
    logger.error(`Error in ${operation}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    if (!res.headersSent) {
      res.status(500).json({ success: false, error: errorMessage });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`);
      res.end();
    }
  }
}


export const xyneAIControllerV2 = new XyneAIControllerV2();