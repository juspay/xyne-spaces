import type Bull from 'bull';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import {
  entityExtractionQueue,
  type EntityExtractionJobData,
} from '@/queues/entityExtractionQueue';
import { entityExtractionService } from '@/services/entityExtraction/entityExtractionService';

/**
 * Consumer for the entity-extraction queue.
 *
 * Jobs are delayed until midnight IST, so this worker sits idle during the day
 * and drains the night's threads in priority (timestamp) order. Each job is one
 * settled thread: extract mentions → resolve → write entity ids back to Vespa.
 *
 * Concurrency is bounded by the shared LiteLLM key's parallel-request limit.
 */
class EntityExtractionWorker {
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;

    await entityExtractionQueue.initialize();
    const queue = entityExtractionQueue.getQueue();
    if (!queue) throw new Error('[ENTITY-EXTRACTION-WORKER] queue unavailable after init');

    queue.process(config.entityExtraction.concurrency, async (job: Bull.Job<EntityExtractionJobData>) => {
      const { threadId } = job.data;
      const startedAt = Date.now();
      const result = await entityExtractionService.processThread(threadId);
      logger.info('[ENTITY-EXTRACTION-WORKER] thread processed', {
        threadId,
        ...result,
        ms: Date.now() - startedAt,
      });
    });

    queue.on('failed', (job, err) => {
      logger.error(
        `[ENTITY-EXTRACTION-WORKER] job ${job.id} failed (attempt ${job.attemptsMade}) ` +
          `thread=${job.data?.threadId}:`,
        err,
      );
    });

    this.started = true;
    logger.info('[ENTITY-EXTRACTION-WORKER] Started');
  }

  async stop(): Promise<void> {
    await entityExtractionQueue.close();
    this.started = false;
  }
}

export const entityExtractionWorker = new EntityExtractionWorker();
