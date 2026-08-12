import { logger } from '@/utils/logger';
import { runAsServiceActor } from '@/database/tenant/context';
import {
  boardConfigCopyQueue,
  BoardConfigCopyJobData,
  BoardConfigCopySummary,
  BoardConfigCopyTicketRemap,
} from '@/queues/boardConfigCopyQueue';
import { boardConfigCopyService } from '@/services/boardConfigCopyService';

const TAG = '[BoardConfigCopyWorker]';
const BATCH_SIZE = 50;
const DELAY_MS = 1000;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Ticket-migration half of "Copy Board Configuration".
 *
 * The board's configuration — stages, transitions, form binding, roles, metadata — is
 * already committed by the time this runs: the dashboard applies it through the same Zero
 * mutators as an ordinary board edit (`board.update`, `formContextMapping.upsert`,
 * `nonLinear.syncTransitions`). The old stages are therefore already gone, which is exactly
 * why the job payload carries a fully-resolved remap: there is nothing left on the board to
 * derive "where should this ticket go" from.
 *
 * This worker exists solely because the remaining work is per-ticket and unbounded — every
 * ticket on the board may need its stage rewritten, and every ticket may hold custom-field
 * values that must follow the new form.
 */
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
    // The Bull processor runs outside any HTTP request, so there is no ambient tenant
    // context — every db.* call inside processJob would otherwise run fully unscoped (see
    // acl-extension.ts's no-context fallback). runAsServiceActor opens one bound to the
    // job's own workspace, matching etaDeadlineWorker.ts / autoDraftWorker.ts.
    queue.process(async job =>
      runAsServiceActor(job.data.actorUserId, job.data.workspaceId, () => this.processJob(job.data)),
    );
    this.isStarted = true;
    logger.info(`${TAG} Started, ready to process jobs`);
  }

  /**
   * Cursor-paginated sweep that moves every ticket currently sitting on one of the retired
   * stage names onto its resolved destination. Safe to run repeatedly — a ticket that has
   * already moved simply no longer matches the query, and `applyStageRemap` itself
   * re-checks the stage name at write time. Returns how many tickets it actually moved.
   */
  private async remapPass(
    data: BoardConfigCopyJobData,
    destinations: Map<string, BoardConfigCopyTicketRemap>,
    summary: BoardConfigCopySummary,
  ): Promise<number> {
    const stageNames = [...destinations.keys()];
    if (stageNames.length === 0) return 0;

    let movedInPass = 0;
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const tickets = await boardConfigCopyService.findTicketsOnOldStages(
        data.targetBoardId,
        stageNames,
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
        const destination = destinations.get(ticket.stageName);
        if (!destination) {
          summary.errors += 1;
          summary.failedTicketIds.push(ticket.id);
          continue;
        }

        try {
          const result = await boardConfigCopyService.applyStageRemap(
            ticket.id,
            data.targetBoardId,
            destination.oldStageId,
            destination.oldStageName,
            destination,
            data.actorUserId,
          );
          if (result === 'updated') {
            summary.updated += 1;
            movedInPass += 1;
          } else {
            // Either already moved by an earlier pass, or a user moved it out from under
            // us mid-transaction. Both are fine — their change wins.
            summary.skipped += 1;
          }
        } catch (error) {
          summary.errors += 1;
          summary.failedTicketIds.push(ticket.id);
          logger.warn(`${TAG} Failed to remap ticket ${ticket.id}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = tickets[tickets.length - 1]?.id ?? null;
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }

    return movedInPass;
  }

  private async processJob(data: BoardConfigCopyJobData): Promise<BoardConfigCopySummary> {
    logger.info(`${TAG} Starting ticket migration for targetBoardId=${data.targetBoardId}`);

    const summary: BoardConfigCopySummary = {
      batches: 0,
      processed: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      failedTicketIds: [],
      fieldValuesRepointed: 0,
      snapshotPath: data.snapshotPath,
      warnings: [],
    };

    // Custom-field values first: a bulk UPDATE per shared field, independent of the stage
    // remap below, and cheap enough that doing it up front keeps pre-existing tickets
    // editable as early as possible.
    if (data.fieldRepoints.length > 0 && data.targetOldFormId && data.clonedFormId) {
      const { repointed, warnings } = await boardConfigCopyService.repointFormEntityValues(
        data.targetBoardId,
        data.targetOldFormId,
        data.clonedFormId,
        data.fieldRepoints,
        data.actorUserId,
      );
      summary.fieldValuesRepointed = repointed;
      summary.warnings.push(...warnings);
    }

    const destinations = new Map(data.ticketRemap.map(remap => [remap.oldStageName, remap]));

    if (destinations.size > 0) {
      await this.remapPass(data, destinations, summary);

      // One final sweep for anything created on a retired stage name while the main pass
      // was running. Those stages no longer exist, so nothing new can legitimately land on
      // them — this only catches writes that were already in flight when the config changed.
      const healed = await this.remapPass(data, destinations, summary);
      if (healed > 0) {
        summary.warnings.push(
          `${healed} ticket(s) were still being written to a retired stage as it was removed, and were moved onto the new stage set.`,
        );
      }
    }

    logger.info(`${TAG} Completed ticket migration for targetBoardId=${data.targetBoardId}`, summary);
    return summary;
  }
}

export const boardConfigCopyWorker = new BoardConfigCopyWorker();
