import { Request, Response } from 'express';
import { ApiResponse } from '@/types/express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { extractEmailAddress } from '@/utils/email';

const TAG = '[ExternalSourceDisplayNameBackfill]';

/**
 * Cleans up legacy `external_sources.displayName` rows that were stored as
 * "Microsoft (foo@bar.com)" instead of the bare "foo@bar.com". The wrapped
 * form survives in places that read displayName directly (older code paths,
 * the OAuth `login_hint` for reconnect — which Microsoft rejects when given
 * a non-email value, breaking the reconnect flow).
 *
 * Idempotent: re-running on already-cleaned rows finds none and is a no-op.
 * Iteration is bounded so a runaway DB shape can't loop forever.
 */
export class ExternalSourceDisplayNameBackfillController {
  private static readonly BATCH_SIZE = 200;
  private static readonly BATCH_DELAY_MS = 100;
  private static readonly MAX_BATCHES = 100;

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public static async backfillDisplayNames(): Promise<{
    totalUpdated: number;
    totalSkipped: number;
    sampleIds: string[];
  }> {
    const startedAt = Date.now();
    logger.info(`${TAG} Starting external_sources.displayName cleanup`, {
      batchSize: this.BATCH_SIZE,
      maxBatches: this.MAX_BATCHES,
      batchDelayMs: this.BATCH_DELAY_MS,
    });

    let totalUpdated = 0;
    let totalSkipped = 0;
    const sampleIds: string[] = [];

    for (let iter = 0; iter < this.MAX_BATCHES; iter++) {
      const batchStart = Date.now();
      const rows = await db.externalSource.findMany({
        where: {
          AND: [
            { displayName: { contains: '(' } },
            { displayName: { contains: '@' } },
            { displayName: { contains: ')' } },
          ],
        },
        select: { id: true, displayName: true, sourceType: true },
        take: this.BATCH_SIZE,
      });

      if (rows.length === 0) {
        logger.info(`${TAG} No more candidate rows — finished after ${iter} batches`);
        break;
      }

      logger.info(`${TAG} Batch ${iter + 1}: fetched ${rows.length} candidate rows`);

      type Update = { id: string; before: string; after: string; sourceType: string };
      const updates: Update[] = [];
      const batchSkipReasons: Record<string, number> = {};
      for (const row of rows) {
        const cleaned = extractEmailAddress(row.displayName);
        if (!cleaned) {
          totalSkipped++;
          batchSkipReasons['no-email-extractable'] =
            (batchSkipReasons['no-email-extractable'] ?? 0) + 1;
          logger.warn(`${TAG} Skip (no email extractable)`, {
            id: row.id,
            displayName: row.displayName,
            sourceType: row.sourceType,
          });
          continue;
        }
        if (cleaned === row.displayName) {
          totalSkipped++;
          batchSkipReasons['already-clean'] = (batchSkipReasons['already-clean'] ?? 0) + 1;
          continue;
        }
        updates.push({
          id: row.id,
          before: row.displayName,
          after: cleaned,
          sourceType: row.sourceType,
        });
      }

      if (updates.length === 0) {
        logger.info(`${TAG} Batch ${iter + 1}: nothing to update`, {
          skippedThisBatch: rows.length,
          skipReasons: batchSkipReasons,
        });
        break;
      }

      for (const u of updates) {
        logger.info(`${TAG} Will rewrite displayName`, {
          id: u.id,
          sourceType: u.sourceType,
          before: u.before,
          after: u.after,
        });
      }

      await db.$transaction(
        updates.map(u =>
          db.externalSource.update({
            where: { id: u.id },
            data: { displayName: u.after },
          }),
        ),
      );

      totalUpdated += updates.length;
      if (sampleIds.length < 10) {
        sampleIds.push(...updates.slice(0, 10 - sampleIds.length).map(u => u.id));
      }

      logger.info(`${TAG} Batch ${iter + 1} done`, {
        updatedThisBatch: updates.length,
        skippedThisBatch: rows.length - updates.length,
        skipReasons: batchSkipReasons,
        elapsedMs: Date.now() - batchStart,
        runningTotalUpdated: totalUpdated,
        runningTotalSkipped: totalSkipped,
      });

      await this.sleep(this.BATCH_DELAY_MS);
    }

    logger.info(`${TAG} Cleanup complete`, {
      totalUpdated,
      totalSkipped,
      sampleIds,
      elapsedMs: Date.now() - startedAt,
    });
    return { totalUpdated, totalSkipped, sampleIds };
  }

  /**
   * @route POST /api/admin/external-source-displayname-backfill
   * @desc  Cleans up "Microsoft (email)" → "email" in external_sources.displayName
   * @access Authenticated users
   */
  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<void> {
    const triggeredBy = req.user?.id ?? 'unknown';
    try {
      logger.info(`${TAG} Backfill triggered`, { triggeredBy });
      const result =
        await ExternalSourceDisplayNameBackfillController.backfillDisplayNames();

      const response: ApiResponse = {
        success: true,
        message: `Backfill complete. Cleaned ${result.totalUpdated} rows, skipped ${result.totalSkipped}.`,
        data: {
          totalUpdated: result.totalUpdated,
          totalSkipped: result.totalSkipped,
          sampleIds: result.sampleIds,
        },
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      logger.error(`${TAG} Error during backfill`, {
        triggeredBy,
        error: error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to trigger backfill',
        timestamp: new Date().toISOString(),
      };
      res.status(500).json(response);
    }
  }
}
