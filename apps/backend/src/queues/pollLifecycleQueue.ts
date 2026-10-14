import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

export const POLL_LIFECYCLE_QUEUE_NAME = 'poll-lifecycle';

export type PollLifecycleJobKind = 'CLOSE' | 'REMIND';

export interface PollLifecycleJobData {
  pollId: string;
  kind: PollLifecycleJobKind;
}

/** The durable schedule of a poll, as stored on `polls.closesAt` / `polls.remindAt`. */
export interface PollLifecycleSchedule {
  id: string;
  closesAt: Date | null;
  remindAt: Date | null;
}

/** One job per poll and kind: Bull ignores an add whose jobId already exists. */
export function pollLifecycleJobId(kind: PollLifecycleJobKind, pollId: string): string {
  return `${kind === 'CLOSE' ? 'poll-close' : 'poll-remind'}:${pollId}`;
}

export const POLL_LIFECYCLE_JOB_OPTIONS: Bull.JobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000,
  },
  removeOnComplete: true,
  removeOnFail: true,
};

/** Enqueue the close and reminder jobs a poll's schedule calls for. */
export async function addPollLifecycleJobs(
  queue: Bull.Queue<PollLifecycleJobData>,
  poll: PollLifecycleSchedule,
): Promise<void> {
  const jobs: Array<[PollLifecycleJobKind, Date | null]> = [
    ['CLOSE', poll.closesAt],
    ['REMIND', poll.remindAt],
  ];
  for (const [kind, runAt] of jobs) {
    if (!runAt) continue;
    const delay = Math.max(0, runAt.getTime() - Date.now());
    await queue.add(
      { pollId: poll.id, kind },
      { jobId: pollLifecycleJobId(kind, poll.id), delay },
    );
    logger.info(`[POLL-LIFECYCLE-QUEUE] Enqueued ${kind} pollId=${poll.id} delayMs=${delay}`);
  }
}

class PollLifecycleQueue {
  private queue: Bull.Queue<PollLifecycleJobData> | null = null;
  private initPromise: Promise<void> | null = null;

  /** Producers live in the API (side effects) and in the delayed-message worker, so connect on first use. */
  async initialize(): Promise<void> {
    if (this.queue) return;
    this.initPromise ??= (async () => {
      this.queue = new Bull<PollLifecycleJobData>(POLL_LIFECYCLE_QUEUE_NAME, {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: POLL_LIFECYCLE_JOB_OPTIONS,
      });
      this.queue.on('error', err => {
        logger.error('[POLL-LIFECYCLE-QUEUE] Queue error:', err);
      });
      logger.info('[POLL-LIFECYCLE-QUEUE] Initialized');
    })().finally(() => {
      this.initPromise = null;
    });
    await this.initPromise;
  }

  async schedulePoll(poll: PollLifecycleSchedule): Promise<void> {
    if (!poll.closesAt && !poll.remindAt) return;
    await this.initialize();
    if (!this.queue) {
      throw new Error('[POLL-LIFECYCLE-QUEUE] Queue not initialized');
    }
    await addPollLifecycleJobs(this.queue, poll);
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      logger.info('[POLL-LIFECYCLE-QUEUE] Closed');
    }
  }
}

export const pollLifecycleQueue = new PollLifecycleQueue();
