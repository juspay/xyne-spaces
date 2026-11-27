import { AsyncLocalStorage } from 'node:async_hooks';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

/*
 * Load limits for /api/analytics-query.
 *
 * withTimeout stops waiting after QUERY_TIMEOUT, but Postgres keeps running the query. So the
 * limit here counts database work that is still running, not requests still waiting: a query
 * that timed out keeps holding its slot until Postgres finishes it. A caller over the limit is
 * refused instead of queued, so slow queries can't pile up behind each other.
 */

/** Who the running query belongs to, set by the controller for the whole request. */
export type QueryOwner = { userId: string; workspaceId: string };

export const queryOwner = new AsyncLocalStorage<QueryOwner>();

/** Database calls still running at once, per person and per workspace (per server). */
const MAX_RUNNING_PER_USER = 4;
const MAX_RUNNING_PER_WORKSPACE = 12;
/** Query requests per person per minute (all servers). */
const MAX_PER_MINUTE = 120;

const running = new Map<string, number>();
const userKey = (o: QueryOwner) => `u:${o.workspaceId}:${o.userId}`;
const workspaceKey = (o: QueryOwner) => `w:${o.workspaceId}`;

const bump = (key: string, by: number) => {
  const n = (running.get(key) ?? 0) + by;
  if (n <= 0) running.delete(key);
  else running.set(key, n);
};

/**
 * Counts `promise` as running database work for the current owner until it settles (not until
 * the caller stops waiting).
 */
export function trackRunning<T>(promise: Promise<T>): Promise<T> {
  const owner = queryOwner.getStore();
  if (!owner) return promise;
  bump(userKey(owner), 1);
  bump(workspaceKey(owner), 1);
  const release = () => {
    bump(userKey(owner), -1);
    bump(workspaceKey(owner), -1);
  };
  promise.then(release, release);
  return promise;
}

/** Why this owner can't start another query now, or null. */
export function capacityError(owner: QueryOwner): string | null {
  if ((running.get(userKey(owner)) ?? 0) >= MAX_RUNNING_PER_USER) {
    return 'Your earlier queries are still running; try again shortly';
  }
  if ((running.get(workspaceKey(owner)) ?? 0) >= MAX_RUNNING_PER_WORKSPACE) {
    return 'Too many analytics queries are running in this workspace; try again shortly';
  }
  return null;
}

/** False once this person passes MAX_PER_MINUTE requests in the current minute. */
export async function withinRate(owner: QueryOwner): Promise<boolean> {
  const key = `aq:rate:${owner.workspaceId}:${owner.userId}:${Math.floor(Date.now() / 60_000)}`;
  try {
    const client = redisService.getClient();
    const n = await client.incr(key);
    if (n === 1) await client.expire(key, 61);
    return n <= MAX_PER_MINUTE;
  } catch (e) {
    // Redis down: the running-query limit above still applies.
    logger.warn('[analytics-query] rate counter unavailable', { error: e instanceof Error ? e.message : String(e) });
    return true;
  }
}
