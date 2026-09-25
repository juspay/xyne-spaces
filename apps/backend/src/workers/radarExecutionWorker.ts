import Bull from 'bull';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { radarExecutionQueue, type RadarExecutionJobData } from '@/queues/radarExecutionQueue';
import { radarExecutionService } from '@/services/radar/radarExecutionService';
import { DatabaseClient } from '@/database/client';
import { runAsServiceActor } from '@/database/tenant/context';
import { radarScopeFor } from '@/services/radar/radarScope';
import { sweepRunLogsQuery } from '@/bypassAcl/radarServices';

const prisma = DatabaseClient.getInstance();

// Concurrency is across SCOPES only: jobId = the scope key means Bull never
// holds two live jobs for one scope, so each thread — and each DM channel — is
// processed serially by construction while different scopes drain in parallel.
const CONCURRENCY = config.radar.workerConcurrency;

/** Retention is a housekeeping floor, not a deadline — hourly is plenty. */
const RUN_LOG_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

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
    return sweepRunLogsQuery();
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
    const { conversationId, channelId, scopeType } = job.data;

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

    // Jobs already queued when this ships carry only a conversationId. Without
    // the channel, an item create would fail on a required column and the drain
    // would burn its retries and skip the window — losing real asks for the
    // length of the cutover. Resolve it instead.
    const resolved =
      channelId && scopeType !== undefined
        ? { channelId, scopeType }
        : await prisma.conversation
            .findUnique({
              where: { conversationId },
              select: { channelId: true, channel: { select: { scopeType: true } } },
            })
            .then(c => ({ channelId: c?.channelId ?? '', scopeType: c?.channel?.scopeType ?? null }));
    if (!resolved.channelId) {
      logger.warn('[RADAR-EXECUTION-WORKER] Conversation has no channel, skipping', {
        conversationId,
      });
      return;
    }
    const scope = radarScopeFor(resolved.scopeType, resolved.channelId, conversationId);
    return runAsServiceActor('radar-execution-worker', conversation.workspaceId, () =>
      radarExecutionService.processThread(scope),
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
