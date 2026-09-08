import { redisService } from '@/services/redisService';
import { fenceKey } from './ownership';
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
/** Per-GROUP subscription registry: instanceKey → descriptor, so a group's owner can materialize
 *  every subscribed instance — including ones only a REMOTE pod wants — that it never saw locally. */
const registryKey = (clientGroupID: string): string => `${PREFIX}:ginst:${clientGroupID}`;
/** The zero-cache clientGroupID a group's tap is CURRENTLY using — it rotates on a CVR self-heal
 *  reset, and the cookie is saved under the rotated id. Persisted (fenced) under the STABLE lease
 *  key so a takeover resumes under the same id + warm cookie instead of a cold rehydrate. */
const zgroupKey = (clientGroupID: string): string => `${PREFIX}:zgroup:${clientGroupID}`;

const STREAM_MAXLEN = 10_000;
const CLEAR_DIFF = JSON.stringify({ upserts: [], deletes: [], cleared: true });
const EMPTY_DIFF = JSON.stringify({ upserts: [], deletes: [] });
/** Deterministic "instance fully (re)materialized" boundary — emitted at the got-transition for
 *  grant instances so the fan-out marks it usable-for-gating only when COMPLETE (not on a partial
 *  mid-rehydration entry). Appended AFTER the poke's row entries, so it is the last thing on the
 *  stream for that instance this poke. */
const RESYNC_DIFF = JSON.stringify({ upserts: [], deletes: [], resynced: true });

/**
 * Multi-pod fencing token, carried from `ownership.acquireGroup`. When a mutating write is
 * passed a guard, the write runs as a single Lua script gated on `GET sync:fence:{G} == token`,
 * so a paused/zombie ex-owner whose lease expired cannot corrupt the shared snapshot/stream.
 * The token is CARRIED (never re-read via `fenceOf`, which is racy) — the value from the
 * acquisition IS the authority. No guard → the write runs unfenced (single-replica path,
 * unchanged and backward-compatible).
 *
 * NOTE: the fenced scripts (e.g. RESET) touch per-instance snap/stream keys passed via ARGV
 * rather than declared in KEYS — legal on standalone Redis (the sync keyspace is single-Redis
 * by design, one clock). A future Redis Cluster move would require hash-tagging the fence and
 * data keys into one slot and reworking fencing accordingly, not just re-declaring KEYS.
 */
export type FenceGuard = { groupKey: string; token: number };

/** `applied` = the write happened; `stale` = the fence rejected it → caller must FULLY demote. */
export type FenceOutcome = 'applied' | 'stale';

/**
 * Every fenced script begins with this preamble. A MISSING/nil fence compares unequal to any
 * token (never a 0-default — an evicted fence must read STALE, not accidentally match), so a
 * zombie is rejected even if the counter was wiped. Returns the Lua string `'STALE'` on reject.
 */
const FENCE_GATE = `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 'STALE' end\n`;

/**
 * applyDiff, fenced. Upserts arrive as a cjson-encoded FLAT array of already-stringified
 * [field, value, field, value, …] pairs — Lua does NOT re-encode the values, so the bytes
 * HSET stores are identical to the unfenced `JSON.stringify` path. deletes = cjson array.
 * HSET/HDEL are CHUNKED because a single `unpack` is bounded by Lua's LUAI_MAXCSTACK (~8000
 * args) — a large hydration diff (a getUsersV2-class instance) would otherwise throw and fail
 * the whole fenced write; chunk sizes stay well under the limit (batch stride is even so each
 * HSET chunk lands on whole field/value pairs).
 * KEYS=[fence, snap, stream]  ARGV=[token, cleared('1'|'0'), upsertPairs, deletes, maxlen, version, diff]
 */
const APPLY_DIFF = `${FENCE_GATE}
if ARGV[2] == '1' then redis.call('DEL', KEYS[2]) end
local ups = cjson.decode(ARGV[3])
for i = 1, #ups, 2000 do
  redis.call('HSET', KEYS[2], unpack(ups, i, math.min(i + 1999, #ups)))
end
local dels = cjson.decode(ARGV[4])
for i = 1, #dels, 4000 do
  redis.call('HDEL', KEYS[2], unpack(dels, i, math.min(i + 3999, #dels)))
end
redis.call('XADD', KEYS[3], 'MAXLEN', '~', ARGV[5], '*', 'v', ARGV[6], 'diff', ARGV[7])
return 'OK'`;

