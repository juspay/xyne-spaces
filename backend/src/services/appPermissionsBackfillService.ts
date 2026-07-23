import { db } from '@/database/client';
import { logger } from '@/utils/logger';

export interface AppPermissionsBackfillConfig {
  batchSize: number;
  sleepMs: number;
}

export interface AppPermissionsBackfillResult {
  permissionsInRegistry: number;
  installationsProcessed: number;
  totalGranted: number;
  totalSkipped: number;
  batches: number;
  startTime: string;
  endTime: string;
}

const DEFAULT_CONFIG: AppPermissionsBackfillConfig = {
  batchSize: 50,
  sleepMs: 2000,
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

type Permission = { id: string; name: string; type: string };

/**
 * Backfill: grant every available permission (as APPROVED) to every installed
 * app that does not already have it.
 *
 * Processes installed apps in cursor-based batches with a configurable sleep
 * between batches to avoid DB load spikes.
 *
 * Safe to re-run — skips permissions that already exist.
 */
export class AppPermissionsBackfillService {
  async grantAllPermissionsToAllApps(
    config: Partial<AppPermissionsBackfillConfig> = {},
  ): Promise<AppPermissionsBackfillResult> {
    const { batchSize, sleepMs } = { ...DEFAULT_CONFIG, ...config };
    const startTime = new Date();

    logger.info(
      `[APP-PERMISSIONS-BACKFILL] Starting — batchSize=${batchSize}, sleepMs=${sleepMs}`,
    );

    // Load the registry once upfront — it's tiny (11 rows)
    const allPermissions: Permission[] = await db.availableAppPermission.findMany({
      select: { id: true, name: true, type: true },
    });

    if (allPermissions.length === 0) {
      throw new Error('No permissions found in registry. Run the seed script first.');
    }

    let installationsProcessed = 0;
    let totalGranted = 0;
    let totalSkipped = 0;
    let batches = 0;
    let cursor: string | undefined;

    while (true) {
      // Fetch next batch of installed apps using cursor-based pagination
      const batch = await db.installedApps.findMany({
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: { id: true, appId: true, workspaceId: true },
        orderBy: { id: 'asc' },
      });

      if (batch.length === 0) break;

      cursor = batch[batch.length - 1]!.id;
      batches++;

      logger.info(
        `[APP-PERMISSIONS-BACKFILL] Batch ${batches} — processing ${batch.length} installed apps`,
      );

      // Process all apps in this batch concurrently
      await Promise.all(
        batch.map(async (installation: { id: string; appId: string; workspaceId: string | null }) => {
          const existing = await db.installedAppPermission.findMany({
            where: { installedAppId: installation.id },
            select: { permissionId: true },
          });

          const existingIds = new Set(existing.map((e: { permissionId: string }) => e.permissionId));
          const toInsert = allPermissions.filter((p) => !existingIds.has(p.id));

          if (toInsert.length > 0) {
            await db.installedAppPermission.createMany({
              data: toInsert.map((p) => ({
                installedAppId: installation.id,
                workspaceId: installation.workspaceId,
                permissionId: p.id,
                status: 'APPROVED',
              })),
              skipDuplicates: true,
            });
            totalGranted += toInsert.length;
          }

          totalSkipped += existingIds.size;
        }),
      );

      installationsProcessed += batch.length;

      logger.info(
        `[APP-PERMISSIONS-BACKFILL] Batch ${batches} done — processed=${installationsProcessed}, granted=${totalGranted}, skipped=${totalSkipped}`,
      );

      if (sleepMs > 0) await sleep(sleepMs);
    }

    const endTime = new Date();
    logger.info(
      `[APP-PERMISSIONS-BACKFILL] Complete — batches=${batches}, installations=${installationsProcessed}, granted=${totalGranted}, skipped=${totalSkipped}, duration=${endTime.getTime() - startTime.getTime()}ms`,
    );

    return {
      permissionsInRegistry: allPermissions.length,
      installationsProcessed,
      totalGranted,
      totalSkipped,
      batches,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    };
  }
}

export const appPermissionsBackfillService = new AppPermissionsBackfillService();
