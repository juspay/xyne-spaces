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
  orgId: string;
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

const KEY = (orgId: string, errorKey: string) => `errpipe:fix:${orgId}:${errorKey}`;
const INDEX = "errpipe:fix:index";
const TTL_SECONDS = 7 * 24 * 60 * 60;

export async function getFixRecord(orgId: string, errorKey: string): Promise<FixRecord | null> {
  const raw = await redisService.getConnection().get(KEY(orgId, errorKey));
  return raw ? (JSON.parse(raw) as FixRecord) : null;
}

export async function saveFixRecord(rec: FixRecord): Promise<void> {
  const record = { ...rec, updatedAt: Date.now() };
  const r = redisService.getConnection();
  const indexKey = `${record.orgId}:${record.errorKey}`;
  await r.set(KEY(record.orgId, record.errorKey), JSON.stringify(record), "EX", TTL_SECONDS);
  await r.zadd(INDEX, record.updatedAt, indexKey);
  await r.zremrangebyscore(INDEX, "-inf", Date.now() - (TTL_SECONDS + 86_400) * 1000).catch(() => {});
}

/** Most-recently-updated fix records, newest first (for the admin UI). */
export async function listFixRecords(limit = 200, orgId?: string): Promise<FixRecord[]> {
  const r = redisService.getConnection();
  const keys = await r.zrevrange(INDEX, 0, limit - 1);
  if (keys.length === 0) return [];
  const raws = await r.mget(keys.map((key) => {
    const separator = key.indexOf(":");
    return KEY(key.slice(0, separator), key.slice(separator + 1));
  }));
  return raws.filter((x): x is string => x !== null)
    .map((x) => JSON.parse(x) as FixRecord)
    .filter((record) => !orgId || record.orgId === orgId);
}
