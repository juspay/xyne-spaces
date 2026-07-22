import { Prisma as CommonPrisma } from '../../prisma-common/generated/client';
import { PrismaClient } from '@prisma/client';
import { config } from '@/config/env';
import { CommonDatabaseClient } from '@/database/commonClient';
import { logger } from '@/utils/logger';

type MainPrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof CommonPrisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

/**
 * Sequence scopes stored in the common DB entity_sequences table.
 * entityValue holds the scoping project id.
 */
export const SequenceEntityType = {
  PROJECT_TICKET: 'PROJECT_TICKET', // entityValue = projectId; ticket numbering (e.g. XYNE-0001)
} as const;

export type SequenceEntityType =
  (typeof SequenceEntityType)[keyof typeof SequenceEntityType];

/**
 * Centralized entity sequence counters backed by the common DB.
 *
 * Note: allocations are NOT part of any main-DB transaction. If the caller's
 * transaction rolls back after allocating, the number is skipped — gaps are
 * acceptable; uniqueness and monotonicity per scope are guaranteed.
 */
export class EntitySequenceService {
  static isCommonProjectTicketSequenceEnabled(): boolean {
    return (
      config.commonDatabase.ticketSequenceEnabled && CommonDatabaseClient.isConfigured()
    );
  }

  static async getNextProjectTicketSequence(
    tx: MainPrismaTransaction,
    projectId: string
  ): Promise<number> {
    if (this.isCommonProjectTicketSequenceEnabled()) {
      try {
        return await this.getNextSequence(SequenceEntityType.PROJECT_TICKET, projectId);
      } catch (error) {
        logger.error(
          `[EntitySequenceService] Common DB ticket allocation failed for project ${projectId}; falling back to main DB:`,
          error
        );
      }
    }

    const project = await tx.project.update({
      where: { id: projectId },
      data: { ticketSequence: { increment: 1 } },
      select: { ticketSequence: true },
    });

    return project.ticketSequence;
  }

  /**
   * Atomically allocate the next sequence number for a scope.
   * Creates the counter row on first use (first allocation returns 1).
   *
   * options.atLeast lets callers self-heal a stale counter: the allocated
   * number is guaranteed to be >= atLeast (use currentMax + 1 when appending
   * to rows whose numbers may have been rewritten outside this service,
   * e.g. pre-migration project data).
   */
  static async getNextSequence(
    entityType: SequenceEntityType,
    entityValue: string,
    options?: { atLeast?: number }
  ): Promise<number> {
    const commonDb = await CommonDatabaseClient.getConnectedInstance();
    const atLeast = options?.atLeast ?? 1;

    // CAS-style loop built from atomic operations only, so two concurrent
    // callers can never be handed the same number. Each retry means another
    // caller made progress, so the loop terminates quickly in practice.
    for (;;) {
      let allocated: number;
      try {
        const result = await commonDb.entitySequence.upsert({
          where: { entityType_entityValue: { entityType, entityValue } },
          create: {
            entityType,
            entityValue,
            sequenceNumber: Math.max(1, atLeast),
          },
          update: { sequenceNumber: { increment: 1 } },
          select: { sequenceNumber: true },
        });
        allocated = result.sequenceNumber;
      } catch (error) {
        // First-use race: another caller created the row between Prisma's
        // read and insert. Retry — the update branch takes over.
        if (isUniqueViolation(error)) continue;
        throw error;
      }

      if (allocated >= atLeast) {
        return allocated;
      }

      // Counter was behind `atLeast` (rows numbered outside this service,
      // e.g. pre-migration data). Conditionally raise it: the WHERE clause
      // guarantees at most one concurrent caller wins and claims `atLeast`;
      // losers loop and re-increment on the raised counter.
      const healed = await commonDb.entitySequence.updateMany({
        where: { entityType, entityValue, sequenceNumber: { lt: atLeast } },
        data: { sequenceNumber: atLeast },
      });
      if (healed.count > 0) {
        return atLeast;
      }
    }
  }

  /**
   * Read the last allocated sequence number without incrementing (0 if none).
   */
  static async peekSequence(
    entityType: SequenceEntityType,
    entityValue: string
  ): Promise<number> {
    const commonDb = await CommonDatabaseClient.getConnectedInstance();
    const row = await commonDb.entitySequence.findUnique({
      where: { entityType_entityValue: { entityType, entityValue } },
      select: { sequenceNumber: true },
    });
    return row?.sequenceNumber ?? 0;
  }

  /**
   * Force a counter to a specific value (used by migrations/backfills).
   * Future getNextSequence calls return sequenceNumber + 1 onwards.
   */
  static async setSequence(
    entityType: SequenceEntityType,
    entityValue: string,
    sequenceNumber: number
  ): Promise<void> {
    const commonDb = await CommonDatabaseClient.getConnectedInstance();
    await commonDb.entitySequence.upsert({
      where: { entityType_entityValue: { entityType, entityValue } },
      update: { sequenceNumber },
      create: { entityType, entityValue, sequenceNumber },
    });
  }

  /**
   * Set a counter to at least a specific value, but never lower an existing
   * counter. Built from atomic operations (create-if-missing, then a
   * conditional raise), so it is safe to call concurrently with
   * getNextSequence — this is the sync primitive for business paths.
   */
  static async setSequenceAtLeast(
    entityType: SequenceEntityType,
    entityValue: string,
    sequenceNumber: number
  ): Promise<void> {
    const commonDb = await CommonDatabaseClient.getConnectedInstance();
    try {
      await commonDb.entitySequence.upsert({
        where: { entityType_entityValue: { entityType, entityValue } },
        create: { entityType, entityValue, sequenceNumber },
        update: {}, // row exists — the conditional raise below handles it
      });
    } catch (error) {
      // First-use race: the row appeared between Prisma's read and insert.
      // Fine — fall through to the conditional raise.
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }

    // Only ever raises: rows at or above the target don't match the WHERE.
    await commonDb.entitySequence.updateMany({
      where: { entityType, entityValue, sequenceNumber: { lt: sequenceNumber } },
      data: { sequenceNumber },
    });
  }
}
