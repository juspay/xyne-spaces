import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { config } from '@/config/env';
import {
  markAutomationFailed,
  markAutomationRetryPending,
} from '@/database/repositories/workflowExecutionStateUtils';
import { isStallExhaustionError } from '../engine/retryability';

export interface AutomationScheduleJobData {
  executionId: string;
  resumeStepName?: string;
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
          attempts: config.automation.maxAttempts,
          backoff: { type: 'fixed', delay: config.automation.retryDelayMs },
          removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
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
      logger.info('[AUTOMATION-SCHEDULE-QUEUE] Initialized');
    } catch (err) {
      logger.error('[AUTOMATION-SCHEDULE-QUEUE] Failed to initialize:', err);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;
    this.queue.on('failed', (job, err) => {
      void this.reconcileFailure(job, err).catch(reconcileErr =>
        logger.error(
          `[AUTOMATION-SCHEDULE-QUEUE] failure reconciliation threw for job ${job.id}:`,
          reconcileErr,
        ),
      );
    });
    this.queue.on('error', err =>
      logger.error('[AUTOMATION-SCHEDULE-QUEUE] queue error:', err),
    );
  }

  // Same reconciliation contract as the main automation queue: boundary comes from
  // job.opts.attempts, and a failed PENDING-reset escalates to FAILED so the run
  // isn't silently dropped.
  private async reconcileFailure(
    job: Bull.Job<AutomationScheduleJobData>,
    err: unknown,
  ): Promise<void> {
    const { executionId } = job.data;
    const message = err instanceof Error ? err.message : String(err);
    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts.attempts ?? config.automation.maxAttempts;
    logger.error(
      `[AUTOMATION-SCHEDULE-QUEUE] job ${job.id} failed — execution ${executionId} (attempt ${attemptsMade}/${maxAttempts}): ${message}`,
    );

    // Stall exhaustion never increments attemptsMade and Bull will not re-run the
    // job — do NOT reset to PENDING (would strand the run). Finalize as FAILED.
    if (isStallExhaustionError(err)) {
      const stalled = await markAutomationFailed(
        executionId,
        `worker stalled beyond maxStalledCount (likely crashed/hung mid-step): ${message}`,
      ).catch(markErr => {
        logger.error(`[AUTOMATION-SCHEDULE-QUEUE] failed to finalize stalled execution=${executionId}:`, markErr);
        return 'error' as const;
      });
      if (stalled === 'marked') {
        logger.warn(
          `[AUTOMATION-SCHEDULE-QUEUE] execution=${executionId} → FAILED after stall exhaustion (job ${job.id} will not be re-run by Bull)`,
        );
      }
      return;
    }

    if (attemptsMade >= maxAttempts) {
      const result = await markAutomationFailed(executionId, message).catch(markErr => {
        logger.error(`[AUTOMATION-SCHEDULE-QUEUE] failed to finalize execution=${executionId}:`, markErr);
        return 'error' as const;
      });
      if (result === 'marked') {
        logger.warn(
          `[AUTOMATION-SCHEDULE-QUEUE] retries exhausted (${attemptsMade}/${maxAttempts}) — execution=${executionId} → FAILED`,
        );
      }
      return;
    }

    const reset = await markAutomationRetryPending(executionId, message, attemptsMade).catch(
      markErr => {
        logger.error(`[AUTOMATION-SCHEDULE-QUEUE] failed to reset execution=${executionId} for retry:`, markErr);
        return 'error' as const;
      },
    );
    if (reset === 'reset') {
      logger.info(
        `[AUTOMATION-SCHEDULE-QUEUE] execution=${executionId} reset FAILED → PENDING for retry (attempt ${attemptsMade + 1}/${maxAttempts})`,
      );
    } else if (reset === 'error') {
      logger.error(
        `[AUTOMATION-SCHEDULE-QUEUE] escalating execution=${executionId} to FAILED — retry reset failed, run would otherwise be dropped`,
      );
      await markAutomationFailed(executionId, `retry reset failed after attempt ${attemptsMade}: ${message}`).catch(() => undefined);
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
      jobId: data.resumeStepName
        ? `${data.executionId}:delay:${data.resumeStepName}`
        : data.executionId,
    });
  }

}

export const automationScheduleQueue = new AutomationScheduleQueue();
