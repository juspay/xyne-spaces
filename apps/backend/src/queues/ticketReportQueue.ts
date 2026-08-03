import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

export interface TicketReportJobData {
  exportId: string;
  workspaceId: string;
  requestedByUserId: string;
}

class TicketReportQueue {
  private queue: Bull.Queue<TicketReportJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<TicketReportJobData>('ticket-report-export', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: 2,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: {
            age: 86400,
            count: 100,
          },
          removeOnFail: {
            age: 604800,
          },
        },
        settings: {
          lockDuration: 10 * 60 * 1000,
          stalledInterval: 60_000,
          maxStalledCount: 2,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[TICKET-REPORT-QUEUE] Initialized');
    } catch (error) {
      logger.error('[TICKET-REPORT-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[TICKET-REPORT-QUEUE] Job ${job.id} failed — export ${job.data.exportId}:`,
        err,
      );
    });

    this.queue.on('stalled', job => {
      logger.warn(`[TICKET-REPORT-QUEUE] Job ${job.id} stalled`);
    });

    this.queue.on('error', err => {
      logger.error('[TICKET-REPORT-QUEUE] Queue error:', err);
    });
  }

  async addJob(data: TicketReportJobData): Promise<Bull.Job<TicketReportJobData>> {
    if (!this.queue) {
      throw new Error(
        '[TICKET-REPORT-QUEUE] Queue not initialized — call initialize() first',
      );
    }
    return this.queue.add('generate-ticket-report', data);
  }

  getQueue(): Bull.Queue<TicketReportJobData> {
    if (!this.queue) {
      throw new Error(
        '[TICKET-REPORT-QUEUE] Queue not initialized — call initialize() first',
      );
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
      logger.info('[TICKET-REPORT-QUEUE] Closed');
    }
  }
}

export const ticketReportQueue = new TicketReportQueue();
