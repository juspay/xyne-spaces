import { Router } from 'express';
import { deskMetricsController } from '../controllers/deskMetricsController.js';

const router = Router({ mergeParams: true });

// GET /channels/:channelId/metrics
router.get('/', deskMetricsController.getMetrics);

export default router;
