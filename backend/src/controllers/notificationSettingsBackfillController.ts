import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

type BackfillOptions = {
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
};

type BackfillSummary = {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
};

type ChannelUserStatusRow = {
  id: string;
  desktopNotificationLevel: string | null;
  mobileNotificationLevel: string | null;
};

/**
 * Backfill controller for XYNE-13792 notification settings migration.
 *
 * Converts legacy 'ALL' notification levels to NULL so channels inherit the global defaults.
 */
export class NotificationSettingsBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = body as Partial<{
      batchSize: number;
      delayMs: number;
      dryRun: boolean;
    }>;

    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 50;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 1000;
    const dryRun = payload.dryRun === true;

    return { batchSize, delayMs, dryRun };
  }

  private static async runBackfill(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;

    while (true) {
      const rows: ChannelUserStatusRow[] = await db.channelUserStatus.findMany({
        where: {
          isDeleted: false,
          OR: [
            { desktopNotificationLevel: { in: ['ALL', 'THREADS_ONLY'] } },
            { mobileNotificationLevel: { in: ['ALL', 'THREADS_ONLY'] } },
          ],
        },
        select: {
          id: true,
          desktopNotificationLevel: true,
          mobileNotificationLevel: true,
        },
        orderBy: { id: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (rows.length === 0) break;

      for (const row of rows) {
        summary.processed += 1;

        const hasTargetDesktop = row.desktopNotificationLevel === 'ALL' || row.desktopNotificationLevel === 'THREADS_ONLY';
        const hasTargetMobile = row.mobileNotificationLevel === 'ALL' || row.mobileNotificationLevel === 'THREADS_ONLY';

        if (!hasTargetDesktop && !hasTargetMobile) {
          summary.skipped += 1;
          continue;
        }

        try {
          if (!options.dryRun) {
            await db.channelUserStatus.update({
              where: { id: row.id },
              data: {
                ...(hasTargetDesktop && { desktopNotificationLevel: null }),
                ...(hasTargetMobile && { mobileNotificationLevel: null }),
              },
            });
          }

          summary.updated += 1;
        } catch (error) {
          summary.errors += 1;
          logger.warn('[NotificationSettingsBackfill] Failed to update row', {
            rowId: row.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = rows[rows.length - 1]?.id ?? null;
      logger.info(
        `[NotificationSettingsBackfill] Batch complete — processed: ${summary.processed}, updated: ${summary.updated}, errors: ${summary.errors}`
      );

      if (options.delayMs > 0) {
        await this.sleep(options.delayMs);
      }
    }

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>) {
    try {
      const options = NotificationSettingsBackfillController.buildOptions(req.body);
      logger.info('[NotificationSettingsBackfill] Starting backfill', options);

      const results = await NotificationSettingsBackfillController.runBackfill(options);

      const response: ApiResponse = {
        success: true,
        message: `Notification settings backfill completed${options.dryRun ? ' (dry run)' : ''}`,
        data: { options, results },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('[NotificationSettingsBackfill] Fatal error during backfill:', error);
      const response: ApiResponse = {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to run notification settings backfill',
        timestamp: new Date().toISOString(),
      };

      res.status(500).json(response);
    }
  }
}
