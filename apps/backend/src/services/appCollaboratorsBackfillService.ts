import { db } from '@/database/client';
import { logger } from '@/utils/logger';

export interface AppCollaboratorsBackfillConfig {
  batchSize: number;
  sleepMs: number;
}

export interface AppCollaboratorsBackfillResult {
  appsProcessed: number;
  totalCreated: number;
  totalSkipped: number;
  batches: number;
  startTime: string;
  endTime: string;
}

const DEFAULT_CONFIG: AppCollaboratorsBackfillConfig = {
  batchSize: 50,
  sleepMs: 2000,
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Backfill: seed every app's creator (apps.createdBy) as an ADMIN row in
 * app_collaborators, so existing apps become collaborator-manageable.
 *
 * Processes apps in cursor-based batches with a configurable sleep between
 * batches to avoid DB load spikes.
 *
 * Safe to re-run — skips apps whose creator is already a collaborator.
 */
export class AppCollaboratorsBackfillService {
  async seedCreatorsAsAdmins(
    config: Partial<AppCollaboratorsBackfillConfig> = {},
  ): Promise<AppCollaboratorsBackfillResult> {
    const { batchSize, sleepMs } = { ...DEFAULT_CONFIG, ...config };
    const startTime = new Date();

    logger.info(
      `[APP-COLLABORATORS-BACKFILL] Starting — batchSize=${batchSize}, sleepMs=${sleepMs}`,
    );

    let appsProcessed = 0;
    let totalCreated = 0;
    let totalSkipped = 0;
    let batches = 0;
    let cursor: string | undefined;

    for (;;) {
      // Fetch next batch of apps using cursor-based pagination
      const batch = await db.apps.findMany({
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: { id: true, createdBy: true, workspaceId: true },
        orderBy: { id: 'asc' },
      });

      if (batch.length === 0) break;

      cursor = batch[batch.length - 1]!.id;
      batches++;

      logger.info(
        `[APP-COLLABORATORS-BACKFILL] Batch ${batches} — processing ${batch.length} apps`,
      );

      const existing = await db.appCollaborator.findMany({
        where: {
          appId: { in: batch.map((a) => a.id) },
        },
        select: { appId: true, userId: true },
      });
      const existingKeys = new Set(existing.map((e) => `${e.appId}:${e.userId}`));

      const toInsert = batch.filter((app) => !existingKeys.has(`${app.id}:${app.createdBy}`));

      if (toInsert.length > 0) {
        const result = await db.appCollaborator.createMany({
          data: toInsert.map((app) => {
            const now = new Date();
            return {
              workspaceId: app.workspaceId,
              appId: app.id,
              userId: app.createdBy,
              collaboratorType: 'ADMIN',
              createdAt: now,
              updatedAt: now,
            };
          }),
          skipDuplicates: true,
        });
        totalCreated += result.count;
      }

      totalSkipped += batch.length - toInsert.length;
      appsProcessed += batch.length;

      logger.info(
        `[APP-COLLABORATORS-BACKFILL] Batch ${batches} done — processed=${appsProcessed}, created=${totalCreated}, skipped=${totalSkipped}`,
      );

      if (sleepMs > 0) await sleep(sleepMs);
    }

    const endTime = new Date();
    logger.info(
      `[APP-COLLABORATORS-BACKFILL] Complete — batches=${batches}, apps=${appsProcessed}, created=${totalCreated}, skipped=${totalSkipped}, duration=${endTime.getTime() - startTime.getTime()}ms`,
    );

    return {
      appsProcessed,
      totalCreated,
      totalSkipped,
      batches,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    };
  }
}

export const appCollaboratorsBackfillService = new AppCollaboratorsBackfillService();
