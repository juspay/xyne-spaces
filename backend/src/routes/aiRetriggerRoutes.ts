import { Router } from 'express';
import { AiRetriggerController } from '../controllers/aiRetriggerController.js';

const router = Router({ mergeParams: true });
const controller = new AiRetriggerController();

// GET  /channels/:channelId/ai-retrigger/status
// POST /channels/:channelId/ai-retrigger
router.get('/status', controller.getStatus);
router.post('/', controller.retrigger);

export default router;
