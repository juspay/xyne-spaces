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

  /** An instance op-stream's head id — the cursor a fresh subscriber tails from after a snapshot. */
  async head(instanceKey: string): Promise<string> {
    const last = await redisService.getClient().xrevrange(streamKey(instanceKey), '+', '-', 'COUNT', 1);
    return last.length > 0 ? last[0][0] : '0';
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
