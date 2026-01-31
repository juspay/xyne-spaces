import { Router } from 'express';
import { productInsightsController } from '../controllers/productInsightsController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

/**
 * GET /api/productInsights
 * Query params: scope, time_range
 */
router.get(
  '/',
  authMiddleware.authenticate,
  productInsightsController.getProductInsights
);

export default router;