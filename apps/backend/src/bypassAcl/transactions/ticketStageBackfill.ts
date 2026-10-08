import { TicketStatusV2 } from '@xyne/shared';
import { db } from '@/database/client';
import { transaction } from '../base';
import { calculateETADeadline } from '@/utils/etaCalculation';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';

type StageDetails = {
  id: string;
  name: string;
  boardId: string;
  sequenceNumber: number;
  eta: number | null;
  defaultTicketStatusV2: TicketStatusV2;
};

type BackfillScope = {
  channelId: string;
  workspaceId: string;
  boardId: string;
  createdAfter?: Date;
};

/**
 * Relocated from xyne-spaces-private's controllers/ticketStageBackfillController.ts. Moves one
 * ticket from a source stage to a destination stage: closes the source stage-visit, opens (or
 * reactivates) the destination one, and updates the ticket row. Everything commits atomically so
 * a concurrent stage transition can't interleave with the backfill and leave stage-visit rows
 * inconsistent with the ticket's own stageName. Not called from this (public) repo — it exists
 * here only so xyne-spaces-private's overlay build has a bypass primitive to import, per the
 * repo-coupling rule that no bypass logic may live in the private tree itself.
 */
export function applyStageChangeTx(
  ticketId: string,
  scope: BackfillScope,
  sourceStage: StageDetails,
  destinationStage: StageDetails,
  actorUserId: string,
): Promise<boolean> {
  return transaction(['Ticket', 'TicketStageEta'], 'ticket stage backfill: closing the source stage-visit, opening the destination one and updating the ticket must commit atomically so a concurrent stage transition cannot interleave', db, async tx => {
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
          workspaceId: scope.workspaceId,
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
