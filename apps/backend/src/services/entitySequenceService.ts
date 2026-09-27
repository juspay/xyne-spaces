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
 * entityValue holds the id of the entity that owns the counter.
 */
export const SequenceEntityType = {
  PROJECT_TICKET: 'PROJECT_TICKET', // entityValue = projectId; ticket numbering (e.g. XYNE-0001)
  BOARD_STAGE: 'BOARD_STAGE', // entityValue = boardId; monotonic stage sequence numbers
  FORM_FIELD: 'FORM_FIELD', // entityValue = formId; monotonic field sequence numbers
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
  static isCommonEntitySequenceEnabled(): boolean {
    return (
      config.commonDatabase.ticketSequenceEnabled && CommonDatabaseClient.isConfigured()
    );
  }

  static isCommonProjectTicketSequenceEnabled(): boolean {
    return this.isCommonEntitySequenceEnabled();
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
   * Allocate `count` consecutive sequence numbers in one hop and return the
   * inclusive range. Bulk creation needs N numbers up front so its rows can be
   * inserted set-based rather than one allocation per row.
   *
   * Same guarantees as {@link getNextProjectTicketSequence}: the allocation is
   * atomic and is NOT part of the caller's transaction, so a rollback afterwards
   * skips the block — gaps are acceptable, uniqueness is not.
   */
  static async reserveProjectTicketSequenceBlock(
    tx: MainPrismaTransaction,
    projectId: string,
    count: number
  ): Promise<{ start: number; end: number }> {
    if (count <= 0) {
      throw new Error(
        `reserveProjectTicketSequenceBlock requires a positive count, got ${count}`
      );
    }

    if (this.isCommonProjectTicketSequenceEnabled()) {
      try {
        const commonDb = await CommonDatabaseClient.getConnectedInstance();
        // One atomic increment of `count` hands this caller the whole block: the
        // returned value is its last number, so no concurrent caller can be
        // inside the range.
        for (;;) {
          try {
            const result = await commonDb.entitySequence.upsert({
              where: {
                entityType_entityValue: {
                  entityType: SequenceEntityType.PROJECT_TICKET,
                  entityValue: projectId,
                },
              },
              create: {
                entityType: SequenceEntityType.PROJECT_TICKET,
                entityValue: projectId,
                sequenceNumber: count,
              },
              update: { sequenceNumber: { increment: count } },
              select: { sequenceNumber: true },
            });
            return { start: result.sequenceNumber - count + 1, end: result.sequenceNumber };
          } catch (error) {
            // First-use race, same as getNextSequence: retry into the update branch.
            if (isUniqueViolation(error)) continue;
            throw error;
          }
        }
      } catch (error) {
        logger.error(
          `[EntitySequenceService] Common DB block allocation failed for project ${projectId}; falling back to main DB:`,
          error
        );
      }
    }

    const project = await tx.project.update({
      where: { id: projectId },
      data: { ticketSequence: { increment: count } },
      select: { ticketSequence: true },
    });

    return { start: project.ticketSequence - count + 1, end: project.ticketSequence };
  }

  private static async getNextScopedSequence(
    entityType: SequenceEntityType,
    entityValue: string,
    currentMaxSequence: number
  ): Promise<number> {
    if (this.isCommonEntitySequenceEnabled()) {
      try {
        // Once the common sequence is enabled it is the only allocator. Do not
        // derive the next value from live rows: deletions and reordering can
        // leave gaps there, and concurrent writers would otherwise collide.
        return await this.getNextSequence(entityType, entityValue);
      } catch (error) {
        logger.error(
          `[EntitySequenceService] Common DB ${entityType} allocation failed for ${entityValue}:`,
          error
        );
        // These scopes do not have a durable fallback counter in the main DB.
        // Failing the write is safer than recycling a number after a deletion.
        throw error;
      }
    }

    // Legacy fallback used only while the common sequence feature is disabled.
    return Math.max(1, currentMaxSequence + 1);
  }

  static async getNextBoardStageSequence(
    boardId: string,
    currentMaxSequence: number
  ): Promise<number> {
    return this.getNextScopedSequence(
      SequenceEntityType.BOARD_STAGE,
      boardId,
      currentMaxSequence
    );
  }

  static async getNextFormFieldSequence(
    formId: string,
    currentMaxSequence: number
  ): Promise<number> {
    return this.getNextScopedSequence(
      SequenceEntityType.FORM_FIELD,
      formId,
      currentMaxSequence
    );
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
