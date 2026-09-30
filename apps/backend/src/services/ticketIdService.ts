import { PrismaClient } from '@prisma/client';
import { EntitySequenceService } from '@/services/entitySequenceService';

// Type for Prisma transaction client
type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Generates ticket IDs. Format: {CODE}-{number} (e.g. EUL-0001).
 * Code + sequence come from the board's TicketNamespace; boards without one
 * (legacy, pre-backfill) fall back to the project's code + sequence.
 */
export class TicketIdService {
  static async generateTicketId(
    tx: PrismaTransaction,
    boardId: string
  ): Promise<string> {
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
        const isDefaultNamespace =
          project?.defaultTicketNamespaceId === board.ticketNamespaceId;
        // Option B: the default namespace draws from the legacy PROJECT_TICKET
        // counter, so its numbers stay continuous with pre-namespace tickets and a
        // rollback to project-based ids can't collide. Non-default namespaces get
        // their own counter.
        const sequenceNumber = isDefaultNamespace
          ? await EntitySequenceService.getNextProjectTicketSequence(tx, board.projectId)
          : await EntitySequenceService.getNextNamespaceTicketSequence(
              tx,
              board.ticketNamespaceId
            );
        return this.formatId(namespace.code, sequenceNumber);
      }
    }

    const project = await tx.project.findUnique({
      where: { id: board.projectId },
      select: { code: true },
    });

    if (!project) {
      throw new Error(`Project not found: ${board.projectId}`);
    }

    const sequenceNumber = await EntitySequenceService.getNextProjectTicketSequence(
      tx,
      board.projectId
    );

    return this.formatId(project.code, sequenceNumber);
  }

  private static formatId(code: string, sequenceNumber: number): string {
    // Format: CODE-0001 (zero-padded to 4 digits)
    return `${code.toUpperCase()}-${String(sequenceNumber).padStart(4, '0')}`;
  }
}
