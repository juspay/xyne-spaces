import { Router, Request, Response } from 'express';
import { authorize } from '@/middleware/authorize';
import { AccessType } from '@prisma/client';
import {
  userPresenceBackfillService,
  type PresenceBackfillConfig,
} from '@/services/userPresenceBackfillService';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

const router = Router();

/**
 * @route   POST /migrate/api/users-data-migration/backfill-presence-status
 * @desc    One-time migration: copies statusEmoji, statusContent, statusExpiryAt,
 *          lastActiveAt from user_presence into the users table in batches.
 *          Runs synchronously and returns the full result when complete.
 *          Accepts optional body: { batchSize?: number, sleepMs?: number }.
 *          Safe to re-run — idempotent per user row.
 * @access  UserMigration Admin
 */
router.post(
  '/backfill-presence-status',
  authorize('User_Migration', AccessType.ADMIN),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchSize, sleepMs } = req.body as Partial<PresenceBackfillConfig>;
      const config: Partial<PresenceBackfillConfig> = {};
      if (typeof batchSize === 'number') config.batchSize = batchSize;
      if (typeof sleepMs === 'number') config.sleepMs = sleepMs;

      logger.info('[USER-MIGRATION] Presence status backfill starting', config);

      const result = await userPresenceBackfillService.backfillPresenceToUsers(config);

      const response: ApiResponse = {
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('[USER-MIGRATION] Presence status backfill failed', error);

      const response: ApiResponse = {
        success: false,
        error: 'Presence status backfill failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };

      res.status(500).json(response);
    }
  },
);

export default router;
