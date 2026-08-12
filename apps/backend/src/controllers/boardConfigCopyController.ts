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

// The migration plan `/prepare` handed back, returned verbatim by the client. Shape-checked
// here; every claim it makes is re-verified against the board's live state in the service,
// and workspace/actor are overridden there from the authenticated request.
const startMigrationSchema = z
  .object({
    targetBoardId: z.string().min(1),
    workspaceId: z.string(),
    actorUserId: z.string(),
    ticketRemap: z.array(
      z.object({
        oldStageId: z.string().min(1),
        oldStageName: z.string().min(1),
        newStageId: z.string().min(1),
        newStageName: z.string().min(1),
        newStageEta: z.number().nullable(),
        newStageStatusV2: z.string(),
        futureStagesEtaHours: z.number(),
      }),
    ),
    fieldRepoints: z.array(z.object({ oldFieldId: z.string().min(1), newFieldId: z.string().min(1) })),
    targetOldFormId: z.string().nullable(),
    clonedFormId: z.string().nullable(),
    snapshotPath: z.string(),
  })
  .strict();

export class BoardConfigCopyController {
  /**
   * Both halves of a copy request. Always returns the plan (what would change, and which
   * old stages still need a target) so the remap picker can render; additionally performs
   * the server-only work — pre-copy snapshot and custom-fields form clone — and returns
   * `prepared` once the plan is fully resolved and `dryRun` is false.
   *
   * Writes no board configuration itself; the client commits that through the ordinary Zero
   * mutators, the same way it commits an ordinary board edit.
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
      // Board-pair validation failures (wrong project, release board, missing board) come
      // back in-band so the caller still gets the structured `errors` list, matching how
      // the old /plan endpoint reported them.
      if (result.errors.length > 0) {
        res.status(400).json({ success: false, error: result.errors.join('; '), data: result, timestamp: new Date().toISOString() });
        return;
      }
      res.status(200).json({
        success: true,
        message: result.prepared ? 'Board config copy prepared' : 'Board config copy plan',
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
   * Enqueues the ticket migration a prepared copy left pending, once the client has
   * committed the configuration. Takes the plan `/prepare` returned; the service re-checks
   * every destination in it against the board's live stages before acting on it.
   */
  static async startTicketMigration(req: Request, res: Response<ApiResponse>): Promise<void> {
    const parsed = startMigrationSchema.safeParse(req.body);
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
      const result = await boardConfigCopyService.startTicketMigration(parsed.data, actorUserId, workspaceId);
      res.status(202).json({
        success: true,
        message: 'Ticket migration started',
        data: { jobId: result.jobId },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof BoardConfigCopyValidationError) {
        res.status(400).json({
          success: false,
          error: error.errors.join('; '),
          data: { errors: error.errors },
          timestamp: new Date().toISOString(),
        });
        return;
      }
      if (error instanceof BoardConfigCopyConflictError) {
        res.status(409).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
        return;
      }
      logger.error(`${TAG} startTicketMigration failed`, error);
      res.status(500).json({ success: false, error: 'Failed to start ticket migration', timestamp: new Date().toISOString() });
    }
  }
}
