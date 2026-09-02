import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { logger } from '@/utils/logger';
import { encodeSecProtocols, PROTOCOL_VERSION } from './protocol';
import { PackDemux } from './packDemux';
import type { RowPatchOp } from './streamState';
import type { RedisStreamStore } from './redisStore';
import type { ClientSchema } from './clientSchema';
import type { QueryMeta } from './queryMeta';
import { mintSecProtocolToken, buildCookieHeader, SYNC_SERVICE_SUB } from './serviceIdentity';

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

  readonly #clientID: string;
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
  #pendingReset = false;
  #pendingBackoff: { minMs: number; maxMs: number } | undefined;
  #attempt = 0;
  #reconnectTimer: NodeJS.Timeout | null = null;

  readonly #pending = new Map<string, RowPatchOp[]>();

  constructor(opts: PackConnectionOptions) {
    this.#opts = opts;
    this.#demux = new PackDemux(opts.meta, opts.pkFields);
    this.#clientID = `${opts.clientGroupID}-c`;
    this.#profileID = `${opts.clientGroupID}-p`;
  }

  /** Add a query-instance to this group. Registers it live if already connected. */
  addInstance(instanceKey: string, args: readonly unknown[], hash: string, partitionValue: string): void {
    if (this.#desired.has(instanceKey)) return;
    this.#desired.set(instanceKey, { hash, args, partitionValue });
    this.#demux.addInstance(instanceKey, partitionValue);
    if (this.#connected) this.#sendDesiredPatch([this.#putPatch(instanceKey)]);
  }

  removeInstance(instanceKey: string, partitionValue: string): void {
    if (!this.#desired.has(instanceKey)) return;
    const { hash } = this.#desired.get(instanceKey)!;
    this.#desired.delete(instanceKey);
    this.#demux.removeInstance(instanceKey, partitionValue);
    if (this.#connected) this.#sendDesiredPatch([{ op: 'del', hash }]);
  }

  size(): number {
    return this.#demux.size();
  }

  async start(): Promise<void> {
    this.#closed = false;
    this.#stopped = false;
    this.#baseCookie = await this.#opts.store.loadCookie(this.#opts.clientGroupID);
    this.#connect();
  }

  stop(): void {
    this.#closed = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#ws?.close();
    this.#ws = null;
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
      clientGroupID: this.#opts.clientGroupID,
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
      this.#baseCookie = '';
      try {
        await this.#opts.store.reset(this.#opts.clientGroupID, this.#demux.instanceKeys());
      } catch (error) {
        logger.error('sync_pack_reset_failed', { clientGroupID: this.#opts.clientGroupID, error });
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
        this.#reconcileDesired();
        logger.info('sync_pack_connected', { clientGroupID: this.#opts.clientGroupID, instances: this.#demux.size() });
        break;
      case 'error':
        this.#onErrorFrame(body);
        break;
      case 'pokeStart':
        this.#pending.set(String(body.pokeID), []);
        break;
      case 'pokePart': {
        const acc = this.#pending.get(String(body.pokeID));
        const rowsPatch = body.rowsPatch as RowPatchOp[] | undefined;
        if (acc && rowsPatch) acc.push(...rowsPatch);
        break;
      }
      case 'pokeEnd':
        void this.#onPokeEnd(body);
        break;
      default:
        break;
    }
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
    this.#pending.delete(pokeID);
    if (body.cancel) return;

    const cookie = String(body.cookie);
    const diffs = this.#demux.applyPoke(cookie, ops);
    this.#baseCookie = cookie;
    try {
      for (const [instanceKey, diff] of diffs) {
        await this.#opts.store.applyDiff(instanceKey, cookie, diff);
      }
      await this.#opts.store.saveCookie(this.#opts.clientGroupID, cookie);
    } catch (error) {
      logger.error('sync_pack_persist_failed', { clientGroupID: this.#opts.clientGroupID, error });
    }
  }
}
