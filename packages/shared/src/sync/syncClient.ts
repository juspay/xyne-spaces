/**
 * Shared-base sync engine client (protocol only — transport is injected).
 *
 * The fan-out rides the app's EXISTING backend socket (dashboard: socket.io via
 * `websocketService`; mobile: its own socket) rather than a second WebSocket — one
 * connection, shared auth/reconnect/heartbeat. This module speaks the sync protocol
 * over whatever `SyncTransport` the app provides, reference-counts instances so many
 * hooks share a subscription, re-subscribes on reconnect, and feeds received rows
 * into the hosted IVM.
 */
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import type { IvmHost, WireRow } from './ivmHost.js';
import { obsEmit } from './obs.js';
import { loadPersistedOffsets, savePersistedOffsets } from './persistence.js';

/** Debounce for persisting offsets — a crash-recovery cache, not a source of truth. */
const OFFSET_PERSIST_DEBOUNCE_MS = 1000;

/**
 * Minimal transport the host app adapts from its existing socket. `emit`'s optional
 * `ack` uses the socket's acknowledgement callback (socket.io supports it natively).
 */
export interface SyncTransport {
  emit<P, A = void>(event: string, payload: P, ack?: (response: A) => void): void;
  on<P>(event: string, handler: (payload: P) => void): void;
  off<P>(event: string, handler: (payload: P) => void): void;
}

const EVT = {
  subscribe: 'sync:subscribe',
  unsubscribe: 'sync:unsubscribe',
  snapshot: 'sync:snapshot',
  delta: 'sync:delta',
  revoke: 'sync:revoke',
  /**
   * Server → client, emitted once the backend's sync handlers are attached on a
   * connection (after its async workspace lookup). We (re)send subscriptions on THIS,
   * not on the socket's raw `connect`: `connect` fires before the server has registered
   * its `sync:subscribe` handler, so a subscribe sent then is silently dropped.
   */
  ready: 'sync:ready',
  disconnect: 'disconnect',
} as const;

/** Client → server. */
interface SubscribePayload {
  queryName: string;
  args: ReadonlyJSONValue[];
  /** Last applied op-stream offset — server resumes (deltas only) if still retained. */
  sinceOffset?: string;
}
/** Server ack to `sync:subscribe`. */
interface SubscribeAck {
  instanceKey: string;
}
/** Server → client. `offset` = the op-stream id this frame brings the client current to. */
interface SnapshotMsg {
  instanceKey: string;
  rows: WireRow[];
  offset?: string;
}
interface DeltaMsg {
  instanceKey: string;
  upserts?: WireRow[];
  deletes?: string[];
  offset?: string;
}
interface RevokeMsg {
  instanceKey: string;
}

const subKey = (queryName: string, args: ReadonlyJSONValue[]): string =>
  `${queryName}:${JSON.stringify(args)}`;

export class SyncClient {
  readonly #host: IvmHost;
  readonly #transport: SyncTransport;
  /** subKey → active subscription (reference-counted, with its server instanceKey). */
  readonly #subs = new Map<
    string,
    { queryName: string; args: ReadonlyJSONValue[]; refs: number; instanceKey?: string }
  >();
  /** subKeys whose first snapshot has arrived — a query is `complete` only once hydrated
   *  (an empty channel is complete-empty, indistinguishable from "loading" by row count). */
  readonly #hydrated = new Set<string>();
  readonly #hydrationListeners = new Map<string, Set<() => void>>();
  /**
   * instanceKey → last applied op-stream offset. Sent as `sinceOffset` on (re)subscribe so
   * a reconnect replays only missed deltas instead of a full snapshot. In-memory, so it
   * survives a socket reconnect (rows are still in the IVM) but not a reload (rows gone
   * too — a fresh snapshot is correct there). Kept until the instance is dropped/revoked.
   */
  readonly #offsets = new Map<string, string>();
  /**
   * Persisted `subKey → offset` map (survives reload via the StorageAdapter). DORMANT for
   * now — nothing promotes it into `#offsets`, so reload still snapshots. The reload
   * flatten-seed step will consume it once it can seed the source. Kept current so it's
   * ready then. (Distinct from `#offsets`, which is keyed by instanceKey and drives the
   * in-memory socket-reconnect resume.)
   */
  #persistedOffsets: Record<string, string> = {};
  #offsetPersistTimer: ReturnType<typeof setTimeout> | undefined;
  #started = false;
  /**
   * Whether the server has signalled this connection is initialized (`sync:ready`).
   * Subscriptions are DECLARATIVE: `subscribe()` only records intent; the `sync:subscribe`
   * is sent when the connection is ready and re-sent on every new connection — mirroring
   * how Zero sends its query set as part of connection init instead of racing an eager
   * emit against a socket that isn't connected yet. `#subs` is the live, ref-counted set
   * of currently-mounted queries (navigating unmounts old ones), so a reconnect re-sends
   * only what's on screen now, not every channel ever visited.
   */
  #connectionReady = false;

