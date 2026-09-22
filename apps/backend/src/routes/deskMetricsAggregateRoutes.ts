import { Router } from 'express';
import { deskMetricsController } from '../controllers/deskMetricsController.js';

const router = Router();

router.get('/aggregate', deskMetricsController.getAggregateMetrics);
router.get('/desks', deskMetricsController.listDesks);

export default router;
