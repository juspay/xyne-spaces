import Bull from 'bull';
import { logger } from '@/utils/logger';
import { boardConfigCopyQueue, BoardConfigCopyJobData, BoardConfigCopySummary } from '@/queues/boardConfigCopyQueue';
import { boardConfigCopyService } from '@/services/boardConfigCopyService';

const TAG = '[BoardConfigCopyWorker]';
const BATCH_SIZE = 50;
const DELAY_MS = 1000;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

class BoardConfigCopyWorker {
  private isStarted = false;

  /**
   * Registers the job processor on the already-initialized queue. Intentionally run
   * inside the same process as the API server (not the separate worker.ts process) —
   * this is an occasional, admin-triggered operation, not a high-throughput hot path,
   * so it doesn't need its own scaled worker deployment.
   */
  start(): void {
    if (this.isStarted) return;

    const queue = boardConfigCopyQueue.getQueue();
    queue.process(async job => this.processJob(job.data, job));
    this.isStarted = true;
    logger.info(`${TAG} Started, ready to process jobs`);
  }

  private async processJob(
    data: BoardConfigCopyJobData,
    job: Bull.Job<BoardConfigCopyJobData>,
  ): Promise<BoardConfigCopySummary> {
    logger.info(`${TAG} Starting copy job for targetBoardId=${data.targetBoardId}`);

    // Phase 1: insert the new (copied-from-source) stages/transitions onto the target
    // board. Old stages are left in place — both sets briefly coexist so every ticket's
    // stageName always resolves to a real, currently-persisted Stage row.
    await boardConfigCopyService.insertNewStagesPhase(data);

    // Phase 2: batched ticket remap.
    const oldStageById = new Map(data.oldStages.map(s => [s.id, s]));
    const oldStageIdByName = new Map(data.oldStages.map(s => [s.name, s.id]));
    const remapOldStageNames = Object.keys(data.ticketRemapByOldStageId)
      .map(oldStageId => oldStageById.get(oldStageId)?.name)
      .filter((name): name is string => Boolean(name));

    const summary = {
      batches: 0,
      processed: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      failedTicketIds: [] as string[],
      newStageCount: data.newStages.length,
      deletedOldStageCount: data.oldStages.length,
    };

    if (remapOldStageNames.length > 0) {
      // Precompute the total once so progress reporting (and the frontend's progress
      // bar, which renders processed/total) has a denominator from the first batch on.
      const total = await boardConfigCopyService.countTicketsOnOldStages(
        data.targetBoardId,
        remapOldStageNames,
      );

      let cursor: string | null = null;
      let hasMore = true;

      while (hasMore) {
        const tickets = await boardConfigCopyService.findTicketsOnOldStages(
          data.targetBoardId,
          remapOldStageNames,
          cursor,
          BATCH_SIZE,
        );

        if (tickets.length === 0) {
          hasMore = false;
          continue;
        }
        summary.batches += 1;

        for (const ticket of tickets) {
          summary.processed += 1;
          const oldStageId = oldStageIdByName.get(ticket.stageName);
          const target = oldStageId ? data.ticketRemapByOldStageId[oldStageId] : undefined;
          if (!oldStageId || !target) {
            summary.errors += 1;
            summary.failedTicketIds.push(ticket.id);
            continue;
          }

          try {
            const result = await boardConfigCopyService.applyStageRemap(
              ticket.id,
              data.targetBoardId,
              oldStageId,
              ticket.stageName,
              target,
              data.actorUserId,
            );
            if (result === 'updated') summary.updated += 1;
            else summary.skipped += 1;
          } catch (error) {
            summary.errors += 1;
            summary.failedTicketIds.push(ticket.id);
            logger.warn(`${TAG} Failed to remap ticket ${ticket.id}`, {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        cursor = tickets[tickets.length - 1]?.id ?? null;
        await job.progress({
          phase: 'REMAP',
          processed: summary.processed,
          total,
          batches: summary.batches,
        });

        if (DELAY_MS > 0) await sleep(DELAY_MS);
      }
    }

    // Phase 3: verify no ticket still points at a stage we're about to delete.
    const oldStageNames = data.oldStages.map(s => s.name);
    const remaining = await boardConfigCopyService.countTicketsOnOldStages(data.targetBoardId, oldStageNames);
    if (remaining > 0) {
      throw new Error(
        `${remaining} ticket(s) still reference an old stage after the remap pass — aborting before deleting stages. Re-run the copy to retry.`,
      );
    }

    // Phase 4: delete old stages and flip the target board's boardType to match source.
    await boardConfigCopyService.deleteOldStagesPhase(
      data.targetBoardId,
      data.oldStages.map(s => s.id),
      data.newBoardType,
      data.actorUserId,
    );

    logger.info(`${TAG} Completed copy job for targetBoardId=${data.targetBoardId}`, summary);

    return {
      customFieldsCopied: false,
      rolesCopied: false,
      stages: summary,
      warnings: [],
    };
  }
}

export const boardConfigCopyWorker = new BoardConfigCopyWorker();
