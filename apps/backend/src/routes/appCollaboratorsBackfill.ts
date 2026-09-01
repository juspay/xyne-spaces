import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '@/middleware/auth';
import {
  appCollaboratorsBackfillService,
  type AppCollaboratorsBackfillConfig,
} from '@/services/appCollaboratorsBackfillService';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

const router = Router();

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  authMiddleware.authenticate(req, res, next);
};

/**
 * @route POST /api/admin/app-collaborators-backfill
 * @desc  Seed every app's creator (apps.createdBy) as an ADMIN row in app_collaborators.
 *        Processes apps in cursor-based batches with a sleep between each batch.
 *        Safe to re-run — skips apps whose creator is already a collaborator.
 * @body  { batchSize?: number, sleepMs?: number }  (optional, defaults: 50 / 2000)
 * @access Authenticated admin
 */
router.post(
  '/',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchSize, sleepMs } = req.body as Partial<AppCollaboratorsBackfillConfig>;
      const config: Partial<AppCollaboratorsBackfillConfig> = {};
      if (typeof batchSize === 'number') config.batchSize = batchSize;
      if (typeof sleepMs === 'number') config.sleepMs = sleepMs;

      logger.info('[APP-COLLABORATORS-BACKFILL] Triggered via API', config);

      const result = await appCollaboratorsBackfillService.seedCreatorsAsAdmins(config);

      res.status(200).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      } as ApiResponse);
    } catch (error) {
      logger.error('[APP-COLLABORATORS-BACKFILL] Failed:', error);
      res.status(500).json({
        success: false,
        error: 'App collaborators backfill failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
    }
  },
);

export default router;
