import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { logger } from '@/utils/logger';
import { encodeSecProtocols, PROTOCOL_VERSION } from './protocol';
import { PackDemux } from './packDemux';
import type { RowPatchOp } from './streamState';
import type { RedisStreamStore, FenceGuard } from './redisStore';
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
  #closed = false;
  #stopped = false;
  #fenceLost = false;
  #pendingReset = false;
  #pendingBackoff: { minMs: number; maxMs: number } | undefined;
  #attempt = 0;
  #reconnectTimer: NodeJS.Timeout | null = null;

  readonly #pending = new Map<string, RowPatchOp[]>();
  /** Accumulated `gotQueriesPatch` ops per in-flight poke (hash = instanceKey). */
  readonly #pendingGot = new Map<string, { op: string; hash: string }[]>();
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
    this.#baseCookie = await this.#opts.store.loadCookie(this.#zeroClientGroupID);
    // Seed the initial desired instances (the resume set) before the init header desires them.
    await this.#ensureSeeded([...this.#desired.keys()]);
    this.#connect();
  }

  stop(): void {
    this.#closed = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#ws?.close();
    this.#ws = null;
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
    const body: Record<string, unknown> = {
      desiredQueriesPatch: [...this.#desired.keys()].map((ik) => this.#putPatch(ik)),
      activeClients: [this.#clientID],
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
    if (this.#closed || this.#stopped) return;
    if (this.#pendingReset) {
      this.#pendingReset = false;
      this.#attempt = 0;
      this.#demux.resetAll();
      // The fresh materialize re-sends gotQueriesPatch and rebuilds the demux, so let both
      // re-fire: clear #got (else an empty instance never re-marks hydrated post-reset →
      // deferred clients stuck) and #seeded (re-seed from the now-wiped snapshot; a no-op).
      this.#got.clear();
      this.#seeded.clear();
      this.#baseCookie = '';
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
    this.#reconnectTimer = setTimeout(() => this.#connect(), delayMs);
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
        void this.#onPokeEnd(body);
        break;
      default:
        break;
    }
  }

  /** On connect: seed any desired instances added since start() (before their patch is sent),
   *  then reconcile the desired set. Init-header instances were seeded in start(). */
  async #onConnected(): Promise<void> {
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
      logger.error('sync_pack_fatal', { clientGroupID: this.#opts.clientGroupID, kind });
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

  async #onPokeEnd(body: Record<string, unknown>): Promise<void> {
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
    this.#baseCookie = cookie;
    try {
      // Persist row diffs FIRST so an instance's snapshot HSET reflects its data before it
      // is marked hydrated (a deferred fan-out client snapshots on the hydrated marker). A
      // STALE fenced write means we lost the lease mid-poke → stop immediately and demote;
      // the remaining writes (and saveCookie) would each be rejected anyway.
      for (const [instanceKey, diff] of diffs) {
        if ((await this.#opts.store.applyDiff(instanceKey, cookie, diff, this.#opts.guard)) === 'stale') {
          return this.#demoteFenceLost();
        }
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
      // Mark newly-"got" instances hydrated (once each). The hash IS the instanceKey.
      for (const { op, hash } of gotOps) {
        if (op === 'put' && this.#desired.has(hash) && !this.#got.has(hash)) {
          this.#got.add(hash);
          if ((await this.#opts.store.markHydrated(hash, cookie, this.#opts.guard)) === 'stale') {
            return this.#demoteFenceLost();
          }
          obsEmit('tap', { action: 'hydrated', instanceKey: hash, clientGroupID: this.#opts.clientGroupID });
        }
      }
      if ((await this.#opts.store.saveCookie(this.#zeroClientGroupID, cookie, this.#opts.guard)) === 'stale') {
        return this.#demoteFenceLost();
      }
    } catch (error) {
      logger.error('sync_pack_persist_failed', { clientGroupID: this.#opts.clientGroupID, error });
    }
  }
}
