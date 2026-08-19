import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { TicketPriority, TicketStatusV2, type SurfaceAreaType } from '@xyne/shared';

export interface BulkTicketCreationInput {
  title: string;
  description?: string;
  projectId: string;
  boardId: string;
  channelId: string;
  createdBy: string;
  updatedBy: string;
  priority?: TicketPriority;
  statusV2?: TicketStatusV2;
  stageName?: string;
  assignedTo?: string;
  userGroupId?: string;
  eta?: Date;
  tags?: string[];
  ticketType?: string;
  workflowType?: string;
  dynamicFields?: Record<string, string>;
  merchantId?: string;
  clientRowId?: string;
}

export interface BulkTicketCreationJobData {
  parentTicketId: string | null;
  parentWorkspaceId: string;
  userId: string;
  subTickets: BulkTicketCreationInput[];
  sourceMessageId?: string;
  sourceType?: SurfaceAreaType;
  channelId?: string;
  projectId?: string;
}

class BulkTicketCreationQueue {
  private queue: Bull.Queue<BulkTicketCreationJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<BulkTicketCreationJobData>('sub-ticket-creation', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
        settings: {
          lockDuration: 5 * 60 * 1000,
          stalledInterval: 60 * 1000,
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[BULK-TICKET-CREATION-QUEUE] Initialized');
    } catch (error) {
      logger.error('[BULK-TICKET-CREATION-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[BULK-TICKET-CREATION-QUEUE] Job ${job.id} failed — parent ${job.data.parentTicketId}:`,
        err,
      );
    });

    this.queue.on('stalled', job => {
      logger.warn(
        `[BULK-TICKET-CREATION-QUEUE] Job ${job.id} stalled — parent ${job.data.parentTicketId}`,
      );
    });

    this.queue.on('error', err => {
      logger.error('[BULK-TICKET-CREATION-QUEUE] Queue error:', err);
    });
  }

  getQueue(): Bull.Queue<BulkTicketCreationJobData> {
    if (!this.queue) {
      throw new Error('[BULK-TICKET-CREATION-QUEUE] Queue not initialized — call initialize() first');
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
      logger.info('[BULK-TICKET-CREATION-QUEUE] Closed');
    }
  }
}

export const bulkTicketCreationQueue = new BulkTicketCreationQueue();
