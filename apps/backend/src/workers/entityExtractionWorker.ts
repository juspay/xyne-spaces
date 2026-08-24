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
 * Each job is one thread: extract mentions → resolve → write entity ids back to
 * Vespa. Jobs are produced by live message/ticket mutations but held for a
 * debounce window, so this worker sees one job per busy thread per window rather
 * than one per message — a job re-reads the whole thread either way.
 *
 * Concurrency is bounded by the shared LiteLLM key's parallel-request limit.
 */
class EntityExtractionWorker {
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    const entityExtractionEnabled = config.entityExtraction.enabled;
    if (!entityExtractionEnabled) {
      logger.info('[ENTITY-EXTRACTION-WORKER] Disabled; not starting');
      return;
    }

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

    // A job fails when the thread could not be extracted at all — most often
    // every LLM call exhausted its retries. Bull retries with backoff; the last
    // failure is called out separately because that thread stays unextracted
    // until someone replays it from the failed set (kept: removeOnFail 500).
    queue.on('failed', (job, err) => {
      const attempts = job.opts?.attempts ?? 1;
      const exhausted = job.attemptsMade >= attempts;
      logger.error(
        `[ENTITY-EXTRACTION-WORKER] job ${job.id} failed ` +
          `(attempt ${job.attemptsMade}/${attempts}) thread=${job.data?.threadId} ` +
          `${exhausted ? 'GIVING UP — thread left unextracted' : 'will retry'}:`,
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
