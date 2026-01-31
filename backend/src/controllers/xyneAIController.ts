import { Request, Response } from 'express';
import { z } from 'zod';
import { xyneAIStream, type XyneAIStreamRequest, type UserInfo } from '@/agents/xyne-ai';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { config } from '@/config/env';

const emptyToUndefined = (val: unknown) => (val === '' ? undefined : val);

// Request validation schema
// Note: channel_ids can be empty [] - agent will ask user to specify channel if needed
const XyneAIRequestSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(10000, 'Query too long'),
  session_id: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  channel_ids: z.array(z.string().min(1)).default([]), // Allow empty array - agent handles clarification
  conversation_id: z.preprocess(emptyToUndefined, z.string().optional()),
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

    const { query, session_id, channel_ids, conversation_id } = parseResult.data;

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

      // Verify conversation_id if provided (only if channel_ids is not empty)
      if (conversation_id && channel_ids.length > 0) {
        const conversation = await db.conversation.findUnique({
          where: { conversationId: conversation_id },
        });
        if (!conversation || !channel_ids.includes(conversation.channelId)) {
          res.status(400).json({ error: 'Invalid conversation_id: does not belong to any of the specified channels' });
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

      const agentRequest = {
        query,
        sessionId: session_id,
        channelIds: channel_ids,
        conversationId: conversation_id,
        userId,
        userInfo,
      };

      await this.streamResponse(res, agentRequest);

    } catch (error) {
      this.handleError(res, error, 'xyne-ai query');
    }
  };

  /**
   * POST /api/xyne-ai/feedback
   *
   * Body:
   * - traceId: string (required) - the trace ID from the AI response
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

    const { traceId, value } = parseResult.data;

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

      // Validate trace ID format (32 hex characters for Langfuse)
      if (!/^[a-f0-9]{32}$/i.test(traceId)) {
        logger.warn(`[XyneAI] Invalid trace ID format: ${traceId}. Expected 32 hex characters.`);
        res.status(400).json({ 
          error: 'Invalid trace ID format',
          details: 'traceId must be a 32-character hexadecimal string'
        });
        return;
      }

      // Construct the full URL for the scores endpoint
      const baseUrl = langfuseBaseUrl || 'https://periscope.breeze.in';
      const periscopeUrl = baseUrl.endsWith('/') 
        ? `${baseUrl}api/public/scores` 
        : `${baseUrl}/api/public/scores`;
      const authKey = `${publicKey}:${secretKey}`;

      logger.info(`[XyneAI] Submitting feedback to: ${periscopeUrl}, traceId: ${traceId}, value: ${value}`);
      
      const response = await fetch(periscopeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(authKey).toString('base64')}`,
        },
        body: JSON.stringify({
          traceId,
          name: 'XYNE_AI_FEEDBACK',
          value,
          dataType: 'CATEGORICAL',
          comment: 'Evaluation from the user',
          id: traceId,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[XyneAI] Failed to submit feedback: ${response.status} ${errorText}`);
        res.status(response.status).json({ error: 'Failed to submit feedback' });
        return;
      }

      logger.info(`[XyneAI] Feedback submitted successfully for traceId: ${traceId}`);
      res.json({ success: true });

    } catch (error) {
      logger.error('[XyneAI] Error submitting feedback:', error);
      res.status(500).json({ error: 'Internal server error' });
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

    // Create callback for real-time tool events (e.g., Genius streaming)
    const onStreamEvent = (event: Record<string, unknown>): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (typeof (res as any).flush === 'function') (res as any).flush();
    };

    const streamGenerator = xyneAIStream({ ...request, onStreamEvent });

    for await (const chunk of streamGenerator) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      if (typeof (res as any).flush === 'function') (res as any).flush();
      if (chunk.type === 'complete' || chunk.type === 'error') break;
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
