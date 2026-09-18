import { Router, type Request, type Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

const router = Router();

/**
 * List every known merchant, for the tickets Merchant ID filter.
 *
 * The merchants table is small (one row per merchant id ever seen) and carries no
 * tenant column, so the whole list is returned in one call and the client filters
 * it locally as the user types.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const merchants = await db.merchant.findMany({
      select: { id: true, mid: true },
      orderBy: { mid: 'asc' },
    });

    res.status(200).json({ success: true, merchants });
  } catch (error) {
    logger.error('[MerchantRoutes] Failed to list merchants:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
