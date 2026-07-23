import { redisService } from "../../redis.js";

/**
 * Durable record of what the runner's agents did with each error, keyed by
 * errorKey (Redis on claw-auth's existing instance, 7d TTL). Read before
 * working an item (recent-completion dedup) and by the admin /fixes endpoint.
 */

export type FixStatus =
  | "running"    // agent spawned, in progress
  | "completed"  // agent finished (its summary says what it did — incl. any PR)
  | "failed";    // agent errored / timed out

export interface FixRecord {
  errorKey: string;
  bucket: string;
  status: FixStatus;
  message: string;      // the error being worked (label for the activity table)
  sessionId?: string;   // the agent run
  conversationId?: string; // the run's conversation — deep-links to the chat view
  summary?: string;     // the agent's FULL final report — PR link and all
  attempts: number;
  updatedAt: number;
}

const KEY = (errorKey: string) => `errpipe:fix:${errorKey}`;
const INDEX = "errpipe:fix:index";
const TTL_SECONDS = 7 * 24 * 60 * 60;

export async function getFixRecord(errorKey: string): Promise<FixRecord | null> {
  const raw = await redisService.getConnection().get(KEY(errorKey));
  return raw ? (JSON.parse(raw) as FixRecord) : null;
}

export async function saveFixRecord(rec: FixRecord): Promise<void> {
  const record = { ...rec, updatedAt: Date.now() };
  const r = redisService.getConnection();
  await r.set(KEY(record.errorKey), JSON.stringify(record), "EX", TTL_SECONDS);
  await r.zadd(INDEX, record.updatedAt, record.errorKey);
  await r.zremrangebyscore(INDEX, "-inf", Date.now() - (TTL_SECONDS + 86_400) * 1000).catch(() => {});
}

/** Most-recently-updated fix records, newest first (for the admin UI). */
export async function listFixRecords(limit = 200): Promise<FixRecord[]> {
  const r = redisService.getConnection();
  const keys = await r.zrevrange(INDEX, 0, limit - 1);
  if (keys.length === 0) return [];
  const raws = await r.mget(keys.map(KEY));
  return raws.filter((x): x is string => x !== null).map((x) => JSON.parse(x) as FixRecord);
}
