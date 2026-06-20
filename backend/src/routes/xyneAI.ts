import { Router } from 'express';
import { xyneAIControllerFactory } from '@/controllers/xyneAIControllerFactory';
import { authMiddleware } from '@/middleware/auth';
import { listClawAgentsInChannel } from '@/services/clawAgentService';
import { logger } from '@/utils/logger';

const router = Router();

/**
 * Xyne AI Routes
 * 
 * Base path: /api/xyne-ai
 * 
 * Single unified endpoint for the AI assistant.
 * Handles both normal questions and summary requests.
 * 
 * Version switching: Set ASK_AI_VERSION=v2 in environment to use xyne-claw
 */

/**
 * Main Xyne AI endpoint
 * 
 * POST /api/xyne-ai
 * 
 * Body:
 * {
 *   "query": "string (required) - the user's question",
 *   "session_id": "string (optional) - UUID for session continuity",
 *   "channel_ids": "string[] (optional) - the channel context",
 *   "conversation_id": "string (optional) - the thread context"
 * }
 * 
 * Response: Server-Sent Events stream
 * 
 * Events:
 * - tool_input: { type: 'tool_input', toolName, input }
 * - tool_output: { type: 'tool_output', toolName, output }
 * - start: { type: 'start', sessionId, isNewSession, traceId }
 * - delta: { type: 'delta', content }
 * - complete: { type: 'complete', output: { summary, keypoints, citations } }
 * - error: { type: 'error', error }
 * - end: { type: 'end' }
 */
router.post('/', xyneAIControllerFactory.query);

/**
 * Feedback endpoint for Xyne AI responses
 *
 * POST /api/xyne-ai/feedback
 *
 * Body:
 * {
 *   "traceId": "string (required) - the trace ID from the AI response",
 *   "value": "LIKE | DISLIKE (required) - user feedback"
 * }
 *
 * Response:
 * {
 *   "success": true
 * }
 */
router.post('/feedback', xyneAIControllerFactory.feedback);

/**
 * List available products for Research Agent
 *
 * GET /api/xyne-ai/list-products
 *
 * Response:
 * [{ id: string, name: string }]
 */
router.get('/list-products', xyneAIControllerFactory.listProducts);

/**
 * List available repositories for Research Agent
 *
 * GET /api/xyne-ai/list-repositories
 *
 * Response:
 * [{ id: string, name: string }]
 */
router.get('/list-repositories', xyneAIControllerFactory.listRepositories);

// GET /api/xyne-ai/config - Public endpoint returning web search config
router.get('/config', xyneAIControllerFactory.getConfig);

// GET /api/xyne-ai/memories - Get all memories for current user
router.get('/memories', xyneAIControllerFactory.getMemories);

// DELETE /api/xyne-ai/memories/:id - Delete a single memory
router.delete('/memories/:id', xyneAIControllerFactory.deleteMemory);

// DELETE /api/xyne-ai/memories - Clear all memories for current user
router.delete('/memories', xyneAIControllerFactory.clearMemories);

// ============================================================================
// Session Management Endpoints
// ============================================================================

/**
 * GET /api/xyne-ai/sessions
 *
 * List all Ask AI sessions for the authenticated user.
 * Returns lightweight metadata (no messages).
 */
router.get('/sessions', xyneAIControllerFactory.getSessions);

/**
 * GET /api/xyne-ai/sessions/by-conversation/:conversationId
 *
 * Returns the most recent Ask AI session ID for the current user + this mail conversation.
 */
router.get(
  '/sessions/by-conversation/:conversationId',
  xyneAIControllerFactory.getSessionByConversation,
);

/**
 * GET /api/xyne-ai/sessions/by-conversation/:conversationId/autodraft
 *
 * Returns the autodraft session ID (channel-owner's session) for this mail conversation.
 */
router.get(
  '/sessions/by-conversation/:conversationId/autodraft',
  xyneAIControllerFactory.getAutodraftSessionByConversation,
);

/**
 * GET /api/xyne-ai/sessions/:sessionId
 *
 * Get a single session with all messages transformed to frontend format.
 */
