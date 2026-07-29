import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { markAutomationFailed } from '@/database/repositories/workflowExecutionStateUtils';

export interface AutomationJobData {
  executionId: string;
}

class AutomationQueue {
  private queue: Bull.Queue<AutomationJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<AutomationJobData>('automations', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: {
            age: 60 * 60,
            count: 1000,
          },
          removeOnFail: false,
        },
        settings: {
          lockDuration: 60_000,
          stalledInterval: 30_000,
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[AUTOMATION-QUEUE] Initialized');
    } catch (error) {
      logger.error('[AUTOMATION-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;
    this.queue.on('failed', (job, err) => {
      const { executionId } = job.data;
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        `[AUTOMATION-QUEUE] Job ${job.id} failed — execution ${executionId}: ${message}`,
      );
      void markAutomationFailed(executionId, message)
        .then(result => {
          if (result === 'marked') {
            logger.info(`[AUTOMATION-QUEUE] reconciled execution=${executionId} → FAILED`);
          }
        })
        .catch(markErr =>
          logger.error(
            `[AUTOMATION-QUEUE] failed to reconcile execution=${executionId}:`,
            markErr,
          ),
        );
    });
    this.queue.on('stalled', (job) => {
      logger.warn(`[AUTOMATION-QUEUE] Job ${job.id} stalled`);
    });
    this.queue.on('error', (err) => {
      logger.error('[AUTOMATION-QUEUE] Queue error:', err);
    });
  }

  getQueue(): Bull.Queue<AutomationJobData> {
    if (!this.queue) {
      throw new Error('[AUTOMATION-QUEUE] Queue not initialized — call initialize() first');
    }
    return this.queue;
  }

  async enqueueRun(
    data: AutomationJobData,
    options?: Bull.JobOptions,
  ): Promise<Bull.Job<AutomationJobData>> {
    return this.getQueue().add(data, options);
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }
}

export const automationQueue = new AutomationQueue();
