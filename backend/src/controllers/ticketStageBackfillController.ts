import { TicketStatusV2 } from '@prisma/client';
import { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '@/database/client';
import { ApiResponse } from '@/types/express';
import { calculateETADeadline } from '@/utils/etaCalculation';
import { logger } from '@/utils/logger';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { isDeskChannelType } from '@xyne/shared';

const TAG = '[TicketStageBackfill]';

const requestSchema = z
  .object({
    channelId: z.string().trim().min(1, 'channelId is required'),
    targetStage: z.string().trim().min(1, 'targetStage is required'),
    destinationStage: z.string().trim().min(1, 'destinationStage is required'),
    batchSize: z.number().int().min(1).max(1000).optional().default(100),
    delayMs: z.number().int().min(0).max(60_000).optional().default(2000),
    dryRun: z.boolean().optional().default(false),
  })
  .strict()
  .refine(data => data.targetStage !== data.destinationStage, {
    message: 'targetStage and destinationStage must be different',
    path: ['destinationStage'],
  });

type BackfillOptions = z.infer<typeof requestSchema>;

type BackfillSummary = {
  batches: number;
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
};

type StageDetails = {
  id: string;
  name: string;
  eta: number | null;
  defaultTicketStatusV2: TicketStatusV2;
};

type TicketForBackfill = {
  id: string;
  boardId: string;
};

export class TicketStageBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static async applyStageChange(
    ticketId: string,
    channelId: string,
    sourceStage: StageDetails,
    destinationStage: StageDetails,
    actorUserId: string,
  ): Promise<boolean> {
    return db.$transaction(async tx => {
      const ticket = await tx.ticket.findFirst({
        where: {
          id: ticketId,
          channelId,
          stageName: sourceStage.name,
        },
        select: {
          id: true,
          channelId: true,
          stageName: true,
          statusV2: true,
          boardId: true,
        },
      });

      // A concurrent stage update may have removed this ticket from the source set.
      if (!ticket) return false;

      const now = new Date();
      const statusChanged = ticket.statusV2 !== destinationStage.defaultTicketStatusV2;

      await tx.ticketStageEta.updateMany({
        where: {
          ticketId: ticket.id,
          stageId: sourceStage.id,
          stageLeftAt: null,
        },
        data: {
          stageLeftAt: now,
          updatedAt: now,
          updatedBy: actorUserId,
        },
      });

      const existingDestinationEta = await tx.ticketStageEta.findFirst({
        where: {
          ticketId: ticket.id,
          stageId: destinationStage.id,
        },
      });

      const destinationEta =
        destinationStage.eta !== null && destinationStage.eta > 0
          ? calculateETADeadline(now, destinationStage.eta)
          : null;

      if (existingDestinationEta) {
        await tx.ticketStageEta.update({
          where: { id: existingDestinationEta.id },
          data: {
            stageEnteredAt: now,
            stageLeftAt: null,
            ...(destinationEta ? { stageEta: destinationEta } : {}),
            updatedAt: now,
            updatedBy: actorUserId,
          },
        });
      } else if (destinationEta) {
        await tx.ticketStageEta.create({
          data: {
            ticketId: ticket.id,
            stageId: destinationStage.id,
            stageEnteredAt: now,
            stageLeftAt: null,
            stageEta: destinationEta,
            updatedBy: actorUserId,
          },
        });
      }

      const updatedTicket = await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          stageName: destinationStage.name,
          statusV2: destinationStage.defaultTicketStatusV2,
          ...(statusChanged ? { statusUpdatedAt: now } : {}),
          updatedBy: actorUserId,
          updatedAt: now,
        },
      });

      await syncConversationTicketMdFromPrismaTicket(tx, updatedTicket);

      return true;
    });
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<void> {
    const parsedBody = requestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid request body',
        data: parsedBody.error.flatten(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const options: BackfillOptions = parsedBody.data;
    const workspaceId = req.user?.workspaceId;
    const actorUserId = req.user?.id;
    if (!workspaceId || !actorUserId) {
      res.status(401).json({
        success: false,
        error: 'Authenticated workspace required',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      const channel = await db.channel.findFirst({
        where: { id: options.channelId, workspaceId },
        select: { id: true, type: true },
      });

      if (!channel) {
        res.status(404).json({
          success: false,
          error: 'Desk channel not found',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (!isDeskChannelType(channel.type)) {
        res.status(400).json({
          success: false,
          error: `Channel ${options.channelId} is not a desk channel`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const ticketWhere = {
        channelId: options.channelId,
        workspaceId,
        stageName: options.targetStage,
      };

      const boardRows: TicketForBackfill[] = await db.ticket.findMany({
        where: ticketWhere,
        select: { id: true, boardId: true },
        distinct: ['boardId'],
      });
      const boardIds = boardRows.map(ticket => ticket.boardId);

      const stagesByBoard = new Map<string, Map<string, StageDetails>>();
      if (boardIds.length > 0) {
        const stages = await db.stage.findMany({
          where: {
            boardId: { in: boardIds },
            name: { in: [options.targetStage, options.destinationStage] },
          },
          select: {
            id: true,
            name: true,
            boardId: true,
            eta: true,
            defaultTicketStatusV2: true,
          },
        });

        for (const stage of stages) {
          const boardStages = stagesByBoard.get(stage.boardId) ?? new Map<string, StageDetails>();
          boardStages.set(stage.name, {
            id: stage.id,
            name: stage.name,
            eta: stage.eta,
            defaultTicketStatusV2: stage.defaultTicketStatusV2,
          });
          stagesByBoard.set(stage.boardId, boardStages);
        }

        const invalidBoards = boardIds.filter(boardId => {
          const boardStages = stagesByBoard.get(boardId);
          return !boardStages?.has(options.targetStage) || !boardStages.has(options.destinationStage);
        });

        if (invalidBoards.length > 0) {
          res.status(400).json({
            success: false,
            error: 'Both stages must exist on every board containing matching tickets',
            data: {
              targetStage: options.targetStage,
              destinationStage: options.destinationStage,
              boardIds: invalidBoards,
            },
            timestamp: new Date().toISOString(),
          });
          return;
        }
      }

      const summary: BackfillSummary = {
        batches: 0,
        processed: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
      };

      logger.info(`${TAG} Starting`, {
        ...options,
        workspaceId,
        actorUserId,
      });

      let cursor: string | null = null;
      while (true) {
        const tickets: TicketForBackfill[] = await db.ticket.findMany({
          // Use an explicit keyset predicate because updated tickets no longer
          // match ticketWhere; cursor + skip: 1 could skip the next row after
          // the cursor has been moved out of the source stage.
          where: {
            ...ticketWhere,
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          select: { id: true, boardId: true },
          orderBy: { id: 'asc' },
          take: options.batchSize,
        });

        if (tickets.length === 0) break;
        summary.batches += 1;

        for (const ticket of tickets) {
          summary.processed += 1;

          const boardStages = stagesByBoard.get(ticket.boardId);
          const sourceStage = boardStages?.get(options.targetStage);
          const destinationStage = boardStages?.get(options.destinationStage);
          if (!sourceStage || !destinationStage) {
            summary.errors += 1;
            logger.warn(`${TAG} Missing stage metadata while processing ticket`, {
              ticketId: ticket.id,
              boardId: ticket.boardId,
              targetStage: options.targetStage,
              destinationStage: options.destinationStage,
            });
            continue;
          }

          if (options.dryRun) {
            summary.updated += 1;
            continue;
          }

          try {
            const updated = await TicketStageBackfillController.applyStageChange(
              ticket.id,
              options.channelId,
              sourceStage,
              destinationStage,
              actorUserId,
            );
            if (updated) summary.updated += 1;
            else summary.skipped += 1;
          } catch (error) {
            summary.errors += 1;
            logger.warn(`${TAG} Failed to update ticket`, {
              ticketId: ticket.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        cursor = tickets[tickets.length - 1]?.id ?? null;
        logger.info(`${TAG} Batch complete`, {
          channelId: options.channelId,
          cursor,
          ...summary,
        });

        if (options.delayMs > 0) await TicketStageBackfillController.sleep(options.delayMs);
      }

      res.status(200).json({
        success: true,
        message: options.dryRun ? 'Dry run completed' : 'Ticket stage backfill completed',
        data: {
          options,
          summary,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(`${TAG} Failed`, error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run ticket stage backfill',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
