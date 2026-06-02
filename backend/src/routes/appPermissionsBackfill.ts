import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '@/middleware/auth';
import {
  appPermissionsBackfillService,
  type AppPermissionsBackfillConfig,
} from '@/services/appPermissionsBackfillService';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

const router = Router();

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  authMiddleware.authenticate(req, res, next);
};

/**
 * @route POST /api/admin/app-permissions-backfill
 * @desc  Grant every available permission (as APPROVED) to every installed app.
 *        Processes apps in cursor-based batches with a sleep between each batch.
 *        Safe to re-run — skips permissions already present.
 * @body  { batchSize?: number, sleepMs?: number }  (optional, defaults: 50 / 2000)
 * @access Authenticated admin
 */
router.post(
  '/',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchSize, sleepMs } = req.body as Partial<AppPermissionsBackfillConfig>;
      const config: Partial<AppPermissionsBackfillConfig> = {};
      if (typeof batchSize === 'number') config.batchSize = batchSize;
      if (typeof sleepMs === 'number') config.sleepMs = sleepMs;

      logger.info('[APP-PERMISSIONS-BACKFILL] Triggered via API', config);

      const result = await appPermissionsBackfillService.grantAllPermissionsToAllApps(config);

      res.status(200).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      } as ApiResponse);
    } catch (error) {
      logger.error('[APP-PERMISSIONS-BACKFILL] Failed:', error);
      res.status(500).json({
        success: false,
        error: 'App permissions backfill failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
    }
  },
);

export default router;
