import { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '@/types/express';
import { logger } from '@/utils/logger';
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

const prepareSchema = z
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

const startMigrationSchema = z.object({ targetBoardId: z.string().min(1) }).strict();

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
      res.status(500).json({ success: false, error: 'Failed to plan board config copy', timestamp: new Date().toISOString() });
    }
  }

  /**
   * Does the server-only half of a copy — validation, the pre-copy snapshot, and the
   * custom-fields form clone — then hands back the exact arguments the dashboard feeds
   * into the ordinary Zero mutators to commit the configuration itself. Writes no board
   * configuration; the client owns that, the same way it owns an ordinary board edit.
   */
  static async prepare(req: Request, res: Response<ApiResponse>): Promise<void> {
    const parsed = prepareSchema.safeParse(req.body);
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
      const result = await boardConfigCopyService.prepareCopy(parsed.data, actorUserId, workspaceId);
      res.status(200).json({
        success: true,
        message: parsed.data.dryRun ? 'Dry run completed' : 'Board config copy prepared',
        data: result,
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
      logger.error(`${TAG} prepare failed`, error);
      res.status(500).json({ success: false, error: 'Failed to prepare board config copy', timestamp: new Date().toISOString() });
    }
  }

  /**
   * Enqueues the ticket migration left pending by a prepared copy, once the client has
   * committed the configuration. The remap plan comes from the server-side stash, never
   * the request body — by now the old stages are deleted, so a forged plan could silently
   * scatter every ticket on the board.
   */
  static async startTicketMigration(req: Request, res: Response<ApiResponse>): Promise<void> {
    const parsed = startMigrationSchema.safeParse(req.body);
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
      const result = await boardConfigCopyService.startTicketMigration(parsed.data.targetBoardId, workspaceId);
      if (!result) {
        res.status(404).json({
          success: false,
          error: 'No prepared migration found for this board — it may have already started or expired.',
          timestamp: new Date().toISOString(),
        });
        return;
      }
      res.status(202).json({
        success: true,
        message: 'Ticket migration started',
        data: { jobId: result.jobId },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof BoardConfigCopyConflictError) {
        res.status(409).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
        return;
      }
      logger.error(`${TAG} startTicketMigration failed`, error);
      res.status(500).json({ success: false, error: 'Failed to start ticket migration', timestamp: new Date().toISOString() });
    }
  }
}
