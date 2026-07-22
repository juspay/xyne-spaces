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
  skipped: number;
};

const PROJECT_TICKET_SEQUENCE_BACKFILL_OFFSET = 5_000;

export function getProjectTicketSequenceBackfillTarget(currentSequence: number): number {
  return Math.max(
    currentSequence * 3,
    currentSequence + PROJECT_TICKET_SEQUENCE_BACKFILL_OFFSET
  );
}

/**
 * Moves project ticket sequence state from the main DB into the common DB
 * entity_sequences table:
 *
 * - PROJECT_TICKET: counter = max(project.ticketSequence * 3,
 *   project.ticketSequence + 5,000)
 *
 * Reads are keyset-paginated (batchSize per page, optional delayMs between
 * pages) and every write goes through setSequenceAtLeast, so re-runs are
 * idempotent and can never lower a counter that live traffic has advanced.
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
      for (const counter of counters) {
        await EntitySequenceService.setSequenceAtLeast(
          options.entityType,
          counter.entityValue,
          counter.sequenceNumber
        );
      }
    }
    summary.countersWritten += counters.length;
  }

  private static logBatch(options: BackfillOptions, summary: BackfillSummary): void {
    logger.info(`[DualWriteSequenceNumberBackfill] Batch #${summary.batches} completed`, {
      entityType: options.entityType,
      scopesProcessed: summary.scopesProcessed,
      countersWritten: summary.countersWritten,
      skipped: summary.skipped,
      dryRun: options.dryRun,
    });
  }

  private static async backfillProjectTickets(
    options: BackfillOptions,
    summary: BackfillSummary
  ): Promise<void> {
    let cursor: string | null = null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const projects: Array<{ id: string; ticketSequence: number }> = await db.project.findMany({
        where: { ticketSequence: { gt: 0 } },
        select: { id: true, ticketSequence: true },
        orderBy: { id: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (projects.length === 0) break;

      await this.writeBatch(
        options,
        summary,
        projects.map(project => ({
          entityValue: project.id,
          sequenceNumber: getProjectTicketSequenceBackfillTarget(project.ticketSequence),
        }))
      );

      summary.scopesProcessed += projects.length;
      summary.batches += 1;
      cursor = projects[projects.length - 1].id;
      this.logBatch(options, summary);

      if (projects.length < options.batchSize) break;
      if (options.delayMs > 0) await this.sleep(options.delayMs);
    }
  }

  private static async runBackfill(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = {
      entityType: options.entityType,
      batches: 0,
      scopesProcessed: 0,
      countersWritten: 0,
      skipped: 0,
    };

    await this.backfillProjectTickets(options, summary);

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
