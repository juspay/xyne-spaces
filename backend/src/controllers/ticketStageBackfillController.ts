import { ExternalEntityType, TicketStatusV2 } from '@prisma/client';
import { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '@/database/client';
import { ApiResponse } from '@/types/express';
import { calculateETADeadline } from '@/utils/etaCalculation';
import { logger } from '@/utils/logger';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';

const TAG = '[TicketStageBackfill]';
const BATCH_SIZE = 50;
const DELAY_MS = 1000;

const requestSchema = z
  .object({
    channelId: z.string().trim().min(1, 'channelId is required'),
    targetStage: z.string().trim().min(1).optional(),
    destinationStage: z.string().trim().min(1).optional(),
    status: z.nativeEnum(TicketStatusV2).optional(),
    boardId: z.string().trim().min(1).optional(),
    externalSourceType: z.string().trim().min(1).optional(),
    createdAfter: z
      .string()
      .datetime({ offset: true })
      .transform(value => new Date(value))
      .optional(),
    dryRun: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((data, context) => {
    const hasDestinationStage = data.destinationStage !== undefined;
    const hasStatus = data.status !== undefined;

    if (hasDestinationStage === hasStatus) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Exactly one of destinationStage or status is required',
        path: ['destinationStage'],
      });
    }

    if (hasDestinationStage && data.targetStage && data.targetStage === data.destinationStage) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'targetStage and destinationStage must be different',
        path: ['destinationStage'],
      });
    }
  });

type BackfillOptions = z.infer<typeof requestSchema>;

type BackfillSummary = {
  batches: number;
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  failedTicketIds: string[];
};

type StageDetails = {
  id: string;
  name: string;
  boardId: string;
  sequenceNumber: number;
  eta: number | null;
  defaultTicketStatusV2: TicketStatusV2;
};

type TicketForBackfill = {
  id: string;
  boardId: string;
  stageName: string;
};

type BackfillScope = {
  channelId: string;
  workspaceId: string;
  boardId: string;
  createdAfter?: Date;
};

type ResolvedDestinationStages = Record<
  string,
  {
    id: string;
    name: string;
    defaultTicketStatusV2: TicketStatusV2;
  }
>;

