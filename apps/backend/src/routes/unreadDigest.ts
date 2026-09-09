import { Router } from 'express';
import { UnreadDigestController } from '@/controllers/unreadDigestController';

const router = Router();
const unreadDigestController = new UnreadDigestController();

/**
 * Unread Digest Routes
 * Base path: /api/unread-digest
 */

// POST /api/unread-digest/generate — stream an on-demand summary of all the
// authenticated user's unread channel messages (SSE).
router.post('/generate', unreadDigestController.generate);

export default router;
