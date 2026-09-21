import { logger } from '@/utils/logger';
import { runAsServiceActor } from '@/database/tenant/context';
import { commitAnalysisQueue } from '@/queues/commitAnalysisQueue';

const TAG = '[CommitAnalysisWorker]';

/**
 * Worker for processing commit analysis jobs from the queue.
 * Matches the pattern used by boardConfigCopyWorker.
 */
class CommitAnalysisWorker {
  private isStarted = false;

  /**
   * Registers the job processor on the already-initialized queue.
   */
  start(): void {
    if (this.isStarted) return;

    const queue = commitAnalysisQueue.getQueue();

    // Register processor with workspace context
    queue.process(async (job) =>
      runAsServiceActor('commit-analysis-worker', job.data.workspaceId, () =>
        commitAnalysisQueue.processJob(job),
      ),
    );

    this.isStarted = true;
    logger.info(`${TAG} Started, ready to process jobs`);
  }
}

export const commitAnalysisWorker = new CommitAnalysisWorker();