router.get('/sessions/:sessionId', xyneAIControllerFactory.getSessionDetail);

/**
 * PATCH /api/xyne-ai/sessions/:sessionId/star
 *
 * Toggle star status for a session.
 */
router.patch('/sessions/:sessionId/star', xyneAIControllerFactory.toggleStar);

/**
 * PATCH /api/xyne-ai/sessions/:sessionId/rename
 *
 * Rename a session. Body: { title: string }
 */
router.patch('/sessions/:sessionId/rename', xyneAIControllerFactory.renameSession);

/**
 * PATCH /api/xyne-ai/sessions/:sessionId/metadata
 *
 * Update session metadata (branchSelections, feedbackMap, title).
 * Body: { branchSelections?: Record<string, string>, feedbackMap?: Record<string, number>, title?: string }
 */
router.patch('/sessions/:sessionId/metadata', xyneAIControllerFactory.updateSessionMetadata);

/**
 * DELETE /api/xyne-ai/sessions/:sessionId
 *
 * Delete a session and all its messages.
 */
router.delete('/sessions/:sessionId', xyneAIControllerFactory.deleteSessionEndpoint);

// ============================================================================
// v2 Specific Endpoints (xyne-claw)
// ============================================================================

// Note: Webhook endpoints (/v2/callback, /v2/progress) have been removed.
// Now using SSE streaming via claw-auth's /run/stream endpoint.
// Events flow: xyne-claw → claw-auth (internal) → Spaces backend (SSE) → Frontend (SSE)

/**
 * POST /api/xyne-ai/v2/action
 * 
 * Approve or decline a pending write action (human-in-the-loop)
 */
router.post('/v2/action', authMiddleware.authenticate, xyneAIControllerFactory.handleActionApproval);

/**
 * POST /api/xyne-ai/v2/cancel/:sessionId
 *
 * Cancel an in-flight Ask AI v2 run. Propagates through claw-auth to claw,
 * which aborts the agent loop. Claw then emits a final `done` frame with
 * status="cancelled" carrying partial assistant text + tool invocations, so
 * the partial result is persisted to chat_messages and visible on reload.
 */
router.post(
  '/v2/cancel/:sessionId',
  authMiddleware.authenticate,
  xyneAIControllerFactory.cancelRun,
);

// GET /api/xyne-ai/v2/conversations - List user's AI conversations from claw
router.get('/v2/conversations', authMiddleware.authenticate, xyneAIControllerFactory.listConversations);

// GET /api/xyne-ai/v2/conversations/:convId/messages - Get conversation messages from claw
router.get('/v2/conversations/:convId/messages', authMiddleware.authenticate, xyneAIControllerFactory.getConversationMessages);
router.get('/v2/conversations/:convId/debug', authMiddleware.authenticate, xyneAIControllerFactory.getConversationDebug);

// DELETE /api/xyne-ai/v2/conversations/:convId - Delete a claw conversation
router.delete('/v2/conversations/:convId', authMiddleware.authenticate, xyneAIControllerFactory.deleteConversation);

// GET /api/xyne-ai/v2/attachments/:attachmentId/download - Download attachment from claw
router.get('/v2/attachments/:attachmentId/download', authMiddleware.authenticate, xyneAIControllerFactory.downloadAttachment);

// GET /api/xyne-ai/agents - List all claw agents accessible to the current user
router.get(
  '/agents',
  authMiddleware.authenticate,
  xyneAIControllerFactory.listAccessibleAgents,
);

// GET /api/xyne-ai/channel-agents/:channelId - List claw agents in a channel
router.get(
  '/channel-agents/:channelId',
  authMiddleware.authenticate,
  async (req, res) => {
    try {
      const { channelId } = req.params;
      if (!channelId) {
        res.status(400).json({ error: 'channelId is required' });
        return;
      }
      const agents = await listClawAgentsInChannel(channelId);
      res.json({ agents });
    } catch (error) {
      logger.error('[xyne-ai] Failed to list channel claw agents:', error);
      res.status(500).json({ error: 'Failed to list channel claw agents' });
    }
  },
);

export default router;
