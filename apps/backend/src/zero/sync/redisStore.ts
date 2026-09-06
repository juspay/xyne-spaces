import { redisService } from '@/services/redisService';
import type { CompactedRow, StreamDiff } from './streamState';

/**
 * Durable sync state in Redis, split by the two levels it belongs to:
 *  - per QUERY-INSTANCE: snapshot hash `sync:snap:{instanceKey}` (hydration source)
 *    + op-stream `sync:stream:{instanceKey}` (delta for tailers)
 *  - per CLIENT-GROUP:  resume cursor `sync:cookie:{clientGroupID}` (the CVR version,
 *    which advances across every query in the group — shared once instances are packed)
 */
const PREFIX = 'sync';
const snapKey = (instanceKey: string): string => `${PREFIX}:snap:${instanceKey}`;
const streamKey = (instanceKey: string): string => `${PREFIX}:stream:${instanceKey}`;
const cookieKey = (clientGroupID: string): string => `${PREFIX}:cookie:${clientGroupID}`;

const STREAM_MAXLEN = 10_000;
const CLEAR_DIFF = JSON.stringify({ upserts: [], deletes: [], cleared: true });
const EMPTY_DIFF = JSON.stringify({ upserts: [], deletes: [] });

/** XRANGE returns fields as a flat [f, v, f, v, …] array — collapse to an object. */
function fieldsToObject(fields: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
  return obj;
}

/**
 * Compare two Redis stream ids (`ms-seq`). Returns <0, 0, >0. Lexicographic comparison
 * is wrong once the millisecond part differs in length, so compare the two numeric parts.
 */
export function compareStreamId(a: string, b: string): number {
  const [ams, aseq] = a.split('-').map(Number);
  const [bms, bseq] = b.split('-').map(Number);
  return ams !== bms ? ams - bms : (aseq || 0) - (bseq || 0);
}

export class RedisStreamStore {
  /** Mirror one poke's compaction diff to an instance's snapshot hash + op-stream. */
  async applyDiff(instanceKey: string, version: string, diff: StreamDiff): Promise<void> {
    const snap = snapKey(instanceKey);
    const pipeline = redisService.getClient().pipeline();
    if (diff.cleared) pipeline.del(snap);
    for (const up of diff.upserts) {
      pipeline.hset(snap, up.key, JSON.stringify({ tableName: up.tableName, row: up.row }));
    }
    if (diff.deletes.length > 0) pipeline.hdel(snap, ...diff.deletes);
    pipeline.xadd(streamKey(instanceKey), 'MAXLEN', '~', STREAM_MAXLEN, '*', 'v', version, 'diff', JSON.stringify(diff));
    await pipeline.exec();
  }

  /** Current compacted rows for an instance (hydration). */
  async snapshot(instanceKey: string): Promise<CompactedRow[]> {
    const hash = await redisService.getClient().hgetall(snapKey(instanceKey));
    return Object.values(hash).map((v) => JSON.parse(v) as CompactedRow);
  }

