import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

const TAG = '[InstalledAppCommandsBackfill]';

type BackfillOptions = {
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
};

type BackfillSummary = {
  processedInstalls: number;
  created: number;
  updated: number;
  removed: number;
  errors: number;
};

/**
 * Backfills installed_app_commands (a newly added table) for existing installs. For each install
 * it snapshots the parent app's current commands into installed_app_commands — creating rows that
 * are missing, refreshing changed ones, and removing rows whose template command no longer exists.
 * Matched by sourceCommandId, so it's idempotent and safe to re-run.
 */
export class InstalledAppCommandsBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = (body ?? {}) as Partial<{ batchSize: number; delayMs: number; dryRun: boolean }>;
    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 100;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 1000;
    const dryRun = payload.dryRun === true;
    return { batchSize, delayMs, dryRun };
  }

  private static async syncInstall(
    installedAppId: string,
    appId: string,
    workspaceId: string | null,
    dryRun: boolean,
    summary: BackfillSummary,
  ): Promise<void> {
    const now = new Date();
    const [templateCommands, existing] = await Promise.all([
      db.appCommand.findMany({ where: { appId } }),
      db.installedAppCommand.findMany({ where: { installedAppId } }),
    ]);
    const existingBySource = new Map(existing.map(e => [e.sourceCommandId, e]));
    const templateIds = new Set(templateCommands.map(c => c.id));

    for (const c of templateCommands) {
      const prev = existingBySource.get(c.id);
      if (prev) {
        if (!dryRun) {
          await db.installedAppCommand.update({
            where: { id: prev.id },
            data: {
              commandName: c.commandName,
              description: c.description,
              commandType: c.commandType,
              commandAccessibility: c.commandAccessibility,
              updatedAt: now,
            },
          });
        }
        summary.updated += 1;
      } else {
        if (!dryRun) {
          await db.installedAppCommand.create({
            data: {
              installedAppId,
              sourceCommandId: c.id,
              commandName: c.commandName,
              description: c.description,
              commandType: c.commandType,
              commandAccessibility: c.commandAccessibility,
              createdAt: now,
              updatedAt: now,
              workspaceId,
            },
          });
        }
        summary.created += 1;
      }
    }

    for (const e of existing) {
      if (!templateIds.has(e.sourceCommandId)) {
        if (!dryRun) {
          await db.installedAppCommand.delete({ where: { id: e.id } });
        }
        summary.removed += 1;
      }
    }
  }

  private static async runBackfill(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = { processedInstalls: 0, created: 0, updated: 0, removed: 0, errors: 0 };
    let cursor: string | null = null;
    let batchNumber = 0;

    do {
      batchNumber += 1;
      const installs: Array<{ id: string; appId: string; workspaceId: string | null }> = await db.installedApps.findMany({
        select: { id: true, appId: true, workspaceId: true },
        orderBy: { id: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (installs.length === 0) break;

      for (const inst of installs) {
        summary.processedInstalls += 1;
        try {
          await InstalledAppCommandsBackfillController.syncInstall(inst.id, inst.appId, inst.workspaceId, options.dryRun, summary);
        } catch (error) {
          summary.errors += 1;
          logger.warn(`${TAG} Failed to backfill install`, {
            installedAppId: inst.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = installs[installs.length - 1]?.id ?? null;
      logger.info(`${TAG} Batch #${batchNumber} completed`, { batchSize: installs.length, ...summary });

      if (options.delayMs > 0) {
        await InstalledAppCommandsBackfillController.sleep(options.delayMs);
      }
    } while (cursor);

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<void> {
    try {
      const options = InstalledAppCommandsBackfillController.buildOptions(req.body);
      logger.info(`${TAG} Starting backfill`, options);

      const summary = await InstalledAppCommandsBackfillController.runBackfill(options);

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
