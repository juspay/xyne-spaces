import { createRedisClient } from '@/services/redisFactory';
import { Checkpoint, MigrationIssue, MigrationJob, MigrationStatus, MigrationType } from './types';

const TTL_SECONDS = 60 * 60 * 24 * 182; // ~6 months
const KEY = (id: string) => `slackmig:job:${id}`;
const INDEX = 'slackmig:index';
const DM_LOCK = (workspaceId: string, userId: string) => `slackmig:dmlock:${workspaceId}:${userId}`;
const CHANNEL_LOCK = (workspaceId: string, slackChannelId: string) => `slackmig:chanlock:${workspaceId}:${slackChannelId}`;
// Parallel ingest: the set of conversations already ingested (atomic SADD, so many workers on one migration never lose each other's ticks),
// and a once-only claim so exactly one worker runs the finalize (COMPLETED + announce + GCS cleanup).
const INGESTED_SET = (id: string) => `slackmig:ingested:${id}`;
const FINALIZE = (id: string) => `slackmig:finalize:${id}`;
const channelKeyOf = (job: MigrationJob): string | undefined =>
  job.type === MigrationType.CHANNEL ? job.channelInput?.slackChannelId : undefined;

const emptyCheckpoint = (): Checkpoint => ({ totalConversations: 0, collectedConversationIds: [], ingestedConversationIds: [] });

/**
 * Map a MigrationJob-shaped patch onto Redis HASH fields.
 *  - `stats` is flattened to two numeric fields so counts move via atomic HINCRBY, never a read-modify-write of a blob.
 *  - nested objects are stored as JSON in a single field; `stopRequested` as '0'/'1'.
 *  - an explicit `undefined` in the patch means "clear this field" → HDEL (e.g. dropping the token at the approval gate).
 */
function encodePatch(patch: Partial<MigrationJob>): { set: Record<string, string>; del: string[] } {
  const set: Record<string, string> = {};
  const del: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) {
      if (k === 'stats') del.push('statsConversations', 'statsMessages');
      else del.push(k);
      continue;
    }
    switch (k) {
      case 'stats': {
        const s = v as MigrationJob['stats'];
        set.statsConversations = String(s.conversations);
        set.statsMessages = String(s.messages);
        break;
      }
      case 'stopRequested':
        set.stopRequested = v ? '1' : '0';
        break;
      case 'checkpoint':
      case 'channelInput':
      case 'channelProgress':
      case 'issues':
        set[k] = JSON.stringify(v);
        break;
      default:
        set[k] = String(v);
    }
  }
  return { set, del };
}

/**
 * Source of truth for a migration: a Redis HASH (6-month TTL). Bull jobs carry only the id; bulk data lives in GCS.
 *
 * Why a HASH and not a JSON blob: the heartbeat ticker fires every 15s in parallel with the worker's own writes.
 * With a whole-record read-modify-write, a stale heartbeat snapshot would clobber freshly-written stats/checkpoint/issues.
 * Per-field writes make each mutation touch only what it owns — heartbeat writes `heartbeatAt`, counts move via HINCRBY —
 * so no write can lose another's data.
 */
