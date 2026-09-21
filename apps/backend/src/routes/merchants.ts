import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const ListMerchantsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

/**
 * Search merchants for the tickets Merchant ID filter.
 *
 * The table grows a row per distinct merchantId ever seen on a ticket and is never
 * pruned, so this is a bounded search (`q` + `limit`) rather than a full dump: the
 * client queries as the user types instead of holding the whole table.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const parsed = ListMerchantsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: parsed.error.errors,
      });
      return;
    }

    const { q, limit } = parsed.data;

    const merchants = await db.merchant.findMany({
      ...(q ? { where: { mid: { contains: q, mode: 'insensitive' as const } } } : {}),
      select: { mid: true },
      orderBy: { mid: 'asc' },
      take: limit,
    });

    res.status(200).json({
      success: true,
      merchants,
      // The client shows a "refine your search" hint rather than paginating.
      hasMore: merchants.length === limit,
    });
  } catch (error) {
    logger.error('[MerchantRoutes] Failed to list merchants:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
