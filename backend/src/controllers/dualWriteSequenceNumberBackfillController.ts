import { Request, Response } from 'express';
import { db } from '@/database/client';
import { EntitySequenceService, SequenceEntityType } from '@/services/entitySequenceService';
import { CommonDatabaseClient } from '@/database/commonClient';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

type BackfillOptions = {
  entityType: SequenceEntityType;
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
};

type BackfillSummary = {
  entityType: SequenceEntityType;
  batches: number;
  scopesProcessed: number;
  countersWritten: number;
};

const PROJECT_TICKET_SEQUENCE_BACKFILL_OFFSET = 5_000;

export function getProjectTicketSequenceBackfillTarget(currentSequence: number): number {
  return Math.max(
    currentSequence * 3,
    currentSequence + PROJECT_TICKET_SEQUENCE_BACKFILL_OFFSET
  );
}

/**
 * Moves entity sequence state from the main DB into the common DB
 * entity_sequences table:
 *
 * - PROJECT_TICKET: counter = max(project.ticketSequence * 3,
 *   project.ticketSequence + 5,000)
 * - BOARD_STAGE: counter = the board's highest existing stage sequence
 * - FORM_FIELD: counter = the form's highest existing field sequence
 *
 * Scope values are read once and written in bounded batches (with an optional
 * delayMs between batches). Every write goes through setSequenceAtLeast, so
 * re-runs are idempotent and can never lower a live counter.
 */
export class DualWriteSequenceNumberBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = body as Partial<{
      entityType: string;
      batchSize: number;
      delayMs: number;
      dryRun: boolean;
    }>;

    const entityType = payload.entityType as SequenceEntityType;
    if (!entityType || !Object.values(SequenceEntityType).includes(entityType)) {
      throw new Error(
        `entityType is required and must be one of: ${Object.values(SequenceEntityType).join(', ')}`
      );
    }

    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 100;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 1000;
    const dryRun = payload.dryRun === true;

    return { entityType, batchSize, delayMs, dryRun };
  }

  private static async writeBatch(
    options: BackfillOptions,
    summary: BackfillSummary,
    counters: Array<{ entityValue: string; sequenceNumber: number }>
  ): Promise<void> {
    if (!options.dryRun) {
      await Promise.all(
        counters.map(counter =>
          EntitySequenceService.setSequenceAtLeast(
            options.entityType,
            counter.entityValue,
            counter.sequenceNumber
          )
        )
      );
    }
    summary.countersWritten += counters.length;
  }

  private static async writeCounters(
    options: BackfillOptions,
    summary: BackfillSummary,
    counters: Array<{ entityValue: string; sequenceNumber: number }>
  ): Promise<void> {
    for (let start = 0; start < counters.length; start += options.batchSize) {
      const batch = counters.slice(start, start + options.batchSize);
      await this.writeBatch(options, summary, batch);

      summary.scopesProcessed += batch.length;
      summary.batches += 1;
      this.logBatch(options, summary);

      const hasAnotherBatch = start + options.batchSize < counters.length;
      if (hasAnotherBatch && options.delayMs > 0) {
        await this.sleep(options.delayMs);
      }
    }
  }

  private static logBatch(options: BackfillOptions, summary: BackfillSummary): void {
    logger.info(`[DualWriteSequenceNumberBackfill] Batch #${summary.batches} completed`, {
      entityType: options.entityType,
      scopesProcessed: summary.scopesProcessed,
      countersWritten: summary.countersWritten,
      dryRun: options.dryRun,
    });
  }

  private static async backfillProjectTickets(
    options: BackfillOptions,
    summary: BackfillSummary
  ): Promise<void> {
    const projects: Array<{ id: string; ticketSequence: number }> = await db.project.findMany({
      where: { ticketSequence: { gt: 0 } },
      select: { id: true, ticketSequence: true },
      orderBy: { id: 'asc' },
    });

    await this.writeCounters(
      options,
      summary,
      projects.map(project => ({
        entityValue: project.id,
        sequenceNumber: getProjectTicketSequenceBackfillTarget(project.ticketSequence),
      }))
    );
  }

  private static async backfillBoardStages(
    options: BackfillOptions,
    summary: BackfillSummary
  ): Promise<void> {
    const boards: Array<{ id: string; stages: Array<{ sequenceNumber: number }> }> =
      await db.board.findMany({
        where: { stages: { some: {} } },
        select: {
          id: true,
          stages: {
            select: { sequenceNumber: true },
            orderBy: { sequenceNumber: 'desc' },
            take: 1,
          },
        },
        orderBy: { id: 'asc' },
      });

    await this.writeCounters(
      options,
      summary,
      boards.map(board => ({
        entityValue: board.id,
        sequenceNumber: board.stages[0].sequenceNumber,
      }))
    );
  }

  private static async backfillFormFields(
    options: BackfillOptions,
    summary: BackfillSummary
  ): Promise<void> {
    const forms: Array<{ id: string; fields: Array<{ sequenceNumber: number }> }> =
      await db.form.findMany({
        where: { fields: { some: {} } },
        select: {
          id: true,
          fields: {
            select: { sequenceNumber: true },
            orderBy: { sequenceNumber: 'desc' },
            take: 1,
          },
        },
        orderBy: { id: 'asc' },
      });

    await this.writeCounters(
      options,
      summary,
      forms.map(form => ({
        entityValue: form.id,
        sequenceNumber: form.fields[0].sequenceNumber,
      }))
    );
  }

  private static async runBackfill(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = {
      entityType: options.entityType,
      batches: 0,
      scopesProcessed: 0,
      countersWritten: 0,
    };

    switch (options.entityType) {
      case SequenceEntityType.PROJECT_TICKET:
        await this.backfillProjectTickets(options, summary);
        break;
      case SequenceEntityType.BOARD_STAGE:
        await this.backfillBoardStages(options, summary);
        break;
      case SequenceEntityType.FORM_FIELD:
        await this.backfillFormFields(options, summary);
        break;
    }

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>) {
    let options: BackfillOptions;
    try {
      options = DualWriteSequenceNumberBackfillController.buildOptions(req.body);
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid request body',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      if (!options.dryRun && !(await CommonDatabaseClient.connect())) {
        res.status(503).json({
          success: false,
          error: 'Common database is not configured or unavailable',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      logger.info('[DualWriteSequenceNumberBackfill] Starting backfill', options);

      const results = await DualWriteSequenceNumberBackfillController.runBackfill(options);

      res.status(200).json({
        success: true,
        message: options.dryRun ? 'Dry run completed' : 'Backfill completed',
        data: { options, results },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[DualWriteSequenceNumberBackfill] Error during backfill:', error);
      res.status(500).json({
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to run sequence number backfill',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
