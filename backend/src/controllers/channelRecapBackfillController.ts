import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

type BackfillOptions = {
  batchSize: number;
  dryRun: boolean;
};

type BackfillSummary = {
  total: number;
  migrated: number;
  skipped: number;
  errors: number;
};

export class ChannelRecapBackfillController {
  private static buildOptions(body: unknown): BackfillOptions {
    const payload = body as Partial<{
      batchSize: number;
      dryRun: boolean;
    }>;

    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 500;
    const dryRun = payload.dryRun === true;

    return { batchSize, dryRun };
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>) {
    try {
      const options = ChannelRecapBackfillController.buildOptions(req.body);
      const startTime = Date.now();

      logger.info('[ChannelRecapBackfill] Starting backfill', options);

      const summary: BackfillSummary = { total: 0, migrated: 0, skipped: 0, errors: 0 };
      let skip = 0;

      while (true) {
        const batch = await db.channelDailyRecap.findMany({
          skip,
          take: options.batchSize,
          orderBy: { id: 'asc' },
        });

        if (batch.length === 0) break;

        summary.total += batch.length;

        for (const record of batch) {
          try {
            // Check if already migrated (same channelId + recapDate + userId)
            const existing = await db.channelRecap.findFirst({
              where: {
                channelId: record.channelId,
                recapDate: record.recapDate,
                userId: record.userId,
              },
            });

            if (existing) {
              summary.skipped++;
              continue;
            }

            if (!options.dryRun) {
              await db.channelRecap.create({
                data: {
                  channelId: record.channelId,
                  recapDate: record.recapDate,
                  summary: record.summary,
                  userId: record.userId,
                },
              });
            }

            summary.migrated++;
          } catch (error) {
            summary.errors++;
            logger.error(`[ChannelRecapBackfill] Error migrating record ${record.id}:`, error);
          }
        }

        skip += batch.length;
        logger.info(`[ChannelRecapBackfill] Processed ${skip} records so far...`);
      }

      const durationMs = Date.now() - startTime;

      logger.info('[ChannelRecapBackfill] Backfill completed', { ...summary, durationMs });

      const response: ApiResponse = {
        success: true,
        message: options.dryRun ? 'Dry run completed' : 'Backfill completed',
        data: {
          options,
          summary,
          durationMs,
        },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('[ChannelRecapBackfill] Error during backfill:', error);
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run backfill',
        timestamp: new Date().toISOString(),
      };
      res.status(500).json(response);
    }
  }
}
