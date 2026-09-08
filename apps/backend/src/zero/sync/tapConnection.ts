import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { logger } from '@/utils/logger';
import { encodeSecProtocols, PROTOCOL_VERSION } from './protocol';
import { PackDemux } from './packDemux';
import type { RowPatchOp, StreamDiff } from './streamState';
import type { RedisStreamStore, FenceGuard } from './redisStore';
import { SerialQueue } from './serialQueue';
import type { ClientSchema } from './clientSchema';
import type { QueryMeta } from './queryMeta';
import { mintSecProtocolToken, buildCookieHeader, SYNC_SERVICE_SUB } from './serviceIdentity';
import { obsEmit } from './obs';

export interface PackConnectionOptions {
  zeroCacheUrl: string;
  /** Stable client-group id for this pack group — keys the resume cursor. */
  clientGroupID: string;
  /** The single query-type packed into this group (all instances are disjoint instances of it). */
  queryName: string;
  meta: QueryMeta;
  /** clientSchema covering the query-type's tables (root + related). */
  clientSchema: ClientSchema;
  pkFields: Record<string, readonly string[]>;
  ttlMs: number;
  store: RedisStreamStore;
  /**
   * Multi-pod fencing token for this group's Redis writes. When present, every store write
   * is gated on the group's fence so a zombie ex-owner can't corrupt the shared snapshot;
   * a STALE return means we lost ownership → `onFenceLost` fires and the tap demotes. Absent
   * (single-replica) → writes run unfenced, exactly as before, and STALE can never occur.
   */
  guard?: FenceGuard;
  onFenceLost?: () => void;
}

interface DesiredEntry {
  hash: string;
  args: readonly unknown[];
  partitionValue: string;
}

type Downstream = [type: string, body: Record<string, unknown>];

const RESET_KINDS = new Set([
  'ClientNotFound',
  'InvalidConnectionRequestBaseCookie',
  'InvalidConnectionRequestClientDeleted',
]);
const BACKOFF_KINDS = new Set(['Rebalance', 'Rehome', 'ServerOverloaded']);
const FATAL_KINDS = new Set(['VersionNotSupported', 'SchemaVersionNotSupported']);

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
/** Persist backlog depth at which we warn (a stalled Redis accumulating pokes). */
const PERSIST_DEPTH_WARN = 100;

/**
 * One raw Zero sync-protocol connection to zero-cache for a PACK GROUP: many
 * disjoint instances of a single query-type share this one client group. Pokes are
 * demuxed back to instances (PackDemux) and each instance's diff is persisted to
 * Redis. Instances are added/removed live via `changeDesiredQueries`. Cookie-resumes
 * and rebuilds on CVR-clear like the single-query case.
 */
export class PackConnection {
  readonly #opts: PackConnectionOptions;
  readonly #demux: PackDemux;

  #clientID: string;
  #zeroClientGroupID: string;
  readonly #profileID: string;

  /** Target desired set (instanceKey → entry). */
  readonly #desired = new Map<string, DesiredEntry>();
  /** Snapshot of desired keys at the last connect, to reconcile after 'connected'. */
  #sentInInit = new Set<string>();

  #ws: WebSocket | null = null;
  #baseCookie = '';
  #connected = false;
  /** Wall-clock of the last poke processed (and of each connect) — a staleness signal: an owned
   *  group that is disconnected AND hasn't poked in a long while is a candidate wedged owner. */
  #lastPokeAt = Date.now();
  #closed = false;
  #stopped = false;
  #fenceLost = false;
  #pendingReset = false;
  #pendingBackoff: { minMs: number; maxMs: number } | undefined;
  #attempt = 0;
  #reconnectTimer: NodeJS.Timeout | null = null;
  /** Repeating alarm while a FATAL server frame has stopped this group (C5). */
  #fatalTimer: NodeJS.Timeout | null = null;

