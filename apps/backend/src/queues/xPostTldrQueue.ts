import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { config } from '@/config/env';
import { processXPostTldrJob, type XPostTldrJobData } from '@/services/xPost/xPostTldrJob';

const QUEUE_NAME = 'x-post-tldr';
const JOB_NAME = 'summarize-x-post';
const ATTEMPTS = 2;

/**
 * Off-request TLDR generation for X post cards. Queued so model latency never sits in the
 * message send path: the card appears immediately with the post text and an "AI summary"
 * placeholder, and the summary is filled in when this job finishes.
 *
 * Mirrors MessageClassificationQueue: initialize() runs in both the API (producer) and the
 * worker (consumer) and is a no-op when ENABLE_X_POST_TLDR is off.
 */
class XPostTldrQueue {
  private queue: Bull.Queue<XPostTldrJobData> | null = null;
  private isInitialized = false;
  private processorRegistered = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (!config.xPostTldr.enabled) {
      logger.info('[XPostTldrQueue] Disabled; not initializing');
      return;
    }
    try {
      this.queue = new Bull<XPostTldrJobData>(QUEUE_NAME, {
        redis: { ...redisService.getRedisConfig(), lazyConnect: false },
        defaultJobOptions: {
          attempts: ATTEMPTS,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      });
      this.queue.on('error', err => logger.error('[XPostTldrQueue] error:', err));
      this.isInitialized = true;
      logger.info('[XPostTldrQueue] Initialized');
    } catch (err) {
      logger.error('[XPostTldrQueue] Failed to initialize:', err);
    }
  }

  /** True when a job can be queued. Callers use this to avoid writing a card stuck on "pending". */
  isReady(): boolean {
    return this.queue !== null;
  }

  startProcessing(concurrency = 2): void {
    if (!this.queue || this.processorRegistered) return;
    this.processorRegistered = true;

    void this.queue.process(JOB_NAME, concurrency, async job => {
      const attempts = job.opts.attempts ?? ATTEMPTS;
      const isFinalAttempt = job.attemptsMade + 1 >= attempts;
      const outcome = await processXPostTldrJob(job.data, isFinalAttempt);
      logger.info('[XPostTldrQueue] Job done', { ...job.data, outcome, attempt: job.attemptsMade + 1 });
      return { outcome };
    });

    logger.info('[XPostTldrQueue] Processor registered', { concurrency });
  }

  /**
   * Queue a TLDR for one message. One job per message: a duplicate side-effect delivery for
   * the same message is ignored by Bull (same jobId). Returns false when nothing was queued.
   */
  async enqueue(data: XPostTldrJobData): Promise<boolean> {
    if (!this.queue) return false;
    try {
      await this.queue.add(JOB_NAME, data, { jobId: `x-post-tldr:${data.messageId}:${data.postId}` });
      return true;
    } catch (error) {
      logger.error('[XPostTldrQueue] Failed to enqueue', { ...data, error });
      return false;
    }
  }

  async shutdown(): Promise<void> {
    if (!this.queue) return;
    await this.queue.close();
    this.queue = null;
    this.isInitialized = false;
    this.processorRegistered = false;
    logger.info('[XPostTldrQueue] Shut down');
  }
}

export const xPostTldrQueue = new XPostTldrQueue();
