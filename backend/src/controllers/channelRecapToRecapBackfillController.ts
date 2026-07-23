import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';
import { RecapEntityType } from '@prisma/client';

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

export class ChannelRecapToRecapBackfillController {
  private static buildOptions(body: unknown): BackfillOptions {
    const payload = body as Partial<{
      batchSize: number;
      dryRun: boolean;
    }>;

    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 100;
    const dryRun = payload.dryRun === true;

    return { batchSize, dryRun };
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>) {
    try {
      const options = ChannelRecapToRecapBackfillController.buildOptions(req.body);
      const startTime = Date.now();

      logger.info('[ChannelRecapToRecapBackfill] Starting backfill from channel_recaps to recaps', options);

      const summary: BackfillSummary = { total: 0, migrated: 0, skipped: 0, errors: 0 };
      let skip = 0;

      while (true) {
        const batch = await db.channelRecap.findMany({
          skip,
          take: options.batchSize,
          orderBy: { id: 'asc' },
        });

        if (batch.length === 0) break;

        summary.total += batch.length;

        for (const record of batch) {
          try {
            // Check if already migrated (same entityType + entityId + recapDate + userId)
            const existing = await db.recap.findFirst({
              where: {
                entityType: RecapEntityType.CHANNEL,
                entityId: record.channelId,
                recapDate: record.recapDate,
                userId: record.userId,
              },
            });

            if (existing) {
              summary.skipped++;
              continue;
            }

            if (!options.dryRun) {
              await db.recap.create({
                data: {
                  entityType: RecapEntityType.CHANNEL,
                  entityId: record.channelId,
                  workspaceId: record.workspaceId,
                  recapDate: record.recapDate,
                  summary: record.summary,
                  userId: record.userId,
                },
              });
            }

            summary.migrated++;
          } catch (error) {
            summary.errors++;
            logger.error(`[ChannelRecapToRecapBackfill] Error migrating record ${record.id}:`, error);
          }
        }

        skip += batch.length;
        logger.info(`[ChannelRecapToRecapBackfill] Processed ${skip} records so far...`);
      }

      const durationMs = Date.now() - startTime;

      logger.info('[ChannelRecapToRecapBackfill] Backfill completed', { ...summary, durationMs });

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
      logger.error('[ChannelRecapToRecapBackfill] Error during backfill:', error);
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run backfill',
        timestamp: new Date().toISOString(),
      };
      res.status(500).json(response);
    }
  }
}