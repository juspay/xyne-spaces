import Bull from 'bull';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import type { DeskLabelBackfillProgress } from '../services/desk-label-backfill.service';

export interface DeskLabelBackfillJobData {
  workflowId: string;
}

export const DESK_LABEL_BACKFILL_JOB = 'desk-label-backfill';

/**
 * One backfill per rule, addressed by a deterministic id. Re-running a rule while
 * its run is still queued or active collapses onto the same job instead of
 * scanning the channel twice.
 */
export const deskLabelBackfillJobId = (workflowId: string): string =>
  `autolabel-backfill:${workflowId}`;

export type DeskLabelBackfillState = 'queued' | 'running' | 'completed' | 'failed';

export interface DeskLabelBackfillRun {
  state: DeskLabelBackfillState;
  progress: DeskLabelBackfillProgress | null;
  failedReason: string | null;
}

export type EnqueueBackfillResult = 'enqueued' | 'already-running';

function isProgress(value: unknown): value is DeskLabelBackfillProgress {
  return typeof value === 'object' && value !== null && 'scanned' in value;
}

class DeskLabelBackfillQueue {
  private queue: Bull.Queue<DeskLabelBackfillJobData> | null = null;
  private isInitialized = false;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      this.queue = new Bull<DeskLabelBackfillJobData>('desk-label-backfill', {
        redis: {
          ...redisService.getRedisConfig(),
          lazyConnect: false,
        },
        defaultJobOptions: {
          // A retry restarts the scan from the beginning. Every apply is
          // idempotent so that is safe, just wasted work — hence a low cap.
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          // Completed runs are kept briefly so the rules list can show the
          // result of the run the user just started.
          removeOnComplete: { age: 60 * 60, count: 200 },
          removeOnFail: false,
        },
        settings: {
          // Long-running: one job walks the channel's whole mail history.
          lockDuration: 5 * 60 * 1000,
          stalledInterval: 60 * 1000,
          maxStalledCount: 1,
        },
      });

      this.setupEventListeners();
      this.isInitialized = true;
      logger.info('[DESK-LABEL-BACKFILL-QUEUE] Initialized');
    } catch (error) {
      logger.error('[DESK-LABEL-BACKFILL-QUEUE] Failed to initialize:', error);
      this.isInitialized = false;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupEventListeners(): void {
    if (!this.queue) return;

    this.queue.on('failed', (job, err) => {
      logger.error(
        `[DESK-LABEL-BACKFILL-QUEUE] Job ${job?.id} failed — automation ${job?.data?.workflowId}:`,
        err,
      );
    });
    this.queue.on('stalled', job => {
      logger.warn(
        `[DESK-LABEL-BACKFILL-QUEUE] Job ${job?.id} stalled — automation ${job?.data?.workflowId}`,
      );
    });
    this.queue.on('error', err => {
      logger.error('[DESK-LABEL-BACKFILL-QUEUE] Queue error:', err);
    });
  }

  getQueue(): Bull.Queue<DeskLabelBackfillJobData> {
    if (!this.queue) {
      throw new Error('[DESK-LABEL-BACKFILL-QUEUE] Queue not initialized — call initialize() first');
    }
    return this.queue;
  }

  get isReady(): boolean {
    return this.isInitialized && this.queue !== null;
  }

  /**
   * Queue a backfill for one rule.
   *
   * Bull silently ignores an add whose jobId already exists, and this queue keeps
   * failed jobs — so a terminal or finished run has to be cleared first, or it
   * would block every later backfill for the same rule while callers still see
   * success. Live jobs are left alone so a second click coalesces onto them.
   */
  async enqueue(workflowId: string): Promise<EnqueueBackfillResult> {
    const queue = this.getQueue();
    const jobId = deskLabelBackfillJobId(workflowId);

    const existing = await queue.getJob(jobId);
    if (existing) {
      const [failed, completed] = await Promise.all([
        existing.isFailed(),
        existing.isCompleted(),
      ]);
      if (!failed && !completed) return 'already-running';
      await existing.remove().catch(err =>
        logger.warn(
          `[DESK-LABEL-BACKFILL-QUEUE] Could not clear finished job ${jobId}; continuing:`,
          err,
        ),
      );
    }

    await queue.add(DESK_LABEL_BACKFILL_JOB, { workflowId }, { jobId });
    logger.info(`[DESK-LABEL-BACKFILL-QUEUE] Queued backfill for automation ${workflowId}`);
    return 'enqueued';
  }

  /** Latest known run for a rule, or null once it has aged out of the queue. */
  async getRun(workflowId: string): Promise<DeskLabelBackfillRun | null> {
    const job = await this.getQueue().getJob(deskLabelBackfillJobId(workflowId));
    if (!job) return null;

    const rawProgress = job.progress();
    const progress = isProgress(rawProgress) ? rawProgress : null;
    const [failed, completed, active] = await Promise.all([
      job.isFailed(),
      job.isCompleted(),
      job.isActive(),
    ]);

    const state: DeskLabelBackfillState = failed
      ? 'failed'
      : completed
        ? 'completed'
        : active
          ? 'running'
          : 'queued';

    return { state, progress, failedReason: job.failedReason ?? null };
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.isInitialized = false;
      logger.info('[DESK-LABEL-BACKFILL-QUEUE] Closed');
    }
  }
}

export const deskLabelBackfillQueue = new DeskLabelBackfillQueue();
