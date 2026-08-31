import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import type { BulkTicketCreationJobData } from '@/types/bulkTicket';

export const BULK_TICKET_JOB_NAME_SUB = 'sub-ticket';
export const BULK_TICKET_JOB_NAME_BULK = 'bulk-ticket';

/**
 * Queue for asynchronous bulk ticket creation.
 *
 * The producer (API process) calls {@link enqueue}; the consumer
 * (worker process) attaches its processor in bulkTicketCreationWorker. Both
 * sides lazily {@link initialize} so neither app.ts nor worker.ts needs to be
 * kept in lock-step — the first `enqueue`/`start` call wires the Redis-backed
 * Bull queue.
 */
class BulkTicketCreationQueue {
  private queue: Bull.Queue<BulkTicketCreationJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) {
      return;
    }

    this.isInitializing = true;

    try {
      this.queue = new Bull<BulkTicketCreationJobData>('bulk-ticket-creation', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
        settings: {
          lockDuration: 5 * 60 * 1000,
          stalledInterval: 60 * 1000,
          maxStalledCount: 1,
        },
      });

      this.queue.on('error', (error) => {
        logger.error('[BULK-TICKET] Queue error:', error);
      });

      this.isInitialized = true;
      logger.info('[BULK-TICKET] Queue initialized successfully');
    } catch (error) {
      logger.error('[BULK-TICKET] Failed to initialize queue:', error);
      this.isInitialized = false;
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Enqueue one bulk-creation batch. The job name distinguishes parent-sub
   * mode (`sub-ticket`) from all-parents mode (`bulk-ticket`).
   */
  async enqueue(jobName: string, data: BulkTicketCreationJobData): Promise<Bull.Job> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    const queue = this.getQueue();
    const job = await queue.add(jobName, data);
    logger.info('[BULK-TICKET] Enqueued batch', {
      jobId: job.id,
      jobName,
      count: data.subTickets.length,
      mode: data.mode,
    });
    return job;
  }

  getQueue(): Bull.Queue<BulkTicketCreationJobData> {
    if (!this.queue) {
      throw new Error('[BULK-TICKET] Queue not initialized — call initialize() first');
    }
    return this.queue;
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[BULK-TICKET] Queue closed');
    }
  }
}

export const bulkTicketCreationQueue = new BulkTicketCreationQueue();
