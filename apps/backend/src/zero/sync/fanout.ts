import Redis, { type RedisOptions } from 'ioredis';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { RedisStreamStore, compareStreamId } from './redisStore';
import type { CompactedRow, StreamDiff } from './streamState';
import type { AclGate } from './aclGate';
import { allPkFields } from './clientSchema';
import { seedRowLevel, routeDelta, projectDeltaForUser, type RowLevelMeta } from './rowLevelRouting';
import { obsEmit } from './obs';
import { SerialQueue } from './serialQueue';

/** PK fields per table, for keying rows/deletes in the row-level owner map. Static (schema-derived). */
const PK = allPkFields();

/** Extract a small summary of a fan-out payload for observability. */
function summarize(payload: unknown): Record<string, unknown> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(p.rows) ? p.rows.length : undefined;
  const upserts = Array.isArray(p.upserts) ? p.upserts.length : undefined;
  const deletes = Array.isArray(p.deletes) ? p.deletes.length : undefined;
  return { instanceKey: p.instanceKey, rows, upserts, deletes };
}

const streamKey = (instanceKey: string): string => `sync:stream:${instanceKey}`;
const instanceOfStream = (key: string): string => key.slice('sync:stream:'.length);
const BLOCK_MS = 1_000;

/** The minimal socket surface the fan-out needs — satisfied by a socket.io Socket. */
export interface SyncSocket {
  emit(event: string, payload: unknown): void;
  join(room: string): void;
  leave(room: string): void;
  readonly connected: boolean;
}

/** Broadcast a payload to every socket in a room (one encode; the socket.io adapter fans out). */
export type SyncBroadcast = (room: string, event: string, payload: unknown) => void;

/** socket.io room for a data instance's live (admitted+hydrated) clients — joined on hydrate,
 *  left on revoke/remove/disconnect. Prefixed to avoid colliding with the app's own rooms. */
const roomFor = (dataInstanceKey: string): string => `sync:${dataInstanceKey}`;

interface ClientSub {
  id: string;
  socket: SyncSocket;
  userId: string;
  workspaceId: string;
  /** Root-scope binding for the gate, e.g. `{ channelId: C }`. */
  scope: Record<string, unknown>;
  gate: AclGate;
  dataInstanceKey: string;
  /** grant table → its materialized instanceKey (for gate snapshots + re-gate). */
  grantByTable: Map<string, string>;
  /** Client's last applied op-stream offset — resume from here instead of a full snapshot. */
  sinceOffset?: string;
  /** Gate passed (ACL-admitted). */
  admitted: boolean;
  /** Snapshot/resume delivered — only then does the client receive live deltas. A client
   *  is admitted-but-not-hydrated while it waits for the instance to materialize. */
  hydrated: boolean;
}

/**
 * Fans a materialized instance's Redis op-stream out to admitted client sockets.
 * One multi-stream `XREAD BLOCK` loop tails every active data + grant stream:
 *   - a DATA delta → pushed to that instance's admitted clients;
 *   - a GRANT delta → re-evaluates the ACL gate for clients on that channel (live
 *     admit/revoke). Admission = `gate.evaluate` against the grant snapshots.
 */
/**
 * A row-level subscriber — one user on a workspace instance. No gate/grants: the ACL is reproduced by
 * routing each row to `row[routeColumn]`, so a client sees only its own rows. Delivery is per-user
 * (payloads differ per user) → NO socket.io room broadcast, unlike the gate path.
 */
interface RowLevelClient {
  id: string;
  socket: SyncSocket;
  userId: string;
  workspaceId: string;
  dataInstanceKey: string;
  /** Client's last applied op-stream offset — resume (puts-only) instead of a full snapshot. */
  sinceOffset?: string;
  /** Snapshot/resume delivered — only then does the client receive live per-user deltas. */
  hydrated: boolean;
}

/** Live per-instance row-level state: the query shape + the `rowKey → ownerUserId` map (R-2). */
interface RowLevelInstance {
  meta: RowLevelMeta;
  /** rowKey → ownerUserId, maintained at every put/del; rebuilt from the snapshot on (re)seed. */
  owner: Map<string, string>;
  /** Has the owner map been seeded from a snapshot yet? Reset on a `cleared` boundary. */
  seeded: boolean;
  /** Offset of the last dispatch that changed a row's owner. A resume from BEFORE this can't reproduce
   *  the synthesized del-to-old (it's not in the stream) → snapshot fallback. In-memory (resets on
   *  restart), which is safe: owner changes are ~never (immutable columns) and the obs counter alerts if
   *  one ever fires, so a resume spanning a pre-restart owner change is an already-flagged rarity. */
  lastOwnerChangeOffset?: string;
}

