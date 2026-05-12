import { Router } from 'express';
import { PriorityClassificationController } from '../controllers/priorityClassificationController.js';

const router = Router({ mergeParams: true });
const controller = new PriorityClassificationController();

// POST /channels/:channelId/priority-classification/preview
router.post('/preview', controller.previewClassification);

// PUT /channels/:channelId/priority-classification/config
router.put('/config', controller.updateConfig);

export default router;
