import { Router } from 'express';
import { SummarizeController } from '@/controllers/summarizeController';

const router = Router();
const summarizeController = new SummarizeController();

/**
 * Summarization Routes
 * Base path: /api/summarize
 */

// GET /api/summarize/thread/:conversationId
router.get('/thread/:conversationId', summarizeController.summarizeThread);

// GET /api/summarize/email-thread/:conversationId
router.get('/email-thread/:conversationId', summarizeController.summarizeEmailThread);

// GET /api/summarize/channel/:channelId?dateFrom=ISO_DATE&dateTo=ISO_DATE
router.get('/channel/:channelId', summarizeController.summarizeChannel);

// Summarize search results based on user query
// POST /api/summarize/searchMessage
router.post('/searchMessage', summarizeController.summarizeSearchMessage);

export default router;
