import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { markAutomationFailed } from '@/database/repositories/workflowExecutionStateUtils';

export interface AutomationScheduleJobData {
  executionId: string;
}

class AutomationScheduleQueue {
  private queue: Bull.Queue<AutomationScheduleJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;
    try {
      this.queue = new Bull<AutomationScheduleJobData>('automations-schedule', {
        redis: { ...redisService.getRedisConfig(), lazyConnect: false },
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
          removeOnFail: false,
        },
        settings: {
          lockDuration: 60_000,
          stalledInterval: 30_000,
          maxStalledCount: 1,
        },
      });

      this.queue.on('failed', (job, err) => {
        const { executionId } = job.data;
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          `[AUTOMATION-SCHEDULE-QUEUE] job ${job.id} failed — execution ${executionId}: ${message}`,
        );
        void markAutomationFailed(executionId, message)
          .then(result => {
            if (result === 'marked') {
              logger.info(
                `[AUTOMATION-SCHEDULE-QUEUE] reconciled execution=${executionId} → FAILED`,
              );
            }
          })
          .catch(markErr =>
            logger.error(
              `[AUTOMATION-SCHEDULE-QUEUE] failed to reconcile execution=${executionId}:`,
              markErr,
            ),
          );
      });
      this.queue.on('error', err =>
        logger.error('[AUTOMATION-SCHEDULE-QUEUE] queue error:', err),
      );

      this.isInitialized = true;
      logger.info('[AUTOMATION-SCHEDULE-QUEUE] Initialized');
    } catch (err) {
      logger.error('[AUTOMATION-SCHEDULE-QUEUE] Failed to initialize:', err);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  getQueue(): Bull.Queue<AutomationScheduleJobData> {
    if (!this.queue) {
      throw new Error('[AUTOMATION-SCHEDULE-QUEUE] not initialized — call initialize() first');
    }
    return this.queue;
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }

  async enqueueScheduled(
    data: AutomationScheduleJobData,
    delayMs: number,
  ): Promise<Bull.Job<AutomationScheduleJobData>> {
    return this.getQueue().add(data, {
      delay: Math.max(0, delayMs),
      jobId: data.executionId,
    });
  }

}

export const automationScheduleQueue = new AutomationScheduleQueue();
