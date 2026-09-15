import { Router } from 'express';
import { deskMetricsController } from '../controllers/deskMetricsController.js';

/**
 * Agent-facing desk metrics, called by the spaces-desk-metrics MCP tool rather
 * than the browser. Mounted behind authenticateUserOrApp in app.ts, ahead of
 * the dashboard's /api/desk-metrics mount so app tokens are not rejected by
 * the user-only middleware there.
 */
const router = Router();

router.get('/desks', deskMetricsController.listDesks);
router.post('/query', deskMetricsController.queryMetrics);

export default router;
