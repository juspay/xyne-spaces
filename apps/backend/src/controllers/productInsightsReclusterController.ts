import { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '@/types/express';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { runReclusteringFlow } from '@/services/productInsightsPipeline';
import { db } from '@/database/client';

const DAY_MS = 24 * 60 * 60 * 1000;

const ReclusterRequestSchema = z.object({
  projectId: z.string().min(1).optional(),
  fromTs: z.number().int().optional(),
  toTs: z.number().int().optional(),
  windowDays: z.number().int().positive().optional(),
});

export class ProductInsightsReclusterController {
  /**
   * @route POST /api/admin/product-insights-recluster
   * @desc Trigger product insights full reclustering (async)
   */
  static async triggerRecluster(req: Request, res: Response<ApiResponse>): Promise<void> {
    try {
      const parsed = ReclusterRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid request payload',
          message: parsed.error.message,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const overrides = parsed.data;
      const projectIdOverride = overrides.projectId;
      const toTs = overrides.toTs ?? Date.now();
      const windowDays = overrides.windowDays ?? config.productInsights.recluster.windowDays;
      const fromTs = overrides.fromTs ?? toTs - windowDays * DAY_MS;

      if (fromTs > toTs) {
        res.status(400).json({
          success: false,
          error: 'Invalid time window',
          message: 'fromTs must be <= toTs',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const response: ApiResponse = {
        success: true,
        data: {
          message: 'Product insights recluster started in background',
          params: {
            projectId: projectIdOverride ?? 'ALL',
            fromTs,
            toTs,
          },
        },
        timestamp: new Date().toISOString(),
      };

      res.status(202).json(response);

      const runForProject = async (projectId: string) => {
        const result = await runReclusteringFlow({
          projectId,
          fromTs,
          toTs,
        });
        if (result) {
          logger.info('[ProductInsightsRecluster] Reclustering completed (uploaded)', {
            projectId,
            fromTs,
            toTs,
          });
        } else {
          logger.warn('[ProductInsightsRecluster] Reclustering completed (skipped upload)', {
            projectId,
            fromTs,
            toTs,
          });
        }
      };

      const runForAllProjects = async () => {
        const projects = await db.project.findMany({ select: { id: true, name: true } });
        for (const project of projects) {
          try {
            logger.info('[ProductInsightsRecluster] Running recluster for project', {
              projectId: project.id,
              projectName: project.name,
              fromTs,
              toTs,
            });
            await runForProject(project.id);
          } catch (error) {
            logger.error('[ProductInsightsRecluster] Reclustering failed for project', {
              projectId: project.id,
              projectName: project.name,
              error: error,
            });
          }
        }
      };

      (projectIdOverride ? runForProject(projectIdOverride) : runForAllProjects()).catch((error) => {
        logger.error('[ProductInsightsRecluster] Background recluster failed', error);
      });
    } catch (error) {
      logger.error('[ProductInsightsRecluster] Trigger failed', error);
      res.status(500).json({
        success: false,
        error: 'Failed to trigger product insights recluster',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
