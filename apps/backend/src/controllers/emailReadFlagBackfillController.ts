import { Request, Response } from 'express';
import { runEmailReadFlagBackfillAsSystem, type EmailReadFlagBackfillOptions } from '@/bypassAcl/emailReadFlagServices';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

export class EmailReadFlagBackfillController {
  private static buildOptions(body: unknown): EmailReadFlagBackfillOptions {
    const payload = (body ?? {}) as Partial<{ batchSize: number; delayMs: number; dryRun: boolean }>;
    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 50;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 1000;
    const dryRun = payload.dryRun === true;
    return { batchSize, delayMs, dryRun };
  }

  /**
   * route POST /migrate/api/admin/email-read-flag-backfill
   * desc One-time backfill of email_reads.hasNewEmail for rows still NULL (true where
   *       lastReadEmailAt < tickets.lastEmailAt, else false). Runs in the background.
   *       Body: { batchSize?: number, delayMs?: number, dryRun?: boolean }
   *       (defaults 50 rows per batch, 1000ms between batches)
   * access TICKET-MIGRATION Admin only
   */
  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<Response> {
    const options = EmailReadFlagBackfillController.buildOptions(req.body);

    res.status(202).json({
      success: true,
      message: options.dryRun
        ? 'Email read flag backfill dry run started in background'
        : 'Email read flag backfill started in background',
      data: options,
      timestamp: new Date().toISOString(),
    });

    void runEmailReadFlagBackfillAsSystem(options).catch((error) => {
      logger.error('[EmailReadFlagBackfill] Background run failed', error);
    });

    return res;
  }
}
