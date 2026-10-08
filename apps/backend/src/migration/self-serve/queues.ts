import Bull from 'bull';
import { getBaseRedisOptions } from '@/services/redisFactory';
import { QueueName } from './types';

interface JobRef { migrationId: string; conversationId?: string; }

/** Bull queue a phase runs on: collection gets one per workspace so tenants collect in parallel; the rest are global. */
export const queueFor = (phase: QueueName, workspaceId: string): string =>
  phase === QueueName.COLLECTION ? `${phase}--${workspaceId}` : phase;

/**
 * Collection + ingestion-planner run one-at-a-time per Bull queue (§5.4). A third queue, CONV_INGEST, is fanned out:
 * the planner drops one job per conversation and every worker process drains it in parallel.
 * Resume position: `lifo`=front (admin-stopped / interrupted), normal add=end (failure).
 * Queues are opened lazily by name — see queueFor().
 */
export class MigrationQueues {
  private readonly queues = new Map<string, Bull.Queue<JobRef>>();

  async enqueue(name: string, migrationId: string, position: 'front' | 'end'): Promise<Bull.Job<JobRef>> {
    const q = this.queue(name);
    await this.evict(q, migrationId);
    return q.add(
      { migrationId },
      { jobId: migrationId, ...(position === 'front' ? { lifo: true } : {}) },
    );
  }

  async removeJob(name: string, migrationId: string): Promise<void> {
    await this.evict(this.queue(name), migrationId);
  }

  async hasJob(name: string, migrationId: string): Promise<boolean> {
    return (await this.queue(name).getJob(migrationId)) != null;
  }

  /** Bull's view of a job: 'active' | 'waiting' | 'delayed' | 'completed' | 'failed' | 'stuck', or null if absent. */
  async jobState(name: string, migrationId: string): Promise<string | null> {
    const job = await this.queue(name).getJob(migrationId);
    return job ? job.getState() : null;
  }

  private async evict(q: Bull.Queue<JobRef>, migrationId: string): Promise<void> {
    const existing = await q.getJob(migrationId);
    if (!existing) return;
    await existing.remove().catch(async () => {
      await existing.moveToFailed({ message: 'superseded' }, true).catch(() => undefined);
      await existing.remove().catch(() => undefined);
    });
  }

  process(name: string, handler: (migrationId: string) => Promise<void>): void {
    this.queue(name).process(1, (job) => handler(job.data.migrationId));
  }

  /**
   * Fan-out enqueue: one job per conversation. jobId dedups, so re-running the planner (resume) is idempotent.
   * attempts:3 lets a transient infra blip (Redis/DB) retry — safe because re-ingesting a conversation is idempotent
   * (done-set skip + per-message dedup), so a retry only back-fills what's missing.
   */
  async enqueueConv(migrationId: string, conversationId: string): Promise<void> {
    await this.queue(QueueName.CONV_INGEST).add(
      { migrationId, conversationId },
      { jobId: `${migrationId}:${conversationId}`, attempts: 3, backoff: { type: 'fixed', delay: 5000 } },
    );
  }

  /** Drain conversation jobs `concurrency`-at-a-time in THIS process; run in every worker process for cross-process parallelism. */
  processConv(concurrency: number, handler: (migrationId: string, conversationId: string) => Promise<void>): void {
    this.queue(QueueName.CONV_INGEST).process(Math.max(1, concurrency), (job) =>
      handler(job.data.migrationId, job.data.conversationId ?? ''),
    );
  }

  /** migrationIds by queue: active (running now) + waiting in processing order (next first), for queue-position display. */
  async getQueueOrder(name: string): Promise<{ activeIds: string[]; waitingIds: string[] }> {
    const q = this.queue(name);
    const [active, waiting] = await Promise.all([q.getActive(), q.getWaiting()]);
    // getWaiting() already returns next-first: Bull reads the wait list from the tail it drains (where lifo 'front' jobs sit).
    return { activeIds: active.map((j) => j.data.migrationId), waitingIds: waiting.map((j) => j.data.migrationId) };
  }

  pause(name: string): Promise<void> { return this.queue(name).pause(); }
  resume(name: string): Promise<void> { return this.queue(name).resume(); }
  isPaused(name: string): Promise<boolean> { return this.queue(name).isPaused(); }

  // Local pause/resume affect ONLY this worker's consumption (not the shared queue). The leader lease uses these to
  // keep the singleton queues (collection lanes + ingestion planner) draining on exactly one worker cluster-wide.
  pauseLocal(name: string): Promise<void> { return this.queue(name).pause(true); }
  resumeLocal(name: string): Promise<void> { return this.queue(name).resume(true); }

  /** Live Bull counts for one queue — drives the dashboard queue-depth gauges. (completed/failed read ~0 here
   *  because the queues use removeOnComplete/removeOnFail; waiting/active/delayed are the meaningful ones.) */
  async getStats(name: string): Promise<{ waiting: number; active: number; completed: number; failed: number; delayed: number; total: number }> {
    const q = this.queue(name);
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      q.getWaitingCount(), q.getActiveCount(), q.getCompletedCount(), q.getFailedCount(), q.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed, total: waiting + active + completed + failed + delayed };
  }

  /** On first-ever init, pause ingestion so approved jobs only stage until someone with SLACK-MIGRATION-INGEST starts it. NX marker keeps restarts from re-pausing in-progress ingestion. */
  async pauseIngestionOnFirstInit(): Promise<void> {
    const q = this.queue(QueueName.INGESTION);
    const firstInit = await q.client.set('slackmig:ingestion:initialized', '1', 'NX');
    if (firstInit) await q.pause();
  }

  /** Kill-switch (MIGRATION_INGEST_CONTROL off): globally pause BOTH the planner and the fan-out so nothing ingests
   *  cluster-wide — pausing the planner alone would let already-fanned-out conversations keep draining. Returns true
   *  if it paused anything. Global (Redis) pause, so one pod is enough and repeated calls are idempotent. */
  async pauseIngestionIfRunning(): Promise<boolean> {
    let paused = false;
    for (const name of [QueueName.INGESTION, QueueName.CONV_INGEST]) {
      const q = this.queue(name);
      if (!(await q.isPaused())) { await q.pause(); paused = true; }
    }
    return paused;
  }

  private queue(name: string): Bull.Queue<JobRef> {
    let q = this.queues.get(name);
    if (!q) {
      q = new Bull<JobRef>(name, {
        redis: { ...getBaseRedisOptions('bullmq'), lazyConnect: false },
        defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
        // lockDuration covers the slowest single-conversation job so an in-progress one isn't treated as stalled.
        settings: { lockDuration: 30 * 60_000, stalledInterval: 30_000, maxStalledCount: 1 },
      });
      this.queues.set(name, q);
    }
    return q;
  }
}
