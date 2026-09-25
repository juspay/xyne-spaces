import { PrismaClient } from '@prisma/client';

// Type for Prisma transaction client
export type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Service for generating ticket IDs with project-scoped format
 * Format: {PROJECT_CODE}-{number} (e.g., XYNE-0001, EUL-0001)
 */
export class TicketIdService {

  static formatProjectScopedId(projectCode: string, sequenceNumber: number): string {
    // Format: CODE-0001 (zero-padded to 4 digits)
    return `${projectCode.toUpperCase()}-${String(sequenceNumber).padStart(4, '0')}`;
  }
}
