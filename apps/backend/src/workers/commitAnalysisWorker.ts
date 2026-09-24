import { logger } from '@/utils/logger';
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

    queue.process(async (job) => commitAnalysisQueue.processJob(job));

    this.isStarted = true;
    logger.info(`${TAG} Started, ready to process jobs`);
  }
}

export const commitAnalysisWorker = new CommitAnalysisWorker();