  /** Whether the fan-out snapshot for this query has arrived. */
  isHydrated(queryName: string, args: ReadonlyJSONValue[]): boolean {
    return this.#hydrated.has(subKey(queryName, args));
  }

  /** Notify when this query hydrates (for `useSyncExternalStore`). */
  onHydration(queryName: string, args: ReadonlyJSONValue[], onChange: () => void): () => void {
    const key = subKey(queryName, args);
    let set = this.#hydrationListeners.get(key);
    if (!set) {
      set = new Set();
      this.#hydrationListeners.set(key, set);
    }
    set.add(onChange);
    return () => set.delete(onChange);
  }

  constructor(host: IvmHost, transport: SyncTransport) {
    this.#host = host;
    this.#transport = transport;
  }

  /** Attach protocol listeners once. Idempotent. Call at engine init so `sync:ready`
   *  and server pushes are caught even before the first subscribe (e.g. a reconnect). */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    // Restore persisted offsets (merge without clobbering any advanced this session).
    void loadPersistedOffsets().then((saved) => {
      for (const k in saved) if (!(k in this.#persistedOffsets)) this.#persistedOffsets[k] = saved[k];
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.#flushOffsets);
    }
    this.#transport.on<SnapshotMsg>(EVT.snapshot, this.#onSnapshot);
    this.#transport.on<DeltaMsg>(EVT.delta, this.#onDelta);
    this.#transport.on<RevokeMsg>(EVT.revoke, this.#onRevoke);
    this.#transport.on<void>(EVT.ready, this.#onReady);
    this.#transport.on<void>(EVT.disconnect, this.#onDisconnect);
  }

  /** Reference a shared query-instance; subscribes on the first reference. */
  subscribe(queryName: string, args: ReadonlyJSONValue[]): void {
    this.start();
    const key = subKey(queryName, args);
    const entry = this.#subs.get(key);
    if (entry) {
      entry.refs += 1;
      return;
    }
    const sub = { queryName, args, refs: 1, instanceKey: undefined as string | undefined };
    this.#subs.set(key, sub);
    // Declarative: only send now if the connection is already initialized. Otherwise the
    // send happens on `sync:ready` (initial connect or reconnect), so we never emit into a
    // socket that isn't connected yet.
    if (this.#connectionReady) this.#send(key);
  }

  /** Drop a reference; unsubscribes and releases the instance's rows on the last one. */
  unsubscribe(queryName: string, args: ReadonlyJSONValue[]): void {
    const key = subKey(queryName, args);
    const entry = this.#subs.get(key);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    this.#subs.delete(key);
    this.#hydrated.delete(key);
    delete this.#persistedOffsets[key];
    this.#scheduleOffsetPersist();
    obsEmit('client-ws', { dir: 'up', event: 'unsubscribe', queryName, instanceKey: entry.instanceKey });
    this.#transport.emit<SubscribePayload>(EVT.unsubscribe, { queryName, args });
    if (entry.instanceKey) {
      this.#offsets.delete(entry.instanceKey);
      this.#host.dropInstance(entry.instanceKey);
    }
  }

  /** Emit a subscribe and record the instanceKey the server replies with. */
  #send(key: string): void {
    const sub = this.#subs.get(key);
    if (!sub) return;
    const sinceOffset = sub.instanceKey ? this.#offsets.get(sub.instanceKey) : undefined;
    obsEmit('client-ws', { dir: 'up', event: 'subscribe', queryName: sub.queryName, sinceOffset });
    this.#transport.emit<SubscribePayload, SubscribeAck>(
      EVT.subscribe,
      { queryName: sub.queryName, args: sub.args, sinceOffset },
      (resp) => {
        const current = this.#subs.get(key);
        if (current) current.instanceKey = resp.instanceKey;
        obsEmit('client-ws', {
          dir: 'down',
          event: 'ack',
          queryName: sub.queryName,
          instanceKey: resp.instanceKey,
        });
      },
    );
  }

  /**
   * The server has attached its sync handlers (fresh connection or reconnect) and has
   * no memory of our subscriptions — re-send them all. Emitted after the server's async
   * setup, so unlike `connect` the handlers are guaranteed registered here.
   */
  readonly #onReady = (): void => {
    this.#connectionReady = true;
    obsEmit('client-ws', { dir: 'down', event: 'ready', resent: this.#subs.size });
    for (const key of this.#subs.keys()) this.#send(key);
  };

  /** Connection dropped — the next `sync:ready` will re-drive all subscriptions. */
  readonly #onDisconnect = (): void => {
    this.#connectionReady = false;
  };

  /** The subKey an instance is subscribed under (for keying its persisted offset). */
  #subKeyOf(instanceKey: string): string | undefined {
    for (const [key, sub] of this.#subs) if (sub.instanceKey === instanceKey) return key;
    return undefined;
  }

  /** Record an instance's latest offset in the persisted (reload) map + schedule a save. */
  #recordOffset(instanceKey: string, offset: string): void {
    const key = this.#subKeyOf(instanceKey);
    if (!key) return;
    this.#persistedOffsets[key] = offset;
    this.#scheduleOffsetPersist();
  }

  #scheduleOffsetPersist(): void {
    if (this.#offsetPersistTimer) return;
    this.#offsetPersistTimer = setTimeout(() => {
      this.#offsetPersistTimer = undefined;
      savePersistedOffsets(this.#persistedOffsets);
    }, OFFSET_PERSIST_DEBOUNCE_MS);
  }