  readonly #pending = new Map<string, RowPatchOp[]>();
  /** Accumulated `gotQueriesPatch` ops per in-flight poke (hash = instanceKey). */
  readonly #pendingGot = new Map<string, { op: string; hash: string }[]>();
  /** Serializes the atomic per-poke persist so writes land in poke order (closes the C1 reorder);
   *  demux runs synchronously in message order, only the Redis write is queued. Single key = fully
   *  serial for this one connection. */
  readonly #persistQueue = new SerialQueue((error) =>
    logger.error('sync_pack_persist_queue_error', { clientGroupID: this.#opts.clientGroupID, error }),
  );
  /** Bumped on every disconnect/reset; a queued persist tagged with a stale epoch bails (the
   *  reconnect resumes from the last SAVED cookie and replays, so persisting it would double-write
   *  or, post-reset, write to torn-down streams). */
  #persistEpoch = 0;
  /** Enqueued-but-not-yet-run persists — a SLOW (not failing) Redis accumulates these silently;
   *  warn once when the backlog crosses the threshold. */
  #persistDepth = 0;
  /** Instances already marked hydrated (gotQueriesPatch is a diff — mark once). */
  readonly #got = new Set<string>();
  /** Instances whose demux attribution maps have been rebuilt from their persisted snapshot
   *  (once per instance) so a resume's del/update pokes attribute instead of dropping. */
  readonly #seeded = new Set<string>();

  constructor(opts: PackConnectionOptions) {
    this.#opts = opts;
    this.#demux = new PackDemux(opts.meta, opts.pkFields);
    this.#zeroClientGroupID = opts.clientGroupID;
    this.#clientID = `${opts.clientGroupID}-c-${randomUUID()}`;
    this.#profileID = `${opts.clientGroupID}-p`;
  }

  /** Add a query-instance to this group. Registers it live if already connected. */
  addInstance(instanceKey: string, args: readonly unknown[], hash: string, partitionValue: string): void {
    if (this.#desired.has(instanceKey)) return;
    this.#desired.set(instanceKey, { hash, args, partitionValue });
    this.#demux.addInstance(instanceKey, partitionValue);
    // Seed the demux from the persisted snapshot BEFORE desiring the query to zero-cache, so
    // the resume's del/update pokes can attribute. Pre-connect adds are seeded in start()/on
    // connect; a live add seeds then desires.
    if (this.#connected) void this.#seedThenDesire(instanceKey);
  }

  async #seedThenDesire(instanceKey: string): Promise<void> {
    await this.#ensureSeeded([instanceKey]);
    if (this.#connected && this.#desired.has(instanceKey)) {
      this.#sendDesiredPatch([this.#putPatch(instanceKey)]);
    }
  }

  /** Rebuild each instance's demux attribution from its persisted Redis snapshot (once). */
  async #ensureSeeded(instanceKeys: readonly string[]): Promise<void> {
    for (const instanceKey of instanceKeys) {
      if (this.#seeded.has(instanceKey)) continue;
      this.#seeded.add(instanceKey);
      try {
        const rows = await this.#opts.store.snapshot(instanceKey);
        // If a removeInstance ran during the snapshot read, don't re-seed its attribution —
        // that would resurrect a torn-down instance (mis-route its future dels).
        if (!this.#desired.has(instanceKey)) continue;
        if (rows.length > 0) this.#demux.seedFromSnapshot(instanceKey, rows);
      } catch (error) {
        this.#seeded.delete(instanceKey); // let a later pass retry
        logger.warn('sync_demux_seed_failed', { clientGroupID: this.#opts.clientGroupID, instanceKey, error });
      }
    }
  }

  removeInstance(instanceKey: string, partitionValue: string): void {
    if (!this.#desired.has(instanceKey)) return;
    const { hash } = this.#desired.get(instanceKey)!;
    this.#desired.delete(instanceKey);
    this.#got.delete(instanceKey); // a re-add must re-observe gotQueriesPatch to re-hydrate
    this.#seeded.delete(instanceKey); // a re-add must re-seed the demux (removeInstance cleared it)
    this.#demux.removeInstance(instanceKey, partitionValue);
    if (this.#connected) this.#sendDesiredPatch([{ op: 'del', hash }]);
  }

  size(): number {
    return this.#demux.size();
  }

  /** Whether the tap's socket is currently connected (a live materializer). */
  isConnected(): boolean {
    return this.#connected;
  }

  /** Milliseconds since the last poke (or connect) — staleness signal for a wedged owner. */
  msSinceLastPoke(): number {
    return Date.now() - this.#lastPokeAt;
  }

  async start(): Promise<void> {
    // A fence-lost connection is single-use: its guard token, cookie and #got/#seeded state are
    // stale, so restarting it would reconnect, have every fenced write return stale, and (since
    // #demoteFenceLost is idempotent) run forever persisting nothing. The manager must discard
    // it and re-acquire with a fresh connection instead.
    if (this.#fenceLost) {
      logger.error('sync_pack_start_after_fence_lost', { clientGroupID: this.#opts.clientGroupID });
      return;
    }
    this.#closed = false;
    this.#stopped = false;
    // Resume under whatever zero-cache group id the previous owner last used (it rotates on a CVR
    // self-heal). On a takeover this is what makes loadCookie hit the warm cursor instead of a cold
    // base miss → ClientNotFound → rehydrate. Null (never rotated) → keep the base id.
    const savedZGroup = await this.#opts.store.loadZGroup(this.#opts.clientGroupID);
    if (savedZGroup) this.#zeroClientGroupID = savedZGroup;
    this.#baseCookie = await this.#opts.store.loadCookie(this.#zeroClientGroupID);
    // Seed the initial desired instances (the resume set) before the init header desires them.
    await this.#ensureSeeded([...this.#desired.keys()]);
    this.#connect();
  }

  stop(): void {
    this.#closed = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    if (this.#fatalTimer) {
      clearInterval(this.#fatalTimer);
      this.#fatalTimer = null;
    }
    this.#ws?.close();
    this.#ws = null;
  }

  /**
   * C5 — a FATAL server frame (VersionNotSupported / SchemaVersionNotSupported) stops the group
   * for good: admitted clients then get NOTHING while their snapshots freeze. Logging once let
   * that vanish — after a zero-cache protocol bump (PROTOCOL_VERSION is hardcoded) the whole
   * engine goes stale on one log line. Raise a LOUD REPEATED signal (error log + obs, re-fired on
   * an interval) so the silent-death surfaces until the process is redeployed. Cleared in stop().
   */
  #raiseFatal(kind: string): void {
    const fire = (): void => {
      logger.error('sync_pack_fatal', {
        clientGroupID: this.#opts.clientGroupID,
        queryName: this.#opts.queryName,
        kind,
      });
      obsEmit('tap-fatal', { clientGroupID: this.#opts.clientGroupID, kind });
    };
    fire();
    if (this.#fatalTimer) clearInterval(this.#fatalTimer);
    this.#fatalTimer = setInterval(fire, 60_000);
    this.#fatalTimer.unref?.();
  }

  /**
   * A fenced store write returned STALE — this pod lost the group lease (a newer owner INCR'd
   * the fence). Demote fully: stop reconnecting, drop the socket, and notify the manager, which
   * removes the group so a reconcile can re-acquire (or another pod already has). Idempotent;
   * only reachable when a `guard` is set — unfenced single-replica writes never go stale.
   */
  #demoteFenceLost(): void {
    if (this.#fenceLost) return;
    this.#fenceLost = true;
    this.#stopped = true;
    logger.error('sync_pack_fence_lost', { clientGroupID: this.#opts.clientGroupID });
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#ws?.close();
    this.#ws = null;
    this.#opts.onFenceLost?.();
  }

  #putPatch(instanceKey: string): Record<string, unknown> {
    const entry = this.#desired.get(instanceKey)!;
    return { op: 'put', hash: entry.hash, name: this.#opts.queryName, args: entry.args, ttl: this.#opts.ttlMs };
  }

  #sendDesiredPatch(desiredQueriesPatch: Record<string, unknown>[]): void {
    if (this.#ws?.readyState !== WebSocket.OPEN) return;
    this.#ws.send(JSON.stringify(['changeDesiredQueries', { desiredQueriesPatch }]));
  }

  #buildUrl(): string {
    const origin = this.#opts.zeroCacheUrl.replace(/^http/, 'ws').replace(/\/$/, '');
    const p = new URLSearchParams({
      clientID: this.#clientID,
      clientGroupID: this.#zeroClientGroupID,
      userID: SYNC_SERVICE_SUB,
      baseCookie: this.#baseCookie,
      ts: String(Date.now()),
      lmid: '0',
      wsid: randomUUID(),
      profileID: this.#profileID,
    });
    return `${origin}/sync/v${PROTOCOL_VERSION}/connect?${p.toString()}`;
  }

  #buildSecProtocol(): string {
    this.#sentInInit = new Set(this.#desired.keys());
    // NOTE: no `activeClients` (it is optional). Sending `[self]` makes zero-cache EVICT any other
    // client on the shared CVR — during a takeover overlap that would evict the outgoing owner's
    // still-live client and could drop its desired queries. Omitting it lets both coexist.
    const body: Record<string, unknown> = {
      desiredQueriesPatch: [...this.#desired.keys()].map((ik) => this.#putPatch(ik)),
    };
    if (this.#baseCookie === '') body.clientSchema = this.#opts.clientSchema;
    const initConnection = ['initConnection', body] as const;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return encodeSecProtocols(initConnection as any, mintSecProtocolToken());
  }

  #connect(): void {
    if (this.#closed || this.#stopped) return;
    this.#connected = false;
    const ws = new WebSocket(this.#buildUrl(), this.#buildSecProtocol(), {
      headers: { Cookie: buildCookieHeader() },
    });
    this.#ws = ws;
    ws.on('message', (data) => this.#onMessage(data.toString()));
    ws.on('error', (err) =>
      logger.error('sync_pack_ws_error', { clientGroupID: this.#opts.clientGroupID, error: err.message }),
    );
    ws.on('close', () => void this.#onClose());
  }

  async #onClose(): Promise<void> {
    this.#connected = false;
    // C4: a disconnect mid-poke strands the accumulated rowsPatch (can be MBs) forever, since
    // PackConnection lives across reconnects — drop it.
    this.#pending.clear();
    this.#pendingGot.clear();
    if (this.#closed || this.#stopped) return;
    // Invalidate any queued/in-flight persist and force the demux to re-seed from the durable
    // snapshot on reconnect (bumps the epoch + resetAll + clears #seeded). Without this, a resume
    // replays un-persisted pokes against a demux whose #owner already dropped their del entries →
    // dropped-del attribution poison. Runs for BOTH the reset and normal-reconnect paths.
    this.#invalidatePersist();
    if (this.#pendingReset) {
      this.#pendingReset = false;
      this.#attempt = 0;
      // Full rehydrate: re-observe gotQueriesPatch (else an empty instance never re-marks hydrated
      // post-reset → deferred clients stuck). #invalidatePersist already did resetAll + #seeded.clear.
      this.#got.clear();
      this.#baseCookie = '';
      // Drain in-flight/queued persists BEFORE the reset: an in-flight applyPoke EVAL can't be
      // epoch-bailed, and its writes must not land AFTER the reset's DELs (that would repopulate a
      // wiped snapshot with a non-cleared tail → isHydrated over torn state). Draining orders
      // reset strictly after every persist on ANY connection — not just via shared-client FIFO,
      // which P2's dedicated sync connections would break.
      await this.#persistQueue.drain();
      try {
        const outcome = await this.#opts.store.reset(
          this.#zeroClientGroupID,
          this.#demux.instanceKeys(),
          this.#opts.guard,
        );
        if (outcome === 'stale') return this.#demoteFenceLost();
      } catch (error) {
        logger.error('sync_pack_reset_failed', { clientGroupID: this.#opts.clientGroupID, error });
      }
      this.#zeroClientGroupID = `${this.#opts.clientGroupID}-${randomUUID()}`;
      this.#clientID = `${this.#zeroClientGroupID}-c`;
      // Persist the rotated id (fenced) so a takeover resumes under it + the cookie we're about to
      // save there, rather than a stale base id. Losing the fence here is a lease loss → demote.
      try {
        const zg = await this.#opts.store.saveZGroup(this.#opts.clientGroupID, this.#zeroClientGroupID, this.#opts.guard);
        if (zg === 'stale') return this.#demoteFenceLost();
      } catch (error) {
        logger.error('sync_pack_zgroup_save_failed', { clientGroupID: this.#opts.clientGroupID, error });
      }
    }
    const backoff = this.#pendingBackoff;
    this.#pendingBackoff = undefined;
    this.#scheduleReconnect(backoff);
  }

  #scheduleReconnect(override?: { minMs: number; maxMs: number }): void {
    if (this.#closed || this.#stopped) return;
    let delayMs: number;
    if (override) {
      delayMs = override.minMs + Math.random() * Math.max(0, override.maxMs - override.minMs);
    } else {
      const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** this.#attempt, MAX_BACKOFF_MS);
      delayMs = Math.random() * ceiling;
      this.#attempt += 1;
    }
    this.#reconnectTimer = setTimeout(() => void this.#reconnect(), delayMs);
  }

  /**
   * Reconnect path: SEED the demux from the durable snapshot BEFORE the socket exists. #onClose
   * wiped attribution (#invalidatePersist), and the init header desires every instance, so
   * zero-cache can poke resume deltas the instant it sees 'connected' — before #onConnected's lazy
   * seed finishes. Since #onPokeEnd is synchronous, a resume del for a not-yet-seeded instance
   * would find an empty #owner and be silently dropped (delete-leak class, df59b9055a). Seeding
   * first — exactly what start() does — makes that window impossible. (No-op on the reset path:
   * the snapshot was just wiped, so there is nothing to seed and no resume deltas.)
   */
  async #reconnect(): Promise<void> {
    if (this.#closed || this.#stopped) return;
    await this.#ensureSeeded([...this.#desired.keys()]);
    if (this.#closed || this.#stopped) return;
    // #ensureSeeded swallows per-instance snapshot-read failures (logs + drops from #seeded).
    // Connecting with an incompletely-seeded demux reopens the dropped-del window for exactly
    // those instances, so retry seeding via the normal backoff instead of connecting blind (a
    // persistent Redis outage then cycles seed-retry rather than poking against empty #owner).
    if ([...this.#desired.keys()].some((k) => !this.#seeded.has(k))) {
      logger.warn('sync_pack_reseed_incomplete', { clientGroupID: this.#opts.clientGroupID });
      this.#scheduleReconnect();
      return;
    }
    this.#connect();
  }

  #onMessage(raw: string): void {
    let msg: Downstream;
    try {
      msg = JSON.parse(raw) as Downstream;
    } catch {
      return;
    }
    const [type, body] = msg;
    switch (type) {
      case 'connected':
        this.#attempt = 0;
        this.#connected = true;
        void this.#onConnected();
        break;
      case 'error':
        this.#onErrorFrame(body);
        break;
      case 'pokeStart':
        this.#pending.set(String(body.pokeID), []);
        this.#pendingGot.set(String(body.pokeID), []);
        break;
      case 'pokePart': {
        const id = String(body.pokeID);
        const acc = this.#pending.get(id);
        const rowsPatch = body.rowsPatch as RowPatchOp[] | undefined;
        if (acc && rowsPatch) acc.push(...rowsPatch);
        // gotQueriesPatch is zero-cache's per-query "materialized" signal (fires even for
        // an empty result) — the exact thing its own client uses to flip `complete`.
        const gotAcc = this.#pendingGot.get(id);
        const gotPatch = body.gotQueriesPatch as { op: string; hash: string }[] | undefined;
        if (gotAcc && gotPatch) gotAcc.push(...gotPatch);
        break;
      }
      case 'pokeEnd':
        this.#onPokeEnd(body); // synchronous demux (message order) + enqueue the atomic persist
        break;
      default:
        break;
    }
  }

  /** On connect: seed any desired instances added since start() (before their patch is sent),
   *  then reconcile the desired set. Init-header instances were seeded in start(). */
  async #onConnected(): Promise<void> {
    this.#lastPokeAt = Date.now(); // fresh connect: reset the staleness clock
    await this.#ensureSeeded([...this.#desired.keys()]);
    this.#reconcileDesired();
    logger.info('sync_pack_connected', { clientGroupID: this.#opts.clientGroupID, instances: this.#demux.size() });
  }

  /** After (re)connect, sync the server's desired set to any adds/removes since the init header. */
  #reconcileDesired(): void {
    const patch: Record<string, unknown>[] = [];
    for (const ik of this.#desired.keys()) if (!this.#sentInInit.has(ik)) patch.push(this.#putPatch(ik));
    for (const ik of this.#sentInInit) if (!this.#desired.has(ik)) patch.push({ op: 'del', hash: ik });
    if (patch.length) this.#sendDesiredPatch(patch);
  }

  #onErrorFrame(body: Record<string, unknown>): void {
    const kind = String(body.kind ?? '');
    logger.warn('sync_pack_server_error', { clientGroupID: this.#opts.clientGroupID, kind, message: body.message });
    if (FATAL_KINDS.has(kind)) {
      this.#stopped = true;
      this.#raiseFatal(kind);
      return;
    }
    if (RESET_KINDS.has(kind)) {
      this.#pendingReset = true;
      return;
    }
    if (BACKOFF_KINDS.has(kind)) {
      this.#pendingBackoff = {
        minMs: Number(body.minBackoffMs ?? BASE_BACKOFF_MS),
        maxMs: Number(body.maxBackoffMs ?? MAX_BACKOFF_MS),
      };
    }
  }

  /**
   * SYNCHRONOUS: demux the poke (mutating attribution in strict message order — no interleave),
   * then ENQUEUE the atomic persist. The demux must run in poke order and does so here because
   * ws 'message' handling is sequential; only the Redis write is deferred, onto the per-connection
   * SerialQueue so writes also land in poke order.
   */
  #onPokeEnd(body: Record<string, unknown>): void {
    this.#lastPokeAt = Date.now();
    const pokeID = String(body.pokeID);
    const ops = this.#pending.get(pokeID) ?? [];
    const gotOps = this.#pendingGot.get(pokeID) ?? [];
    this.#pending.delete(pokeID);
    this.#pendingGot.delete(pokeID);
    if (body.cancel) return;

    const cookie = String(body.cookie);
    // zero-cache's makeRowPatch is put/del-only; an `update` should never arrive. If one does,
    // we can't merge it (stateless) — force a full re-materialize so the instance re-hydrates
    // instead of being left wiped-but-unhydratable. Blunt (whole-group reset) is acceptable:
    // this branch should never fire; skip the doomed poke and let the fresh connect rebuild.
    if (ops.some((o) => o.op === 'update')) {
      logger.error('sync_unexpected_update_op', { clientGroupID: this.#opts.clientGroupID });
      this.#pendingReset = true;
      this.#ws?.close();
      return;
    }
    const diffs = this.#demux.applyPoke(cookie, ops);
    // Instances that transitioned to `got` this poke (mark hydrated once each). The hash IS the
    // instanceKey. Recorded synchronously so a stale gotOps can't double-mark across pokes.
    const newlyGot: string[] = [];
    for (const { op, hash } of gotOps) {
      if (op === 'put' && this.#desired.has(hash) && !this.#got.has(hash)) {
        this.#got.add(hash);
        newlyGot.push(hash);
      }
    }
    const epoch = this.#persistEpoch;
    this.#persistDepth += 1;
    if (this.#persistDepth === PERSIST_DEPTH_WARN) {
      logger.warn('sync_pack_persist_backlog', { clientGroupID: this.#opts.clientGroupID, depth: this.#persistDepth });
    }
    this.#persistQueue.enqueue(this.#opts.clientGroupID, () => this.#persistPoke(epoch, cookie, diffs, newlyGot));
  }

  /**
   * Persist one poke atomically (all instance diffs + hydration markers + cookie in one write).
   * Advances `#baseCookie` ONLY after the write is durable, so a failed/skipped poke resumes from
   * the last saved cookie on reconnect. A stale epoch (a disconnect/reset happened since enqueue)
   * bails — the reconnect replays from the saved cookie against a re-seeded demux.
   */
  async #persistPoke(
    epoch: number,
    cookie: string,
    diffs: Map<string, StreamDiff>,
    newlyGot: readonly string[],
  ): Promise<void> {
    this.#persistDepth -= 1; // dequeued
    if (epoch !== this.#persistEpoch) return;
    try {
      const outcome = await this.#opts.store.applyPoke(
        { clientGroupID: this.#zeroClientGroupID, cookie, diffs, newlyGot },
        this.#opts.guard,
      );
      if (outcome === 'stale') return this.#demoteFenceLost(); // fence loss is epoch-independent — handle first
      if (epoch !== this.#persistEpoch) return; // reconnected mid-write; result is moot (resume re-seeds + replays)
      this.#baseCookie = cookie;
      for (const [instanceKey, diff] of diffs) {
        if (diff.upserts.length || diff.deletes.length) {
          obsEmit('tap-poke', {
            instanceKey,
            clientGroupID: this.#opts.clientGroupID,
            queryName: this.#opts.queryName,
            upserts: diff.upserts.length,
            deletes: diff.deletes.length,
          });
        }
      }
      for (const hash of newlyGot) {
        obsEmit('tap', { action: 'hydrated', instanceKey: hash, clientGroupID: this.#opts.clientGroupID });
      }
    } catch (error) {
      // Persist failed → the poke never reached Redis but the demux already applied it (dels
      // dropped their #owner entries). Roll back: bump the epoch (skips queued persists), undo the
      // in-memory `got` marks, re-seed the demux from the still-correct snapshot, and reconnect —
      // resume from the last SAVED cookie replays the poke with correct attribution. (`#baseCookie`
      // was not advanced, so it already points at the last durable cookie.)
      logger.error('sync_pack_persist_failed', { clientGroupID: this.#opts.clientGroupID, error });
      this.#invalidatePersist();
      for (const hash of newlyGot) this.#got.delete(hash);
      this.#ws?.close();
    }
  }

  /**
   * Invalidate any queued/in-flight persist and force the demux to rebuild from the durable
   * snapshot on the next connect. Called on every disconnect and on a persist failure so a
   * resume's del/update pokes (PK-only) re-attribute instead of dropping (C2).
   */
  #invalidatePersist(): void {
    this.#persistEpoch += 1;
    this.#demux.resetAll();
    this.#seeded.clear();
  }
}
