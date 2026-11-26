/**
 * Notion import jobs in Redis, so History survives restarts and any API pod can answer /mine or
 * take an Approve. One JSON record per job (only the process running a phase writes it) plus a
 * per-user index. Notion tokens are never part of a job.
 */
import { createRedisClient } from '@/services/redisFactory';
import type { NotionImportSummary, NotionSection } from './notionCanvasImporter';

export type NotionJobStatus = 'collecting' | 'awaiting_review' | 'ingesting' | 'completed' | 'failed';

export interface NotionImportJob {
  id: string;
  kind: 'token' | 'member';
  userId: string;
  userEmail: string;
  workspaceId: string;
  status: NotionJobStatus;
  channel?: string;
  notionWorkspace?: string;
  log: string[];
  sections?: NotionSection[]; // set when awaiting review
  summary?: NotionImportSummary;
  error?: string;
  startedAt: number;
  updatedAt: number; // also the liveness signal while collecting/ingesting
  finishedAt?: number;
  stagingPrefix?: string; // collected pages in the migration bucket, kept until ingest (token imports)
}

const TTL_SECONDS = 60 * 60 * 24 * 30;
const HISTORY_LIMIT = 50;
const KEY = (id: string) => `notionmig:job:${id}`;
const USER_INDEX = (workspaceId: string, userId: string) => `notionmig:user:${workspaceId}:${userId}`;
const CLAIM = (id: string) => `notionmig:claim:${id}`;

// A running phase saves at least this often; a job silent for longer lost its process.
export const NOTION_JOB_HEARTBEAT_MS = 30_000;
const STALE_AFTER_MS = 5 * 60_000;

let client: ReturnType<typeof createRedisClient> | null = null;
const redis = () => (client ??= createRedisClient('notion-migration-jobs'));

/** A job still "running" with no save for a while died with its process (restart, deploy, crash). */
function withLiveness(job: NotionImportJob): NotionImportJob {
  const running = job.status === 'collecting' || job.status === 'ingesting';
  if (!running || Date.now() - job.updatedAt < STALE_AFTER_MS) return job;
  return { ...job, status: 'failed', error: 'Interrupted — the server restarted while this import was running. Start it again.' };
}

export const notionJobStore = {
  async save(job: NotionImportJob): Promise<void> {
    await redis().pipeline()
      .set(KEY(job.id), JSON.stringify(job), 'EX', TTL_SECONDS)
      .zadd(USER_INDEX(job.workspaceId, job.userId), job.startedAt, job.id)
      .expire(USER_INDEX(job.workspaceId, job.userId), TTL_SECONDS)
      .exec();
  },

  async get(id: string): Promise<NotionImportJob | null> {
    const raw = await redis().get(KEY(id));
    return raw ? withLiveness(JSON.parse(raw) as NotionImportJob) : null;
  },

  /** The user's imports, newest first. */
  async listForUser(workspaceId: string, userId: string): Promise<NotionImportJob[]> {
    const ids = await redis().zrevrange(USER_INDEX(workspaceId, userId), 0, HISTORY_LIMIT - 1);
    if (!ids.length) return [];
    const raws = await redis().mget(ids.map(KEY));
    return raws.flatMap(raw => (raw ? [withLiveness(JSON.parse(raw) as NotionImportJob)] : []));
  },

  /** Exactly one Approve starts the ingest, whichever pod or click gets there first. */
  async claim(id: string): Promise<boolean> {
    return (await redis().set(CLAIM(id), '1', 'EX', TTL_SECONDS, 'NX')) === 'OK';
  },
};
