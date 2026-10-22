import Bull from 'bull';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import {
  closePollForLifecycle,
  findPollsWithPendingLifecycle,
  remindPollNonVotersForLifecycle,
} from '@/bypassAcl/pollLifecycleServices';
import {
  POLL_LIFECYCLE_JOB_OPTIONS,
  POLL_LIFECYCLE_QUEUE_NAME,
  addPollLifecycleJobs,
  type PollLifecycleJobData,
} from '@/queues/pollLifecycleQueue';

const POLL_LIFECYCLE_CONCURRENCY = 3;

async function processPollLifecycleJob(data: PollLifecycleJobData): Promise<void> {
  await (data.kind === 'CLOSE'
    ? closePollForLifecycle(data.pollId)
    : remindPollNonVotersForLifecycle(data.pollId));
}

class PollLifecycleWorker {
  private queue: Bull.Queue<PollLifecycleJobData> | null = null;
  private isProcessorRegistered = false;

  private getQueue(): Bull.Queue<PollLifecycleJobData> {
    this.queue ??= new Bull<PollLifecycleJobData>(POLL_LIFECYCLE_QUEUE_NAME, {
      redis: { ...redisService.getRedisConfig(), lazyConnect: false },
      defaultJobOptions: POLL_LIFECYCLE_JOB_OPTIONS,
      settings: {
        stalledInterval: 30 * 1000,
        maxStalledCount: 1,
      },
    });
    return this.queue;
  }

  async start(): Promise<void> {
    if (this.isProcessorRegistered) return;
    const queue = this.getQueue();
    this.isProcessorRegistered = true;
    void queue.process(POLL_LIFECYCLE_CONCURRENCY, job => processPollLifecycleJob(job.data));
    queue.on('failed', (job, err) => {
      logger.error(`[POLL-LIFECYCLE] Job ${job.id} failed`, { data: job.data, error: err });
    });
    logger.info('[POLL-LIFECYCLE] Started');
  }

  /** `polls` is the durable record. Bull dedupes by jobId, so re-adding a queued job is a no-op. */
  async reenqueuePendingPolls(): Promise<void> {
    const queue = this.getQueue();
    const polls = await findPollsWithPendingLifecycle();
    for (const poll of polls) {
      await addPollLifecycleJobs(queue, poll);
    }
    logger.info(`[POLL-LIFECYCLE] Re-enqueue complete: ${polls.length} poll(s)`);
  }

  /** Bull's close() waits for in-flight jobs before resolving. */
  async shutdown(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    this.isProcessorRegistered = false;
    logger.info('[POLL-LIFECYCLE] Shut down');
  }
}

export const pollLifecycleWorker = new PollLifecycleWorker();
