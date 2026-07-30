import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

/**
 * Producer for the nightly entity-extraction queue.
 *
 * Enqueued at message ingest, drained at midnight. A job is just a threadId
 * (== conversationId), keyed so a busy thread dedupes to ONE job, delayed until
 * the next IST midnight so it is processed once when the thread has settled, and
 * priority-ordered by time. Everything else — resolving the channel/workspace,
 * reading the channel's approved types (chat_container.entityTypes), gating —
 * happens in the worker, keeping the ingest path free of lookups.
 *
 * Consumption lives in workers/entityExtractionWorker.ts.
 */
export interface EntityExtractionJobData {
  threadId: string;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** ms from now until the next 00:00 IST — the delay that batches jobs to night. */
function msUntilNextMidnightIST(): number {
  const istNow = Date.now() + IST_OFFSET_MS;
  return Math.ceil(istNow / DAY_MS) * DAY_MS - istNow;
}

class EntityExtractionQueue {
  private queue: Bull.Queue<EntityExtractionJobData> | null = null;
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    try {
      this.queue = new Bull<EntityExtractionJobData>('entity-extraction', {
        redis: { ...redisService.getRedisConfig(), lazyConnect: false },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: 500,
        },
        settings: {
          // A thread is one LLM call, but the shared key rate-limits, so give it
          // room. The lock must outlive the retries.
          lockDuration: 10 * 60 * 1000,
          stalledInterval: 60_000,
          maxStalledCount: 1,
        },
      });
      this.queue.on('error', (err) => logger.error('[ENTITY-EXTRACTION-QUEUE] error:', err));
      this.isInitialized = true;
      logger.info('[ENTITY-EXTRACTION-QUEUE] Initialized');
    } catch (err) {
      logger.error('[ENTITY-EXTRACTION-QUEUE] Failed to initialize:', err);
    }
  }

  getQueue(): Bull.Queue<EntityExtractionJobData> | null {
    return this.queue;
  }

  /**
   * Feed-time entry — call when a message is ingested (threadId == conversationId).
   * Fully guarded so it can never throw into the ingest path. Bull ignores a
   * repeat add while the job is still queued, so a busy thread stays one job.
   */
  async enqueueForMessage(conversationId: string | undefined): Promise<void> {
    if (!this.queue || !conversationId) return;
    try {
      await this.queue.add(
        { threadId: conversationId },
        {
          jobId: conversationId, // dedupe the thread
          priority: Math.max(1, Math.floor(Date.now() / 1000)), // lower = older = first
          delay: msUntilNextMidnightIST(),
        },
      );
    } catch (err) {
      logger.warn('[ENTITY-EXTRACTION-QUEUE] enqueue failed', {
        conversationId,
        error: String(err),
      });
    }
  }

  /**
   * Enqueue a thread for IMMEDIATE processing (backfill), bypassing the nightly
   * delay. Same jobId dedup, so a thread already queued for tonight isn't
   * duplicated. Returns true if a job was added.
   */
  async enqueueThreadNow(threadId: string): Promise<void> {
    if (!this.queue || !threadId) return;
    await this.queue.add(
      { threadId },
      { jobId: threadId, priority: Math.max(1, Math.floor(Date.now() / 1000)) },
    );
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.isInitialized = false;
    }
  }
}

export const entityExtractionQueue = new EntityExtractionQueue();
