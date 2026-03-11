import { PrismaClient } from '@prisma/client';

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
   * Uses atomic increment on project.ticketSequence to avoid race conditions
   */
  static async generateTicketId(
    tx: PrismaTransaction,
    projectId: string
  ): Promise<string> {
    const project = await tx.project.findUnique({
      where: { id: projectId }
    });

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // Generate project-scoped ID using atomic increment
    return this.generateProjectScopedId(tx, projectId, project.code);
  }

  /**
   * Generate project-scoped ID: {CODE}-{number}
   * Uses atomic increment on project.ticketSequence to avoid race conditions
   */
  private static async generateProjectScopedId(
    tx: PrismaTransaction,
    projectId: string,
    projectCode: string
  ): Promise<string> {
    // Atomic increment: UPDATE projects SET ticketSequence = ticketSequence + 1
    const updatedProject = await tx.project.update({
      where: { id: projectId },
      data: {
        ticketSequence: {
          increment: 1
        }
      }
    });

    // Format: CODE-0001 (zero-padded to 4 digits)
    const sequenceNumber = updatedProject.ticketSequence;
    return `${projectCode.toUpperCase()}-${String(sequenceNumber).padStart(4, '0')}`;
  }
}
