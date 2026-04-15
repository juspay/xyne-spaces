import { Router } from 'express';
import { searchMetricsController } from '@/controllers/searchMetricsController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

// POST /api/search-metrics/metrics - Record batched search metrics
router.post('/metrics', authMiddleware.authenticate, searchMetricsController.recordMetrics);

export default router;