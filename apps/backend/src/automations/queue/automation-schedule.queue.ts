import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { markAutomationFailed } from '@/database/repositories/workflowExecutionStateUtils';

export interface AutomationScheduleJobData {
  executionId?: string; // DELAY wake-up
  workflowId?: string; // Schedule (CRON) tick
}

// Per-workflow job NAME (no custom jobId) keeps same-cron automations on separate repeat keys.
export const CRON_TICK_PREFIX = 'cron-tick:';

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
        if (!executionId) return;
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

  async unscheduleCron(workflowId: string): Promise<void> {
    const queue = this.getQueue();
    const name = `${CRON_TICK_PREFIX}${workflowId}`;
    const repeatables = await queue.getRepeatableJobs();
    for (const job of repeatables.filter(j => j.name === name)) {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  async scheduleCron(workflowId: string, cron: string, tz: string): Promise<void> {
    await this.unscheduleCron(workflowId);
    await this.getQueue().add(
      `${CRON_TICK_PREFIX}${workflowId}`,
      { workflowId },
      { repeat: { cron, tz }, removeOnFail: true },
    );
  }
}

export const automationScheduleQueue = new AutomationScheduleQueue();