  /** The op-stream's last entry (id + cookie version + parsed diff), or null if empty. */
  async #lastEntry(
    instanceKey: string,
  ): Promise<{ id: string; version: string; diff: StreamDiff } | null> {
    const last = await redisService.getClient().xrevrange(streamKey(instanceKey), '+', '-', 'COUNT', 1);
    if (last.length === 0) return null;
    const map = fieldsToObject(last[0][1]);
    return { id: last[0][0], version: map.v ?? '', diff: JSON.parse(map.diff ?? CLEAR_DIFF) as StreamDiff };
  }

  /**
   * Make a materialized instance visible to the fan-out. A NON-EMPTY instance already has
   * data entries in its op-stream, so it's hydrated the moment its first `applyDiff` lands.
   * An EMPTY instance writes no rows — zero-cache reports it via `gotQueriesPatch` but the
   * stream carries no data — so we append a single empty marker to flip `isHydrated` and
   * wake any deferred client. No-op once the tail is a real materialization; a `cleared`
   * tail (reset in progress) is NOT one, so an empty re-materialize still marks.
   */
  async markHydrated(instanceKey: string, version: string): Promise<void> {
    const last = await this.#lastEntry(instanceKey);
    if (last && !last.diff.cleared) return;
    await redisService
      .getClient()
      .xadd(streamKey(instanceKey), 'MAXLEN', '~', STREAM_MAXLEN, '*', 'v', version, 'diff', EMPTY_DIFF);
  }

  /**
   * Whether the instance is currently materialized. The op-stream's tail tells us: a data
   * entry or empty marker = hydrated; nothing, or a `cleared` tail (a reset that dropped
   * the snapshot and is awaiting re-materialize), = NOT hydrated — so the fan-out defers
   * rather than snapshotting the just-emptied state.
   */
  async isHydrated(instanceKey: string): Promise<boolean> {
    const last = await this.#lastEntry(instanceKey);
    return last !== null && !last.diff.cleared;
  }

  /** An instance op-stream's head id — the cursor a fresh subscriber tails from after a snapshot. */
  async head(instanceKey: string): Promise<string> {
    return (await this.#lastEntry(instanceKey))?.id ?? '0';
  }

  /**
   * The head id AND its content version (cookie `stateVersion`). A snapshot's rows all
   * reflect the DB state at the latest applied poke, so the client stamps them with this
   * one version for cross-stream apply-if-newer.
   */
  async headWithVersion(instanceKey: string): Promise<{ id: string; version: string }> {
    const last = await this.#lastEntry(instanceKey);
    return last ? { id: last.id, version: last.version } : { id: '0', version: '' };
  }

  /** The oldest surviving op-stream id, or null if empty. Used for the resume trim check. */
  async firstId(instanceKey: string): Promise<string | null> {
    const first = await redisService.getClient().xrange(streamKey(instanceKey), '-', '+', 'COUNT', 1);
    return first.length > 0 ? first[0][0] : null;
  }

  /**
   * Op-stream diffs strictly after `sinceOffset` (a resume replay), each with its stream
   * id and version. Exclusive start (`(id`), so a client that already applied `sinceOffset`
   * receives only what it missed. Caller must first verify `sinceOffset` is still retained
   * (see `firstId`) — Redis silently returns a partial range past a trimmed id.
   */
  async readSince(
    instanceKey: string,
    sinceOffset: string,
  ): Promise<Array<{ id: string; version: string; diff: StreamDiff }>> {
    const entries = await redisService
      .getClient()
      .xrange(streamKey(instanceKey), `(${sinceOffset}`, '+');
    return entries.map(([id, fields]) => {
      const map = fieldsToObject(fields);
      return { id, version: map.v ?? '', diff: JSON.parse(map.diff ?? CLEAR_DIFF) as StreamDiff };
    });
  }

  /** Persisted resume cursor for a client group ('' = fresh connect). */
  async saveCookie(clientGroupID: string, cookie: string): Promise<void> {
    await redisService.getClient().set(cookieKey(clientGroupID), cookie);
  }

  async loadCookie(clientGroupID: string): Promise<string> {
    return (await redisService.getClient().get(cookieKey(clientGroupID))) ?? '';
  }

  /**
   * CVR-cleared reset: drop the group's resume cursor and, for each instance it
   * carries, wipe the snapshot and append a `clear` so existing tailers reset.
   * The next fresh hydration rebuilds the snapshots.
   */
  async reset(clientGroupID: string, instanceKeys: readonly string[]): Promise<void> {
    const pipeline = redisService.getClient().pipeline();
    pipeline.del(cookieKey(clientGroupID));
    for (const instanceKey of instanceKeys) {
      pipeline.del(snapKey(instanceKey));
      pipeline.xadd(streamKey(instanceKey), 'MAXLEN', '~', STREAM_MAXLEN, '*', 'v', '', 'diff', CLEAR_DIFF);
    }
    await pipeline.exec();
  }

  async teardownInstance(instanceKey: string): Promise<void> {
    await redisService.getClient().del(snapKey(instanceKey), streamKey(instanceKey));
  }

  async teardownGroup(clientGroupID: string): Promise<void> {
    await redisService.getClient().del(cookieKey(clientGroupID));
  }
}
