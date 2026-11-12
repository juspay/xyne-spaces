/**
 * Execution queue for `@xyne/workflow-sdk`.
 *
 * One job = one *pass* over an execution, not one execution: a run that pauses and later
 * resumes is several jobs against the same `executionId`. The worker hands each job to
 * `WorkflowRuntime.processJob()`, which re-walks the step tree and reconciles from the
 * persisted node records.
 *
 * Lives here rather than beside the adapter because `docs/guidelines/JOBS.md` puts every
 * Bull queue in `src/queues/`; the adapter in `workflowsV2/adapters/queue.ts` is a thin
 * shell over this.
 */
import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { config } from '@/config/env';

export const WORKFLOWS_QUEUE_NAME = 'workflows-execution';
export const WORKFLOWS_JOB_NAME = 'run-execution';

export interface WorkflowsJobData {
  executionId: string;
}

/**
 * A step may legitimately run for many minutes — an LLM call, a long HTTP request, a
 * document pipeline. Bull's defaults assume short jobs and will declare a slow one
 * *stalled*, then hand it to a second worker: two concurrent walks over one execution,
 * which is exactly what `singletonKey` exists to prevent.
 *
 * Tunable via WORKFLOWS_LOCK_DURATION_MS so a deployment with slower steps can raise it
 * without a code change.
 */
const LOCK_DURATION_MS = config.workflows.lockDurationMs;

class WorkflowsQueue {
  private queue: Bull.Queue<WorkflowsJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<WorkflowsJobData>(WORKFLOWS_QUEUE_NAME, {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          // The SDK owns retry policy per workflow (`settings.retry`) and records failure
          // on the execution row, so a Bull-level retry would re-walk a run the engine has
          // already decided about. One attempt; the engine decides what happens next.
          attempts: 1,
          // BOTH must stay true. `jobId` is how this queue gets single-writer semantics
          // (see the adapter), and Bull refuses to add a job whose id already exists — in
          // ANY state, completed and failed included. Retaining finished jobs would
          // therefore wedge an execution permanently: no later pass could ever be
          // enqueued for it, and resume would silently do nothing. Failures are not lost —
          // they are on the execution row via `markFailed`, and in the logs.
          removeOnComplete: true,
          removeOnFail: true,
        },
        settings: {
          lockDuration: LOCK_DURATION_MS,
          stalledInterval: LOCK_DURATION_MS,
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info(
        `[WORKFLOWS-QUEUE] Initialized (lockDuration ${String(LOCK_DURATION_MS)}ms)`,
      );
    } catch (error) {
      logger.error('[WORKFLOWS-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[WORKFLOWS-QUEUE] Job ${String(job.id)} failed — execution ${job.data.executionId}`,
        err,
      );
    });

    // Worth a warning rather than silence: a stall means the lock expired mid-pass, so a
    // second worker may now be walking the same execution.
    this.queue.on('stalled', (job) => {
      logger.warn(
        `[WORKFLOWS-QUEUE] Job ${String(job.id)} stalled — execution ${job.data.executionId} exceeded lockDuration`,
      );
    });

    this.queue.on('error', (err) => {
      logger.error('[WORKFLOWS-QUEUE] Queue error:', err);
    });
  }

  getQueue(): Bull.Queue<WorkflowsJobData> {
    if (!this.queue) {
      throw new Error('[WORKFLOWS-QUEUE] Queue not initialized — call initialize() first');
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
      logger.info('[WORKFLOWS-QUEUE] Closed');
    }
  }
}

export const workflowsQueue = new WorkflowsQueue();
