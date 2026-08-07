import { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '@/types/express';
import { logger } from '@/utils/logger';
import { boardConfigCopyQueue } from '@/queues/boardConfigCopyQueue';
import {
  boardConfigCopyService,
  BoardConfigCopyValidationError,
  BoardConfigCopyConflictError,
} from '@/services/boardConfigCopyService';

const TAG = '[BoardConfigCopyController]';

const categoriesSchema = z.object({
  customFields: z.boolean(),
  roles: z.boolean(),
  stages: z.boolean(),
});

const planSchema = z
  .object({
    sourceBoardId: z.string().min(1),
    targetBoardId: z.string().min(1),
    categories: categoriesSchema,
  })
  .strict();

const executeSchema = z
  .object({
    sourceBoardId: z.string().min(1),
    targetBoardId: z.string().min(1),
    categories: categoriesSchema,
    stageRemapOverrides: z
      .array(z.object({ oldStageId: z.string().min(1), newStageId: z.string().min(1) }))
      .optional(),
    dryRun: z.boolean().optional().default(false),
  })
  .strict();

export class BoardConfigCopyController {
  static async plan(req: Request, res: Response<ApiResponse>): Promise<void> {
    const parsed = planSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid request body', data: parsed.error.flatten(), timestamp: new Date().toISOString() });
      return;
    }

    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ success: false, error: 'Authenticated workspace required', timestamp: new Date().toISOString() });
      return;
    }

    try {
      const result = await boardConfigCopyService.planCopy(parsed.data, workspaceId);
      if (result.errors.length > 0) {
        res.status(400).json({ success: false, error: result.errors.join('; '), data: result, timestamp: new Date().toISOString() });
        return;
      }
      res.status(200).json({ success: true, data: result, timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error(`${TAG} plan failed`, error);
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to plan board config copy', timestamp: new Date().toISOString() });
    }
  }

  static async execute(req: Request, res: Response<ApiResponse>): Promise<void> {
    const parsed = executeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid request body', data: parsed.error.flatten(), timestamp: new Date().toISOString() });
      return;
    }

    const workspaceId = req.user?.workspaceId;
    const actorUserId = req.user?.id;
    if (!workspaceId || !actorUserId) {
      res.status(401).json({ success: false, error: 'Authenticated workspace required', timestamp: new Date().toISOString() });
      return;
    }

    try {
      const result = await boardConfigCopyService.executeCopy(parsed.data, actorUserId, workspaceId);

      if (result.jobId) {
        res.status(202).json({
          success: true,
          message: 'Board config copy started',
          data: { jobId: result.jobId },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: parsed.data.dryRun ? 'Dry run completed' : 'Board config copy completed',
        data: { summary: result.summary },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof BoardConfigCopyValidationError) {
        res.status(400).json({
          success: false,
          error: error.errors.join('; '),
          data: { errors: error.errors, requiresExplicit: error.requiresExplicit },
          timestamp: new Date().toISOString(),
        });
        return;
      }
      if (error instanceof BoardConfigCopyConflictError) {
        res.status(409).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
        return;
      }
      logger.error(`${TAG} execute failed`, error);
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to execute board config copy', timestamp: new Date().toISOString() });
    }
  }

  static async status(req: Request, res: Response<ApiResponse>): Promise<void> {
    const jobId = req.params['jobId'];
    if (!jobId) {
      res.status(400).json({ success: false, error: 'jobId is required', timestamp: new Date().toISOString() });
      return;
    }

    try {
      const queue = boardConfigCopyQueue.getQueue();
      const job = await queue.getJob(jobId);
      if (!job) {
        res.status(404).json({ success: false, error: 'Job not found', timestamp: new Date().toISOString() });
        return;
      }

      const state = await job.getState();
      res.status(200).json({
        success: true,
        data: {
          state,
          progress: job.progress(),
          result: job.returnvalue,
          failedReason: job.failedReason,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(`${TAG} status failed`, error);
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to fetch job status', timestamp: new Date().toISOString() });
    }
  }
}
