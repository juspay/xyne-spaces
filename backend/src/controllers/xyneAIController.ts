import { Request, Response } from 'express';
import { z } from 'zod';
import { xyneAIStream, type XyneAIStreamRequest, type UserInfo, AgentsConfig } from '@/agents/xyne-ai';
import { getOtelTraceId } from '@juspay-jaf/jaf';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { config } from '@/config/env';
import {
  getAskAIQueriesTotal,
  getAskAIQueryDuration,
  getAskAIContextChannels,
  getAskAIFeedbackTotal,
} from '@/services/otel';
import { researchAgentService } from '@/services/researchAgentService';
import { sessionStore } from '@/agents/xyne-ai/storage/sessionStore';
import {
  transformMessagesToFrontendFormat,
  applyFeedbackToMessages,
} from '@/agents/xyne-ai/utils/messageTransformer';

const emptyToUndefined = (val: unknown) => (val === '' ? undefined : val);

// Validate base64 string
const isValidBase64 = (str: string): boolean => {
  if (!str || str.length === 0) return false;
  // Base64 regex: only allows valid base64 characters (A-Z, a-z, 0-9, +, /, =)
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(str)) return false;
  // Check if length is valid (must be multiple of 4)
  if (str.length % 4 !== 0) return false;
  return true;
};

// Research context schema - selected product or repository from frontend
const ResearchContextSchema = z.object({
  type: z.enum(['product', 'repository']),
  name: z.string().min(1),
});

// Selection context schema - selected text from canvas
const SelectionContextSchema = z.object({
  canvas_view_access_id: z.string().min(1),
  selected_text: z.string().min(1),
  canvas_title: z.string().optional(),
});

// Request validation schema
// Note: channel_ids can be empty [] - agent will ask user to specify channel if needed
const XyneAIRequestSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty'),
  session_id: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  channel_ids: z.array(z.string().min(1)).default([]), // Allow empty array - agent handles clarification
  conversation_id: z.preprocess(emptyToUndefined, z.string().optional()),
  canvas_view_access_id: z.string().optional(), // Canvas context when Ask AI is triggered from canvas
  selection_contexts: z.array(SelectionContextSchema).optional(), // Selected text contexts from canvases
  create_canvas_enabled: z.boolean().optional().default(false), // Enable create canvas instruction
  web_search_enabled: z.boolean().optional().default(false), // Enable/disable web search tool, defaults to false
  deep_research_enabled: z.boolean().optional().default(false), // Enable/disable deep research tool, defaults to false
  research_context: ResearchContextSchema.optional().nullable(), // Selected product/repository from frontend
  attachments: z.array(z.object({
    data: z.string().min(1, 'Attachment data cannot be empty').refine(isValidBase64, {
      message: 'Invalid base64 data format',
    }),
    mime_type: z.string().min(1, 'MIME type is required'),
    filename: z.string().optional(),
  })).optional(),
  message_attachment_ids: z.array(z.string().min(1)).optional(), // Attachment IDs to fetch from GCS
  parent_message_id: z.string().optional(), // Parent message ID for branching (tree structure)
  is_regenerate: z.boolean().optional().default(false), // Whether this is a regenerate request
  canvas_ids: z.array(z.string().min(1)).optional(), // Canvas IDs to fetch and inject as context
  ticket_ids: z.array(z.string().min(1)).optional(), // Ticket IDs to fetch and inject as context
  call_ids: z.array(z.string().min(1)).optional(), // Call IDs to fetch and inject as context (includes recordings)
  display_query: z.string().optional(), // Original user query without canvas/selection enhancements — stored in DB
});

// Feedback request validation schema
const FeedbackRequestSchema = z.object({
  traceId: z.string().min(1, 'traceId is required'),
  value: z.enum(['LIKE', 'DISLIKE'], { required_error: 'value must be LIKE or DISLIKE' }),
});

/**
 * Controller for Xyne AI - Unified AI Assistant
 * The agent decides which tools to call based on the query
 */
