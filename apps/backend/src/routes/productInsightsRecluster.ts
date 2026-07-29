import { Router, Request, Response, NextFunction } from 'express';
import { ProductInsightsReclusterController } from '@/controllers/productInsightsReclusterController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

/**
 * @route POST /api/admin/product-insights-recluster
 * @desc Trigger product insights recluster (admin only)
 */
router.post(
  '/',
  (req: Request, res: Response, next: NextFunction) => authMiddleware.authenticate(req, res, next),
  (req: Request, res: Response, next: NextFunction) => authMiddleware.requireAdmin(req, res, next),
  ProductInsightsReclusterController.triggerRecluster,
);

export default router;
