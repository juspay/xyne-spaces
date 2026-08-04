import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { classifyAndTagThread } from '@/services/messageClassification';

/**
 * Wait this long before classifying. Short enough to read as immediate, long enough that a
 * burst of replies collapses into one pass instead of one call per message.
 */
const DEBOUNCE_MS = Number(process.env['MESSAGE_CLASSIFICATION_DEBOUNCE_MS'] ?? 30_000);

const QUEUE_NAME = 'message-classification';
const JOB_NAME = 'classify-message';

export type MessageClassificationJob = { conversationId: string };

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
    if (process.env['ENABLE_MESSAGE_CLASSIFICATION'] !== 'true') {
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
   * The debounce collapses a burst of replies into one pass; the jobId is the thread, so
   * Bull drops repeat adds while that job is still pending.
   */
  async enqueueForMessage(conversationId: string): Promise<void> {
    if (!conversationId) return;
    if (!this.queue) {
      // Not silent: an uninitialized producer drops every message with no other trace.
      logger.warn('[MessageClassificationQueue] Not initialized; nothing will be classified');
      return;
    }

    try {
      await this.queue.add(
        JOB_NAME,
        { conversationId },
        { jobId: `classify:${conversationId}`, delay: DEBOUNCE_MS },
      );
    } catch (error) {
      logger.error('[MessageClassificationQueue] Failed to enqueue', { conversationId, error });
    }
  }
}

export const messageClassificationQueue = new MessageClassificationQueue();
