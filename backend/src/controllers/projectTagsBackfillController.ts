import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

const TAG = '[ProjectTagsBackfill]';
const LOG_EVERY_N_BATCHES = 10;

type BackfillOptions = {
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
};

type BackfillSummary = {
  batches: number;
  processed: number;
  projectTagsCreated: number;
  mappingsCreated: number;
  skipped: number;
  errors: number;
};

export class ProjectTagsBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = (body ?? {}) as Partial<{ batchSize: number; delayMs: number; dryRun: boolean }>;
    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 50;
    const delayMs = payload.delayMs && payload.delayMs > 0 ? payload.delayMs : 1000;
    const dryRun = payload.dryRun ?? false;
    return { batchSize, delayMs, dryRun };
  }

  private static async runBackfill(options: BackfillOptions): Promise<void> {
    const summary: BackfillSummary = {
      batches: 0,
      processed: 0,
      projectTagsCreated: 0,
      mappingsCreated: 0,
      skipped: 0,
      errors: 0,
    };
    const startTime = Date.now();
    logger.info(`${TAG} Starting`, options);

    let cursor: string | null = null;

    while (true) {
      const ticketTags: Array<{
        id: string;
        name: string;
        ticketId: string;
        ticket: { projectId: string };
      }> = await db.ticketTag.findMany({
        select: {
          id: true,
          name: true,
          ticketId: true,
          ticket: { select: { projectId: true } },
        },
        orderBy: { id: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (ticketTags.length === 0) break;

      summary.batches += 1;
      cursor = ticketTags[ticketTags.length - 1]?.id ?? null;

      // Collect unique (projectId, name) pairs
      const uniqueProjectTags = new Map<string, { name: string; projectId: string }>();
      const validTags: Array<{ name: string; ticketId: string; projectId: string }> = [];

      for (const tag of ticketTags) {
        summary.processed += 1;
        if (!tag.ticket.projectId) {
          summary.skipped += 1;
          continue;
        }
        const key = `${tag.ticket.projectId}::${tag.name}`;
        if (!uniqueProjectTags.has(key)) {
          uniqueProjectTags.set(key, { name: tag.name, projectId: tag.ticket.projectId });
        }
        validTags.push({ name: tag.name, ticketId: tag.ticketId, projectId: tag.ticket.projectId });
      }

      if (options.dryRun) {
        summary.projectTagsCreated += uniqueProjectTags.size;
        summary.mappingsCreated += validTags.length;
      } else {
        // Batch create project_tags (skipDuplicates handles ON CONFLICT)
        const ptValues = [...uniqueProjectTags.values()];
        if (ptValues.length > 0) {
          try {
            const result = await db.projectTag.createMany({
              data: ptValues.map(v => ({ name: v.name, projectId: v.projectId })),
              skipDuplicates: true,
            });
            summary.projectTagsCreated += result.count;
          } catch (error) {
            summary.errors += 1;
            logger.warn(`${TAG} Failed to batch create project_tags`, {
              count: ptValues.length,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Fetch all project_tag IDs for this batch in one query
        const projectIds = [...new Set(validTags.map(t => t.projectId))];
        const tagNames = [...new Set(validTags.map(t => t.name))];
        const projectTagRows = await db.projectTag.findMany({
          where: { projectId: { in: projectIds }, name: { in: tagNames } },
          select: { id: true, name: true, projectId: true },
        });
        const ptLookup = new Map(projectTagRows.map(pt => [`${pt.projectId}::${pt.name}`, pt.id]));

        // Batch create ticket_tag_mappings
        const mappingData: Array<{ ticketId: string; tagId: string; tagName: string }> = [];
        for (const tag of validTags) {
          const tagId = ptLookup.get(`${tag.projectId}::${tag.name}`);
          if (!tagId) {
            summary.skipped += 1;
            continue;
          }
          mappingData.push({ ticketId: tag.ticketId, tagId, tagName: tag.name });
        }

        if (mappingData.length > 0) {
          try {
            const result = await db.ticketTagMapping.createMany({
              data: mappingData,
              skipDuplicates: true,
            });
            summary.mappingsCreated += result.count;
          } catch (error) {
            summary.errors += 1;
            logger.warn(`${TAG} Failed to batch create ticket_tag_mappings`, {
              count: mappingData.length,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      if (summary.batches % LOG_EVERY_N_BATCHES === 0) {
        logger.info(`${TAG} Progress`, { ...summary, dryRun: options.dryRun });
      }

      if (options.delayMs > 0) {
        await ProjectTagsBackfillController.sleep(options.delayMs);
      }
    }

    logger.info(`${TAG} Done`, {
      ...summary,
      dryRun: options.dryRun,
      durationMs: Date.now() - startTime,
    });
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<Response> {
    const options = ProjectTagsBackfillController.buildOptions(req.body);

    res.status(202).json({
      success: true,
      message: `Project tags backfill started in background${options.dryRun ? ' (dry run)' : ''}`,
      data: options,
      timestamp: new Date().toISOString(),
    });

    void (async (): Promise<void> => {
      try {
        await ProjectTagsBackfillController.runBackfill(options);
      } catch (error) {
        logger.error(`${TAG} Background run failed`, error);
      }
    })();

    return res;
  }
}
