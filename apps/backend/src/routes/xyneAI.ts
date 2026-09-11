import { Router } from 'express';
import { xyneAIControllerV2 } from '@/controllers/xyneAIControllerV2';
import { authMiddleware } from '@/middleware/auth';
import { listClawAgentsInChannel } from '@/services/channelClawAgentService';
import { ShareAgentConversationController } from '@/controllers/shareAgentConversationController';
import { logger } from '@/utils/logger';

const router = Router();
const shareAgentConversationController = new ShareAgentConversationController();

router.get('/agent-conversation-preview', shareAgentConversationController.getPreview);

/**
 * Xyne AI Routes
 *
 * Base path: /api/xyne-ai
 *
 * All Ask AI traffic runs on the claw service (V2). The legacy JAF-based V1
 * loop and its session/memory/research-agent endpoints were removed.
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
 */
router.post('/', xyneAIControllerV2.query);

/**
 * Feedback endpoint for Xyne AI responses
 *
 * POST /api/xyne-ai/feedback
 */
router.post('/feedback', xyneAIControllerV2.feedback);

// GET /api/xyne-ai/config - Public endpoint returning capability flags
router.get('/config', xyneAIControllerV2.getConfig);

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
router.post('/v2/action', authMiddleware.authenticate, xyneAIControllerV2.handleActionApproval);

/**
 * POST /api/xyne-ai/v2/cancel/:sessionId
 *
 * Cancel an in-flight Ask AI run. Propagates through claw-auth to claw,
 * which aborts the agent loop. Claw then emits a final `done` frame with
 * status="cancelled" carrying partial assistant text + tool invocations, so
 * the partial result is persisted to chat_messages and visible on reload.
 */
router.post(
  '/v2/cancel/:sessionId',
  authMiddleware.authenticate,
  xyneAIControllerV2.cancelRun,
);

// GET /api/xyne-ai/v2/conversations - List user's AI conversations from claw
router.get('/v2/conversations', authMiddleware.authenticate, xyneAIControllerV2.listConversations);

// GET /api/xyne-ai/v2/conversations/:convId/messages - Get conversation messages from claw
router.get('/v2/conversations/:convId/messages', authMiddleware.authenticate, xyneAIControllerV2.getConversationMessages);
router.get('/v2/conversations/:convId/debug', authMiddleware.authenticate, xyneAIControllerV2.getConversationDebug);
// POST /api/xyne-ai/v2/messages/:messageId/rate - persist 👍/👎 (+ comment) for
// the run that produced an assistant message (proxies to claw-auth agent_runs.rating).
router.post('/v2/messages/:messageId/rate', authMiddleware.authenticate, xyneAIControllerV2.rateRun);
// SSE proxy to claw-auth's live stream — lets a reloaded Spaces AI tab re-attach
// to an in-flight run and stream the answer instead of waiting for `done`.
router.get('/v2/conversations/:convId/live', authMiddleware.authenticate, xyneAIControllerV2.streamConversationLive);

// DELETE /api/xyne-ai/v2/conversations/:convId - Delete a claw conversation
router.delete('/v2/conversations/:convId', authMiddleware.authenticate, xyneAIControllerV2.deleteConversation);

// GET /api/xyne-ai/v2/attachments/:attachmentId/download - Download attachment from claw
router.get(
  '/v2/attachments/:attachmentId/download',
  authMiddleware.authenticate,
  xyneAIControllerV2.downloadAttachment
);

// GET /api/xyne-ai/agents - List all claw agents accessible to the current user
router.get('/agents', authMiddleware.authenticate, xyneAIControllerV2.listAccessibleAgents);

// GET /api/xyne-ai/agents/:slug/models - Models the agent's LiteLLM key can serve
router.get(
  '/agents/:slug/models',
  authMiddleware.authenticate,
  xyneAIControllerV2.listAgentModels,
);

// GET /api/xyne-ai/channel-agents/:channelId - List claw agents in a channel
router.get('/channel-agents/:channelId', authMiddleware.authenticate, async (req, res) => {
  try {
    const { channelId } = req.params;
    if (!channelId) {
      res.status(400).json({ error: 'channelId is required' });
      return;
    }
    const requesterUserId = req.user?.id;
    if (!requesterUserId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const agents = await listClawAgentsInChannel(channelId, requesterUserId);
    res.json({ agents });
  } catch (error) {
    logger.error('[xyne-ai] Failed to list channel claw agents:', error);
    res.status(500).json({ error: 'Failed to list channel claw agents' });
  }
});

export default router;
