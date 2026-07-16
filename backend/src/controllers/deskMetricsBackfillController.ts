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

  private static buildDaysBack(query: unknown): number {
    const q = (query ?? {}) as Partial<{ daysBack: string }>;
    const parsed = parseInt(q.daysBack ?? '', 10);
    return parsed > 0 ? Math.min(parsed, 90) : 7;
  }

  private static async runChannelIdBackfill(batchSize: number): Promise<BackfillSummary> {
    const summary: BackfillSummary = { totalUpdated: 0, batches: 0, errors: 0 };

    logger.info('[DeskMetricsBackfill] Starting channelId backfill', { batchSize });

    while (true) {
      try {
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

        logger.info('[DeskMetricsBackfill] channelId batch complete', {
          batchNum: summary.batches,
          batchUpdated: Number(updated),
          totalUpdated: summary.totalUpdated,
        });

        if (Number(updated) === 0) break;

        await DeskMetricsBackfillController.sleep(SLEEP_BETWEEN_BATCHES_MS);
      } catch (error) {
        summary.errors += 1;
        logger.error('[DeskMetricsBackfill] channelId batch failed', {
          batchNum: summary.batches,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }

    return summary;
  }

  private static async runTicketCreatedActivityBackfill(batchSize: number, daysBack: number): Promise<BackfillSummary> {
    const summary: BackfillSummary = { totalUpdated: 0, batches: 0, errors: 0 };

    logger.info('[DeskMetricsBackfill] Starting TICKET_CREATED activity backfill', { batchSize, daysBack });

    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    while (true) {
      try {
        const inserted = await db.$executeRaw`
          WITH batch AS (
            SELECT t.id, t."createdBy", t."createdAt", t."channelId", t."priority", t."stageName", t."statusV2"
            FROM "public"."tickets" t
            WHERE t."channelId" IN (
                SELECT "channelId" FROM "public"."email_channel_preferences"
              )
              AND t."createdAt" >= ${cutoff}
              AND NOT EXISTS (
                SELECT 1 FROM "public"."ticket_activities" ta
                WHERE ta."ticketId" = t.id AND ta."activityType" = 'TICKET_CREATED'
              )
            LIMIT ${batchSize}
          )
          INSERT INTO "public"."ticket_activities" (id, "ticketId", "updatedBy", timestamp, "activityType", "channelId", value)
          SELECT
            gen_random_uuid()::text,
            b.id,
            b."createdBy",
            b."createdAt",
            'TICKET_CREATED',
            b."channelId",
            jsonb_build_object('field', 'ticketCreated', 'priority', b."priority"::text, 'stageName', b."stageName", 'statusV2', b."statusV2"::text)
          FROM batch b
        `;

        summary.batches += 1;
        summary.totalUpdated += Number(inserted);

        logger.info('[DeskMetricsBackfill] TICKET_CREATED batch complete', {
          batchNum: summary.batches,
          batchInserted: Number(inserted),
          totalInserted: summary.totalUpdated,
        });

        if (Number(inserted) === 0) break;

        await DeskMetricsBackfillController.sleep(SLEEP_BETWEEN_BATCHES_MS);
      } catch (error) {
        summary.errors += 1;
        logger.error('[DeskMetricsBackfill] TICKET_CREATED batch failed', {
          batchNum: summary.batches,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }

    return summary;
  }

  private static async runBackfill(batchSize: number, daysBack: number): Promise<void> {
    const startTime = Date.now();

    const channelIdSummary = await DeskMetricsBackfillController.runChannelIdBackfill(batchSize);
    const ticketCreatedSummary = await DeskMetricsBackfillController.runTicketCreatedActivityBackfill(batchSize, daysBack);

    logger.info('[DeskMetricsBackfill] Done', {
      channelIdBackfill: channelIdSummary,
      ticketCreatedBackfill: ticketCreatedSummary,
      durationMs: Date.now() - startTime,
    });
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<Response> {
    const batchSize = DeskMetricsBackfillController.buildBatchSize(req.body);
    const daysBack = DeskMetricsBackfillController.buildDaysBack(req.query);

    res.status(202).json({
      success: true,
      message: 'Desk metrics backfill started in background (channelId + TICKET_CREATED activities)',
      data: { batchSize, daysBack },
      timestamp: new Date().toISOString(),
    });

    void (async (): Promise<void> => {
      try {
        await DeskMetricsBackfillController.runBackfill(batchSize, daysBack);
      } catch (error) {
        logger.error('[DeskMetricsBackfill] Background run failed', error);
      }
    })();

    return res;
  }
}
