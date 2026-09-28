import { transaction } from '../base';
import { db } from '@/database/client';
import { calculateETADeadline, recomputeOverallTicketEta } from '@/utils/etaCalculation';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';


export function applyStageRemapTx(ticketId: string, targetBoardId: string, oldStageName: string, target: { newStageId: string; newStageName: string; newStageEta: number | null; newStageStatusV2: string; futureStagesEtaHours: number; }, actorUserId: string, oldStageId: string) {
  return transaction(['Conversation', 'Ticket', 'TicketStageEta'], 'applyStageRemap: ticket stage remap, ETA ledger update and conversation markdown sync must commit atomically; tx is not ACL-wrapped', db, async tx => {
    const ticket = await tx.ticket.findFirst({
      where: { id: ticketId, boardId: targetBoardId, stageName: oldStageName },
      select: { id: true, workspaceId: true, statusV2: true },
    });
    if (!ticket) return 'skipped';

    const now = new Date();

    const targetStageEta =
      target.newStageEta !== null && target.newStageEta > 0 ? calculateETADeadline(now, target.newStageEta) : now;
    const recomputedEta = recomputeOverallTicketEta(targetStageEta, now, target.futureStagesEtaHours);
    const statusChanged = ticket.statusV2 !== target.newStageStatusV2;

    // Compare-and-swap: re-assert `stageName: oldStageName` at write time instead of
    // trusting the read above. If a user moved this ticket through the UI in between,
    // Postgres re-evaluates the predicate against their committed row and matches zero
    // rows — the human's change wins and the job leaves it alone. This runs before the
    // ETA-ledger writes so the lost-the-race path has no side effects to undo.
    const { count } = await tx.ticket.updateMany({
      where: { id: ticket.id, boardId: targetBoardId, stageName: oldStageName },
      data: {
        stageName: target.newStageName,
        statusV2: target.newStageStatusV2,
        ...(statusChanged ? { statusUpdatedAt: now } : {}),
        ...(recomputedEta ? { eta: recomputedEta } : {}),
        updatedBy: actorUserId,
        updatedAt: now,
      },
    });
    if (count === 0) return 'skipped';

    await tx.ticketStageEta.updateMany({
      where: { ticketId: ticket.id, stageId: oldStageId, stageLeftAt: null },
      data: { stageLeftAt: now, updatedAt: now, updatedBy: actorUserId },
    });

    const existing = await tx.ticketStageEta.findFirst({
      where: { ticketId: ticket.id, stageId: target.newStageId },
    });
    if (existing) {
      await tx.ticketStageEta.update({
        where: { id: existing.id },
        data: {
          stageEnteredAt: now,
          stageLeftAt: null,
          ...(target.newStageEta !== null && target.newStageEta > 0 ? { stageEta: targetStageEta } : {}),
          updatedAt: now,
          updatedBy: actorUserId,
        },
      });
    } else if (target.newStageEta !== null && target.newStageEta > 0) {
      await tx.ticketStageEta.create({
        data: {
          ticketId: ticket.id,
          workspaceId: ticket.workspaceId,
          stageId: target.newStageId,
          stageEnteredAt: now,
          stageLeftAt: null,
          stageEta: targetStageEta,
          updatedBy: actorUserId,
        },
      });
    }

    // updateMany doesn't return the row, so re-read it for the markdown sync.
    const updatedTicket = await tx.ticket.findUnique({ where: { id: ticket.id } });
    if (updatedTicket) await syncConversationTicketMdFromPrismaTicket(tx, updatedTicket);

    return 'updated';
  });
}
