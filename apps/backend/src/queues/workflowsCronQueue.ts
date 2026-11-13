/**
 * Cron-tick queue for `@xyne/workflow-sdk`.
 *
 * Separate from the execution queue on purpose. A tick is not a pass over an execution —
 * `processCronTick(workflowId)` asks the trigger whether there is anything to do and only
 * *then* creates an execution, which lands on the execution queue as normal. Keeping them
 * apart means a backlog of long-running executions can never delay a schedule, and the two
 * can be tuned independently.
 *
 * ONE queue holding N repeatable jobs, keyed by workflow — not a queue per workflow. Bull
 * supports many repeatables per queue, so the per-workflow queue pattern (which pg-boss
 * hosts need) would leave an unbounded number of Redis keyspaces and processors behind.
 */
import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

export const WORKFLOWS_CRON_QUEUE_NAME = 'workflows-cron';
export const WORKFLOWS_CRON_JOB_NAME = 'cron-tick';

export interface WorkflowsCronJobData {
  workflowId: string;
}

class WorkflowsCronQueue {
  private queue: Bull.Queue<WorkflowsCronJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<WorkflowsCronJobData>(WORKFLOWS_CRON_QUEUE_NAME, {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          // A missed tick is not worth retrying: the next one is along shortly, and a
          // retried tick can double-fire a workflow whose trigger is not idempotent.
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[WORKFLOWS-CRON] Initialized');
    } catch (error) {
      logger.error('[WORKFLOWS-CRON] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[WORKFLOWS-CRON] Tick failed for workflow ${job.data.workflowId}`,
        err,
      );
    });

    this.queue.on('error', (err) => {
      logger.error('[WORKFLOWS-CRON] Queue error:', err);
    });
  }

  getQueue(): Bull.Queue<WorkflowsCronJobData> {
    if (!this.queue) {
      throw new Error('[WORKFLOWS-CRON] Queue not initialized — call initialize() first');
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
      logger.info('[WORKFLOWS-CRON] Closed');
    }
  }
}

export const workflowsCronQueue = new WorkflowsCronQueue();