export class Fanout {
  readonly #store: RedisStreamStore;
  readonly #dataSubs = new Map<string, Set<ClientSub>>();
  /** instanceKey → its row-level state (present iff the instance is row-level, not gate). */
  readonly #rowLevel = new Map<string, RowLevelInstance>();
  /** row-level instanceKey → its clients. */
  readonly #rowLevelSubs = new Map<string, Set<RowLevelClient>>();
  /** row-level instanceKey → userId → that user's clients (O(1) per-user delta targeting). */
  readonly #rowLevelByUser = new Map<string, Map<string, Set<RowLevelClient>>>();
  /** row-level instanceKey → per-user hydration buckets at a stream head (mass-reconnect memo, bounded
   *  per-instance: one entry, dropped when the instance empties — the P5 snapshot-memo rider). */
  readonly #rowLevelBuckets = new Map<string, { head: string; buckets: Map<string, CompactedRow[]> }>();
  /** dataInstanceKey → userId → that user's ClientSubs on the instance (O(1) per-user targeting). */
  readonly #byUser = new Map<string, Map<string, Set<ClientSub>>>();
  readonly #grantToData = new Map<string, Set<string>>();
  /** grant instanceKey → its partition. A PER-USER grant (`__grant__T{userId:U}`) carries the one
   *  user whose admission a delta on it can change → re-gate only U; a PER-SCOPE grant (channels[C])
   *  has no user → re-gate all of the scope's subscribers. */
  readonly #grantMeta = new Map<string, { userId?: string }>();
  /** Grant instances whose stream has a non-cleared (materialized) tail — safe to gate against.
   *  Admission DEFERS while a client's grant is absent here (cold at session start, or mid-clear
   *  rehydration): a NOT-EXISTS arm would fail OPEN on an empty cold snapshot. */
  readonly #grantHydrated = new Set<string>();
  /** dataInstanceKey → its snapshot at a given stream head, reused across a mass re-admit (P5). */
  readonly #snapshotMemo = new Map<string, { head: string; rows: CompactedRow[] }>();
  readonly #cursors = new Map<string, string>();
  // Serialize dispatch per stream so grant deltas (join/leave) re-gate in stream order;
  // a `void #dispatch` let a later entry overtake an earlier one → stale admit survived
  // a revoke. Distinct streams still dispatch concurrently.
  readonly #dispatchQueue = new SerialQueue((error, key) =>
    logger.error('sync_fanout_dispatch_error', { error, key }),
  );

  #tail: Redis | null = null;
  #stopped = false;
  /** Set at startup from the socket.io server (`io.to(room).emit`). When present, a data delta is
   *  broadcast to the instance's room in ONE encode instead of per-client. Absent (tests / not
   *  wired) → per-client fallback below. */
  #broadcast: SyncBroadcast | null = null;

  /** `store` is injectable for tests (a fake stream store); production uses the real Redis-backed one. */
  constructor(store: RedisStreamStore = new RedisStreamStore()) {
    this.#store = store;
  }

  setBroadcast(fn: SyncBroadcast): void {
    this.#broadcast = fn;
  }

  /** Test seam: await all in-flight per-instance dispatch/hydrate jobs (they run on the serial queue). */
  async drainDispatch(): Promise<void> {
    await this.#dispatchQueue.drain();
  }

  start(): void {
    this.#stopped = false;
    this.#tail = new Redis(redisService.getRedisConfig() as RedisOptions);
    void this.#loop();
  }

  stop(): void {
    this.#stopped = true;
    this.#tail?.disconnect();
    this.#tail = null;
  }

  async addClient(sub: Omit<ClientSub, 'admitted' | 'hydrated'>): Promise<void> {
    const client: ClientSub = { ...sub, admitted: false, hydrated: false };
    this.#setAdd(this.#dataSubs, client.dataInstanceKey, client);
    this.#byUserAdd(client);
    await this.#ensureCursorHead(client.dataInstanceKey);
    // Record each grant instance's partition so a delta on it re-gates the right set: a per-user
    // grant (`channel_participants{userId:U}`) → only U; a per-scope grant (channels[C]) → all.
    const perUserTables = new Set(
      client.gate.grantSources.filter((s) => s.kind === 'per-user').map((s) => s.table),
    );
    for (const [table, grantKey] of client.grantByTable) {
      this.#setAdd(this.#grantToData, grantKey, client.dataInstanceKey);
      if (!this.#grantMeta.has(grantKey)) {
        this.#grantMeta.set(grantKey, perUserTables.has(table) ? { userId: client.userId } : {});
      }
      await this.#ensureCursorHead(grantKey);
      // Seed hydration state so an already-warm grant (a co-subscriber materialized it) admits
      // immediately; a cold one defers until its hydration delta arrives (tracked in #dispatch).
      if (await this.#store.isHydrated(grantKey)) this.#grantHydrated.add(grantKey);
    }
    // Serialize the initial regate onto the data instance's queue so a subscribe-time
    // admit can't interleave a stale grant view against a concurrent grant dispatch for
    // the same instance (same ordering guarantee the grant path relies on).
    this.#enqueueRegate(client.dataInstanceKey, () => this.#regate(client));
  }

  /**
   * Register a row-level subscriber: one user on a workspace instance. No gate/grants — the client is
   * admitted by construction (routing == ACL) and hydrated with ONLY its own rows. `meta` is the query
   * shape (rootTable/routeColumn/childLinks) the R2 gateway derives; the FIRST client establishes the
   * instance's live owner-map state.
   */
  async addRowLevelClient(sub: {
    id: string;
    socket: SyncSocket;
    userId: string;
    workspaceId: string;
    dataInstanceKey: string;
    sinceOffset?: string;
    meta: RowLevelMeta;
  }): Promise<void> {
    const client: RowLevelClient = {
      id: sub.id,
      socket: sub.socket,
      userId: sub.userId,
      workspaceId: sub.workspaceId,
      dataInstanceKey: sub.dataInstanceKey,
      sinceOffset: sub.sinceOffset,
      hydrated: false,
    };
    if (!this.#rowLevel.has(sub.dataInstanceKey)) {
      this.#rowLevel.set(sub.dataInstanceKey, { meta: sub.meta, owner: new Map(), seeded: false });
    }
    this.#setAdd(this.#rowLevelSubs, sub.dataInstanceKey, client);
    this.#rowLevelByUserAdd(client);
    await this.#ensureCursorHead(sub.dataInstanceKey);
    // Serialize the initial hydrate onto the instance's stream queue (same key as #dispatchRowLevel), so
    // it can't race a concurrent dispatch mutating/seeding the owner map — the row-level analog of the
    // gate path enqueuing #regate. Hydrate now if materialized; else stay deferred (the dispatch loop
    // hydrates the moment a non-cleared delta lands — same cold-instance handling as the gate path).
    this.#dispatchQueue.enqueue(streamKey(sub.dataInstanceKey), () => this.#tryHydrateRowLevel(client));
  }

  removeClient(clientId: string, dataInstanceKey: string): void {
    // Row-level instances have their own client set + owner-map lifecycle.
    if (this.#rowLevel.has(dataInstanceKey)) {
      this.#removeRowLevelClient(clientId, dataInstanceKey);
      return;
    }
    const subs = this.#dataSubs.get(dataInstanceKey);
    if (!subs) return;
    let departed: ClientSub | undefined;
    for (const s of subs)
      if (s.id === clientId) {
        // Clear admission (the no-io per-client delta fallback checks it) and LEAVE the room so no
        // in-flight/subsequent broadcast reaches a client that just released the instance.
        s.admitted = false;
        departed = s;
        subs.delete(s);
        this.#byUserDelete(s);
        s.socket.leave(roomFor(dataInstanceKey)); // stop room broadcasts (no-op if already disconnected)
      }
    if (!departed) return;
    // Prune the grant fan-out map (P2 / standing finding #5 — the XREAD stream list otherwise grows
    // for the process lifetime). Drop this data instance from each grant the departing client used,
    // UNLESS a remaining client on the instance still uses that grant (per-scope grants are shared
    // across a channel's clients; per-user grants are 1:1 with the client). A grant that then fans
    // to nothing is dead → drop its cursor (stop tailing) + meta + hydration state.
    for (const grantKey of departed.grantByTable.values()) {
      let stillUsed = false;
      for (const s of subs)
        if ([...s.grantByTable.values()].includes(grantKey)) {
          stillUsed = true;
          break;
        }
      if (stillUsed) continue;
      const set = this.#grantToData.get(grantKey);
      set?.delete(dataInstanceKey);
      if (set && set.size === 0) {
        this.#grantToData.delete(grantKey);
        this.#grantMeta.delete(grantKey);
        this.#grantHydrated.delete(grantKey);
        this.#cursors.delete(streamKey(grantKey)); // stop tailing the now-unreferenced grant stream
      }
    }
    if (subs.size === 0) {
      this.#dataSubs.delete(dataInstanceKey);
      this.#cursors.delete(streamKey(dataInstanceKey)); // stop tailing the now-clientless data stream
      this.#snapshotMemo.delete(dataInstanceKey);
    }
  }

  #byUserAdd(client: ClientSub): void {
    let byU = this.#byUser.get(client.dataInstanceKey);
    if (!byU) this.#byUser.set(client.dataInstanceKey, (byU = new Map()));
    this.#setAdd(byU, client.userId, client);
  }

  #byUserDelete(client: ClientSub): void {
    const byU = this.#byUser.get(client.dataInstanceKey);
    const set = byU?.get(client.userId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) byU!.delete(client.userId);
    if (byU!.size === 0) this.#byUser.delete(client.dataInstanceKey);
  }

  #rowLevelByUserAdd(client: RowLevelClient): void {
    let byU = this.#rowLevelByUser.get(client.dataInstanceKey);
    if (!byU) this.#rowLevelByUser.set(client.dataInstanceKey, (byU = new Map()));
    this.#setAdd(byU, client.userId, client);
  }

  #rowLevelByUserDelete(client: RowLevelClient): void {
    const byU = this.#rowLevelByUser.get(client.dataInstanceKey);
    const set = byU?.get(client.userId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) byU!.delete(client.userId);
    if (byU!.size === 0) this.#rowLevelByUser.delete(client.dataInstanceKey);
  }

  #removeRowLevelClient(clientId: string, instanceKey: string): void {
    const subs = this.#rowLevelSubs.get(instanceKey);
    if (!subs) return;
    for (const s of subs)
      if (s.id === clientId) {
        subs.delete(s);
        this.#rowLevelByUserDelete(s);
      }
    if (subs.size === 0) {
      // Last client gone → drop the instance's live state and stop tailing its stream.
      this.#rowLevelSubs.delete(instanceKey);
      this.#rowLevel.delete(instanceKey);
      this.#rowLevelBuckets.delete(instanceKey);
      this.#cursors.delete(streamKey(instanceKey));
    }
  }

  /** Per-client emission for row-level (no room broadcast — payloads differ per user). Suppresses a
   *  stray emit to a client that unsubscribed during an await window (mirrors the gate-path #emit). */
  #emitRowLevel(client: RowLevelClient, event: string, payload: unknown): void {
    if (!this.#rowLevelSubs.get(client.dataInstanceKey)?.has(client)) return;
    if (client.socket.connected) {
      client.socket.emit(event, payload);
      obsEmit('fanout', { event, socketId: client.id, userId: client.userId, ...summarize(payload) });
    }
  }

  #setAdd<T>(map: Map<string, Set<T>>, key: string, value: T): void {
    const set = map.get(key);
    if (set) set.add(value);
    else map.set(key, new Set([value]));
  }

  async #ensureCursorHead(instanceKey: string): Promise<void> {
    const key = streamKey(instanceKey);
    if (!this.#cursors.has(key)) this.#cursors.set(key, await this.#store.head(instanceKey));
  }

  /**
   * Re-evaluate the gate for one client and admit (send snapshot) / revoke as needed.
   *
   * `cache` (keyed by grant instanceKey) hoists the grant-snapshot reads out of the
   * per-client loop: every client on a channel shares the same grant instances, so a
   * grant delta would otherwise re-read the identical snapshot N times (N×M HGETALLs).
   * A caller that re-gates many clients for one delta passes a single cache → M reads,
   * and all clients gate against one point-in-time view. Callers re-gating a lone client
   * (subscribe) pass none and read fresh.
   *
   * All callers route through `#enqueueRegate` (keyed by the data instance's stream), so
   * regates for a given instance/client never run concurrently — the async snapshot read
   * → synchronous `admitted` flip below is therefore not interleaved, and the freshest
   * delta's regate always flips last. (This is what makes cross-grant-stream ordering
   * structural rather than resting on a fragile shared-FIFO-read invariant.)
   */
  async #regate(client: ClientSub, cache?: Map<string, Record<string, unknown>[]>): Promise<void> {
    // A regate is always a queued job holding a direct client reference; the client may
    // have unsubscribed (removeClient dropped it from the set) before the job runs. Never
    // re-gate or hydrate a client no longer subscribed — else the subscribe-time regate
    // could flip `admitted` and emit a stray snapshot for a released instance.
    if (!this.#dataSubs.get(client.dataInstanceKey)?.has(client)) return;
    // Cold-defer (MANDATORY): never gate against a not-yet-hydrated grant instance. Per-user
    // grants are cold at session start, and a NOT-EXISTS arm fails OPEN on an empty cold snapshot.
    // Returning here defers a not-yet-admitted client AND pins an already-admitted one through a
    // grant's mid-clear rehydration (no false revoke); the grant's hydration delta re-gates. Data
    // hydration is concurrent — both taps are subscribed up-front in addClient.
    for (const grantKey of client.grantByTable.values()) {
      if (!this.#grantHydrated.has(grantKey)) return;
    }
    // Each grant instance is a single flat table (`__grant__<table>{col:val}`), so its snapshot rows
    // are all of `table` — read them directly.
    const grantRows = new Map<string, Record<string, unknown>[]>();
    for (const [table, grantKey] of client.grantByTable) {
      let rows = cache?.get(grantKey);
      if (!rows) {
        rows = (await this.#store.snapshot(grantKey)).map((c) => c.row);
        cache?.set(grantKey, rows);
      }
      grantRows.set(table, rows);
    }
    let admitted: boolean;
    try {
      admitted = client.gate.evaluate(
        client.scope,
        client.userId,
        client.workspaceId,
        (table) => grantRows.get(table) ?? [],
      );
    } catch (error) {
      // A gate that throws (an ACL that evolved to use an unsupported node/op) can never
      // admit — fail CLOSED so an evolving ACL revokes rather than leaks. The per-client
      // catch in the dispatch loop keeps this from aborting the rest of the re-gate set.
      logger.error('sync_fanout_gate_eval_error', {
        error,
        instanceKey: client.dataInstanceKey,
        userId: client.userId,
      });
      admitted = false;
    }
    if (admitted && !client.admitted) {
      // Re-check after the snapshot-read awaits above: an unsubscribe landing during them
      // reset `client.admitted` to false, which would otherwise let this flip it back true
      // and emit a stray snapshot for a released instance. (Revoke branch needs no re-check
      // — removeClient already cleared `admitted`, so it won't fire for an orphan.)
      if (!this.#dataSubs.get(client.dataInstanceKey)?.has(client)) return;
      client.admitted = true;
      await this.#tryHydrate(client);
    } else if (!admitted && client.admitted) {
      client.admitted = false;
      client.hydrated = false;
      // Leave the room BEFORE (well, atomically with) the revoke: no future data-delta broadcast
      // reaches this client. Ordered against data dispatches via the shared data-key SerialQueue.
      client.socket.leave(roomFor(client.dataInstanceKey));
      this.#emit(client, 'sync:revoke', { instanceKey: client.dataInstanceKey });
    }
  }

  /**
   * Send the snapshot/resume IF the instance has materialized (zero-cache "got" it — even
   * empty). Otherwise the client stays admitted-but-not-hydrated and the dispatch loop
   * hydrates it the moment the instance's hydrated marker lands. This is what prevents the
   * cold-instance premature-empty snapshot.
   */
  async #tryHydrate(client: ClientSub): Promise<void> {
    if (await this.#store.isHydrated(client.dataInstanceKey)) {
      await this.#hydrate(client);
    }
  }

  /**
   * Bring a just-admitted client current. If it carries an offset still retained in the
   * op-stream, replay only the deltas it missed (resume); otherwise send a full snapshot.
   * The replay is emitted SYNCHRONOUSLY after the async read so live deltas (delivered once
   * `admitted`) can't interleave ahead of older replayed ops; any overlap with the live
   * tail is an idempotent re-apply, never a gap.
   */
  async #hydrate(client: ClientSub): Promise<void> {
    const instanceKey = client.dataInstanceKey;
    if (client.sinceOffset) {
      const firstId = await this.#store.firstId(instanceKey);
      const retained = firstId !== null && compareStreamId(firstId, client.sinceOffset) <= 0;
      if (retained) {
        const diffs = await this.#store.readSince(instanceKey, client.sinceOffset);
        // A `cleared` op in the range = a reset — can't resume across it, fall back to snapshot.
        if (!diffs.some((d) => d.diff.cleared)) {
          client.hydrated = true;
          for (const { id, version, diff } of diffs) {
            this.#emit(client, 'sync:delta', {
              instanceKey,
              upserts: diff.upserts,
              deletes: diff.deletes,
              offset: id,
              version,
            });
          }
          client.socket.join(roomFor(instanceKey)); // now live → future deltas via the room broadcast
          obsEmit('fanout', { event: 'sync:resume', socketId: client.id, instanceKey, deltas: diffs.length });
          return;
        }
      }
    }
    // Snapshot memo (P2/P5): a mass re-admit on one instance (reconnect storm) would otherwise do
    // N identical full HGETALLs. Key the memo by stream head — hydrations for one instance are
    // serialized on its stream queue, so the first reads, the rest reuse; a moved head (new entry)
    // misses and refreshes. headWithVersion is a cheap XREVRANGE-1; only the big snapshot is saved.
    const { id: head, version } = await this.#store.headWithVersion(instanceKey);
    const memo = this.#snapshotMemo.get(instanceKey);
    const rows = memo && memo.head === head ? memo.rows : await this.#store.snapshot(instanceKey);
    if (!memo || memo.head !== head) this.#snapshotMemo.set(instanceKey, { head, rows });
    client.hydrated = true;
    this.#emit(client, 'sync:snapshot', { instanceKey, rows, offset: head, version });
    client.socket.join(roomFor(instanceKey)); // now live → future deltas via the room broadcast
  }

  #emit(client: ClientSub, event: string, payload: unknown): void {
    // Single funnel for every emission. An unsubscribe can land during any await window in
    // #regate/#hydrate; suppress here if the client is no longer subscribed to this
    // instance. No path legitimately emits to a client outside its instance's live set
    // (delta pulls from the set; hydrate/resume clients were in it at entry; a revoke for a
    // removed client is a no-op), so this closes the stray-emission race family in one
    // place — the callers' membership checks are then just cheap early-outs.
    if (!this.#dataSubs.get(client.dataInstanceKey)?.has(client)) return;
    if (client.socket.connected) {
      client.socket.emit(event, payload);
      obsEmit('fanout', { event, socketId: client.id, userId: client.userId, ...summarize(payload) });
    }
  }

  async #loop(): Promise<void> {
    while (!this.#stopped && this.#tail) {
      const streams = [...this.#cursors.keys()];
      if (streams.length === 0) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      const ids = streams.map((s) => this.#cursors.get(s) as string);
      let res: [string, [string, string[]][]][] | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const xread = this.#tail.xread.bind(this.#tail) as (...a: unknown[]) => Promise<any>;
        res = (await xread('BLOCK', BLOCK_MS, 'COUNT', 200, 'STREAMS', ...streams, ...ids)) as
          | [string, [string, string[]][]][]
          | null;
      } catch (error) {
        if (this.#stopped) break;
        logger.error('sync_fanout_xread_error', { error });
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      if (!res) continue;
      for (const [key, entries] of res) {
        for (const [id, fields] of entries) {
          this.#cursors.set(key, id);
          this.#dispatchQueue.enqueue(key, () => this.#dispatch(key, id, fields));
        }
      }
    }
  }

  async #dispatch(key: string, id: string, fields: string[]): Promise<void> {
    const diffIdx = fields.indexOf('diff');
    const diff = diffIdx >= 0 ? JSON.parse(fields[diffIdx + 1]) : undefined;
    const vIdx = fields.indexOf('v');
    const version = vIdx >= 0 ? fields[vIdx + 1] : undefined;
    const instanceKey = instanceOfStream(key);

    // Row-level instances take a wholly separate path: per-user demux (routeColumn), no gate, no room
    // broadcast (payloads differ per user). Serialized on the same per-stream queue as the gate path.
    if (this.#rowLevel.has(instanceKey)) {
      await this.#dispatchRowLevel(instanceKey, id, diff, version);
      return;
    }

    const dataSubs = this.#dataSubs.get(instanceKey);
    if (dataSubs) {
      const delta = { instanceKey, upserts: diff?.upserts ?? [], deletes: diff?.deletes ?? [], offset: id, version };
      // Broadcast to the room = every currently-LIVE (joined) client, in ONE encode. This runs
      // FIRST, before hydrating the deferred clients below — a deferred client is not in the room
      // yet, and its snapshot (read after this entry landed in Redis) already includes this delta,
      // so it must not also receive the delta (no double-delivery). Room membership == the
      // admitted+hydrated set (join on hydrate, leave on revoke/remove), and revoke's leave is
      // serialized against this dispatch on the data-key queue, so a revoked client has already
      // left → no stray delta (subsumes the old emit-time recheck). No-op on `cleared` (empty delta).
      if (!diff?.cleared) {
        if (this.#broadcast) this.#broadcast(roomFor(instanceKey), 'sync:delta', delta);
        else for (const c of dataSubs) if (c.admitted && c.hydrated) this.#emit(c, 'sync:delta', delta); // fallback: no io
      }
      // Deferred clients (admitted, not yet hydrated) snapshot to the CURRENT state (which includes
      // this entry) and join the room — AFTER the broadcast above.
      const deferred = [...dataSubs].filter((c) => c.admitted && !c.hydrated);
      if (deferred.length > 0 && !diff?.cleared) {
        for (const c of deferred) await this.#hydrate(c);
      }
      obsEmit('stream-diff', {
        instanceKey,
        upserts: delta.upserts.length,
        deletes: delta.deletes.length,
        subscribers: dataSubs.size,
      });
    }

    const affected = this.#grantToData.get(instanceKey);
    if (affected) {
      // Serialize the regate APPLICATION per data instance (not inline here). Concurrent
      // grant deltas for one channel — different grant streams, distinct queue keys, so
      // dispatched in parallel — would otherwise each build a snapshot view and race to
      // flip `admitted` last; a stale view held across the N-client loop (with awaited
      // hydrations) could flip last and leave a revoked user admitted. Enqueuing the loop
      // onto the DATA instance's stream key runs these regates serially in arrival order:
      // the last job builds its cache AFTER every earlier delta's applyDiff, so the final
      // flip always uses a view ≥ every delta. It also orders regates against that
      // instance's data-delta dispatches (same key), so the emit-time recheck sees settled
      // flags. Distinct channels stay parallel.
      // Hydration lifecycle (cold-defer + zero-blip): a `cleared` reset makes the grant unusable
      // for gating → drop it and PIN (don't re-gate; the cold-defer guard keeps admitted clients
      // admitted). The deterministic complete-boundary is the tap's `{resynced:true}` marker,
      // emitted at the got-transition AFTER every row — only THEN is the snapshot whole. Rebuild
      // entries arriving before it are partial → ignore (re-gating on them could mis-gate a member
      // whose row hasn't landed). A normal membership delta on an already-hydrated grant re-gates.
      if (diff?.cleared) {
        this.#grantHydrated.delete(instanceKey);
        return;
      }
      if (diff?.resynced) this.#grantHydrated.add(instanceKey);
      else if (!this.#grantHydrated.has(instanceKey)) return; // partial rebuild before resync
      // A PER-USER grant delta (`channel_participants{userId:U}`) can only change U's admission —
      // the instance IS the user, so re-gate only U on each affected data instance (O(subs_U)).
      // A PER-SCOPE grant delta (channels[C] visibility flip) affects everyone → re-gate all.
      const targetUserId = this.#grantMeta.get(instanceKey)?.userId;
      for (const dataKey of affected) {
        this.#enqueueRegate(dataKey, () => this.#regateInstance(dataKey, targetUserId));
      }
    }
  }

  /** Enqueue a regate onto the data instance's stream queue (see #dispatch for why). */
  #enqueueRegate(dataInstanceKey: string, run: () => Promise<void>): void {
    this.#dispatchQueue.enqueue(streamKey(dataInstanceKey), run);
  }

  /**
   * Re-gate clients of one data instance against a single fresh grant snapshot built INSIDE this
   * (serialized) job. `targetUserId` set (a per-user grant delta) → re-gate only that user's
   * ClientSubs (O(subs_U) via #byUser); absent (per-scope delta / subscribe) → re-gate all. Cache
   * reflects every grant delta applied before the job runs; one point-in-time view for the batch.
   */
  async #regateInstance(dataKey: string, targetUserId?: string): Promise<void> {
    const subs = targetUserId
      ? this.#byUser.get(dataKey)?.get(targetUserId)
      : this.#dataSubs.get(dataKey);
    if (!subs || subs.size === 0) return;
    const grantCache = new Map<string, Record<string, unknown>[]>();
    for (const client of subs) {
      try {
        await this.#regate(client, grantCache);
      } catch (error) {
        // One client's transient re-gate failure (e.g. a snapshot read blip) must not
        // abort re-gating the rest — a dropped revoke is a leak. Log and continue; the
        // next grant delta re-gates. (Gate-eval throws are already caught in #regate.)
        logger.error('sync_fanout_regate_error', {
          error,
          instanceKey: client.dataInstanceKey,
          userId: client.userId,
        });
      }
    }
  }

  // ── Row-level path ────────────────────────────────────────────────────────────────────────────

  /** Seed the live owner map from the instance snapshot on first use / after a reset. Idempotent; any
   *  overlap with deltas re-read past the seed head is an idempotent re-apply (put=set, del=forget). */
  async #ensureSeededRowLevel(instanceKey: string): Promise<void> {
    const inst = this.#rowLevel.get(instanceKey);
    if (!inst || inst.seeded) return;
    const rows = await this.#store.snapshot(instanceKey);
    inst.owner = seedRowLevel(rows, inst.meta, PK).ownerMap;
    inst.seeded = true;
  }

  async #dispatchRowLevel(
    instanceKey: string,
    id: string,
    diff: { upserts?: unknown[]; deletes?: unknown[]; cleared?: boolean } | undefined,
    version: string | undefined,
  ): Promise<void> {
    const inst = this.#rowLevel.get(instanceKey);
    const subs = this.#rowLevelSubs.get(instanceKey);
    if (!inst || !subs) return;

    // A `cleared` reset: the instance re-materializes from scratch. Drop the owner map + bucket memo and
    // mark everyone unhydrated, then re-hydrate whoever the (possibly re-materialized) instance can serve
    // now; a still-cold instance defers to the next non-cleared delta (same as the initial cold path).
    if (diff?.cleared) {
      inst.owner = new Map();
      inst.seeded = false;
      this.#rowLevelBuckets.delete(instanceKey);
      for (const c of subs) c.hydrated = false;
      for (const c of [...subs]) await this.#tryHydrateRowLevel(c);
      return;
    }

    await this.#ensureSeededRowLevel(instanceKey);
    const live = this.#rowLevel.get(instanceKey);
    if (!live) return; // torn down during the await
    const streamDiff: StreamDiff = {
      upserts: (diff?.upserts ?? []) as StreamDiff['upserts'],
      deletes: (diff?.deletes ?? []) as string[],
      cleared: false,
    };
    const { perUser, unroutablePuts, unroutableDels, ownerChanges } = routeDelta(streamDiff, live.owner, live.meta, PK);
    // Pin the owner-change offset so a resume from before it falls back to a snapshot (the synthesized
    // del-to-old is not in the stream). Owner columns are immutable in practice → alert if this fires.
    if (ownerChanges > 0) {
      live.lastOwnerChangeOffset = id;
      obsEmit('sync-rowlevel', { event: 'owner-change', instanceKey, ownerChanges, offset: id });
    }

    // Deliver each owner's slice to that owner's HYDRATED clients (a deferred client's snapshot below
    // already includes this delta, so it must not also receive it — no double-delivery).
    let deliveredToHydrated = false;
    for (const [userId, ud] of perUser) {
      if (ud.upserts.length === 0 && ud.deletes.length === 0) continue;
      const userClients = this.#rowLevelByUser.get(instanceKey)?.get(userId);
      if (!userClients) continue;
      for (const c of userClients) {
        if (c.hydrated) {
          deliveredToHydrated = true;
          this.#emitRowLevel(c, 'sync:delta', { instanceKey, upserts: ud.upserts, deletes: ud.deletes, offset: id, version });
        }
      }
    }

    // Hydrate deferred clients (admitted, not yet hydrated) to the CURRENT snapshot (which includes this
    // entry) — AFTER the live delivery above.
    for (const c of [...subs]) if (!c.hydrated) await this.#hydrateRowLevel(c);

    // Report unroutables ONLY when this delta actually delivered to a hydrated client. The first delta
    // after a (re)seed re-applies against the post-delta snapshot (applyPoke persists snapshot+entry
    // atomically), so its dels legitimately find no map entry — a benign seed overlap, not a real drop;
    // suppressing when nobody was hydrated to miss anything keeps the counter trustworthy.
    if (deliveredToHydrated && (unroutablePuts > 0 || unroutableDels > 0)) {
      obsEmit('sync-rowlevel', { event: 'unroutable', instanceKey, unroutablePuts, unroutableDels });
    }
    obsEmit('stream-diff', {
      instanceKey,
      upserts: streamDiff.upserts.length,
      deletes: streamDiff.deletes.length,
      subscribers: subs.size,
    });
  }

  /** Send the per-user snapshot/resume IF the instance has materialized; else stay deferred (the
   *  dispatch loop hydrates on the next non-cleared delta). Mirrors the gate #tryHydrate. */
  async #tryHydrateRowLevel(client: RowLevelClient): Promise<void> {
    if (await this.#store.isHydrated(client.dataInstanceKey)) await this.#hydrateRowLevel(client);
  }

  /**
   * Bring a row-level client current with ONLY its own rows. Resume (puts-only + snapshot-on-unroutable-
   * del) if it carries a retained offset; otherwise a per-user snapshot slice via the head-keyed bucket
   * memo (so a mass reconnect on one workspace instance filters the snapshot once, not per client).
   */
  async #hydrateRowLevel(client: RowLevelClient): Promise<void> {
    // Idempotent: the initial enqueued hydrate and a concurrent dispatch's deferred-hydrate loop (both
    // on this instance's serial queue) can each target the same client — hydrate exactly once, else a
    // second snapshot re-emits. A `cleared` resets `hydrated=false` first, so re-hydration still runs.
    if (client.hydrated) return;
    const instanceKey = client.dataInstanceKey;
    const inst = this.#rowLevel.get(instanceKey);
    if (!inst) return;

    if (client.sinceOffset && (await this.#tryResumeRowLevel(client, inst))) return;

    const { id: head, version } = await this.#store.headWithVersion(instanceKey);
    const memo = this.#rowLevelBuckets.get(instanceKey);
    let buckets: Map<string, CompactedRow[]>;
    if (memo && memo.head === head) {
      buckets = memo.buckets;
    } else {
      const rows = await this.#store.snapshot(instanceKey);
      const seeded = seedRowLevel(rows, inst.meta, PK);
      buckets = seeded.buckets;
      this.#rowLevelBuckets.set(instanceKey, { head, buckets });
      // First materialization (or post-clear): adopt this snapshot as the live owner map.
      if (!inst.seeded) {
        inst.owner = seeded.ownerMap;
        inst.seeded = true;
      }
    }
    client.hydrated = true;
    this.#emitRowLevel(client, 'sync:snapshot', {
      instanceKey,
      rows: buckets.get(client.userId) ?? [],
      offset: head,
      version,
    });
  }

  /**
   * Resume a row-level client from its offset: replay the missed range, projected to its own rows
   * (read-only against the live owner map). Falls back to a snapshot (returns false) on a `cleared` in
   * range or ANY unroutable op — the R-2 rule that keeps a replayed delete of the client's own row from
   * being silently dropped. Emits synchronously after the async read so live deltas can't interleave.
   */
  async #tryResumeRowLevel(client: RowLevelClient, inst: RowLevelInstance): Promise<boolean> {
    const instanceKey = client.dataInstanceKey;
    // An owner change synthesized a del-to-old that the raw stream doesn't carry; a resume from before
    // it would replay the moved root as "not mine" and keep the stale row → snapshot instead (rare×rare).
    if (inst.lastOwnerChangeOffset && compareStreamId(client.sinceOffset as string, inst.lastOwnerChangeOffset) < 0) {
      return false;
    }
    const firstId = await this.#store.firstId(instanceKey);
    const retained = firstId !== null && compareStreamId(firstId, client.sinceOffset as string) <= 0;
    if (!retained) return false;
    const diffs = await this.#store.readSince(instanceKey, client.sinceOffset as string);
    if (diffs.some((d) => d.diff.cleared)) return false; // reset in range → can't resume
    await this.#ensureSeededRowLevel(instanceKey);
    // Project every diff to this user FIRST; if any is unroutable, snapshot instead (all-or-nothing so
    // we never emit a partial resume then fall back).
    const projected: Array<{ id: string; version?: string; upserts: unknown[]; deletes: string[] }> = [];
    for (const { id, version, diff } of diffs) {
      const slice = projectDeltaForUser(diff, inst.owner, inst.meta, PK, client.userId);
      if (slice === null) return false;
      projected.push({ id, version, upserts: slice.upserts, deletes: slice.deletes });
    }
    client.hydrated = true;
    for (const p of projected) {
      if (p.upserts.length === 0 && p.deletes.length === 0) continue;
      this.#emitRowLevel(client, 'sync:delta', {
        instanceKey,
        upserts: p.upserts,
        deletes: p.deletes,
        offset: p.id,
        version: p.version,
      });
    }
    obsEmit('fanout', { event: 'sync:resume', socketId: client.id, instanceKey, deltas: projected.length });
    return true;
  }
}

export const fanout = new Fanout();
export type { ClientSub };
