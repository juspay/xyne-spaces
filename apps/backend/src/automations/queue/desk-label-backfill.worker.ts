import type Bull from 'bull';
import { logger } from '@/utils/logger';
import { runAsServiceActor } from '@/database/tenant/context';
import {
  resolveBackfillRule,
  runDeskLabelBackfill,
} from '../services/desk-label-backfill.service';
import {
  DESK_LABEL_BACKFILL_JOB,
  deskLabelBackfillQueue,
  type DeskLabelBackfillJobData,
} from './desk-label-backfill.queue';

class DeskLabelBackfillWorker {
  private isInitialized = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await deskLabelBackfillQueue.initialize();
    if (!deskLabelBackfillQueue.isReady) {
      logger.error('[DESK-LABEL-BACKFILL-WORKER] Queue not ready — aborting start');
      return;
    }

    // Concurrency 1: the run is a sequential write loop, and one backfill
    // saturating the DB would slow every live automation on the box.
    deskLabelBackfillQueue
      .getQueue()
      .process(DESK_LABEL_BACKFILL_JOB, 1, (job: Bull.Job<DeskLabelBackfillJobData>) =>
        this.processJob(job),
      );

    this.isInitialized = true;
    logger.info('[DESK-LABEL-BACKFILL-WORKER] Started');
  }

  private async processJob(job: Bull.Job<DeskLabelBackfillJobData>): Promise<void> {
    const { workflowId } = job.data;

    // Read the rule fresh: it may have been disabled, archived, or retargeted
    // between the click and the job running.
    const rule = await resolveBackfillRule(workflowId);
    if (!rule) {
      logger.info(
        `[DESK-LABEL-BACKFILL-WORKER] automation=${workflowId} is not an active desk label rule — dropping`,
      );
      return;
    }

    logger.info(
      `[DESK-LABEL-BACKFILL-WORKER] Job ${job.id} starting — automation=${workflowId} channel=${rule.channelId} label=${rule.labelId}`,
    );

    // Background job → no HTTP tenant scope. Open one from the rule's workspace so
    // every write in the run gets workspaceId stamped.
    const progress = await runAsServiceActor('desk-label-backfill', rule.workspaceId, () =>
      runDeskLabelBackfill(rule, next => {
        void job.progress(next);
      }),
    );

    // The final progress is what the rules list reads back, so publish it even
    // when the run stopped short.
    void job.progress(progress);

    logger.info(
      `[DESK-LABEL-BACKFILL-WORKER] ${progress.stoppedEarly ? 'Stopped early' : 'Completed'} automation=${workflowId} scanned=${progress.scanned} matched=${progress.matched} labeled=${progress.labeled} alreadyLabeled=${progress.alreadyLabeled} archived=${progress.archived} skipped=${progress.skipped}`,
    );
  }

  async shutdown(): Promise<void> {
    await deskLabelBackfillQueue.close();
    this.isInitialized = false;
  }
}

export const deskLabelBackfillWorker = new DeskLabelBackfillWorker();
