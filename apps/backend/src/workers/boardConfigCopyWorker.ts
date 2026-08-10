import Bull from 'bull';
import { logger } from '@/utils/logger';
import {
  boardConfigCopyQueue,
  BoardConfigCopyJobData,
  BoardConfigCopySummary,
  BoardConfigCopyTicketRemapTarget,
} from '@/queues/boardConfigCopyQueue';
import { boardConfigCopyService } from '@/services/boardConfigCopyService';

const TAG = '[BoardConfigCopyWorker]';
const BATCH_SIZE = 50;
const DELAY_MS = 1000;
/**
 * How many times to re-sweep stragglers and re-attempt the delete before giving up and
 * leaving the old stages in place. Each retry only scans for tickets still on an old
 * stage, which is normally zero rows, so this is cheap.
 */
const MAX_DELETE_ATTEMPTS = 3;

/** Where a ticket sitting on a given old stage should land, plus the id of the stage it's leaving. */
interface RemapDestination {
  oldStageId: string;
  target: BoardConfigCopyTicketRemapTarget;
}

type StageSummary = BoardConfigCopySummary['stages'];

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

  /**
   * Landing stage for every old stage on the board, keyed by old stage name (tickets
   * reference stages by name, not id). Old stages that had tickets at plan time use the
   * admin's chosen mapping; ones that were empty then — but that a ticket could still
   * arrive on while the job runs — fall back to a new stage in the same status category,
   * or the first stage in the new set if that category doesn't exist any more.
   */
  private buildDestinationsByOldStageName(data: BoardConfigCopyJobData): Map<string, RemapDestination> {
    const destinations = new Map<string, RemapDestination>();
    const orderedNewStages = [...data.newStages].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    for (const old of data.oldStages) {
      const planned = data.ticketRemapByOldStageId[old.id];
      if (planned) {
        destinations.set(old.name, { oldStageId: old.id, target: planned });
        continue;
      }

      const fallbackStage =
        orderedNewStages.find(s => s.defaultTicketStatusV2 === old.defaultTicketStatusV2) ?? orderedNewStages[0];
      if (!fallbackStage) continue;

      destinations.set(old.name, {
        oldStageId: old.id,
        target: {
          newStageId: fallbackStage.id,
          newStageName: fallbackStage.name,
          newStageEta: fallbackStage.eta,
          newStageStatusV2: fallbackStage.defaultTicketStatusV2,
          futureStagesEtaHours: data.futureStagesEtaHoursByNewStageId[fallbackStage.id] ?? 0,
        },
      });
    }

    return destinations;
  }

  /**
   * Cursor-paginated sweep that moves every ticket currently sitting on one of
   * `stageNames` onto its destination stage. Safe to run repeatedly — a ticket that has
   * already moved simply no longer matches the query, and `applyStageRemap` itself
   * re-checks the stage name at write time. Returns how many tickets it actually moved.
   */
  private async remapPass(
    data: BoardConfigCopyJobData,
    destinations: Map<string, RemapDestination>,
    stageNames: string[],
    summary: StageSummary,
    job: Bull.Job<BoardConfigCopyJobData>,
    progress: { total: number } | null,
  ): Promise<number> {
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
            ticket.stageName,
            destination.target,
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
      if (progress) {
        await job.progress({
          phase: 'REMAP',
          processed: summary.processed,
          total: progress.total,
          batches: summary.batches,
        });
      }

      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }

    return movedInPass;
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

    const destinations = this.buildDestinationsByOldStageName(data);
    const oldStageById = new Map(data.oldStages.map(s => [s.id, s]));
    const plannedStageNames = Object.keys(data.ticketRemapByOldStageId)
      .map(oldStageId => oldStageById.get(oldStageId)?.name)
      .filter((name): name is string => Boolean(name));

    // Ticket identity for a stage is a plain name string (no stageId FK) — when the source
    // and target already share a stage name (e.g. re-running the same copy), a remapped
    // ticket's stageName never changes text even though it correctly now refers to the
    // freshly-inserted row. Names the new stage set still provides are therefore not
    // evidence of a ticket "stuck on an old stage", and must be excluded from both the
    // straggler sweep and the pre-delete safety count.
    const newStageNames = new Set(data.newStages.map(s => s.name));
    const retiredStageNames = data.oldStages.map(s => s.name).filter(name => !newStageNames.has(name));

    const summary: StageSummary = {
      batches: 0,
      processed: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      failedTicketIds: [],
      newStageCount: data.newStages.length,
      deletedOldStageCount: 0,
    };
    const warnings: string[] = [...data.customFieldWarnings];

    // Phase 2: the main batched remap, sized and progress-reported off the planned set.
    if (plannedStageNames.length > 0) {
      const total = await boardConfigCopyService.countTicketsOnOldStages(data.targetBoardId, plannedStageNames);
      await this.remapPass(data, destinations, plannedStageNames, summary, job, { total });
    }

    // Phases 3+4: converge on a delete that is safe at the moment it happens. Rather than
    // failing the whole job when a ticket turns up on an old stage after the main pass,
    // move it and try again — the count that authorises the delete runs inside the delete's
    // own transaction, so this loop only has to handle tickets that arrive between attempts.
    let deleteResult = { deleted: false, remaining: 0 };
    for (let attempt = 1; attempt <= MAX_DELETE_ATTEMPTS; attempt++) {
      await this.remapPass(data, destinations, retiredStageNames, summary, job, null);

      deleteResult = await boardConfigCopyService.deleteOldStagesPhase(
        data.targetBoardId,
        data.oldStages.map(s => s.id),
        retiredStageNames,
        data.newBoardType,
        data.actorUserId,
      );
      if (deleteResult.deleted) break;

      logger.warn(
        `${TAG} Delete attempt ${attempt}/${MAX_DELETE_ATTEMPTS} deferred on board ${data.targetBoardId} — ` +
          `${deleteResult.remaining} ticket(s) arrived on an old stage`,
      );
    }

    if (deleteResult.deleted) {
      summary.deletedOldStageCount = data.oldStages.length;

      // Self-heal: a ticket could have been created on an old stage in the instant between
      // the authorising count and that transaction committing. Its old stage row is gone
      // now, so sweep once more to move it onto the new stage set instead of leaving it
      // pointing at a stage that no longer exists.
      const healed = await this.remapPass(data, destinations, retiredStageNames, summary, job, null);
      if (healed > 0) {
        warnings.push(
          `${healed} ticket(s) landed on an old stage while it was being removed and were moved onto the new stage set.`,
        );
      }
    } else {
      warnings.push(
        `Tickets kept arriving on the old stages, so ${data.oldStages.length} old stage(s) were left in place. ` +
          'The new configuration is fully applied and no ticket data was lost — re-run the copy to finish removing them.',
      );
    }

    logger.info(`${TAG} Completed copy job for targetBoardId=${data.targetBoardId}`, summary);

    return {
      customFieldsCopied: data.customFieldsCopied,
      rolesCopied: data.rolesCopied,
      snapshotPath: data.snapshotPath,
      stages: summary,
      warnings,
    };
  }
}

export const boardConfigCopyWorker = new BoardConfigCopyWorker();
