import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';
import { AUTOMATION_WORKFLOW_TYPE } from '@/automations/types/workflow-adapter';

type BackfillOptions = {
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
};

type BackfillSummary = {
  scanned: number;
  pending: number;
  updated: number;
  unchanged: number;
  errors: number;
};

export class AutomationSeriesIdBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = body as Partial<{ batchSize: number; delayMs: number; dryRun: boolean }>;
    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 25;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 1000;
    const dryRun = payload.dryRun === true;
    return { batchSize, delayMs, dryRun };
  }

  // Walk the automationSeriesId chain to the self-referential lineage root, so a
  // deep chain (c → b → a) collapses to one shared root (a) for the whole series.
  private static rootOf(
    startId: string,
    byId: Map<string, { id: string; automationSeriesId: string | null }>,
  ): string {
    let current = startId;
    const seen = new Set<string>();
    while (!seen.has(current)) {
      seen.add(current);
      const parent = byId.get(current)?.automationSeriesId;
      if (!parent || parent === current || !byId.has(parent)) return current;
      current = parent;
    }
    return current;
  }

  private static async backfillSeriesId(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = {
      scanned: 0,
      pending: 0,
      updated: 0,
      unchanged: 0,
      errors: 0,
    };

    const rows = await db.workflow.findMany({
      where: { workflowType: AUTOMATION_WORKFLOW_TYPE },
      select: { id: true, automationSeriesId: true },
    });
    const byId = new Map(rows.map(r => [r.id, r]));
    summary.scanned = rows.length;

    const pending: Array<{ id: string; root: string }> = [];
    for (const row of rows) {
      const root = AutomationSeriesIdBackfillController.rootOf(row.id, byId);
      if (row.automationSeriesId === root) {
        summary.unchanged += 1;
      } else {
        pending.push({ id: row.id, root });
      }
    }
    summary.pending = pending.length;

    logger.info('[AutomationSeriesIdBackfill] Computed lineage roots', {
      scanned: summary.scanned,
      pending: summary.pending,
      unchanged: summary.unchanged,
      dryRun: options.dryRun,
    });

    let batchNumber = 0;
    for (let i = 0; i < pending.length; i += options.batchSize) {
      batchNumber += 1;
      const batch = pending.slice(i, i + options.batchSize);

      try {
        if (!options.dryRun) {
          await db.$transaction(
            batch.map(p =>
              db.workflow.update({
                where: { id: p.id },
                data: { automationSeriesId: p.root },
              }),
            ),
          );
        }
        summary.updated += batch.length;
      } catch (error) {
        summary.errors += batch.length;
        logger.warn('[AutomationSeriesIdBackfill] Batch failed', {
          batchNumber,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      logger.info(`[AutomationSeriesIdBackfill] Batch #${batchNumber} completed`, {
        batchSize: batch.length,
        updated: summary.updated,
        errors: summary.errors,
        dryRun: options.dryRun,
      });

      if (options.delayMs > 0 && i + options.batchSize < pending.length) {
        await AutomationSeriesIdBackfillController.sleep(options.delayMs);
      }
    }

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<void> {
    try {
      const options = AutomationSeriesIdBackfillController.buildOptions(req.body);
      logger.info('[AutomationSeriesIdBackfill] Starting backfill', options);

      const results = await AutomationSeriesIdBackfillController.backfillSeriesId(options);

      const response: ApiResponse = {
        success: true,
        message: options.dryRun ? 'Dry run completed' : 'Backfill completed',
        data: { options, results },
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      logger.error('[AutomationSeriesIdBackfill] Error during backfill:', error);
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run automation series id backfill',
        timestamp: new Date().toISOString(),
      };
      res.status(500).json(response);
    }
  }
}
