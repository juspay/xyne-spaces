import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { config } from '@/config/env';
import {
  markAutomationFailed,
  markAutomationRetryPending,
} from '@/database/repositories/workflowExecutionStateUtils';
import { isStallExhaustionError } from '../engine/retryability';

export interface AutomationJobData {
  executionId: string;
  resumeStepName?: string;
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
          attempts: config.automation.maxAttempts,
          backoff: { type: 'fixed', delay: config.automation.retryDelayMs },
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
      void this.reconcileFailure(job, err).catch(reconcileErr =>
        logger.error(
          `[AUTOMATION-QUEUE] failure reconciliation threw for job ${job.id}:`,
          reconcileErr,
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

  // Reconcile DB state with a failed attempt. The retry boundary uses
  // job.opts.attempts (what the job was enqueued with), not live config, so a
  // config change can't strand in-flight jobs. A failed PENDING-reset is itself
  // escalated to FAILED — otherwise the run is left FAILED-not-accepted with no
  // future attempt to save it.
  private async reconcileFailure(job: Bull.Job<AutomationJobData>, err: unknown): Promise<void> {
    const { executionId } = job.data;
    const message = err instanceof Error ? err.message : String(err);
    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts.attempts ?? config.automation.maxAttempts;
    logger.error(
      `[AUTOMATION-QUEUE] job ${job.id} failed — execution ${executionId} (attempt ${attemptsMade}/${maxAttempts}): ${message}`,
    );

    // Stall exhaustion: Bull moved the job to failed WITHOUT incrementing
    // attemptsMade and will never re-run it. This listener must NOT reset the
    // run to PENDING — there is no future Bull job to process it, and the
    // executor never saw this job's failure (it's Bull-internal), so nothing
    // marks it FAILED either. Finalize it here instead.
    if (isStallExhaustionError(err)) {
      const stalled = await markAutomationFailed(
        executionId,
        `worker stalled beyond maxStalledCount (likely crashed/hung mid-step): ${message}`,
      ).catch(markErr => {
        logger.error(`[AUTOMATION-QUEUE] failed to finalize stalled execution=${executionId}:`, markErr);
        return 'error' as const;
      });
      if (stalled === 'marked') {
        logger.warn(
          `[AUTOMATION-QUEUE] execution=${executionId} → FAILED after stall exhaustion (job ${job.id} will not be re-run by Bull)`,
        );
      }
      return;
    }

    if (attemptsMade >= maxAttempts) {
      const result = await markAutomationFailed(executionId, message).catch(markErr => {
        logger.error(`[AUTOMATION-QUEUE] failed to finalize execution=${executionId}:`, markErr);
        return 'error' as const;
      });
      if (result === 'marked') {
        logger.warn(
          `[AUTOMATION-QUEUE] retries exhausted (${attemptsMade}/${maxAttempts}) — execution=${executionId} → FAILED`,
        );
      }
      return;
    }

    const reset = await markAutomationRetryPending(executionId, message, attemptsMade).catch(
      markErr => {
        logger.error(`[AUTOMATION-QUEUE] failed to reset execution=${executionId} for retry:`, markErr);
        return 'error' as const;
      },
    );
    if (reset === 'reset') {
      logger.info(
        `[AUTOMATION-QUEUE] execution=${executionId} reset FAILED → PENDING for retry (attempt ${attemptsMade + 1}/${maxAttempts})`,
      );
    } else if (reset === 'error') {
      logger.error(
        `[AUTOMATION-QUEUE] escalating execution=${executionId} to FAILED — retry reset failed, run would otherwise be dropped`,
      );
      await markAutomationFailed(executionId, `retry reset failed after attempt ${attemptsMade}: ${message}`).catch(() => undefined);
    }
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
