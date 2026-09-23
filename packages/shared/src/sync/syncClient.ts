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
import type { SyncStore, RowKeyRef } from './store.js';
import { obsEmit } from './obs.js';

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
  /** Resume-complete marker: the client has been replayed up to the server's current version (sent
   *  even when zero deltas were missed). Flips a resumed instance to `complete`. */
  current: 'sync:current',
  revoke: 'sync:revoke',
  /**
   * Server → client, emitted once the backend's sync handlers are attached on a
   * connection (after its async workspace lookup). We (re)send subscriptions on THIS,
   * not on the socket's raw `connect`: `connect` fires before the server has registered
   * its `sync:subscribe` handler, so a subscribe sent then is silently dropped.
   */
  ready: 'sync:ready',
  /**
   * Server → client, connection-level. The backend won't serve this principal at all (e.g. a
   * guest/unknown role, whose stricter ACL the shared gate can't represent). The client flips a
   * reactive flag so every shared query falls back to native Zero and the engine is never engaged.
   * A subsequent `sync:ready` (reconnect, possibly with a changed role) clears it.
   */
  unavailable: 'sync:unavailable',
  /** Server → client, per-query. A single subscribe was refused (not shareable / raced the gate). */
  error: 'sync:error',
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
/**
 * Server → client. `offset` = the op-stream id this frame brings the client current to
 * (per-stream resume cursor). `version` = the Zero cookie `stateVersion` the rows reflect
 * (the logical change clock) — used for cross-stream apply-if-newer, NOT for resume.
 */
interface SnapshotMsg {
  instanceKey: string;
  rows: WireRow[];
  offset?: string;
  version?: string;
}
interface DeltaMsg {
  instanceKey: string;
  upserts?: WireRow[];
  deletes?: string[];
  offset?: string;
  version?: string;
}
interface RevokeMsg {
  instanceKey: string;
}

export type SyncQueryMode = 'serve' | 'shadow' | 'off';
export interface SyncQueryModes {
  default: SyncQueryMode;
  queries: Record<string, SyncQueryMode>;
}

const subKey = (queryName: string, args: ReadonlyJSONValue[]): string =>
  `${queryName}:${JSON.stringify(args)}`;

/**
 * The content stamp is the cookie `stateVersion`; a `:minorVersion` suffix is per-CVR
 * config-only (not a data-change clock), so strip it before comparing. Equal `stateVersion`
 * = same DB state → apply-if-newer uses `>=` so ties accept.
 */
const contentVersion = (v: string | undefined): string | undefined =>
  v === undefined ? undefined : v.split(':', 1)[0];

export class SyncClient {
  readonly #host: IvmHost;
  readonly #transport: SyncTransport;
  readonly #store: SyncStore;
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
  /** subKey → last applied op-stream offset (drives `sinceOffset`). Keyed by subKey, which
   *  is client-known pre-ack, so a reload can look it up before the server assigns an
   *  instanceKey. Set live from frames and on reload from the persisted `meta`. */
  readonly #offsets = new Map<string, string>();
  /** server instanceKey → our subKey, so incoming frames route to the subKey everything
   *  else (host, store, offsets, hydration) is keyed by. Established on the subscribe ack. */
  readonly #instToSub = new Map<string, string>();
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
  /**
   * The server signalled `sync:unavailable` — this principal is not served by the shared engine
   * (role gate). Reactive: `useQuery` reads it so the whole app falls back to native Zero without
   * engaging the engine. Cleared on a fresh `sync:ready` (a reconnect may carry a different role).
   */
  #unavailable = false;
  readonly #servingListeners = new Set<() => void>();

  /** Whether the server has refused to serve this principal (`sync:unavailable`). Reactive. */
  isUnavailable(): boolean {
    return this.#unavailable;
  }

  /** Notify when serving-availability flips (`sync:unavailable` ↔ `sync:ready`) — for `useSyncExternalStore`. */
  onServingChange(onChange: () => void): () => void {
    this.#servingListeners.add(onChange);
    return () => this.#servingListeners.delete(onChange);
  }

  #setUnavailable(next: boolean): void {
    if (this.#unavailable === next) return;
    this.#unavailable = next;
    this.#servingListeners.forEach((cb) => cb());
  }

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

  constructor(host: IvmHost, transport: SyncTransport, store: SyncStore) {
    this.#host = host;
    this.#transport = transport;
    this.#store = store;
  }

