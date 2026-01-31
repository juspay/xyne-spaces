import { Router } from 'express';
import { listBots, triggerBot } from '../controllers/botController.js';

const router = Router();

/**
 * @route GET /api/bots
 * @desc Get list of all registered bots, optionally filtered by scope
 * @query scope - Optional filter by 'conversation' or 'thread'
 * @access Public
 * @example GET /api/bots?scope=conversation
 */
router.get('/', listBots);

/**
 * @route POST /api/bots/trigger
 * @desc Trigger a bot execution with specified context
 * @body botName - Name of the bot to trigger
 * @body channelId - Channel ID where bot is triggered
 * @body conversationId - Conversation ID for bot context
 * @body parameters - Bot input parameters (optional)
 * @body userId - User ID triggering the bot
 * @access Public
 * @example POST /api/bots/trigger
 */
router.post('/trigger', triggerBot);

export default router;