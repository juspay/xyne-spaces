import Bull from 'bull';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { radarExecutionQueue, type RadarExecutionJobData } from '@/queues/radarExecutionQueue';
import { radarExecutionService } from '@/services/radar/radarExecutionService';
import { DatabaseClient } from '@/database/client';
import { runAsServiceActor, runAsSystem } from '@/database/tenant/context';

const prisma = DatabaseClient.getInstance();

// Concurrency is across THREADS only: jobId = conversationId means Bull never
// holds two live jobs for the same conversation, so each thread is processed
// serially by construction while different threads drain in parallel.
const CONCURRENCY = config.radar.workerConcurrency;

const RUN_LOG_RETENTION_DAYS = config.radar.runLogRetentionDays;
/** Retention is a housekeeping floor, not a deadline — hourly is plenty. */
const RUN_LOG_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const RUN_LOG_SWEEP_BATCH_SIZE = 5_000;
const RUN_LOG_SWEEP_BATCH_PAUSE_MS = 250;
/** Bounds one sweep's work; the remainder is picked up by the next tick. */
const RUN_LOG_SWEEP_MAX_BATCHES = 40;

class RadarExecutionWorker {
  private isInitialized = false;
  private sweepTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await radarExecutionQueue.initialize();

    const queue = radarExecutionQueue.getQueue();

    // Jobs are added unnamed (see radarExecutionQueue.enqueueThread), so the
    // processor is registered unnamed too.
    queue.process(CONCURRENCY, async (job: Bull.Job<RadarExecutionJobData>) => {
      return this.processJob(job);
    });

    queue.on('failed', (job, err) => {
      // Bull emits 'failed' per attempt, not once at the end. Saying
      // "permanently" on a job Bull is about to retry reads as data loss that
      // has not happened.
      const attempts = job.opts.attempts ?? 1;
      const final = job.attemptsMade >= attempts;
      logger.error(
        `[RADAR-EXECUTION-WORKER] Job ${job.id} ${
          final ? 'permanently failed' : `failed (attempt ${job.attemptsMade}/${attempts}, retrying)`
        } — conversation ${job.data.conversationId}:`,
        err,
      );
    });

    this.startRunLogSweep();

    this.isInitialized = true;
    logger.info(`[RADAR-EXECUTION-WORKER] Started, ready to process jobs (concurrency=${CONCURRENCY})`);
  }

  /**
   * execution_run_logs grows one row per drain pass and carries LLM payloads,
   * so it is swept on a timer; items and mutations are never touched.
   *
   * Batched rather than one DELETE: the first sweep after a long run could
   * match millions of rows, and each batch being its own transaction keeps
   * locks short and the work interruptible.
   */
  private sweepRunLogs(): Promise<void> {
    // Retention spans every tenant by design: runAsSystem leaves the query
    // unfiltered and marks it intentional for the ACL extension.
    return runAsSystem(() => this.sweepRunLogsUnscoped());
  }

  private async sweepRunLogsUnscoped(): Promise<void> {
    const cutoff = new Date(Date.now() - RUN_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let deleted = 0;
    try {
      for (let batch = 0; batch < RUN_LOG_SWEEP_MAX_BATCHES; batch++) {
        const stale = await prisma.executionRunLog.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          take: RUN_LOG_SWEEP_BATCH_SIZE,
        });
        if (stale.length === 0) break;
        const { count } = await prisma.executionRunLog.deleteMany({
          where: { id: { in: stale.map(r => r.id) } },
        });
        deleted += count;
        // Breathe so a large backlog doesn't monopolise the pool.
        await new Promise(resolve => setTimeout(resolve, RUN_LOG_SWEEP_BATCH_PAUSE_MS));
      }
      if (deleted > 0) {
        logger.info('[RADAR-EXECUTION-WORKER] Swept run logs', {
          deleted,
          olderThanDays: RUN_LOG_RETENTION_DAYS,
        });
      }
    } catch (error) {
      // Retention must never take the worker down.
      logger.warn('[RADAR-EXECUTION-WORKER] Run-log sweep failed', { deleted, error });
    }
  }

  private startRunLogSweep(): void {
    // Jittered, with no sweep on boot: nothing elects a leader, so overlapping
    // replicas are expected and survivable (a second sweeper finds fewer
    // rows) — but N replicas sweeping the instant they come up is not.
    const jitterMs = Math.floor(Math.random() * RUN_LOG_SWEEP_INTERVAL_MS);
    this.sweepTimer = setTimeout(() => {
      void this.sweepRunLogs();
      this.sweepTimer = setInterval(
        () => void this.sweepRunLogs(),
        RUN_LOG_SWEEP_INTERVAL_MS,
      );
      this.sweepTimer.unref?.();
    }, jitterMs);
    this.sweepTimer.unref?.();
  }

  private async processJob(job: Bull.Job<RadarExecutionJobData>): Promise<void> {
    const { conversationId } = job.data;

    // Background job → no HTTP tenant scope. Resolve the thread's workspace
    // and open a tenant context so writes get workspaceId stamped.
    const conversation = await prisma.conversation.findUnique({
      where: { conversationId },
      select: { workspaceId: true },
    });
    if (!conversation?.workspaceId) {
      // Nothing to process (thread gone or unstamped) — completing the job is
      // correct; a retry would find the same state.
      logger.warn('[RADAR-EXECUTION-WORKER] Conversation not found or has no workspaceId, skipping', {
        conversationId,
      });
      return;
    }

    return runAsServiceActor('radar-execution-worker', conversation.workspaceId, () =>
      radarExecutionService.processThread(conversationId),
    );
  }

  async shutdown(): Promise<void> {
    if (this.sweepTimer) {
      // Covers both phases: the jittered setTimeout and the interval it starts.
      clearTimeout(this.sweepTimer);
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    await radarExecutionQueue.close();
    this.isInitialized = false;
    logger.info('[RADAR-EXECUTION-WORKER] Shut down');
  }
}

export const radarExecutionWorker = new RadarExecutionWorker();
