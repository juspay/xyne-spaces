import Redis from 'ioredis';
import { redisService } from '@/services/redisService';
import { MigrationJob, MigrationStatus, MigrationType } from './types';

const TTL_SECONDS = 60 * 60 * 24 * 182; // ~6 months 
const KEY = (id: string) => `slackmig:job:${id}`;
const INDEX = 'slackmig:index';
const DM_LOCK = (workspaceId: string, userId: string) => `slackmig:dmlock:${workspaceId}:${userId}`;
const CHANNEL_LOCK = (workspaceId: string, slackChannelId: string) => `slackmig:chanlock:${workspaceId}:${slackChannelId}`;
const channelKeyOf = (job: MigrationJob): string | undefined =>
  job.type === MigrationType.CHANNEL ? job.channelInput?.slackChannelId : undefined;

/** Source of truth for a migration: a Redis record (6-month TTL). Bull jobs carry only the id; bulk data lives in GCS. */
export class MigrationStore {
  private readonly redis = new Redis(redisService.getRedisConfig());

  async create(job: MigrationJob): Promise<void> {
    await this.persist(job);
    await this.redis.zadd(INDEX, job.createdAt, job.id);
    if (job.type === MigrationType.DM) {
      await this.redis.set(DM_LOCK(job.workspaceId, job.submittedByUserId), job.id, 'EX', TTL_SECONDS);
    }
    const chan = channelKeyOf(job);
    if (chan) await this.redis.set(CHANNEL_LOCK(job.workspaceId, chan), job.id, 'EX', TTL_SECONDS);
  }

  async findById(id: string): Promise<MigrationJob | null> {
    const raw = await this.redis.get(KEY(id));
    return raw ? (JSON.parse(raw) as MigrationJob) : null;
  }

  async update(id: string, patch: Partial<MigrationJob>): Promise<MigrationJob> {
    const current = await this.findById(id);
    if (!current) throw new Error(`migration ${id} not found`);
    const next: MigrationJob = { ...current, ...patch, updatedAt: Date.now() };
    await this.persist(next);
    // Channels are re-migratable: release the per-channel lock once ingestion completes.
    const chan = channelKeyOf(next);
    if (chan && patch.status === MigrationStatus.COMPLETED) {
      await this.redis.del(CHANNEL_LOCK(next.workspaceId, chan));
    }
    return next;
  }

  heartbeat(id: string): Promise<MigrationJob> {
    return this.update(id, { heartbeatAt: Date.now() });
  }

  async addCollected(id: string, conversationId: string, messages: number): Promise<void> {
    const j = await this.mustGet(id);
    j.checkpoint.collectedConversationIds.push(conversationId);
    j.stats.conversations += 1;
    j.stats.messages += messages;
    await this.update(id, { checkpoint: j.checkpoint, stats: j.stats, heartbeatAt: Date.now() });
  }

  async setChannelProgress(id: string, p: { messages: number; start: number; end: number; through: number }): Promise<void> {
    const j = await this.mustGet(id);
    j.stats.messages = p.messages;
    j.channelProgress = { start: p.start, end: p.end, through: p.through };
    await this.update(id, { stats: j.stats, channelProgress: j.channelProgress, heartbeatAt: Date.now() });
  }

  async addIngested(id: string, conversationId: string): Promise<void> {
    const j = await this.mustGet(id);
    j.checkpoint.ingestedConversationIds.push(conversationId);
    await this.update(id, { checkpoint: j.checkpoint, heartbeatAt: Date.now() });
  }

  async isStopRequested(id: string): Promise<boolean> {
    return (await this.findById(id))?.stopRequested ?? false;
  }

  async list(limit: number, offset: number): Promise<MigrationJob[]> {
    const ids = await this.redis.zrevrange(INDEX, offset, offset + limit - 1);
    if (ids.length === 0) return [];
    const rows = await this.redis.mget(ids.map(KEY));
    return rows.filter((r): r is string => !!r).map((r) => JSON.parse(r) as MigrationJob);
  }

  async delete(id: string): Promise<void> {
    const job = await this.findById(id);
    await this.redis.del(KEY(id));
    await this.redis.zrem(INDEX, id);
    if (job?.type === MigrationType.DM) await this.redis.del(DM_LOCK(job.workspaceId, job.submittedByUserId));
    if (job) { const chan = channelKeyOf(job); if (chan) await this.redis.del(CHANNEL_LOCK(job.workspaceId, chan)); }
  }

  /** Enforces "DMs are one-time per person" (§5.6). */
  async hasDmMigration(workspaceId: string, userId: string): Promise<boolean> {
    return (await this.redis.exists(DM_LOCK(workspaceId, userId))) === 1;
  }

  /** One in-flight migration per channel; released on completion so it can be re-run. */
  async hasChannelMigration(workspaceId: string, slackChannelId: string): Promise<boolean> {
    return (await this.redis.exists(CHANNEL_LOCK(workspaceId, slackChannelId))) === 1;
  }

  private async mustGet(id: string): Promise<MigrationJob> {
    const job = await this.findById(id);
    if (!job) throw new Error(`migration ${id} not found`);
    return job;
  }

  private async persist(job: MigrationJob): Promise<void> {
    await this.redis.set(KEY(job.id), JSON.stringify(job), 'EX', TTL_SECONDS);
  }
}
