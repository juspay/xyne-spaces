import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';
import { getAutomationsBotUserId } from '@/automations/steps/automations-bot';

const TAG = '[TicketActivitySystemActorBackfill]';
const LEGACY_ACTOR = 'system';
const SLEEP_BETWEEN_BATCHES_MS = 1000;

type BackfillSummary = {
  totalUpdated: number;
  batches: number;
  errors: number;
};

/**
 * Backfills the legacy literal 'system' actor written by pre-fix auto-assignment
 * code into a real per-workspace bot User id, so `updatedByUser` resolves instead
 * of silently returning null (see backend/src/workers/emailClassificationWorker.ts).
 */
export class TicketActivitySystemActorBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildBatchSize(body: unknown): number {
    const payload = (body ?? {}) as Partial<{ batchSize: number }>;
    return payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 50;
  }

  private static async updateWorkspaceInBatches(
    workspaceId: string,
    botUserId: string,
    batchSize: number,
    summary: BackfillSummary,
  ): Promise<void> {
    for (;;) {
      try {
        const batch = await db.ticketActivity.findMany({
          where: { workspaceId, updatedBy: LEGACY_ACTOR },
          select: { id: true },
          take: batchSize,
        });
        if (batch.length === 0) break;

        const result = await db.ticketActivity.updateMany({
          where: { id: { in: batch.map(r => r.id) } },
          data: { updatedBy: botUserId },
        });

        summary.batches += 1;
        summary.totalUpdated += result.count;

        logger.info(`${TAG} Workspace ${workspaceId}: batch complete`, {
          batchNum: summary.batches,
          batchUpdated: result.count,
          totalUpdated: summary.totalUpdated,
        });

        if (batch.length < batchSize) break;
        await TicketActivitySystemActorBackfillController.sleep(SLEEP_BETWEEN_BATCHES_MS);
      } catch (error) {
        summary.errors += 1;
        logger.error(`${TAG} Workspace ${workspaceId}: batch failed`, {
          batchNum: summary.batches,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }
  }

  private static async runBackfill(batchSize: number): Promise<BackfillSummary> {
    const summary: BackfillSummary = { totalUpdated: 0, batches: 0, errors: 0 };
    const startTime = Date.now();

    logger.info(`${TAG} Starting backfill`, { batchSize });

    const affected = await db.ticketActivity.groupBy({
      by: ['workspaceId'],
      where: { updatedBy: LEGACY_ACTOR },
      _count: { _all: true },
    });

    for (const row of affected) {
      if (!row.workspaceId) {
        // Denormalized column is nullable — rows stamped before workspaceId was
        // backfilled can't be resolved to a workspace-scoped bot; skip rather than guess.
        logger.warn(`${TAG} Skipping ${row._count._all} row(s) with no workspaceId`);
        continue;
      }

      const botUserId = await getAutomationsBotUserId(row.workspaceId);
      logger.info(`${TAG} Workspace ${row.workspaceId}: ${row._count._all} row(s) → botUserId=${botUserId}`);

      await TicketActivitySystemActorBackfillController.updateWorkspaceInBatches(
        row.workspaceId,
        botUserId,
        batchSize,
        summary,
      );
    }

    logger.info(`${TAG} Done`, { ...summary, durationMs: Date.now() - startTime });
    return summary;
  }

  /**
   * @route POST /api/admin/ticket-activity-system-actor-backfill
   * @desc Backfill ticket_activities.updatedBy from the legacy 'system' literal
   *       to the real automations bot User id, per workspace.
   * @access Authenticated users
   */
  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<Response> {
    const batchSize = TicketActivitySystemActorBackfillController.buildBatchSize(req.body);

    res.status(202).json({
      success: true,
      message: 'Ticket activity system actor backfill started in background',
      data: { batchSize },
      timestamp: new Date().toISOString(),
    });

    void (async (): Promise<void> => {
      try {
        await TicketActivitySystemActorBackfillController.runBackfill(batchSize);
      } catch (error) {
        logger.error(`${TAG} Background run failed`, error);
      }
    })();

    return res;
  }
}