export class MigrationStore {
  // createRedisClient attaches an 'error' listener — a bare `new Redis(...)` would let an
  // 'error' event go unhandled and crash the whole backend if Redis is briefly unreachable.
  private readonly redis = createRedisClient('slack-migration-store');

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
    const h = await this.redis.hgetall(KEY(id));
    if (!h || Object.keys(h).length === 0) return null;
    return decode(h);
  }

  async update(id: string, patch: Partial<MigrationJob>): Promise<MigrationJob> {
    // HSET on a missing key would resurrect a deleted job as a partial record — guard first.
    if ((await this.redis.exists(KEY(id))) !== 1) throw new Error(`migration ${id} not found`);
    const { set, del } = encodePatch({ ...patch, updatedAt: Date.now() });
    const pipe = this.redis.pipeline();
    if (Object.keys(set).length) pipe.hset(KEY(id), set);
    if (del.length) pipe.hdel(KEY(id), ...del);
    pipe.expire(KEY(id), TTL_SECONDS);
    await pipe.exec();
    const next = await this.mustGet(id);
    // Channels are re-migratable: release the per-channel lock once ingestion completes.
    const chan = channelKeyOf(next);
    if (chan && patch.status === MigrationStatus.COMPLETED) {
      await this.redis.del(CHANNEL_LOCK(next.workspaceId, chan));
    }
    return next;
  }

  /** Liveness only — writes the single `heartbeatAt` field so it can never clobber a concurrent stats/checkpoint write. */
  async heartbeat(id: string): Promise<void> {
    const now = String(Date.now());
    await this.redis.hset(KEY(id), 'heartbeatAt', now, 'updatedAt', now);
    await this.redis.expire(KEY(id), TTL_SECONDS);
  }

  /** Forward-progress signal for the stall watchdog: a page actually advanced (distinct from mere liveness/heartbeat). */
  async markProgress(id: string): Promise<void> {
    const now = String(Date.now());
    await this.redis.hset(KEY(id), 'progressAt', now, 'heartbeatAt', now);
    await this.redis.expire(KEY(id), TTL_SECONDS);
  }

  async addCollected(id: string, conversationId: string, messages: number): Promise<void> {
    const cp = await this.readCheckpoint(id);
    cp.collectedConversationIds.push(conversationId);
    const now = String(Date.now());
    const pipe = this.redis.pipeline();
    pipe.hset(KEY(id), 'checkpoint', JSON.stringify(cp), 'progressAt', now, 'heartbeatAt', now, 'updatedAt', now);
    pipe.hincrby(KEY(id), 'statsConversations', 1);
    if (messages) pipe.hincrby(KEY(id), 'statsMessages', messages);
    pipe.expire(KEY(id), TTL_SECONDS);
    await pipe.exec();
  }

  async setChannelProgress(id: string, p: { messages: number; start: number; end: number; through: number }): Promise<void> {
    // Channel message count is live/authoritative (a single conversation), so set it absolute rather than incrementing.
    const now = String(Date.now());
    await this.redis.hset(
      KEY(id),
      'statsMessages', String(p.messages),
      'channelProgress', JSON.stringify({ start: p.start, end: p.end, through: p.through }),
      'progressAt', now,
      'heartbeatAt', now,
      'updatedAt', now,
    );
    await this.redis.expire(KEY(id), TTL_SECONDS);
  }

  async addIngested(id: string, conversationId: string): Promise<void> {
    const cp = await this.readCheckpoint(id);
    cp.ingestedConversationIds.push(conversationId);
    const now = String(Date.now());
    await this.redis.hset(KEY(id), 'checkpoint', JSON.stringify(cp), 'progressAt', now, 'heartbeatAt', now, 'updatedAt', now);
    await this.redis.expire(KEY(id), TTL_SECONDS);
  }

  /**
   * Parallel ingest: mark one conversation done. SADD is atomic, so concurrent workers on the same migration
   * never clobber each other (unlike the checkpoint-blob RMW above). Returns whether this was the first time
   * (increment the count only then, so a re-delivered job can't double-count) and the running total for finalize detection.
   */
  async markConversationDone(id: string, conversationId: string): Promise<{ firstTime: boolean; total: number }> {
    const added = await this.redis.sadd(INGESTED_SET(id), conversationId);
    const firstTime = added === 1;
    if (firstTime) {
      const now = String(Date.now());
      const pipe = this.redis.pipeline();
      pipe.hincrby(KEY(id), 'ingestedCount', 1);
      pipe.hset(KEY(id), 'progressAt', now, 'heartbeatAt', now, 'updatedAt', now);
      pipe.expire(KEY(id), TTL_SECONDS);
      pipe.expire(INGESTED_SET(id), TTL_SECONDS);
      await pipe.exec();
    }
    const total = await this.redis.scard(INGESTED_SET(id));
    return { firstTime, total };
  }

  async isConversationDone(id: string, conversationId: string): Promise<boolean> {
    return (await this.redis.sismember(INGESTED_SET(id), conversationId)) === 1;
  }

  /** Authoritative done count (the set itself, not the derived HINCRBY field) — used to gate finalize. */
  async doneCount(id: string): Promise<number> {
    return this.redis.scard(INGESTED_SET(id));
  }

  /** Seed the done-set from the existing checkpoint (resume / upgrade from the old serial array) and sync the count. */
  async seedDoneSet(id: string, conversationIds: string[]): Promise<void> {
    if (conversationIds.length) await this.redis.sadd(INGESTED_SET(id), ...conversationIds);
    const total = await this.redis.scard(INGESTED_SET(id));
    await this.redis.hset(KEY(id), 'ingestedCount', String(total));
    await this.redis.expire(INGESTED_SET(id), TTL_SECONDS);
  }

  /** Once-only finalize claim: exactly one worker (the one that closed the last conversation) runs COMPLETED + announce + cleanup. */
  async tryClaimFinalize(id: string): Promise<boolean> {
    return (await this.redis.set(FINALIZE(id), '1', 'EX', TTL_SECONDS, 'NX')) === 'OK';
  }

  // Atomic append to the issues JSON array (server-side), so parallel ingest workers appending at once never lose entries.
  private static readonly APPEND_ISSUE_LUA = `
local cur = redis.call('HGET', KEYS[1], 'issues')
local arr = cur and cjson.decode(cur) or {}
table.insert(arr, cjson.decode(ARGV[1]))
redis.call('HSET', KEYS[1], 'issues', cjson.encode(arr), 'heartbeatAt', ARGV[2], 'updatedAt', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return #arr`;

  /** Record a conversation that couldn't be fully collected/ingested so the UI can show it. */
  async addIssue(id: string, issue: MigrationIssue): Promise<void> {
    const now = String(Date.now());
    await this.redis.eval(MigrationStore.APPEND_ISSUE_LUA, 1, KEY(id), JSON.stringify(issue), now, String(TTL_SECONDS));
  }

  async isStopRequested(id: string): Promise<boolean> {
    return (await this.redis.hget(KEY(id), 'stopRequested')) === '1';
  }

  async list(limit: number, offset: number): Promise<MigrationJob[]> {
    const ids = await this.redis.zrevrange(INDEX, offset, offset + limit - 1);
    if (ids.length === 0) return [];
    const pipe = this.redis.pipeline();
    for (const id of ids) pipe.hgetall(KEY(id));
    const res = await pipe.exec();
    if (!res) return [];
    const out: MigrationJob[] = [];
    for (const [, h] of res) {
      const hash = h as Record<string, string> | null;
      if (hash && Object.keys(hash).length > 0) out.push(decode(hash));
    }
    return out;
  }

  async delete(id: string): Promise<void> {
    const job = await this.findById(id);
    await this.redis.del(KEY(id), INGESTED_SET(id), FINALIZE(id));
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

  /** Read just the checkpoint field for an append; the single worker owns these arrays, so a tight RMW here is race-free. */
  private async readCheckpoint(id: string): Promise<Checkpoint> {
    const raw = await this.redis.hget(KEY(id), 'checkpoint');
    return raw ? (JSON.parse(raw) as Checkpoint) : emptyCheckpoint();
  }

  private async persist(job: MigrationJob): Promise<void> {
    const { set } = encodePatch(job);
    await this.redis.hset(KEY(job.id), set);
    await this.redis.expire(KEY(job.id), TTL_SECONDS);
  }
}

