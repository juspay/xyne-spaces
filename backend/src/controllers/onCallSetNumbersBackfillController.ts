import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

type BackfillOptions = {
  batchSize: number;
  dryRun: boolean;
};

type BackfillSummary = {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
};

export class OnCallSetNumbersBackfillController {
  private static buildDefaultOptions(body: unknown): BackfillOptions {
    const payload = body as Partial<{
      batchSize: number;
      dryRun: boolean;
    }>;

    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 500;
    const dryRun = payload.dryRun === true;

    return { batchSize, dryRun };
  }

  private static async backfillOnCallSetNumbers(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;

    let hasMore = true;

    while (hasMore) {
      const mappings: Array<{
        id: string;
        userId: string;
        userGroupId: string;
        onCallSetNumber: number | null;
        onCallSetNumbers: number[] | null;
      }> = await db.userGroupMapping.findMany({
        where: {
          OR: [
            { onCallSetNumbers: { isEmpty: true } },
            { onCallSetNumbers: { equals: [] } },
          ],
        },
        select: {
          id: true,
          userId: true,
          userGroupId: true,
          onCallSetNumber: true,
          onCallSetNumbers: true,
        },
        orderBy: { id: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      hasMore = mappings.length > 0;

      for (const mapping of mappings) {
        summary.processed += 1;
        try {
          let newSetNumbers: number[];

          if (mapping.onCallSetNumber !== null) {
            newSetNumbers = [mapping.onCallSetNumber];
          } else {
            newSetNumbers = [];
          }

          if (mapping.onCallSetNumbers !== null && mapping.onCallSetNumbers.length > 0) {
            summary.skipped += 1;
            continue;
          }

          if (!options.dryRun) {
            await db.userGroupMapping.update({
              where: { id: mapping.id },
              data: { onCallSetNumbers: newSetNumbers },
            });
          }
          summary.updated += 1;
          
          logger.info(`[OnCallSetNumbersBackfill] Updated mapping ${mapping.id}: user=${mapping.userId}, group=${mapping.userGroupId}, old=${mapping.onCallSetNumber}, new=[${newSetNumbers.join(',')}]`);
        } catch (error) {
          summary.errors += 1;
          logger.warn('[OnCallSetNumbersBackfill] Failed to update mapping', {
            mappingId: mapping.id,
            userId: mapping.userId,
            userGroupId: mapping.userGroupId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = mappings[mappings.length - 1]?.id ?? null;
      logger.info(`[OnCallSetNumbersBackfill] Processed batch: ${summary.processed} total, ${summary.updated} updated, ${summary.skipped} skipped, ${summary.errors} errors`);

      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>) {
    try {
      const options = OnCallSetNumbersBackfillController.buildDefaultOptions(req.body);
      logger.info('[OnCallSetNumbersBackfill] Starting backfill', options);

      const results = await OnCallSetNumbersBackfillController.backfillOnCallSetNumbers(options);

      const response: ApiResponse = {
        success: true,
        message: 'On-call set numbers backfill completed',
        data: { options, results },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('[OnCallSetNumbersBackfill] Error during backfill:', error);
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run on-call set numbers backfill',
        timestamp: new Date().toISOString(),
      };

      res.status(500).json(response);
    }
  }
}
