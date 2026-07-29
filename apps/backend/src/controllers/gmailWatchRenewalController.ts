import { Request, Response } from 'express';
import { watchRenewalQueue } from '@/pubsub';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

export class GmailWatchRenewalController {
  /**
   * @route POST /api/admin/gmail-watch-renewal
   * @desc Manually trigger a Gmail watch renewal run outside of its cron schedule.
   */
  static async trigger(_req: Request, res: Response<ApiResponse>): Promise<Response> {
    try {
      await watchRenewalQueue.triggerRenewalNow('gmail');
      return res.status(202).json({
        success: true,
        message: 'Gmail watch renewal triggered',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[GmailWatchRenewalController] Failed to trigger renewal', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to trigger Gmail watch renewal',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
