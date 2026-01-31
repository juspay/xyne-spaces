/**
 * Unified Bot Routes
 *
 * Unified API routes for all bot operations.
 * Converges onto single /api/bots namespace.
 */

import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import {
  listBots,
  getBot,
  chatWithBot,
  executeBot,
} from '@/controllers/unifiedBotController';

const router = Router();

// All routes require authentication
router.use(authMiddleware.authenticate);

/**
 * GET /bots
 * List all available bots
 * Query params: scope, category, capability, q (search)
 */
router.get('/', listBots);

/**
 * GET /bots/:botId
 * Get a specific bot's info
 */
router.get('/:botId', getBot);

/**
 * POST /bots/:botId/chat
 * Chat with a bot (streaming SSE response)
 * Body: { message: string }
 */
router.post('/:botId/chat', chatWithBot);

/**
 * POST /bots/:botId/execute
 * Trigger/execute a bot (async queue-based)
 * Body: { channelId, conversationId, parameters? }
 */
router.post('/:botId/execute', executeBot);

export default router;
