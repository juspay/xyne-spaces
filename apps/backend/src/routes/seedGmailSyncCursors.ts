import { Router, Request, Response } from 'express';
import { AccessType } from '@xyne/shared';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { BACKFILL_ADMIN_RESOURCE } from '@/middleware/backfillAdminAuth';
import { GoogleService } from '@/services/googleService';
import { logger } from '@/utils/logger';

const TAG = '[SeedGmailSyncCursors]';
const router = Router();

const seedCursorsAdminAuth = authorize(BACKFILL_ADMIN_RESOURCE, AccessType.ADMIN);

/**
 * @route POST /migrate/api/admin/seed-gmail-sync-cursors
 * @desc  Give every active Gmail source a starting lastSyncCursor from users.getProfile.
 *        Run before the cursor-resuming ingestion path ships: without a cursor a source
 *        falls back to the push's own historyId, which history.list reads past, so the
 *        first push skips the mail that triggered it.
 *        `?dryRun=true` previews. `?overwrite=true` replaces existing cursors — safe only
 *        while nothing reads the column.
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  seedCursorsAdminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
      const overwrite = req.query.overwrite === 'true' || req.body?.overwrite === true;

      const report = await GoogleService.seedSyncCursors({ dryRun, overwrite });

      logger.info(`${TAG} finished`, {
        dryRun: report.dryRun,
        overwrite: report.overwrite,
        seededCount: report.seeded.length,
        skippedCount: report.skipped.length,
        requestedBy: req.user?.id,
      });
      res.json({ success: true, ...report });
    } catch (error: any) {
      logger.error(`${TAG} failed`, error);
      res.status(500).json({ success: false, error: error?.message ?? 'Unknown error' });
    }
  },
);

export default router;
