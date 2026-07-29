/**
 * Meet Callback Routes
 * Handles callbacks from SAM service for Google Meet processing
 */

import { Router } from 'express';
import { meetCallbackController } from '@/controllers/meetCallbackController';
import { verifySamCallback } from '@/middleware/samCallbackAuth';

const router = Router();

// POST /api/meet/callback
// Called by SAM service when Google Meet processing is complete
// Defense-in-depth: Apply authentication middleware directly to route
router.post('/callback', verifySamCallback, meetCallbackController.handleMeetCallback);

export default router;