export class XyneAIController {
  /**
   * POST /api/xyne-ai
   *
   * Body:
   * - query: string (required)
   * - session_id: string (optional) - UUID for session continuity
   * - channel_id: string (required)
   * - conversation_id: string (optional) - when opened from thread
   * - attachments: array (optional) - file attachments with base64 data, mime_type, and optional filename
   */
  query = async (req: Request, res: Response): Promise<void> => {
    const parseResult = XyneAIRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid input',
        details: parseResult.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
      });
      return;
    }

    const {
      query,
      session_id,
      channel_ids,
      conversation_id,
      canvas_view_access_id,
      selection_contexts,
      create_canvas_enabled,
      web_search_enabled, deep_research_enabled,
      research_context,
      attachments,
      message_attachment_ids,
      parent_message_id,
      is_regenerate,
      canvas_ids,
      ticket_ids,
      call_ids,
      display_query,
    } = parseResult.data;

    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      // Authorization check - verify user has access to ALL specified channels
      // Skip if channel_ids is empty - agent will ask user to specify channel
      if (channel_ids.length > 0) {
        const userChannelAccess = await db.channelParticipant.findMany({
          where: { 
            userId,
            channelId: { in: channel_ids },
          },
          select: { channelId: true },
        });

        const accessibleChannelIds = userChannelAccess.map(c => c.channelId);
        const inaccessibleChannels = channel_ids.filter(id => !accessibleChannelIds.includes(id));

        if (inaccessibleChannels.length > 0) {
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

      const userInfo: UserInfo = {
        userId: user?.id || userId,
        userName: user?.name || 'Unknown',
        userEmail: user?.email || '',
      };

      logger.info(`[XyneAI] User context prepared for agent (userId: ${userInfo.userId})`);

      // Fetch CAC config with user email context (logging is done inside AgentsConfig.fetch)
      const agentsConfig = await AgentsConfig.fetch({ email: userInfo.userEmail });

      // Transform selection_contexts from snake_case to camelCase
      const transformedSelectionContexts = selection_contexts?.map(ctx => ({
        canvasViewAccessId: ctx.canvas_view_access_id,
        selectedText: ctx.selected_text,
        ...(ctx.canvas_title && { canvasTitle: ctx.canvas_title }),
      }));

      const agentRequest = {
        query,
        sessionId: session_id,
        channelIds: channel_ids,
        conversationId: conversation_id,
        canvasViewAccessId: canvas_view_access_id,
        selectionContexts: transformedSelectionContexts,
        createCanvasEnabled: create_canvas_enabled,
        userId,
        attachments: attachments,
        userInfo,
        webSearchEnabled: web_search_enabled,
        deepResearchEnabled: deep_research_enabled,
        researchContext: research_context || undefined,
        messageAttachmentIds: message_attachment_ids,
        canvasIds: canvas_ids || [],
        ticketIds: ticket_ids || [],
        callIds: call_ids || [],
        agentsConfig,  // Pass CAC config to stream
        parentMessageId: parent_message_id,
        isRegenerate: is_regenerate,
        agentName: 'ask-ai',
        displayQuery: display_query,
      };

      // Track metrics: context channels count
      getAskAIContextChannels().record(channel_ids.length);

      const startTime = Date.now();
      let status = 'success';

      try {
        await this.streamResponse(res, agentRequest);
      } catch (streamError) {
        status = 'error';
        throw streamError;
      } finally {
        try {
          const duration = Date.now() - startTime;
          getAskAIQueryDuration().record(duration, { status });
          getAskAIQueriesTotal().add(1, { status });
        } catch (metricsError) {
          logger.error('[XyneAI] Error recording metrics:', metricsError);
        }
      }

    } catch (error) {
      this.handleError(res, error, 'xyne-ai query');
    }
  };

  /**
   * POST /api/xyne-ai/feedback
   *
   * Body:
   * - traceId: string (required) - the JAF trace ID from the AI response
   * - value: 'LIKE' | 'DISLIKE' (required) - user feedback
   *
   * Sends feedback to Langfuse/Periscope
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
        logger.warn('[XyneAI] Langfuse credentials not configured');
        res.status(500).json({ error: 'Langfuse credentials not configured' });
        return;
      }

      const otelTraceId = getOtelTraceId(jafTraceId);
      
      if (!otelTraceId) {
        logger.warn(`[XyneAI] Could not find OTEL trace ID for JAF traceId: ${jafTraceId}`);
        res.status(404).json({ 
          error: 'Trace not found',
          details: 'Could not find the corresponding OTEL trace ID. The trace may have expired.'
        });
        return;
      }

      // Construct the full URL for the scores endpoint
      const baseUrl = langfuseBaseUrl || 'https://periscope.breeze.in';
      const periscopeUrl = baseUrl.endsWith('/') 
        ? `${baseUrl}api/public/scores` 
        : `${baseUrl}/api/public/scores`;
      const authKey = `${publicKey}:${secretKey}`;

      logger.info(`[XyneAI] Submitting feedback to: ${periscopeUrl}, traceId: ${otelTraceId}, value: ${value}`);
      
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
        logger.error(`[XyneAI] Failed to submit feedback: ${response.status} ${errorText}`);
        res.status(response.status).json({ error: 'Failed to submit feedback' });
        return;
      }

      // Track feedback metric
      getAskAIFeedbackTotal().add(1, { value });

      logger.info(`[XyneAI] Feedback submitted successfully for traceId: ${otelTraceId}`);
      res.json({ success: true });

    } catch (error) {
      logger.error('[XyneAI] Error submitting feedback:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };


  /**
   * GET /api/xyne-ai/list-products
   * 
   * Returns list of available products from Research Agent
   * Response: [{ id: string, name: string }]
   */
  listProducts = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const products = await researchAgentService.listProducts();
      res.json(products);
    } catch (error) {
      logger.error('[XyneAI] Error listing products:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch products';
      res.status(500).json({ error: errorMessage });
    }
  };

  /**
   * GET /api/xyne-ai/list-repositories
   * 
   * Returns list of available repositories from Research Agent
   * Response: [{ id: string, name: string }]
   */
  listRepositories = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const repositories = await researchAgentService.listRepositories();
      res.json(repositories);
    } catch (error) {
      logger.error('[XyneAI] Error listing repositories:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch repositories';
      res.status(500).json({ error: errorMessage });
    }
  };

  getConfig = async (_req: Request, res: Response): Promise<void> => {
    res.json({
      webSearchAccessible: !!config.xyneAiExtended.url,
      deepResearchAccessible: !!config.xyneAiExtended.url,
    });
  };

  /**
   * GET /api/xyne-ai/memories
   * Returns all memories stored for the current user in mem0.
   */
  getMemories = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const baseUrl = config.xyneAiExtended.url;
    if (!baseUrl) {
      res.json({ results: [] });
      return;
    }

    try {
      const response = await fetch(`${baseUrl}/mem0/memories?user_id=${encodeURIComponent(userId)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        res.status(response.status).json({ error: 'Failed to fetch memories' });
        return;
      }
      const data = await response.json();
      res.json(data);
    } catch (error) {
      logger.error('[XyneAI] Error fetching memories:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/xyne-ai/memories/:id
   * Deletes a single memory by ID from mem0.
   */
  deleteMemory = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { id } = req.params;
    const baseUrl = config.xyneAiExtended.url;
    if (!baseUrl) {
      res.json({ success: true });
      return;
    }

    try {
      // Verify ownership before deleting
      const getResponse = await fetch(`${baseUrl}/mem0/memories/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (getResponse.status === 404) {
        res.status(404).json({ error: 'Memory not found' });
        return;
      }
      if (getResponse.ok) {
        const memory = await getResponse.json() as { user_id?: string };
        if (memory.user_id && memory.user_id !== userId) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
      }

      const response = await fetch(`${baseUrl}/mem0/memories/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        res.status(response.status).json({ error: 'Failed to delete memory' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      logger.error('[XyneAI] Error deleting memory:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/xyne-ai/memories
   * Deletes all memories for the current user from mem0.
   */
  clearMemories = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const baseUrl = config.xyneAiExtended.url;
    if (!baseUrl) {
      res.json({ success: true });
      return;
    }

    try {
      const response = await fetch(`${baseUrl}/mem0/memories?user_id=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        res.status(response.status).json({ error: 'Failed to clear memories' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      logger.error('[XyneAI] Error clearing memories:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/xyne-ai/sessions
   *
   * Returns all Ask AI sessions for the authenticated user.
   * Lightweight: returns metadata only (no messages).
   */
  getSessions = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const sessions = await sessionStore.getUserSessions(userId);
      res.json({ sessions });
    } catch (error) {
      logger.error('[XyneAI] Error fetching sessions:', error);
      res.status(500).json({ error: 'Failed to fetch sessions' });
    }
  };

  /**
   * GET /api/xyne-ai/sessions/:sessionId
   *
   * Returns a single session with all messages transformed to frontend format.
   */
  getSessionDetail = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      res.status(400).json({ error: 'Session ID is required' });
      return;
    }

    try {
      const sessionData = await sessionStore.get(sessionId);
      if (!sessionData) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      // Verify session belongs to user
      if (sessionData.context.userId !== userId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Get raw messages for transformation
      const rawMessages = await sessionStore.getRawMessages(sessionId);
      const frontendMessages = transformMessagesToFrontendFormat(rawMessages);

      // Read metadata from DB for channelId, isStarred, title, branchSelections, feedbackMap
      const rawMeta = await getRawSessionMetadata(sessionId);

      // Generate title from first user message if no custom title stored
      let title = rawMeta.title || 'New conversation';
      if (!rawMeta.title) {
        const firstUserMsg = frontendMessages.find(m => m.type === 'user');
        if (firstUserMsg) {
          const content = firstUserMsg.content.trim();
          title = content.length > 50 ? content.substring(0, 50) + '...' : content;
        }
      }

      const channelId = rawMeta.channelId || rawMeta.channelIds?.[0] || sessionData.context.channelIds?.[0] || '';
      const threadConversationId = rawMeta.conversationId || sessionData.context.conversationId;

      res.json({
        id: sessionId,
        sessionId,
        channelId,
        threadConversationId,
        title,
        isStarred: rawMeta.isStarred || false,
        branchSelections: rawMeta.branchSelections || {},
        createdAt: sessionData.createdAt,
        updatedAt: sessionData.updatedAt,
        messages: applyFeedbackToMessages(frontendMessages, rawMeta.feedbackMap || {}),
      });
    } catch (error) {
      logger.error(`[XyneAI] Error fetching session detail for ${req.params.sessionId}:`, error);
      res.status(500).json({ error: 'Failed to fetch session detail' });
    }
  };

  /**
   * PATCH /api/xyne-ai/sessions/:sessionId/star
   */
  toggleStar = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      res.status(400).json({ error: 'Session ID is required' });
      return;
    }

    try {
      const rawMeta = await getRawSessionMetadata(sessionId);
      const success = await sessionStore.updateMetadata(sessionId, {
        isStarred: !rawMeta.isStarred,
      });

      if (!success) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({ success: true, isStarred: !rawMeta.isStarred });
    } catch (error) {
      logger.error(`[XyneAI] Error toggling star for ${sessionId}:`, error);
      res.status(500).json({ error: 'Failed to toggle star' });
    }
  };

  /**
   * PATCH /api/xyne-ai/sessions/:sessionId/rename
   */
  renameSession = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { sessionId } = req.params;
    const schema = z.object({ title: z.string().min(1).max(200) });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid title' });
      return;
    }

    try {
      const success = await sessionStore.updateMetadata(sessionId, {
        title: parseResult.data.title,
      });

      if (!success) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      logger.error(`[XyneAI] Error renaming session ${sessionId}:`, error);
      res.status(500).json({ error: 'Failed to rename session' });
    }
  };

  /**
   * DELETE /api/xyne-ai/sessions/:sessionId
   */
  deleteSessionEndpoint = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      res.status(400).json({ error: 'Session ID is required' });
      return;
    }

    try {
      const success = await sessionStore.delete(sessionId);
      if (!success) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      logger.error(`[XyneAI] Error deleting session ${sessionId}:`, error);
      res.status(500).json({ error: 'Failed to delete session' });
    }
  };

  /**
   * PATCH /api/xyne-ai/sessions/:sessionId/metadata
   *
   * Updates session metadata (branchSelections, feedbackMap, etc.)
   */
  updateSessionMetadata = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { sessionId } = req.params;
    const schema = z.object({
      branchSelections: z.record(z.string()).optional(),
      feedbackMap: z.record(z.number()).optional(),
      title: z.string().min(1).max(200).optional(),
    });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid metadata', details: parseResult.error.errors });
      return;
    }

    try {
      const success = await sessionStore.updateMetadata(sessionId, parseResult.data);
      if (!success) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      logger.error(`[XyneAI] Error updating metadata for ${sessionId}:`, error);
      res.status(500).json({ error: 'Failed to update metadata' });
    }
  };

  private async streamResponse(
    res: Response,
    request: Omit<XyneAIStreamRequest, 'onStreamEvent'>
  ): Promise<void> {
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

    // Create callback for real-time tool events (e.g., Genius streaming)
    const onStreamEvent = (event: Record<string, unknown>): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (typeof (res as any).flush === 'function') (res as any).flush();
    };

    const streamGenerator = xyneAIStream({ ...request, onStreamEvent });

    try {
      for await (const chunk of streamGenerator) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
        if (chunk.type === 'complete' || chunk.type === 'error') break;
      }
    } finally {
      clearInterval(pingInterval);
    }

    res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
    res.end();
    logger.info(`[XyneAI] Stream completed`);
  }

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

// ============================================================================
// Helper: Read raw session metadata from DB
// ============================================================================

async function getRawSessionMetadata(sessionId: string): Promise<Record<string, any>> {
  try {
    const execution = await db.workflowExecution.findUnique({
      where: { id: sessionId },
      select: { context: true },
    });
    if (!execution?.context) return {};
    return JSON.parse(execution.context);
  } catch {
    return {};
  }
}
