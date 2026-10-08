import { TicketIdService } from '@/services/ticketIdService';
import type { PrismaTransaction } from '@/services/ticketIdService';
import {
  getNextNamespaceTicketSequence,
  getNextProjectTicketSequence,
} from '@/bypassAcl/transactions/entitySequenceService';

  /**
   * Generate a new ticket ID for a board. Code + sequence come from the board's
   * TicketNamespace; boards without one (pre-backfill) fall back to the project.
   */
export async function generateTicketId(tx: PrismaTransaction, boardId: string): Promise<string> {
    const board = await tx.board.findUnique({
      where: { id: boardId },
      select: { projectId: true, ticketNamespaceId: true },
    });

    if (!board) {
      throw new Error(`Board not found: ${boardId}`);
    }

    if (board.ticketNamespaceId) {
      const namespace = await tx.ticketNamespace.findUnique({
        where: { id: board.ticketNamespaceId },
        select: { code: true },
      });
      if (namespace) {
        const project = await tx.project.findUnique({
          where: { id: board.projectId },
          select: { defaultTicketNamespaceId: true },
        });
        // The default namespace draws from the legacy PROJECT_TICKET counter so its
        // numbers stay continuous; other namespaces get their own counter.
        const sequenceNumber =
          project?.defaultTicketNamespaceId === board.ticketNamespaceId
            ? await getNextProjectTicketSequence(tx, board.projectId)
            : await getNextNamespaceTicketSequence(tx, board.ticketNamespaceId);
        return TicketIdService.formatProjectScopedId(namespace.code, sequenceNumber);
      }
    }

    const project = await tx.project.findUnique({
      where: { id: board.projectId },
      select: { code: true },
    });

    if (!project) {
      throw new Error(`Project not found: ${board.projectId}`);
    }

    const sequenceNumber = await getNextProjectTicketSequence(tx, board.projectId);

    return TicketIdService.formatProjectScopedId(project.code, sequenceNumber);
  }