/**
 * markHydrated, fenced. Reads the tail INSIDE the script (atomic with the append): if the tail
 * is a real materialization (a non-`cleared` diff) it is already hydrated → no-op; otherwise
 * (empty stream, or a `cleared` reset tail) append the empty marker to flip isHydrated.
 * KEYS=[fence, stream]  ARGV=[token, maxlen, version, emptyDiff]
 */
const MARK_HYDRATED = `${FENCE_GATE}
local last = redis.call('XREVRANGE', KEYS[2], '+', '-', 'COUNT', 1)
if #last > 0 then
  local fields = last[1][2]
  for i = 1, #fields, 2 do
    if fields[i] == 'diff' then
      if not cjson.decode(fields[i + 1]).cleared then return 'OK' end
      break
    end
  end
end
redis.call('XADD', KEYS[2], 'MAXLEN', '~', ARGV[2], '*', 'v', ARGV[3], 'diff', ARGV[4])
return 'OK'`;

/**
 * reset, fenced. DEL the group cookie, then per instance DEL its snapshot + append a `clear`.
 * snap/stream keys arrive as parallel cjson arrays (computed caller-side).
 * KEYS=[fence, cookie]  ARGV=[token, snaps, streams, maxlen, clearDiff]
 */
const RESET = `${FENCE_GATE}
redis.call('DEL', KEYS[2])
local snaps = cjson.decode(ARGV[2])
local streams = cjson.decode(ARGV[3])
for i = 1, #snaps do
  redis.call('DEL', snaps[i])
  redis.call('XADD', streams[i], 'MAXLEN', '~', ARGV[4], '*', 'v', '', 'diff', ARGV[5])
end
return 'OK'`;

/** teardownInstance, fenced. KEYS=[fence, snap, stream]  ARGV=[token] */
const TEARDOWN_INSTANCE = `${FENCE_GATE}
redis.call('DEL', KEYS[2], KEYS[3])
return 'OK'`;

/** teardownGroup, fenced. Drops the resume cursor, subscription registry, AND the zgroup pointer.
 *  KEYS=[fence, cookie, registry, zgroup]  ARGV=[token] */
const TEARDOWN_GROUP = `${FENCE_GATE}
redis.call('DEL', KEYS[2], KEYS[3], KEYS[4])
return 'OK'`;

/** saveCookie, fenced. KEYS=[fence, cookie]  ARGV=[token, cookie] */
const SAVE_COOKIE = `${FENCE_GATE}
redis.call('SET', KEYS[2], ARGV[2])
return 'OK'`;

/** saveZGroup, fenced. KEYS=[fence, zgroup]  ARGV=[token, zeroGroupID] */
const SAVE_ZGROUP = `${FENCE_GATE}
redis.call('SET', KEYS[2], ARGV[2])
return 'OK'`;

/** deregisterInstance, fenced (owner-only prune). KEYS=[fence, registry]  ARGV=[token, instanceKey] */
const DEREGISTER = `${FENCE_GATE}
redis.call('HDEL', KEYS[2], ARGV[2])
return 'OK'`;

/**
 * atomic per-poke write (C-FIX-ATOMIC). Applies EVERY touched instance's diff + the group
 * cookie in ONE script — so a poke is all-or-nothing and ordered by construction (closes the
 * cross-poke reorder + partial-persist races), and costs 1 Redis RT instead of K+1. Per-instance
 * snap/stream keys arrive in ARGV as a cjson array (same pattern as RESET — legal on standalone
 * Redis, one keyspace/clock). Each entry: `{s:snap, x:stream, c:'1'|'0'(cleared), u:[f,v,…]upserts,
 * d:[keys]deletes, j:diffJson}`. HSET/HDEL chunked past Lua's unpack limit, as in APPLY_DIFF.
 * An empty-but-just-`got` instance is passed with j=EMPTY_DIFF, u/d=[] → its XADD flips isHydrated.
 */
