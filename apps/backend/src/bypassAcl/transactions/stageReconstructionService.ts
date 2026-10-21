import { TicketStatusV2, ActivityType } from '@xyne/shared';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { calculateETADeadline } from '@/utils/etaCalculation';
import { syncStageOverdueFlag } from '@/services/tickets/syncStageOverdueFlag';
import { Prisma } from '@prisma/client';
import { StageReconstructionService, TicketSnapshot } from '@/services/stageReconstructionService';
import { transaction, type TableName } from '../base';
import type { PrismaClient } from '@prisma/client';
import type { DbClient, PrismaTransaction } from '@/services/stageReconstructionService';

/**
 * Relocated from services/stageReconstructionService.ts's runInTransaction: opens a transaction
 * when given the root client, or runs directly on an already-open transaction client.
 * Deliberately NOT exported — only the named operations in this file may use it.
 */
async function runInTransaction<T>(
  tables: TableName[],
  reason: string,
  dbClient: DbClient,
  fn: (tx: PrismaTransaction) => Promise<T>,
): Promise<T> {
  const maybePrismaClient = dbClient as PrismaClient;
  if (typeof maybePrismaClient.$transaction === 'function') {
    return transaction(tables, reason, maybePrismaClient, fn);
  }

  return fn(dbClient as PrismaTransaction);
}

export function applyReconstructedStateTx(self: StageReconstructionService, ticket: TicketSnapshot, reconstructedStageName: string, reconstructedStatusV2: TicketStatusV2, actorUserId: string) {
  return runInTransaction(['Stage', 'Ticket', 'TicketActivity', 'TicketStageEta'], 'applyReconstructedState: reconstructed stage/status, activity and ETA rows for a ticket must commit together; tx is not ACL-wrapped', self.db, async (tx) => {
    const now = new Date();
    const stageChanged = ticket.stageName !== reconstructedStageName;
    const statusChanged = ticket.statusV2 !== reconstructedStatusV2;

    const updatedTicket = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        stageName: reconstructedStageName,
        statusV2: reconstructedStatusV2,
        ...(statusChanged ? { statusUpdatedAt: now } : {}),
        updatedBy: actorUserId,
        updatedAt: now,
      },
    });

    await syncConversationTicketMdFromPrismaTicket(tx, updatedTicket);

    if (stageChanged) {
      const targetStage = await tx.stage.findFirst({
        where: { boardId: ticket.boardId, name: reconstructedStageName },
        select: { id: true, eta: true },
      });

      if (targetStage) {
        await tx.ticketStageEta.updateMany({
          where: {
            ticketId: ticket.id,
            stageLeftAt: null,
          },
          data: {
            stageLeftAt: now,
            updatedAt: now,
            updatedBy: actorUserId,
          },
        });

        const existingEntry = await tx.ticketStageEta.findFirst({
          where: { ticketId: ticket.id, stageId: targetStage.id },
        });

        if (existingEntry && targetStage.eta !== null && targetStage.eta > 0) {
          await tx.ticketStageEta.update({
            where: { id: existingEntry.id },
            data: {
              stageEnteredAt: now,
              stageLeftAt: null,
              stageEta: calculateETADeadline(now, targetStage.eta),
              updatedAt: now,
              updatedBy: actorUserId,
            },
          });
        } else if (!existingEntry && targetStage.eta !== null && targetStage.eta > 0) {
          await tx.ticketStageEta.create({
            data: {
              workspaceId: ticket.workspaceId,
              ticketId: ticket.id,
              stageId: targetStage.id,
              stageEnteredAt: now,
              stageLeftAt: null,
              stageEta: calculateETADeadline(now, targetStage.eta),
              updatedBy: actorUserId,
            },
          });
        }
      }

      await syncStageOverdueFlag(tx, ticket.id, now);

      await tx.ticketActivity.create({
        data: {
          workspaceId: ticket.workspaceId,
          ticketId: ticket.id,
          updatedBy: actorUserId,
          timestamp: now,
          activityType: ActivityType.STAGE_NAME,
          value: {
            field: 'stageName',
            oldValue: ticket.stageName,
            newValue: reconstructedStageName,
            source: 'STAGE_RECONSTRUCTION',
          } as Prisma.InputJsonValue,
        },
      });
    }

    if (statusChanged) {
      await tx.ticketActivity.create({
        data: {
          workspaceId: ticket.workspaceId,
          ticketId: ticket.id,
          updatedBy: actorUserId,
          timestamp: now,
          activityType: ActivityType.STATUS,
          value: {
            field: 'statusV2',
            oldValue: ticket.statusV2,
            newValue: reconstructedStatusV2,
            source: 'STAGE_RECONSTRUCTION',
          } as Prisma.InputJsonValue,
        },
      });
    }
  });
}
