import { Router } from 'express';
import { deskMetricsController } from '../controllers/deskMetricsController.js';

/**
 * Mounted at /api/desk-metrics rather than under /api/channels/:channelId so
 * the multi-desk selection lives in the query string and cannot collide with
 * the :channelId path segment.
 */
const router = Router();

// GET /desk-metrics/aggregate?channelIds=a,b,c
router.get('/aggregate', deskMetricsController.getAggregateMetrics);

export default router;
