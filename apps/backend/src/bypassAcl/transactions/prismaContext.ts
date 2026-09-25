import type { Prisma } from '@prisma/client';
import { parseBoardEtaManagement } from '@xyne/shared';
import type { LoadedBoardEtaContext } from '@/services/etaManagement/prismaContext';

/**
 * Shared Prisma data-loading glue for the domain service's Prisma call
 * sites (TicketStageTransitionService, ticketRepository). Loads exactly
 * what `evaluateEta`'s pure functions need - board type/config, all stages,
 * all transitions - within the caller's own transaction client so the read
 * is consistent with whatever the caller is about to write.
 */
export async function loadBoardEtaContext(
  tx: Prisma.TransactionClient,
  boardId: string,
): Promise<LoadedBoardEtaContext> {
  const board = await tx.board.findUnique({ where: { id: boardId } });
  if (!board) {
    throw new Error(`Board ${boardId} not found while loading ETA context`);
  }

  const [stages, transitions] = await Promise.all([
    tx.stage.findMany({
      where: { boardId },
      select: { id: true, sequenceNumber: true, eta: true },
    }),
    tx.stageTransition.findMany({ where: { boardId } }),
  ]);

  return {
    boardType: board.boardType,
    boardEtaManagement: parseBoardEtaManagement(board.metadata, board.boardType),
    stages,
    transitions,
  };
}
