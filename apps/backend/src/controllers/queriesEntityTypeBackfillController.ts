import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

type BackfillOptions = {
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
  clearEntityType: boolean;
};

type BackfillSummary = {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
};

export class QueriesEntityTypeBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildDefaultOptions(body: unknown): BackfillOptions {
    const payload = body as Partial<{
      batchSize: number;
      delayMs: number;
      dryRun: boolean;
      clearEntityType: boolean;
    }>;

    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 100;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 1000;
    const dryRun = payload.dryRun === true;
    const clearEntityType = payload.clearEntityType === true;

    return { batchSize, delayMs, dryRun, clearEntityType };
  }

  private static async backfillTargetEntity(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;

    do {
      const queries: Array<{ id: string; entityType: string | null; targetEntity: string | null }> =
        await db.query.findMany({
          where: {
            entityType: { not: null },
            targetEntity: null,
          },
          select: { id: true, entityType: true, targetEntity: true },
          orderBy: { id: 'asc' },
          take: options.batchSize,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });

      if (queries.length === 0) break;

      for (const query of queries) {
        summary.processed += 1;
        try {
          if (!query.entityType) {
            summary.skipped += 1;
            continue;
          }

          if (query.targetEntity === query.entityType) {
            summary.skipped += 1;
            continue;
          }

          if (!options.dryRun) {
            const updateData: { targetEntity: string; entityType?: null } = {
              targetEntity: query.entityType,
            };

            if (options.clearEntityType) {
              updateData.entityType = null;
            }

            await db.query.update({
              where: { id: query.id },
              data: updateData,
            });
          }
          summary.updated += 1;
        } catch (error) {
          summary.errors += 1;
          logger.warn('[QueriesEntityTypeBackfill] Failed to update query', {
            queryId: query.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = queries[queries.length - 1]?.id ?? null;
      if (options.delayMs > 0) {
        await this.sleep(options.delayMs);
      }
    } while (cursor);

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>) {
    try {
      const options = QueriesEntityTypeBackfillController.buildDefaultOptions(req.body);

      logger.info('[QueriesEntityTypeBackfill] Starting backfill', options);

      const summary = await QueriesEntityTypeBackfillController.backfillTargetEntity(options);

      logger.info('[QueriesEntityTypeBackfill] Backfill completed', summary);

      const response: ApiResponse = {
        success: true,
        message: 'Backfill completed',
        data: {
          options,
          summary,
        },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('[QueriesEntityTypeBackfill] Error during backfill:', error);
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run backfill',
        timestamp: new Date().toISOString(),
      };
      res.status(500).json(response);
    }
  }

  static async getBackfillStats(_req: Request, res: Response<ApiResponse>) {
    try {
      const totalWithEntityType = await db.query.count({
        where: { entityType: { not: null } },
      });

      const totalNeedingBackfill = await db.query.count({
        where: {
          entityType: { not: null },
          targetEntity: null,
        },
      });

      const totalBackfilled = await db.query.count({
        where: {
          entityType: { not: null },
          targetEntity: { not: null },
        },
      });

      const response: ApiResponse = {
        success: true,
        data: {
          stats: {
            totalWithEntityType,
            totalNeedingBackfill,
            totalBackfilled,
          },
        },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('[QueriesEntityTypeBackfill] Error getting stats:', error);
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get stats',
        timestamp: new Date().toISOString(),
      };
      res.status(500).json(response);
    }
  }
}
