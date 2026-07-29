import { Router, Request, Response } from 'express';
import {
  mettleUserSyncService,
  MettleEmployee,
} from '@/services/mettleUserSyncService';
import { verifyMettleUserSyncAuth } from '@/middleware/mettleUserSyncAuth';
import { logger } from '@/utils/logger';

const router = Router();

// POST /api/mettle/users/sync
// API key protected webhook endpoint for syncing user information from Mettle.
router.post('/users/sync', verifyMettleUserSyncAuth, async (req: Request, res: Response) => {
  const payload = req.body as Partial<MettleEmployee>;

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    res.status(400).json({
      success: false,
      error: 'Invalid payload. Expected a single employee object',
    });
    return;
  }

  try {
    const syncResult = await mettleUserSyncService.syncUsers(payload);

    res.status(200).json({
      success: true,
      data: syncResult,
    });
  } catch (error) {
    logger.error('[Mettle User Sync] Failed to process webhook', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    res.status(500).json({
      success: false,
      error: 'Failed to process user sync webhook',
    });
  }
});

export default router;