const APPLY_POKE_BODY = `
local cookie = ARGV[COOKIE_ARG]
local maxlen = ARGV[MAXLEN_ARG]
local instances = cjson.decode(ARGV[INSTANCES_ARG])
for _, inst in ipairs(instances) do
  if inst.c == '1' then redis.call('DEL', inst.s) end
  for i = 1, #inst.u, 2000 do redis.call('HSET', inst.s, unpack(inst.u, i, math.min(i + 1999, #inst.u))) end
  for i = 1, #inst.d, 4000 do redis.call('HDEL', inst.s, unpack(inst.d, i, math.min(i + 3999, #inst.d))) end
  redis.call('XADD', inst.x, 'MAXLEN', '~', maxlen, '*', 'v', cookie, 'diff', inst.j)
end
redis.call('SET', KEYS[COOKIE_KEY], cookie)
return 'OK'`;
// Fenced: KEYS=[fence, cookie]  ARGV=[token, cookie, maxlen, instancesJSON]
const APPLY_POKE_FENCED =
  FENCE_GATE + APPLY_POKE_BODY.replace('COOKIE_ARG', '2').replace('MAXLEN_ARG', '3').replace('INSTANCES_ARG', '4').replace('COOKIE_KEY', '2');
// Unfenced: KEYS=[cookie]  ARGV=[cookie, maxlen, instancesJSON]
const APPLY_POKE =
  APPLY_POKE_BODY.replace('COOKIE_ARG', '1').replace('MAXLEN_ARG', '2').replace('INSTANCES_ARG', '3').replace('COOKIE_KEY', '1');

