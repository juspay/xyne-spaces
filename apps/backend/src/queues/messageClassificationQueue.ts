import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { config } from '@/config/env';
import { classifyAndTagThread } from '@/services/messageClassification';

/**
 * Wait for the thread to go QUIET this long before classifying.
 *
 * Ten minutes, not seconds. A thread judged 30s after its opening message is judged when it
 * is one message long — and at that moment it cannot yet be a HOW_TO, a WHAT_HAPPENED, a
 * WHY_DECISION or any other answer type, because the answer has not been written. Classifying
 * that early does not just produce a stale tag, it makes over half the vocabulary unreachable.
 *
 * The delay is refreshed by every new message (see enqueueForMessage), so an active thread is
 * read once after it settles rather than once per burst.
 */
const DEBOUNCE_MS = Number(process.env['MESSAGE_CLASSIFICATION_DEBOUNCE_MS'] ?? 10 * 60_000);

const QUEUE_NAME = 'message-classification';
const JOB_NAME = 'classify-message';

export type MessageClassificationJob = { conversationId: string };

/** Clearable states, matching vespa-backfill's clearJobsByState. */
export const CLASSIFICATION_QUEUE_STATES = [
  'wait',
  'active',
  'delayed',
  'completed',
  'failed',
] as const;
export type ClassificationQueueState = (typeof CLASSIFICATION_QUEUE_STATES)[number];

/**
 * Off-request LLM classification. Queued so model latency never sits in the send path.
 * Failures are retried twice then dropped — an untagged message is a missing chip.
 */
class MessageClassificationQueue {
  private queue: Bull.Queue<MessageClassificationJob> | null = null;
  private isInitialized = false;
  private processorRegistered = false;

  /**
   * Call once at startup, in both the API (producer) and worker (consumer) processes.
   * A no-op when the feature is off, which is what keeps the producer from filling a
   * queue nobody drains — jobs are only removed once processed.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (!config.messageClassificationEnabled) {
      logger.info('[MessageClassificationQueue] Disabled; not initializing');
      return;
    }
    try {
      this.queue = new Bull<MessageClassificationJob>(QUEUE_NAME, {
        redis: { ...redisService.getRedisConfig(), lazyConnect: false },
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      });
      this.queue.on('error', err => logger.error('[MessageClassificationQueue] error:', err));
      this.isInitialized = true;
      logger.info('[MessageClassificationQueue] Initialized');
    } catch (err) {
      logger.error('[MessageClassificationQueue] Failed to initialize:', err);
    }
  }

  getQueue(): Bull.Queue<MessageClassificationJob> | null {
    return this.queue;
  }

  /** Register the worker. Call after initialize(). */
  startProcessing(concurrency = 2): void {
    if (!this.queue || this.processorRegistered) return;
    this.processorRegistered = true;

    void this.queue.process(JOB_NAME, concurrency, async job => {
      const { conversationId } = job.data;
      try {
        const result = await classifyAndTagThread(conversationId);
        logger.info('[MessageClassificationQueue] Classified thread', {
          conversationId,
          ...result,
        });
        return result;
      } catch (error) {
        logger.error('[MessageClassificationQueue] Classification failed', {
          conversationId,
          error,
        });
        throw error;
      }
    });

    logger.info('[MessageClassificationQueue] Processor registered', { concurrency });
  }

  async shutdown(): Promise<void> {
    if (!this.queue) return;
    // Let in-flight classifications finish rather than killing them mid-LLM-call.
    await this.queue.close();
    this.queue = null;
    this.isInitialized = false;
    this.processorRegistered = false;
    logger.info('[MessageClassificationQueue] Shut down');
  }

  /**
   * Consider a thread for classification. Guarded internally so callers can fire-and-forget.
   *
   * Deliberately does NO database read. This runs inside the Zero transaction that created
   * the message, so a brand-new conversation is not visible to Prisma yet — a lookup here
   * silently dropped every new thread while replies worked. All real gating (thread size,
   * already-classified, no project) happens in the consumer, which runs after commit.
   *
   * The jobId is the thread, and Bull SILENTLY IGNORES an add whose jobId already exists —
   * including a COMPLETED one, which it retains (removeOnComplete: 100). Adding blindly
   * therefore does neither of the things this needs: a reply would not push the quiet window
   * back, and a thread classified once could never be looked at again until its finished job
   * aged out of the last hundred. Both are why an existing job is removed first.
   */
  async enqueueForMessage(conversationId: string): Promise<void> {
    if (!conversationId) return;
    if (!this.queue) {
      // Not silent: an uninitialized producer drops every message with no other trace.
      logger.warn('[MessageClassificationQueue] Not initialized; nothing will be classified');
      return;
    }

    const jobId = `classify:${conversationId}`;
    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        // Leave a job that is already running: killing it mid-LLM-call would waste the call
        // and the reply that triggered this will be picked up by the pass after it.
        if (state === 'active') return;
        // Delayed (still counting down), or finished from an earlier pass — either way it is
        // replaced, which is what turns the delay into a rolling quiet window.
        await existing.remove();
      }

      await this.queue.add(JOB_NAME, { conversationId }, { jobId, delay: DEBOUNCE_MS });
    } catch (error) {
      logger.error('[MessageClassificationQueue] Failed to enqueue', { conversationId, error });
    }
  }

  /**
   * Backfill enqueue: same job, no debounce.
   *
   * The jobId is shared with enqueueForMessage so a thread already waiting because someone
   * just replied is not queued twice — that add is skipped and this returns false.
   *
   * The finished-job sweep is not optional: Bull keeps completed jobs (removeOnComplete:
   * 100) and SILENTLY IGNORES an add whose jobId already exists, so without removing the
   * old one a second backfill run would report success and queue nothing. Backfill jobs
   * also clear themselves on completion, so they never build up that shadow.
   *
   * Returns false when the queue isn't up (feature flag off) or the thread is already
   * queued, so `enqueued` counts what really landed.
   */
  async enqueueBackfill(conversationId: string, delayMs = 0): Promise<boolean> {
    if (!conversationId || !this.queue) return false;
    const jobId = `classify:${conversationId}`;
    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        // Still pending — leave it alone, it will run.
        if (state !== 'completed' && state !== 'failed') return false;
        await existing.remove();
      }

      await this.queue.add(
        JOB_NAME,
        { conversationId },
        {
          jobId,
          removeOnComplete: true,
          removeOnFail: true,
          ...(delayMs > 0 ? { delay: delayMs } : {}),
        },
      );
      return true;
    } catch (error) {
      logger.error('[MessageClassificationQueue] Backfill enqueue failed', {
        conversationId,
        error,
      });
      return false;
    }
  }

  // ─── Queue control ─────────────────────────────────────────────────────────────

  /** Same shape vespaQueue.getStats returns, so the two admin surfaces read alike. */
  async getStats() {
    if (!this.queue) {
      return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 };
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    };
  }

  /**
   * Drop jobs in one state, or every state when `state` is 'all'.
   *
   * Clearing 'active' does NOT abort a classification already talking to the model; it
   * only forgets the job, so the run finishes and its write still lands.
   */
  async clearJobsByState(state: ClassificationQueueState | 'all'): Promise<boolean> {
    if (!this.queue) return false;
    const queue = this.queue;

    if (state === 'all') {
      await Promise.all(CLASSIFICATION_QUEUE_STATES.map(name => queue.clean(0, name)));
    } else {
      await queue.clean(0, state);
    }
    logger.warn('[MessageClassificationQueue] Cleared jobs', { state });
    return true;
  }
}

export const messageClassificationQueue = new MessageClassificationQueue();
