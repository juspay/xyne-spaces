import { Router } from 'express';
import { XyneAIController } from '@/controllers/xyneAIController';

const router = Router();
const xyneAIController = new XyneAIController();

/**
 * Xyne AI Routes
 * 
 * Base path: /api/xyne-ai
 * 
 * Single unified endpoint for the AI assistant.
 * Handles both normal questions and summary requests.
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
router.post('/', xyneAIController.query);

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
router.post('/feedback', xyneAIController.feedback);

/**
 * List available products for Research Agent
 *
 * GET /api/xyne-ai/list-products
 *
 * Response:
 * [{ id: string, name: string }]
 */
router.get('/list-products', xyneAIController.listProducts);

/**
 * List available repositories for Research Agent
 *
 * GET /api/xyne-ai/list-repositories
 *
 * Response:
 * [{ id: string, name: string }]
 */
router.get('/list-repositories', xyneAIController.listRepositories);

// GET /api/xyne-ai/config - Public endpoint returning web search config
router.get('/config', xyneAIController.getConfig);

// GET /api/xyne-ai/memories - Get all memories for current user
router.get('/memories', xyneAIController.getMemories);

// DELETE /api/xyne-ai/memories/:id - Delete a single memory
router.delete('/memories/:id', xyneAIController.deleteMemory);

// DELETE /api/xyne-ai/memories - Clear all memories for current user
router.delete('/memories', xyneAIController.clearMemories);

// ============================================================================
// Session Management Endpoints
// ============================================================================

/**
 * GET /api/xyne-ai/sessions
 *
 * List all Ask AI sessions for the authenticated user.
 * Returns lightweight metadata (no messages).
 */
router.get('/sessions', xyneAIController.getSessions);

/**
 * GET /api/xyne-ai/sessions/:sessionId
 *
 * Get a single session with all messages transformed to frontend format.
 */
router.get('/sessions/:sessionId', xyneAIController.getSessionDetail);

/**
 * PATCH /api/xyne-ai/sessions/:sessionId/star
 *
 * Toggle star status for a session.
 */
router.patch('/sessions/:sessionId/star', xyneAIController.toggleStar);

/**
 * PATCH /api/xyne-ai/sessions/:sessionId/rename
 *
 * Rename a session. Body: { title: string }
 */
router.patch('/sessions/:sessionId/rename', xyneAIController.renameSession);

/**
 * PATCH /api/xyne-ai/sessions/:sessionId/metadata
 *
 * Update session metadata (branchSelections, feedbackMap, title).
 * Body: { branchSelections?: Record<string, string>, feedbackMap?: Record<string, number>, title?: string }
 */
router.patch('/sessions/:sessionId/metadata', xyneAIController.updateSessionMetadata);

/**
 * DELETE /api/xyne-ai/sessions/:sessionId
 *
 * Delete a session and all its messages.
 */
router.delete('/sessions/:sessionId', xyneAIController.deleteSessionEndpoint);

export default router;