  readonly #flushOffsets = (): void => {
    if (this.#offsetPersistTimer) {
      clearTimeout(this.#offsetPersistTimer);
      this.#offsetPersistTimer = undefined;
    }
    savePersistedOffsets(this.#persistedOffsets);
  };

  readonly #onSnapshot = (msg: SnapshotMsg): void => {
    obsEmit('client-ws', {
      dir: 'down',
      event: 'snapshot',
      instanceKey: msg.instanceKey,
      rows: msg.rows?.length ?? 0,
    });
    this.#host.applyDelta(msg.instanceKey, msg.rows ?? [], []);
    if (msg.offset) {
      this.#offsets.set(msg.instanceKey, msg.offset);
      this.#recordOffset(msg.instanceKey, msg.offset);
    }
    // Mark the subscription(s) for this instance hydrated (a query becomes `complete`).
    for (const [key, sub] of this.#subs) {
      if (sub.instanceKey === msg.instanceKey && !this.#hydrated.has(key)) {
        this.#hydrated.add(key);
        this.#hydrationListeners.get(key)?.forEach((cb) => cb());
      }
    }
  };

  readonly #onDelta = (msg: DeltaMsg): void => {
    obsEmit('client-ws', {
      dir: 'down',
      event: 'delta',
      instanceKey: msg.instanceKey,
      upserts: msg.upserts?.length ?? 0,
      deletes: msg.deletes?.length ?? 0,
    });
    this.#host.applyDelta(msg.instanceKey, msg.upserts ?? [], msg.deletes ?? []);
    if (msg.offset) {
      this.#offsets.set(msg.instanceKey, msg.offset);
      this.#recordOffset(msg.instanceKey, msg.offset);
    }
  };

  readonly #onRevoke = (msg: RevokeMsg): void => {
    obsEmit('client-ws', { dir: 'down', event: 'revoke', instanceKey: msg.instanceKey });
    const subKey = this.#subKeyOf(msg.instanceKey);
    if (subKey) {
      delete this.#persistedOffsets[subKey];
      this.#scheduleOffsetPersist();
    }
    this.#offsets.delete(msg.instanceKey);
    this.#host.dropInstance(msg.instanceKey);
  };
}
