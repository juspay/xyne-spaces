import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

const TAG = '[DashboardWorkspaceIdBackfill]';

type BackfillOptions = {
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
};

type BackfillSummary = {
  processed: number;
  updated: number;
  renamed: number;
  skipped: number;
  errors: number;
};

export class DashboardWorkspaceIdBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = (body ?? {}) as Partial<{
      batchSize: number;
      delayMs: number;
      dryRun: boolean;
    }>;
    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 100;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 1000;
    const dryRun = payload.dryRun === true;
    return { batchSize, delayMs, dryRun };
  }

  private static async resolveClashName(
    dashboardId: string,
    originalName: string,
    targetWorkspaceId: string,
    creatorEmail: string,
  ): Promise<string> {
    const primary = `${originalName} (${creatorEmail})`;
    const primaryClash = await db.dashboard.findFirst({
      where: {
        workspaceId: targetWorkspaceId,
        name: primary,
        NOT: { id: dashboardId },
      },
      select: { id: true },
    });
    if (!primaryClash) return primary;

    // Same creator already has a rename collision — fall back to the dashboard
    // id suffix, which is guaranteed unique because id is the primary key.
    const idSuffix = dashboardId.slice(-8);
    return `${originalName} (${creatorEmail}) [${idSuffix}]`;
  }

  private static async runBackfill(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = { processed: 0, updated: 0, renamed: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;
    let batchNumber = 0;

    do {
      batchNumber += 1;
      const dashboards: Array<{
        id: string;
        createdBy: string;
        name: string;
      }> = await db.dashboard.findMany({
        where: { workspaceId: '' },
        select: { id: true, createdBy: true, name: true },
        orderBy: { id: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (dashboards.length === 0) break;

      const creatorIds = [...new Set(dashboards.map(d => d.createdBy))];
      const creators = await db.user.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, workspaceId: true, email: true },
      });
      const creatorById = new Map(creators.map(c => [c.id, c] as const));

      for (const dashboard of dashboards) {
        summary.processed += 1;
        try {
          const creator = creatorById.get(dashboard.createdBy);
          if (!creator || !creator.workspaceId) {
            summary.skipped += 1;
            logger.warn(`${TAG} Creator missing or has no workspaceId`, {
              dashboardId: dashboard.id,
              createdBy: dashboard.createdBy,
            });
            continue;
          }

          // Pre-check the (workspaceId, name) collision so the unique index
          // added in the follow-up migration won't break.
          const clash = await db.dashboard.findFirst({
            where: {
              workspaceId: creator.workspaceId,
              name: dashboard.name,
              NOT: { id: dashboard.id },
            },
            select: { id: true },
          });

          if (clash) {
            const newName = await DashboardWorkspaceIdBackfillController.resolveClashName(
              dashboard.id,
              dashboard.name,
              creator.workspaceId,
              creator.email,
            );
            if (!options.dryRun) {
              await db.dashboard.update({
                where: { id: dashboard.id },
                data: { workspaceId: creator.workspaceId, name: newName },
              });
            }
            summary.renamed += 1;
            summary.updated += 1;
            logger.info(`${TAG} Renamed clashing dashboard`, {
              dashboardId: dashboard.id,
              workspaceId: creator.workspaceId,
              from: dashboard.name,
              to: newName,
              clashingId: clash.id,
            });
            continue;
          }

          if (!options.dryRun) {
            await db.dashboard.update({
              where: { id: dashboard.id },
              data: { workspaceId: creator.workspaceId },
            });
          }
          summary.updated += 1;
        } catch (error) {
          summary.errors += 1;
          logger.warn(`${TAG} Failed to update dashboard`, {
            dashboardId: dashboard.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = dashboards[dashboards.length - 1]?.id ?? null;

      logger.info(`${TAG} Batch #${batchNumber} completed`, {
        batchSize: dashboards.length,
        ...summary,
      });

      if (options.delayMs > 0) {
        await DashboardWorkspaceIdBackfillController.sleep(options.delayMs);
      }
    } while (cursor);

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<void> {
    try {
      const options = DashboardWorkspaceIdBackfillController.buildOptions(req.body);
      logger.info(`${TAG} Starting backfill`, options);

      const summary = await DashboardWorkspaceIdBackfillController.runBackfill(options);

      logger.info(`${TAG} Backfill completed`, summary);
      res.status(200).json({
        success: true,
        message: 'Backfill completed',
        data: { options, summary },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(`${TAG} Error during backfill:`, error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run backfill',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