/** Reconstruct a MigrationJob from its HASH, coercing numbers/booleans and parsing JSON sub-fields. */
function decode(h: Record<string, string>): MigrationJob {
  const req = (k: string): string => h[k] ?? '';
  const opt = (k: string): string | undefined => h[k];
  const numReq = (k: string): number => Number(h[k] ?? 0);
  const numOpt = (k: string): number | undefined => (h[k] !== undefined ? Number(h[k]) : undefined);
  return {
    id: req('id'),
    type: req('type') as MigrationType,
    status: req('status') as MigrationStatus,
    currentQueue: req('currentQueue') as MigrationJob['currentQueue'],
    workspaceId: req('workspaceId'),
    submittedByUserId: req('submittedByUserId'),
    submittedByName: opt('submittedByName'),
    teamId: req('teamId'),
    ownerSlackId: opt('ownerSlackId'),
    gcsPrefix: req('gcsPrefix'),
    encryptedToken: opt('encryptedToken'),
    channelInput: h.channelInput ? (JSON.parse(h.channelInput) as MigrationJob['channelInput']) : undefined,
    slackChannelName: opt('slackChannelName'),
    xyneChannelName: opt('xyneChannelName'),
    slackChannelCreator: opt('slackChannelCreator'),
    slackChannelCreated: numOpt('slackChannelCreated'),
    channelProgress: h.channelProgress ? (JSON.parse(h.channelProgress) as MigrationJob['channelProgress']) : undefined,
    checkpoint: h.checkpoint ? (JSON.parse(h.checkpoint) as Checkpoint) : emptyCheckpoint(),
    ingestedCount: numOpt('ingestedCount'),
    stats: { conversations: numReq('statsConversations'), messages: numReq('statsMessages') },
    stopRequested: h.stopRequested === '1',
    stopReason: opt('stopReason') as MigrationJob['stopReason'],
    heartbeatAt: numReq('heartbeatAt'),
    progressAt: numOpt('progressAt'),
    createdAt: numReq('createdAt'),
    updatedAt: numReq('updatedAt'),
    completedAt: numOpt('completedAt'),
    ingestStartedAt: numOpt('ingestStartedAt'),
    error: opt('error'),
    issues: h.issues ? (JSON.parse(h.issues) as MigrationIssue[]) : undefined,
  };
}
