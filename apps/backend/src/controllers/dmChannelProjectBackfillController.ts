import { ChannelScopeType, ProjectType } from '@prisma/client';
import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

type BackfillOptions = {
  dryRun: boolean;
};

type BackfillSummary = {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
};

type ChannelToBackfill = {
  id: string;
  workspaceId: string;
};

const DEFAULT_PROJECT_ID = 'default';
const BATCH_SIZE = 50;
const DELAY_MS = 1000;

export class DmChannelProjectBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = body as Partial<{ dryRun: boolean }>;
    return { dryRun: payload.dryRun === true };
  }

  private static async backfillDmChannelProjectIds(
    options: BackfillOptions,
  ): Promise<BackfillSummary> {
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;
    let batchNumber = 0;

    while (true) {
      batchNumber += 1;
      const channels: ChannelToBackfill[] = await db.channel.findMany({
        where: {
          projectId: DEFAULT_PROJECT_ID,
          scopeType: ChannelScopeType.DM,
        },
        select: { id: true, workspaceId: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (channels.length === 0) break;

      const workspaceIds: string[] = [...new Set(channels.map(channel => channel.workspaceId))];
      const dmProjects = await db.project.findMany({
        where: {
          workspaceId: { in: workspaceIds },
          type: ProjectType.DM,
        },
        select: { id: true, workspaceId: true },
        orderBy: { id: 'asc' },
      });

      const dmProjectByWorkspaceId = new Map<string, string>();
      for (const project of dmProjects) {
        if (!dmProjectByWorkspaceId.has(project.workspaceId)) {
          dmProjectByWorkspaceId.set(project.workspaceId, project.id);
        }
      }

      summary.processed += channels.length;

      const channelIdsByProjectId = new Map<string, string[]>();
      for (const channel of channels) {
        const dmProjectId = dmProjectByWorkspaceId.get(channel.workspaceId);
        if (!dmProjectId) {
          summary.skipped += 1;
          continue;
        }

        const bucket = channelIdsByProjectId.get(dmProjectId);
        if (bucket) {
          bucket.push(channel.id);
        } else {
          channelIdsByProjectId.set(dmProjectId, [channel.id]);
        }
      }

      for (const [projectId, channelIds] of channelIdsByProjectId) {
        if (options.dryRun) {
          summary.updated += channelIds.length;
          continue;
        }

        try {
          const result = await db.channel.updateMany({
            where: { id: { in: channelIds } },
            data: { projectId },
          });
          summary.updated += result.count;
        } catch (error) {
          summary.errors += channelIds.length;
          logger.warn('[DmChannelProjectBackfill] Failed to update batch', {
            projectId,
            channelCount: channelIds.length,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = channels[channels.length - 1]?.id ?? null;
      logger.info(`[DmChannelProjectBackfill] Batch #${batchNumber} completed`, {
        batchSize: channels.length,
        processed: summary.processed,
        updated: summary.updated,
        skipped: summary.skipped,
        errors: summary.errors,
      });

      if (DELAY_MS > 0) {
        await this.sleep(DELAY_MS);
      }
    }

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<void> {
    try {
      const options = DmChannelProjectBackfillController.buildOptions(req.body);
      logger.info('[DmChannelProjectBackfill] Starting backfill', options);

      const results = await DmChannelProjectBackfillController.backfillDmChannelProjectIds(options);

      res.status(200).json({
        success: true,
        message: options.dryRun ? 'Dry run completed' : 'Backfill completed',
        data: { options, results },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[DmChannelProjectBackfill] Error during backfill:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run DM channel project backfill',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
