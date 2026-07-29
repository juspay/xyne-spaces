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

export class SetUpdatedAtTimeController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildDefaultOptions(body: unknown): BackfillOptions {
    const payload = body as Partial<{
      batchSize: number;
      delayMs: number;
      dryRun: boolean;
    }>;

    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 1000;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 0;
    const dryRun = payload.dryRun === true;

    return { batchSize, delayMs, dryRun };
  }

  private static async backfillUpdatedAt(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;

    do {
      const activities: Array<{ id: string; createdAt: Date; updatedAt: Date }> =
        await db.activity.findMany({
          select: { id: true, createdAt: true, updatedAt: true },
          orderBy: { id: 'asc' },
          take: options.batchSize,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });

      if (activities.length === 0) break;

      const idsToUpdate: string[] = [];

      for (const activity of activities) {
        summary.processed += 1;
        if (activity.updatedAt.getTime() === activity.createdAt.getTime()) {
          summary.skipped += 1;
          continue;
        }
        idsToUpdate.push(activity.id);
      }

      if (idsToUpdate.length > 0) {
        if (!options.dryRun) {
          try {
            const updatedCount = await db.$executeRaw`
              UPDATE "activities"
              SET "updatedAt" = "createdAt"
              WHERE "id" = ANY(${idsToUpdate})
                AND "updatedAt" <> "createdAt"
            `;
            summary.updated += Number(updatedCount);
          } catch (error) {
            summary.errors += idsToUpdate.length;
            logger.warn('[SetUpdatedAtTime] Failed updatedAt backfill batch', {
              batchSize: idsToUpdate.length,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        } else {
          summary.updated += idsToUpdate.length;
        }
      }

      cursor = activities[activities.length - 1]?.id ?? null;
      if (options.delayMs > 0) {
        await this.sleep(options.delayMs);
      }
    } while (cursor);

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>) {
    try {
      const options = SetUpdatedAtTimeController.buildDefaultOptions(req.body);
      const results = await SetUpdatedAtTimeController.backfillUpdatedAt(options);

      const response: ApiResponse = {
        success: true,
        message: 'Backfill completed',
        data: {
          options,
          results,
        },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('[SetUpdatedAtTime] Error during backfill:', error);
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run backfill',
        timestamp: new Date().toISOString(),
      };
      res.status(500).json(response);
    }
  }
}
