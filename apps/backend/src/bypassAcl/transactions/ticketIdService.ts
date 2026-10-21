import { TicketIdService } from '@/services/ticketIdService';
import type { PrismaTransaction } from '@/services/ticketIdService';
import { getNextProjectTicketSequence } from '@/bypassAcl/transactions/entitySequenceService';

  /**
   * Generate a new ticket ID based on project
   * Uses exactly one sequence source, selected by configuration.
   */
export async function generateTicketId(tx: PrismaTransaction, projectId: string): Promise<string> {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { code: true },
    });

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const sequenceNumber = await getNextProjectTicketSequence(tx, projectId);

    return TicketIdService.formatProjectScopedId(project.code, sequenceNumber);
  }