  /** Attach protocol listeners once. Idempotent. Call at engine init so `sync:ready`
   *  and server pushes are caught even before the first subscribe (e.g. a reconnect). */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#transport.on<SnapshotMsg>(EVT.snapshot, this.#onSnapshot);
    this.#transport.on<DeltaMsg>(EVT.delta, this.#onDelta);
    this.#transport.on<{ instanceKey: string }>(EVT.current, this.#onCurrent);
    this.#transport.on<RevokeMsg>(EVT.revoke, this.#onRevoke);
    this.#transport.on<{ modes?: SyncQueryModes } | undefined>(EVT.ready, this.#onReady);
    this.#transport.on<{ reason?: string }>(EVT.unavailable, this.#onUnavailable);
    this.#transport.on<{ queryName?: string; message?: string }>(EVT.error, this.#onError);
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
    void this.#hydrateAndSend(key);
  }

  /**
   * Look up the resume offset (fast, a single `meta` read) and send `sinceOffset` — the
   * send needs only the offset, not the rows, so a channel-switch (already connected)
   * resumes instead of snapshotting. Row seeding runs in PARALLEL for instant paint, and
   * the resume deltas apply on top of the seeded base in either completion order: the
   * seed promise is recorded in `#seedDone` so the resume's `sync:current` cannot flip
   * `complete` before the local base is applied (see #onCurrent). On a fresh reload the
   * connection isn't ready yet, so the send happens on `sync:ready` — by then both the
   * offset and the seed have run.
   */
  async #hydrateAndSend(key: string): Promise<void> {
    try {
      const offset = await this.#store.loadOffset(key);
      if (offset) this.#offsets.set(key, offset);
    } catch {
      // best-effort — subscribe fresh (snapshot) on failure
    }
    // Only now may a send carry this key — #onReady skips unprepared keys and relies on
    // this tail, so a boot-time `sync:ready` that beats the IDB read can't emit an
    // offset-less subscribe (which forces a full snapshot where a resume would do).
    this.#prepared.add(key);
    if (this.#connectionReady && this.#subs.has(key)) this.#send(key);
    this.#seedDone.set(key, this.#seedFromStore(key));
  }

  /** Keys whose resume-offset load has settled — the gate for #onReady's re-send. */
  readonly #prepared = new Set<string>();

  /**
   * subKey → completion of the in-flight IDB seed (resolves even on failure/skip). The
   * resume path's `complete` gate: a zero-delta resume answers in a network round-trip
   * (~ms) and regularly BEATS the IDB read, and flipping `complete` before the seeded
   * base is applied shows `complete` with an empty/partial view — consumers treating
   * that as truth wipe their lists (the switch-return flicker). `complete` must mean:
   * server-confirmed current AND the local base fully applied.
   */
  readonly #seedDone = new Map<string, Promise<void>>();

  /** Load an instance's persisted rows + offset into the IVM (a fast local PAINT only). Does NOT mark
   *  the instance hydrated: `complete` must mean "caught up to the server's current state", and the
   *  seed is possibly-stale local data (its offset can be ahead of its rows). The instance stays
   *  `unknown` until the SERVER confirms currency — a `sync:snapshot` (#onSnapshot) or a `sync:current`
   *  resume-complete marker (#onCurrent). Painting under `unknown` avoids the empty/stale-complete that
   *  makes consumers (e.g. ChatListV4's "all deleted" branch) wipe the list on a channel switch-return. */
  async #seedFromStore(key: string): Promise<void> {
    try {
      const persisted = await this.#store.loadInstance(key);
      if (!persisted || !this.#subs.has(key)) return;
      // An authoritative snapshot (or a completed resume) landed while the IDB read was in
      // flight — its state supersedes the persisted base. Applying the seed now could only
      // re-add rows deleted-while-away (the version guard can't catch PKs the snapshot no
      // longer contains). Discard it.
      if (this.#hydrated.has(key)) return;
      if (persisted.rows.length > 0) this.#host.applySeed(key, persisted.rows);
      if (persisted.offset) this.#offsets.set(key, persisted.offset);
    } catch {
      // Seed is best-effort; on failure we simply subscribe fresh (server snapshots).
    }
  }

  /** Server → client: the resume is caught up to the current version (sent even for a zero-delta
   *  resume). This is the resume-path completion signal — snapshots self-announce via #onSnapshot,
   *  but a resume replays bare deltas with no terminal marker, so without this a switch-return that
   *  resumes with nothing-missed would sit at `unknown` forever. Flip to hydrated (`complete`) —
   *  but only once the parallel IDB seed has been applied: the resume deltas are RELATIVE to the
   *  seeded base, so before the seed lands the view is partial and must stay `unknown`. */
  readonly #onCurrent = (msg: { instanceKey: string }): void => {
    const key = this.#instToSub.get(msg.instanceKey);
    if (!key) return;
    const seed = this.#seedDone.get(key);
    if (seed) void seed.then(() => this.#markHydrated(key));
    else this.#markHydrated(key);
  };

  /** Flip a subscription to hydrated (`complete`) — only if it is still live and not already. */
  #markHydrated(key: string): void {
    if (!this.#subs.has(key) || this.#hydrated.has(key)) return;
    this.#hydrated.add(key);
    this.#hydrationListeners.get(key)?.forEach((cb) => cb());
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
    this.#seedDone.delete(key);
    this.#prepared.delete(key);
    obsEmit('client-ws', { dir: 'up', event: 'unsubscribe', queryName, instanceKey: entry.instanceKey });
    this.#transport.emit<SubscribePayload>(EVT.unsubscribe, { queryName, args });
    // Everything (host rows, offset) is keyed by subKey; the seed may have populated the
    // host even before an ack. Disk (SyncStore) is intentionally KEPT — eviction is
    // RAM-only, so a revisit resumes.
    this.#offsets.delete(key);
    this.#host.dropInstance(key);
    if (entry.instanceKey) this.#instToSub.delete(entry.instanceKey);
  }

  /** Emit a subscribe and record the instanceKey the server replies with. */
  #send(key: string): void {
    const sub = this.#subs.get(key);
    if (!sub) return;
    const sinceOffset = this.#offsets.get(key);
    obsEmit('client-ws', { dir: 'up', event: 'subscribe', queryName: sub.queryName, sinceOffset });
    this.#transport.emit<SubscribePayload, SubscribeAck>(
      EVT.subscribe,
      { queryName: sub.queryName, args: sub.args, sinceOffset },
      (resp) => {
        const current = this.#subs.get(key);
        if (current) current.instanceKey = resp.instanceKey;
        this.#instToSub.set(resp.instanceKey, key);
        obsEmit('client-ws', {
          dir: 'down',
          event: 'ack',
          queryName: sub.queryName,
          instanceKey: resp.instanceKey,
        });
      },
    );
  }

  #modes: SyncQueryModes | null = null;
  readonly #modesListeners = new Set<() => void>();

  #setModes(modes: SyncQueryModes): void {
    const changed = JSON.stringify(this.#modes) !== JSON.stringify(modes);
    this.#modes = modes;
    if (changed) for (const cb of this.#modesListeners) cb();
  }

  /** Per-query serve mode from the server's ready payload; undefined until (or unless) sent. */
  queryMode(queryName: string): SyncQueryMode | undefined {
    if (!this.#modes) return undefined;
    return this.#modes.queries[queryName] ?? this.#modes.default;
  }

  onModesChange(cb: () => void): () => void {
    this.#modesListeners.add(cb);
    return () => this.#modesListeners.delete(cb);
  }

  /**
   * Throttled shadow-check beacon — the promotion/rollback signal for shadow mode. BOTH outcomes
   * report (different throttles): matches give the DENOMINATOR (zero divergences with zero checks
   * is false confidence, not correctness), divergences carry a kind (length = rows missing/extra;
   * content = same rows, drifted fields) for triage without log access.
   */
  readonly #lastCheckAt = new Map<string, number>();
  reportShadowCheck(queryName: string, matched: boolean, kind?: 'length' | 'content'): void {
    const key = `${queryName}:${matched}`;
    const throttleMs = matched ? 600_000 : 60_000; // liveness ping vs incident signal
    const now = Date.now();
    if (now - (this.#lastCheckAt.get(key) ?? 0) < throttleMs) return;
    this.#lastCheckAt.set(key, now);
    this.#transport.emit('sync:shadow-check', { queryName, matched, kind });
  }

  /**
   * The server has attached its sync handlers (fresh connection or reconnect) and has
   * no memory of our subscriptions — re-send them all. Emitted after the server's async
   * setup, so unlike `connect` the handlers are guaranteed registered here.
   */
  readonly #onReady = (msg?: { modes?: SyncQueryModes }): void => {
    this.#connectionReady = true;
    // Per-query serve modes ride the ready payload (CAC overlay; see backend queryModes.ts) —
    // refreshed on every (re)connect. Absent on an older server → legacy routing (undefined).
    if (msg?.modes) this.#setModes(msg.modes);
    // A fresh `sync:ready` means the server IS serving us now — clear any prior unavailable
    // (a reconnect can carry a changed role). Shared queries re-engage the engine on re-render.
    this.#setUnavailable(false);
    obsEmit('client-ws', { dir: 'down', event: 'ready', resent: this.#subs.size });
    // Only PREPARED keys re-send here. At boot, `sync:ready` regularly beats the IDB
    // offset load (localhost socket vs cold IndexedDB); sending then would omit
    // `sinceOffset` and force a full snapshot where a resume would do. An unprepared
    // key's in-flight #hydrateAndSend sends it the moment its offset load settles
    // (connectionReady is now true). On a mid-session reconnect every live key is
    // already prepared, so all of them re-send immediately as before.
    for (const key of this.#subs.keys()) {
      if (this.#prepared.has(key)) this.#send(key);
    }
  };

  /**
   * The server won't serve this principal (role gate). Flip the reactive flag → `useQuery` routes
   * every shared query to native Zero. Any instances the client optimistically engaged before this
   * arrived are torn down by React when `useSharedQuery` unmounts (isShared → false); we only need
   * to stop the connection from being treated as ready so nothing re-sends.
   */
  readonly #onUnavailable = (msg?: { reason?: string }): void => {
    this.#connectionReady = false;
    obsEmit('client-ws', { dir: 'down', event: 'unavailable', reason: msg?.reason });
    this.#setUnavailable(true);
  };

  /**
   * A single subscribe was refused. The SWR handoff in `useQuery` already keeps Zero serving until
   * the engine hydrates, so an errored query never blanks — this is observability + a hook point.
   */
  readonly #onError = (msg?: { queryName?: string; message?: string }): void => {
    obsEmit('client-ws', { dir: 'down', event: 'error', queryName: msg?.queryName, message: msg?.message });
  };

  /** Connection dropped — the next `sync:ready` will re-drive all subscriptions. */
  readonly #onDisconnect = (): void => {
    this.#connectionReady = false;
  };

  readonly #onSnapshot = (msg: SnapshotMsg): void => {
    const key = this.#instToSub.get(msg.instanceKey);
    if (!key) return;
    obsEmit('client-ws', {
      dir: 'down',
      event: 'snapshot',
      instanceKey: msg.instanceKey,
      rows: msg.rows?.length ?? 0,
    });
    const rows = msg.rows ?? [];
    const version = contentVersion(msg.version);
    // Authoritative: clear-then-apply in RAM and on disk (drops deletes-while-away).
    this.#host.applySnapshot(key, rows, version);
    void this.#store
      .applySnapshot(key, rows.map((r) => this.#host.rowPut(r)), msg.offset, version)
      .catch(() => {});
    if (msg.offset) this.#offsets.set(key, msg.offset);
    // Authoritative (clear-then-apply): hydrated immediately, no seed dependency — a still
    // in-flight seed is discarded by #seedFromStore's hydrated guard.
    this.#markHydrated(key);
  };

  readonly #onDelta = (msg: DeltaMsg): void => {
    obsEmit('client-ws', {
      dir: 'down',
      event: 'delta',
      instanceKey: msg.instanceKey,
      upserts: msg.upserts?.length ?? 0,
      deletes: msg.deletes?.length ?? 0,
    });
    const key = this.#instToSub.get(msg.instanceKey);
    if (!key) return;
    const upserts = msg.upserts ?? [];
    const deletes = msg.deletes ?? [];
    const version = contentVersion(msg.version);
    this.#host.applyDelta(key, upserts, deletes, version);
    const puts = upserts.map((r) => this.#host.rowPut(r));
    const dels = deletes
      .map((k) => this.#host.keyRef(k))
      .filter((x): x is RowKeyRef => x !== null);
    void this.#store.applyDelta(key, puts, dels, msg.offset, version).catch(() => {});
    if (msg.offset) this.#offsets.set(key, msg.offset);
  };

  readonly #onRevoke = (msg: RevokeMsg): void => {
    obsEmit('client-ws', { dir: 'down', event: 'revoke', instanceKey: msg.instanceKey });
    const key = this.#instToSub.get(msg.instanceKey);
    if (!key) return;
    this.#offsets.delete(key);
    this.#seedDone.delete(key);
    this.#host.dropInstance(key);
    // Access lost → drop the persisted copy too (the one place disk is evicted).
    void this.#store.dropInstance(key).catch(() => {});
  };
}
