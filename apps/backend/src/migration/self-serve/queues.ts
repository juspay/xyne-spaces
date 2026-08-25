import Bull from 'bull';
import { getBaseRedisOptions } from '@/services/redisFactory';
import { QueueName } from './types';

interface JobRef { migrationId: string; }

/** Two serial (concurrency 1) queues — one-at-a-time for accountability (§5.4). Resume position: `lifo`=front (admin-stopped), normal add=end (failure). */
export class MigrationQueues {
  private readonly queues = new Map<QueueName, Bull.Queue<JobRef>>();

  constructor() {
    for (const name of [QueueName.COLLECTION, QueueName.INGESTION]) {
      this.queues.set(
        name,
        new Bull<JobRef>(name, {
          redis: { ...getBaseRedisOptions('bullmq'), lazyConnect: false },
          defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
          settings: { lockDuration: 5 * 60_000, stalledInterval: 30_000, maxStalledCount: 1 },
        }),
      );
    }
  }

  async enqueue(name: QueueName, migrationId: string, position: 'front' | 'end'): Promise<Bull.Job<JobRef>> {
    const q = this.queue(name);
    await this.evict(q, migrationId);
    return q.add(
      { migrationId },
      { jobId: migrationId, ...(position === 'front' ? { lifo: true } : {}) },
    );
  }

  async removeJob(name: QueueName, migrationId: string): Promise<void> {
    await this.evict(this.queue(name), migrationId);
  }

  async hasJob(name: QueueName, migrationId: string): Promise<boolean> {
    return (await this.queue(name).getJob(migrationId)) != null;
  }

  /** Bull's view of a job: 'active' | 'waiting' | 'delayed' | 'completed' | 'failed' | 'stuck', or null if absent. */
  async jobState(name: QueueName, migrationId: string): Promise<string | null> {
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

  process(name: QueueName, handler: (migrationId: string) => Promise<void>): void {
    this.queue(name).process(1, (job) => handler(job.data.migrationId));
  }

  pause(name: QueueName): Promise<void> { return this.queue(name).pause(); }
  resume(name: QueueName): Promise<void> { return this.queue(name).resume(); }
  isPaused(name: QueueName): Promise<boolean> { return this.queue(name).isPaused(); }

  /** On first-ever init, pause ingestion so approved jobs only stage until someone with SLACK-MIGRATION-INGEST starts it. NX marker keeps restarts from re-pausing in-progress ingestion. */
  async pauseIngestionOnFirstInit(): Promise<void> {
    const q = this.queue(QueueName.INGESTION);
    const firstInit = await q.client.set('slackmig:ingestion:initialized', '1', 'NX');
    if (firstInit) await q.pause();
  }

  private queue(name: QueueName): Bull.Queue<JobRef> {
    const q = this.queues.get(name);
    if (!q) throw new Error(`queue ${name} not initialized`);
    return q;
  }
}