export class TicketStageBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static async applyStageChange(
    ticketId: string,
    scope: BackfillScope,
    sourceStage: StageDetails,
    destinationStage: StageDetails,
    actorUserId: string,
  ): Promise<boolean> {
    return db.$transaction(async tx => {
      const ticket = await tx.ticket.findFirst({
        where: {
          id: ticketId,
          channelId: scope.channelId,
          workspaceId: scope.workspaceId,
          boardId: scope.boardId,
          ...(scope.createdAfter ? { createdAt: { gt: scope.createdAfter } } : {}),
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

  private static async findExternalTicketIds(
    workspaceId: string,
    sourceType: string,
  ): Promise<string[]> {
    const sources = await db.externalSource.findMany({
      where: {
        workspaceId,
        sourceType,
      },
      select: { id: true },
    });

    if (sources.length === 0) return [];

    const mappings = await db.externalMessage.findMany({
      where: {
        externalSourceId: { in: sources.map(source => source.id) },
        entityType: ExternalEntityType.TICKET,
        entityId: { not: null },
      },
      select: { entityId: true },
    });

    return Array.from(
      new Set(
        mappings
          .map(mapping => mapping.entityId)
          .filter((entityId): entityId is string => entityId !== null),
      ),
    );
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
        select: { id: true, type: true, projectId: true },
      });

      if (!channel) {
        res.status(404).json({
          success: false,
          error: 'Desk channel not found',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (options.boardId) {
        const board = await db.board.findFirst({
          where: {
            id: options.boardId,
            workspaceId,
            projectId: channel.projectId,
          },
          select: { id: true },
        });

        if (!board) {
          res.status(404).json({
            success: false,
            error: 'Board not found for this workspace and channel project',
            timestamp: new Date().toISOString(),
          });
          return;
        }
      }

      const externalTicketIds = options.externalSourceType
        ? await TicketStageBackfillController.findExternalTicketIds(
            workspaceId,
            options.externalSourceType,
          )
        : undefined;

      const ticketWhere = {
        channelId: options.channelId,
        workspaceId,
        ...(options.targetStage ? { stageName: options.targetStage } : {}),
        ...(options.boardId ? { boardId: options.boardId } : {}),
        ...(options.createdAfter ? { createdAt: { gt: options.createdAfter } } : {}),
        ...(externalTicketIds ? { id: { in: externalTicketIds } } : {}),
      };

      const boardRows = await db.ticket.findMany({
        where: ticketWhere,
        select: { boardId: true },
        distinct: ['boardId'],
      });
      const boardIds = boardRows.map(ticket => ticket.boardId);

      if (boardIds.length === 0) {
        res.status(200).json({
          success: true,
          message: options.dryRun ? 'Dry run completed' : 'Ticket stage backfill completed',
          data: {
            options,
            ...(options.status ? { resolvedDestinationStages: {} } : {}),
            summary: {
              batches: 0,
              processed: 0,
              updated: 0,
              skipped: 0,
              errors: 0,
              failedTicketIds: [],
            } satisfies BackfillSummary,
          },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const stagesByBoard = new Map<string, Map<string, StageDetails>>();
      const stages = await db.stage.findMany({
        where: {
          boardId: { in: boardIds },
          ...(options.targetStage
            ? {
                OR: [
                  { name: options.targetStage },
                  ...(options.destinationStage ? [{ name: options.destinationStage }] : []),
                  ...(options.status ? [{ defaultTicketStatusV2: options.status }] : []),
                ],
              }
            : {}),
        },
        select: {
          id: true,
          name: true,
          boardId: true,
          sequenceNumber: true,
          eta: true,
          defaultTicketStatusV2: true,
        },
      });

      for (const stage of stages) {
        const boardStages = stagesByBoard.get(stage.boardId) ?? new Map<string, StageDetails>();
        boardStages.set(stage.name, {
          id: stage.id,
          name: stage.name,
          boardId: stage.boardId,
          sequenceNumber: stage.sequenceNumber,
          eta: stage.eta,
          defaultTicketStatusV2: stage.defaultTicketStatusV2,
        });
        stagesByBoard.set(stage.boardId, boardStages);
      }

      const destinationStagesByBoard = new Map<string, StageDetails>();
      const invalidBoards = boardIds.filter(boardId => {
        const boardStages = stagesByBoard.get(boardId);
        if (!boardStages) return true;
        if (options.targetStage && !boardStages.has(options.targetStage)) return true;

        if (options.destinationStage) {
          const destinationStage = boardStages.get(options.destinationStage);
          if (!destinationStage) return true;
          destinationStagesByBoard.set(boardId, destinationStage);
          return false;
        }

        const destinationStage = Array.from(boardStages.values())
          .filter(
            stage =>
              stage.name !== options.targetStage &&
              stage.defaultTicketStatusV2 === options.status,
          )
          .sort(
            (left, right) =>
              left.sequenceNumber - right.sequenceNumber || left.id.localeCompare(right.id),
          )[0];

        if (!destinationStage) return true;
        destinationStagesByBoard.set(boardId, destinationStage);
        return false;
      });

      if (invalidBoards.length > 0) {
        res.status(400).json({
          success: false,
          error: options.destinationStage
            ? 'Both stages must exist on every board containing matching tickets'
            : 'A distinct stage with the requested status must exist on every board containing matching tickets',
          data: {
            targetStage: options.targetStage,
            destinationStage: options.destinationStage,
            status: options.status,
            boardIds: invalidBoards,
          },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const resolvedDestinationStages: ResolvedDestinationStages = Object.fromEntries(
        Array.from(destinationStagesByBoard.entries()).map(([boardId, stage]) => [
          boardId,
          {
            id: stage.id,
            name: stage.name,
            defaultTicketStatusV2: stage.defaultTicketStatusV2,
          },
        ]),
      );

      const candidateTicketWhere = options.targetStage
        ? ticketWhere
        : {
            AND: [
              ticketWhere,
              {
                OR: Array.from(destinationStagesByBoard.entries()).map(([boardId, stage]) => ({
                  boardId,
                  stageName: { not: stage.name },
                })),
              },
            ],
          };

      const summary: BackfillSummary = {
        batches: 0,
        processed: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        failedTicketIds: [],
      };

      logger.info(`${TAG} Starting`, {
        ...options,
        workspaceId,
        actorUserId,
        resolvedDestinationStages,
      });

      let cursor: string | null = null;
      let hasMoreTickets = true;
      while (hasMoreTickets) {
        const tickets: TicketForBackfill[] = await db.ticket.findMany({
          // Use an explicit keyset predicate because updated tickets no longer
          // match ticketWhere; cursor + skip: 1 could skip the next row after
          // the cursor has been moved out of the source stage.
          where: cursor
            ? { AND: [candidateTicketWhere, { id: { gt: cursor } }] }
            : candidateTicketWhere,
          select: { id: true, boardId: true, stageName: true },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
        });

        if (tickets.length === 0) {
          hasMoreTickets = false;
          continue;
        }
        summary.batches += 1;

        for (const ticket of tickets) {
          summary.processed += 1;

          const boardStages = stagesByBoard.get(ticket.boardId);
          const sourceStage = boardStages?.get(options.targetStage ?? ticket.stageName);
          const destinationStage = destinationStagesByBoard.get(ticket.boardId);
          if (!sourceStage || !destinationStage) {
            summary.errors += 1;
            summary.failedTicketIds.push(ticket.id);
            logger.warn(`${TAG} Missing stage metadata while processing ticket`, {
              ticketId: ticket.id,
              boardId: ticket.boardId,
              targetStage: options.targetStage ?? ticket.stageName,
              destinationStage: options.destinationStage,
              status: options.status,
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
              {
                channelId: options.channelId,
                workspaceId,
                boardId: ticket.boardId,
                ...(options.createdAfter ? { createdAfter: options.createdAfter } : {}),
              },
              sourceStage,
              destinationStage,
              actorUserId,
            );
            if (updated) summary.updated += 1;
            else summary.skipped += 1;
          } catch (error) {
            summary.errors += 1;
            summary.failedTicketIds.push(ticket.id);
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

        if (DELAY_MS > 0) await TicketStageBackfillController.sleep(DELAY_MS);
      }

      const hasErrors = summary.errors > 0;
      res.status(hasErrors ? 207 : 200).json({
        success: !hasErrors,
        message: hasErrors
          ? 'Ticket stage backfill completed with errors'
          : options.dryRun
            ? 'Dry run completed'
            : 'Ticket stage backfill completed',
        ...(hasErrors ? { error: 'Some tickets could not be updated' } : {}),
        data: {
          options,
          ...(options.status ? { resolvedDestinationStages } : {}),
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
