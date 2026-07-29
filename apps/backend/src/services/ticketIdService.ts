import { PrismaClient } from '@prisma/client';
import { EntitySequenceService } from '@/services/entitySequenceService';

// Type for Prisma transaction client
type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Service for generating ticket IDs with project-scoped format
 * Format: {PROJECT_CODE}-{number} (e.g., XYNE-0001, EUL-0001)
 */
export class TicketIdService {
  /**
   * Generate a new ticket ID based on project
   * Uses exactly one sequence source, selected by configuration.
   */
  static async generateTicketId(
    tx: PrismaTransaction,
    projectId: string
  ): Promise<string> {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { code: true },
    });

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const sequenceNumber = await EntitySequenceService.getNextProjectTicketSequence(tx, projectId);

    return this.formatProjectScopedId(project.code, sequenceNumber);
  }

  private static formatProjectScopedId(projectCode: string, sequenceNumber: number): string {
    // Format: CODE-0001 (zero-padded to 4 digits)
    return `${projectCode.toUpperCase()}-${String(sequenceNumber).padStart(4, '0')}`;
  }
}
