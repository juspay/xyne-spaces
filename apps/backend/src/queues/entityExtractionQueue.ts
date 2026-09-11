import Bull from 'bull';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { redisService } from '@/services/redisService';

/**
 * Producer for the entity-extraction queue.
 *
 * Enqueued at message ingest. A job is just a threadId (== conversationId),
 * keyed so a busy thread dedupes to ONE job and held for a short debounce window
 * so that dedupe has something to collapse: a job re-extracts the WHOLE thread,
 * so firing one per message would cost O(n²) LLM calls over the thread's life.
 * Everything else — resolving the channel/workspace, reading the channel's
 * approved types (chat_container.entityTypes), gating — happens in the worker,
 * keeping the ingest path free of lookups.
 *
 * A message landing while the thread's job is already active is dropped (Bull
 * ignores the repeat add, and the job is gone once it completes). Accepted:
 * any later message on the thread re-extracts it whole.
 *
 * Consumption lives in workers/entityExtractionWorker.ts.
 */
export interface EntityExtractionJobData {
  threadId: string;
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
   * repeat add while the job is still delayed or queued, so every message inside
   * the debounce window folds into the one job the first message created.
   */
  async enqueueForMessage(conversationId: string | undefined): Promise<void> {
    if (!this.queue || !conversationId) return;
    try {
      await this.queue.add(
        { threadId: conversationId },
        {
          jobId: conversationId, // dedupe the thread
          priority: Math.max(1, Math.floor(Date.now() / 1000)), // lower = older = first
          delay: config.entityExtraction.debounceMs,
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
   * Enqueue a thread for IMMEDIATE processing (backfill), bypassing the debounce
   * window. Same jobId dedup, so a thread already waiting out its window isn't
   * duplicated — it just stays on its original schedule.
   */
  async enqueueThreadNow(threadId: string): Promise<void> {
    if (!this.queue || !threadId) return;
    try {
      await this.queue.add(
        { threadId },
        { jobId: threadId, priority: Math.max(1, Math.floor(Date.now() / 1000)) },
      );
    } catch (err) {
      logger.warn('[ENTITY-EXTRACTION-QUEUE] backfill enqueue failed', {
        threadId,
        error: String(err),
      });
    }
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.isInitialized = false;
    }
  }
}

export const entityExtractionQueue = new EntityExtractionQueue();
