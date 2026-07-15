import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';
const SLEEP_BETWEEN_BATCHES_MS = 1000;

type BackfillSummary = {
  totalUpdated: number;
  batches: number;
  errors: number;
};

export class DeskMetricsBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildBatchSize(body: unknown): number {
    const payload = (body ?? {}) as Partial<{ batchSize: number }>;
    return payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 50;
  }

  private static async runBackfill(batchSize: number): Promise<void> {
    const summary: BackfillSummary = { totalUpdated: 0, batches: 0, errors: 0 };
    const startTime = Date.now();

    logger.info('[DeskMetricsBackfill] Starting channelId backfill', { batchSize });

    while (true) {
      try {
        // CTE scopes the batch to desk-channel tickets only so non-desk rows
        // (channelId stays NULL intentionally) never enter the loop.
        const updated = await db.$executeRaw`
          WITH batch AS (
            SELECT ta.id, t."channelId" AS channel_id
            FROM "public"."ticket_activities" ta
            JOIN "public"."tickets" t ON t.id = ta."ticketId"
            WHERE ta."channelId" IS NULL
              AND t."channelId" IN (
                SELECT "channelId" FROM "public"."email_channel_preferences"
              )
            LIMIT ${batchSize}
          )
          UPDATE "public"."ticket_activities" ta
          SET "channelId" = batch.channel_id
          FROM batch
          WHERE ta.id = batch.id
        `;

        summary.batches += 1;
        summary.totalUpdated += Number(updated);

        logger.info('[DeskMetricsBackfill] Batch complete', {
          batchNum: summary.batches,
          batchUpdated: Number(updated),
          totalUpdated: summary.totalUpdated,
        });

        if (Number(updated) === 0) break;

        await DeskMetricsBackfillController.sleep(SLEEP_BETWEEN_BATCHES_MS);
      } catch (error) {
        summary.errors += 1;
        logger.error('[DeskMetricsBackfill] Batch failed', {
          batchNum: summary.batches,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }

    logger.info('[DeskMetricsBackfill] Done', {
      ...summary,
      durationMs: Date.now() - startTime,
    });
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<Response> {
    const batchSize = DeskMetricsBackfillController.buildBatchSize(req.body);

    res.status(202).json({
      success: true,
      message: 'Desk metrics channelId backfill started in background',
      data: { batchSize },
      timestamp: new Date().toISOString(),
    });

    void (async (): Promise<void> => {
      try {
        await DeskMetricsBackfillController.runBackfill(batchSize);
      } catch (error) {
        logger.error('[DeskMetricsBackfill] Background run failed', error);
      }
    })();

    return res;
  }
}