/** One poke's worth of persistence: every touched instance's diff + the newly-hydrated instances + the cookie. */
export interface PokeWrite {
  clientGroupID: string;
  cookie: string;
  /** instanceKey → its compacted diff (from the demux). */
  diffs: Map<string, StreamDiff>;
  /** Instances that transitioned to `got` this poke (hydration markers); ones already in `diffs` are skipped. */
  newlyGot: readonly string[];
  /** Grant instances to stamp with a `{resynced:true}` marker this poke (their got-transition) — the
   *  deterministic complete-boundary the fan-out gates cold-defer on. Appended after row entries. */
  resyncMarkers?: readonly string[];
}

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
  /** Run a fenced Lua script; `'STALE'` (fence mismatch/missing) → `stale`, else `applied`. */
  async #fenced(
    script: string,
    keys: readonly string[],
    args: readonly (string | number)[],
  ): Promise<FenceOutcome> {
    const r = await redisService
      .getClient()
      .eval(script, keys.length, ...(keys as string[]), ...(args as (string | number)[]));
    return r === 'STALE' ? 'stale' : 'applied';
  }

  /** Mirror one poke's compaction diff to an instance's snapshot hash + op-stream. */
  async applyDiff(
    instanceKey: string,
    version: string,
    diff: StreamDiff,
    guard?: FenceGuard,
  ): Promise<FenceOutcome> {
    const snap = snapKey(instanceKey);
    const stream = streamKey(instanceKey);
    if (guard) {
      const pairs: string[] = [];
      for (const up of diff.upserts) {
        pairs.push(up.key, JSON.stringify({ tableName: up.tableName, row: up.row }));
      }
      return this.#fenced(
        APPLY_DIFF,
        [fenceKey(guard.groupKey), snap, stream],
        [
          String(guard.token),
          diff.cleared ? '1' : '0',
          JSON.stringify(pairs),
          JSON.stringify(diff.deletes),
          STREAM_MAXLEN,
          version,
          JSON.stringify(diff),
        ],
      );
    }
    const pipeline = redisService.getClient().pipeline();
    if (diff.cleared) pipeline.del(snap);
    for (const up of diff.upserts) {
      pipeline.hset(snap, up.key, JSON.stringify({ tableName: up.tableName, row: up.row }));
    }
    if (diff.deletes.length > 0) pipeline.hdel(snap, ...diff.deletes);
    pipeline.xadd(stream, 'MAXLEN', '~', STREAM_MAXLEN, '*', 'v', version, 'diff', JSON.stringify(diff));
    await pipeline.exec();
    return 'applied';
  }

  /** Flatten a poke into the per-instance payload the atomic script consumes. */
  #buildPokeInstances(w: PokeWrite): Array<{ s: string; x: string; c: string; u: string[]; d: string[]; j: string }> {
    const out: Array<{ s: string; x: string; c: string; u: string[]; d: string[]; j: string }> = [];
    const seen = new Set<string>();
    for (const [instanceKey, diff] of w.diffs) {
      const u: string[] = [];
      for (const up of diff.upserts) u.push(up.key, JSON.stringify({ tableName: up.tableName, row: up.row }));
      out.push({ s: snapKey(instanceKey), x: streamKey(instanceKey), c: diff.cleared ? '1' : '0', u, d: [...diff.deletes], j: JSON.stringify(diff) });
      seen.add(instanceKey);
    }
    // A newly-`got` instance with no diff this poke (empty result) needs an explicit marker to flip
    // isHydrated; one that IS in `diffs` is already hydrated by its own stream entry.
    for (const instanceKey of w.newlyGot) {
      if (seen.has(instanceKey)) continue;
      out.push({ s: snapKey(instanceKey), x: streamKey(instanceKey), c: '0', u: [], d: [], j: EMPTY_DIFF });
    }
    // Resync markers LAST (after every row entry above), so the marker is the final stream entry
    // for the instance this poke — the fan-out sees it only once the snapshot is complete.
    for (const instanceKey of w.resyncMarkers ?? []) {
      out.push({ s: snapKey(instanceKey), x: streamKey(instanceKey), c: '0', u: [], d: [], j: RESYNC_DIFF });
    }
    return out;
  }

  /**
   * Persist one poke ATOMICALLY: all instance diffs + hydration markers + the group cookie in a
   * single script. `stale` (fenced fence-mismatch) → caller demotes; the whole poke is rolled back
   * (nothing applied) so the caller can resume from the last saved cookie.
   */
  async applyPoke(w: PokeWrite, guard?: FenceGuard): Promise<FenceOutcome> {
    const instancesJSON = JSON.stringify(this.#buildPokeInstances(w));
    if (guard) {
      return this.#fenced(
        APPLY_POKE_FENCED,
        [fenceKey(guard.groupKey), cookieKey(w.clientGroupID)],
        [String(guard.token), w.cookie, STREAM_MAXLEN, instancesJSON],
      );
    }
    const r = await redisService
      .getClient()
      .eval(APPLY_POKE, 1, cookieKey(w.clientGroupID), w.cookie, String(STREAM_MAXLEN), instancesJSON);
    return r === 'STALE' ? 'stale' : 'applied';
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
  async markHydrated(instanceKey: string, version: string, guard?: FenceGuard): Promise<FenceOutcome> {
    if (guard) {
      return this.#fenced(
        MARK_HYDRATED,
        [fenceKey(guard.groupKey), streamKey(instanceKey)],
        [String(guard.token), STREAM_MAXLEN, version, EMPTY_DIFF],
      );
    }
    const last = await this.#lastEntry(instanceKey);
    if (last && !last.diff.cleared) return 'applied';
    await redisService
      .getClient()
      .xadd(streamKey(instanceKey), 'MAXLEN', '~', STREAM_MAXLEN, '*', 'v', version, 'diff', EMPTY_DIFF);
    return 'applied';
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
  async saveCookie(clientGroupID: string, cookie: string, guard?: FenceGuard): Promise<FenceOutcome> {
    if (guard) {
      return this.#fenced(
        SAVE_COOKIE,
        [fenceKey(guard.groupKey), cookieKey(clientGroupID)],
        [String(guard.token), cookie],
      );
    }
    await redisService.getClient().set(cookieKey(clientGroupID), cookie);
    return 'applied';
  }

  async loadCookie(clientGroupID: string): Promise<string> {
    return (await redisService.getClient().get(cookieKey(clientGroupID))) ?? '';
  }

  /**
   * CVR-cleared reset: drop the group's resume cursor and, for each instance it
   * carries, wipe the snapshot and append a `clear` so existing tailers reset.
   * The next fresh hydration rebuilds the snapshots.
   */
  async reset(
    clientGroupID: string,
    instanceKeys: readonly string[],
    guard?: FenceGuard,
  ): Promise<FenceOutcome> {
    if (guard) {
      return this.#fenced(
        RESET,
        [fenceKey(guard.groupKey), cookieKey(clientGroupID)],
        [
          String(guard.token),
          JSON.stringify(instanceKeys.map(snapKey)),
          JSON.stringify(instanceKeys.map(streamKey)),
          STREAM_MAXLEN,
          CLEAR_DIFF,
        ],
      );
    }
    const pipeline = redisService.getClient().pipeline();
    pipeline.del(cookieKey(clientGroupID));
    for (const instanceKey of instanceKeys) {
      pipeline.del(snapKey(instanceKey));
      pipeline.xadd(streamKey(instanceKey), 'MAXLEN', '~', STREAM_MAXLEN, '*', 'v', '', 'diff', CLEAR_DIFF);
    }
    await pipeline.exec();
    return 'applied';
  }

  async teardownInstance(instanceKey: string, guard?: FenceGuard): Promise<FenceOutcome> {
    if (guard) {
      return this.#fenced(
        TEARDOWN_INSTANCE,
        [fenceKey(guard.groupKey), snapKey(instanceKey), streamKey(instanceKey)],
        [String(guard.token)],
      );
    }
    await redisService.getClient().del(snapKey(instanceKey), streamKey(instanceKey));
    return 'applied';
  }

  async teardownGroup(clientGroupID: string, guard?: FenceGuard): Promise<FenceOutcome> {
    if (guard) {
      return this.#fenced(
        TEARDOWN_GROUP,
        [fenceKey(guard.groupKey), cookieKey(clientGroupID), registryKey(clientGroupID), zgroupKey(clientGroupID)],
        [String(guard.token)],
      );
    }
    await redisService.getClient().del(cookieKey(clientGroupID), registryKey(clientGroupID), zgroupKey(clientGroupID));
    return 'applied';
  }

  /** Persist the rotated zero-cache clientGroupID under the stable lease key (fenced) so a takeover
   *  resumes under the same id + warm cookie. Called by the tap on a CVR self-heal rotation. */
  async saveZGroup(clientGroupID: string, zeroGroupID: string, guard?: FenceGuard): Promise<FenceOutcome> {
    if (guard) {
      return this.#fenced(SAVE_ZGROUP, [fenceKey(guard.groupKey), zgroupKey(clientGroupID)], [String(guard.token), zeroGroupID]);
    }
    await redisService.getClient().set(zgroupKey(clientGroupID), zeroGroupID);
    return 'applied';
  }

  /** The zero-cache clientGroupID the group's tap last used (null = never rotated → use the base). */
  async loadZGroup(clientGroupID: string): Promise<string | null> {
    return redisService.getClient().get(zgroupKey(clientGroupID));
  }

  /**
   * Register (or refresh) a subscribed instance in its group's registry so the group's OWNER —
   * which may be a different pod that never saw this subscribe — can materialize it. Additive and
   * unfenced: any pod may announce a subscription; the owner prunes it (fenced) when interest dies.
   */
  async registerInstance(clientGroupID: string, instanceKey: string, descriptor: string): Promise<void> {
    await redisService.getClient().hset(registryKey(clientGroupID), instanceKey, descriptor);
  }

  /** Every subscribed instance in a group: instanceKey → descriptor JSON (the owner's work-list). */
  async groupInstances(clientGroupID: string): Promise<Record<string, string>> {
    return redisService.getClient().hgetall(registryKey(clientGroupID));
  }

  /** Owner-only prune of a registry entry once its instance has no live interest (fenced). */
  async deregisterInstance(clientGroupID: string, instanceKey: string, guard?: FenceGuard): Promise<FenceOutcome> {
    if (guard) {
      return this.#fenced(DEREGISTER, [fenceKey(guard.groupKey), registryKey(clientGroupID)], [String(guard.token), instanceKey]);
    }
    await redisService.getClient().hdel(registryKey(clientGroupID), instanceKey);
    return 'applied';
  }
}
