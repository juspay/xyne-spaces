import type { Socket } from 'socket.io';
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import { logger } from '@/utils/logger';
import { syncEngine } from './syncEngine';
import { fanout, type SyncSocket } from './fanout';
import { hashOfNameAndArgs } from './protocol';
import { deriveAclGate, NON_GUEST_ROLES } from './aclGate';
import { queryMetaFor } from './queryMeta';
import { grantQueryName, grantArgs } from './grantQueries';
import { isRowLevelQuery, routeColumnOf, rowLevelEligibility } from './rowLevelQueries';
import { resolveSharedBase, isWorkspacePartitioned, SHARED_BASE_QUERIES } from './baseQueries';
import { syncContext } from './serviceIdentity';
import { obsEmit } from './obs';
import { syncMetrics } from './metrics';
import { modeFor, modesSnapshot } from './queryModes';

/**
 * An authenticated app socket. Matches the shape websocketService's auth middleware
 * attaches (`userId`, `workspaceId`), so its `AuthenticatedSocket` is assignable here
 * without casting. The fan-out delivers over this same socket (see fanout.ts).
 */
export interface SyncIoSocket extends Socket {
  userId: string;
  workspaceId?: string;
  /** Workspace role. The ACL gate is derived under a non-guest (MEMBER) sentinel, so the sync engine
   *  serves every non-guest role (member/admin/owner/community — see NON_GUEST_ROLES); GUEST and
   *  unknown roles are refused fail-closed (guests would be over-admitted under the non-guest gate). */
  workspaceRole?: string;
}

interface Subscription {
  grantInstanceKeys: string[];
}

interface SyncMessage {
  queryName?: string;
  args?: ReadonlyJSONValue[];
  /** Client's last applied op-stream offset for this instance — resume instead of snapshot. */
  sinceOffset?: string;
}

/** Reply to `sync:subscribe` — the client keys the instance by this to release its rows. */
interface SubscribeAck {
  instanceKey: string;
}
type SubscribeAckFn = (ack: SubscribeAck) => void;

/**
 * Register the shared-base sync-engine handlers on an authenticated socket.io socket.
 * Client emits `sync:subscribe` / `sync:unsubscribe` ({ queryName, args }); the server
 * materializes the data + ACL-grant instances, gates the client, and streams
 * `sync:snapshot` / `sync:delta` back over the same socket.
 */
export function attachSyncHandlers(socket: SyncIoSocket): () => void {
  const { userId } = socket;
  const connId = socket.id;
  const subs = new Map<string, Subscription>(); // dataInstanceKey → grant instances
  // Subscribes that arrive before workspaceId resolves are queued here and flushed by the
  // returned trigger. The handlers are registered SYNCHRONOUSLY on connection (before the
  // async workspace lookup), so a subscribe the client sends immediately on connect is
  // received and queued — never dropped for want of a registered handler (the old race).
  const pending: Array<{
    queryName: string;
    args: ReadonlyJSONValue[];
    ack?: SubscribeAckFn;
    sinceOffset?: string;
  }> = [];
  let ready = false;

  // Deliver over this socket via the minimal emitter surface the fan-out expects. join/leave manage
  // the per-instance room the fan-out broadcasts deltas to (one encode for all live clients).
  const emitter: SyncSocket = {
    emit: (event, payload) => {
      socket.emit(event, payload);
    },
    join: (room) => {
      void socket.join(room);
    },
    leave: (room) => {
      void socket.leave(room);
    },
    get connected() {
      return socket.connected;
    },
  };

  socket.on('sync:subscribe', (msg: SyncMessage, ack?: SubscribeAckFn) => {
    if (!msg?.queryName || !Array.isArray(msg.args)) return;
    if (!ready) {
      pending.push({ queryName: msg.queryName, args: msg.args, ack, sinceOffset: msg.sinceOffset });
      return;
    }
    subscribe(msg.queryName, msg.args, ack, msg.sinceOffset);
  });
  // Per-socket rate limit for client-originated beacon frames: the client throttles itself,
  // but the server must not trust that (a hostile/buggy client could spam the metric + log).
  let beaconWindowStart = 0;
  let beaconCount = 0;
  socket.on('sync:shadow-check', (msg: { queryName?: string; matched?: boolean; kind?: string }) => {
    const now = Date.now();
    if (now - beaconWindowStart > 60_000) {
      beaconWindowStart = now;
      beaconCount = 0;
    }
    if (++beaconCount > 30) return; // drop silently past the per-socket budget
    // Client-reported shadow comparison (throttled client-side). Matches are the DENOMINATOR —
    // a divergence rate needs one, and "no divergences" without checks is false confidence.
    // The label is attributed ONLY for registry-known names — queryName is the one
    // client-supplied string that reaches a Prometheus label, and label cardinality must not
    // be client-mintable.
    const raw = typeof msg?.queryName === 'string' ? msg.queryName : '';
    const q = SHARED_BASE_QUERIES.has(raw) || isRowLevelQuery(raw) ? raw : 'unknown';
    const matched = msg?.matched === true;
    const kind = msg?.kind === 'length' || msg?.kind === 'content' ? msg.kind : undefined;
    syncMetrics.count('sync_engine_shadow_checks_total', {
      queryName: q,
      result: matched ? 'match' : 'diverged',
      ...(kind ? { kind } : {}),
    });
    if (!matched) {
      obsEmit('sync-sub', { action: 'shadow-divergence', socketId: connId, userId, queryName: q, kind });
    }
  });
  socket.on('sync:unsubscribe', (msg: SyncMessage) => {
    if (msg?.queryName && Array.isArray(msg.args)) unsubscribe(msg.queryName, msg.args);
  });
  socket.on('disconnect', () => {
    for (const [dataInstanceKey, sub] of subs) {
      syncEngine.unsubscribe(dataInstanceKey, connId);
      for (const g of sub.grantInstanceKeys) syncEngine.unsubscribe(g, connId);
      fanout.removeClient(connId, dataInstanceKey);
    }
    subs.clear();
    obsEmit('sync-sub', { action: 'disconnect', socketId: connId, userId });
  });

  function subscribe(
    queryName: string,
    args: ReadonlyJSONValue[],
    ack?: SubscribeAckFn,
    sinceOffset?: string,
  ): void {
    const workspaceId = socket.workspaceId;
    if (!workspaceId) return; // guaranteed set once `ready`; guard for safety
    const subStart = Date.now();
    // FAIL-CLOSED role gate. The gate is derived under a NON-GUEST sentinel (sentinelCtx.role = MEMBER),
    // so it encodes the non-guest ACL branch. A GUEST evaluated under it would be admitted to things the
    // guest ACL (guestChannelAccessWhere) denies — a LEAK — so guests are refused → native Zero. Every
    // OTHER role (member/admin/owner/community) shares that same non-guest branch (asserted role-invariant
    // by the shareability CI guard), so the gate is CORRECT for them — admit them. An unknown/absent role
    // fails closed (not in NON_GUEST_ROLES).
    if (!socket.workspaceRole || !NON_GUEST_ROLES.includes(socket.workspaceRole)) {
      obsEmit('sync-sub', { action: 'reject', socketId: connId, userId, queryName, reason: 'guest-or-unknown-role' });
      socket.emit('sync:error', { queryName, message: 'sync engine does not serve guest-role principals' });
      syncMetrics.count('sync_engine_subscribe_total', { plane: isRowLevelQuery(queryName) ? 'rowlevel' : 'gate', queryName, outcome: 'refused_role' });
      return;
    }
    // Runtime rollout gate (CAC overlay — see queryModes.ts): 'off' refuses → the client stays
    // native for this query. Can only SUBTRACT from the compiled, CI-audited registries.
    if (modeFor(queryName) === 'off') {
      obsEmit('sync-sub', { action: 'reject', socketId: connId, userId, queryName, reason: 'mode-off' });
      socket.emit('sync:error', { queryName, message: 'query disabled by config' });
      syncMetrics.count('sync_engine_subscribe_total', {
        plane: isRowLevelQuery(queryName) ? 'rowlevel' : 'gate',
        queryName,
        outcome: 'refused_config',
      });
      return;
    }
    // Row-level queries take a wholly separate path: the workspace partition is forced from the SOCKET
    // (never client args — it IS the tenant boundary, there is no gate), rows route by socket.userId,
    // no gate/grants. Reached only for an admitted non-guest role (guarded above).
    if (isRowLevelQuery(queryName)) {
      subscribeRowLevel(queryName, ack, sinceOffset, subStart);
      return;
    }
    // Workspace-partitioned GATE queries (partition = workspaceId): FORCE the partition from the
    // authenticated socket, overriding any client-supplied value. workspaceId is the tenant boundary,
    // so — unlike a globally-unique channelId taken safely from args — it must never be client-
    // controlled: this keys + materializes the instance under the socket's OWN workspace, so a client
    // can neither join nor materialize another tenant's instance. Admission within the instance is
    // still the ACL gate below (every member sees all rows → one shared instance, room-broadcast).
    // NORMALIZED to exactly [{workspaceId}] — spreading client args into the key would let every
    // junk-arg variant ({x:1, workspaceId:W}, {x:2, …}) materialize a DISTINCT workspace-sized
    // instance (zero-cache pipeline + Redis snapshot/stream + memo entry each) from one authed
    // client. Every registry base reads ONLY args.workspaceId, so nothing is lost; a future entry
    // needing real args must declare them in the registry and whitelist them here.
    if (isWorkspacePartitioned(queryName)) {
      args = [{ workspaceId }];
    }
    const dataInstanceKey = syncEngine.subscribe(queryName, args, connId);
    if (!dataInstanceKey) {
      obsEmit('sync-sub', { action: 'reject', socketId: connId, userId, queryName });
      socket.emit('sync:error', { queryName, message: 'not a shareable query' });
      syncMetrics.count('sync_engine_subscribe_total', { plane: 'gate', queryName, outcome: 'refused_query' });
      return;
    }
    // Idempotent: the client may (re)send the same subscribe (optimistic send races the
    // handler attach, so it also re-sends on `sync:ready`). Re-ack and stop — a second
    // `fanout.addClient` would double-deliver. `syncEngine.subscribe` above already
    // refreshed the instance's idle timer.
    if (subs.has(dataInstanceKey)) {
      ack?.({ instanceKey: dataInstanceKey });
      return;
    }
    const meta = queryMetaFor(queryName, args[0]);
    if (!meta) {
      // Roll back the data subscribe made above — this path never reaches `subs.set`, so
      // the disconnect handler would never release it either (a permanent refcount leak).
      syncEngine.unsubscribe(dataInstanceKey, connId);
      return;
    }
    const partitionValue = String((args[0] as Record<string, ReadonlyJSONValue>)[meta.partitionColumn]);

    // Materialize the ACL grant instances (own client groups) and gate the client.
    // An ungateable ACL (unsupported node/op) is not shareable — refuse the subscribe and
    // roll back the data instance we subscribed above, rather than materialize a client the
    // gate could never evaluate.
    let gate;
    try {
      gate = deriveAclGate(meta.rootTable);
    } catch (error) {
      syncEngine.unsubscribe(dataInstanceKey, connId);
      obsEmit('sync-sub', { action: 'reject', socketId: connId, userId, queryName, reason: 'ungateable-acl' });
      logger.error('[SyncGateway] ungateable ACL — refusing subscribe', {
        queryName,
        rootTable: meta.rootTable,
        error,
      });
      socket.emit('sync:error', { queryName, message: 'query ACL is not shareable' });
      syncMetrics.count('sync_engine_subscribe_total', { plane: 'gate', queryName, outcome: 'refused_query' });
      return;
    }
    // GATE-ONLY shareability (defense in depth behind the build-time CI guard): refuse a query whose
    // ACL doesn't collapse to a gate — per-row admission (calls' membership arms, per-row visibleTo/
    // createdBy) is not served here. The client falls back to native Zero on this sync:error.
    const collapse = gate.collapsibility(meta.partitionColumn);
    if (!collapse.ok) {
      syncEngine.unsubscribe(dataInstanceKey, connId);
      obsEmit('sync-sub', { action: 'reject', socketId: connId, userId, queryName, reason: 'not-gate-collapsible' });
      logger.error('[SyncGateway] non-gate-collapsible ACL — refusing subscribe', {
        queryName,
        rootTable: meta.rootTable,
        partitionColumn: meta.partitionColumn,
        reason: collapse.reason,
      });
      socket.emit('sync:error', { queryName, message: 'query ACL is not shareable' });
      syncMetrics.count('sync_engine_subscribe_total', { plane: 'gate', queryName, outcome: 'refused_query' });
      return;
    }
    // Cursor pagination is per-subscriber (scroll position) → it fragments into per-subscriber
    // instances (hashOfNameAndArgs keys by the cursor args), defeating sharing. The CI guard's
    // cursor check is SAMPLE_ARGS-dependent and misses CONDITIONAL `.start()` (built only when the
    // client passes a cursor), so re-check the base built from the ACTUAL args here. A fixed
    // `.limit()` window is fine (shared per instance) — only `.start()` is the disqualifier. Build
    // fresh (queryMetaFor's meta cache is first-args-wins, so it can't be trusted for this).
    const actualBase = resolveSharedBase(queryName, syncContext(), args[0]) as { ast?: { start?: unknown } } | undefined;
    if (actualBase?.ast?.start !== undefined) {
      syncEngine.unsubscribe(dataInstanceKey, connId);
      obsEmit('sync-sub', { action: 'reject', socketId: connId, userId, queryName, reason: 'cursor-paginated' });
      logger.error('[SyncGateway] cursor-paginated query — refusing subscribe (not shareable)', { queryName });
      socket.emit('sync:error', { queryName, message: 'query is cursor-paginated (not shareable)' });
      syncMetrics.count('sync_engine_subscribe_total', { plane: 'gate', queryName, outcome: 'refused_query' });
      return;
    }
    const grantByTable = new Map<string, string>();
    const grantInstanceKeys: string[] = [];
    for (const gs of gate.grantSources) {
      // Two-plane partition (final plan): a PER-USER grant materializes ALL of U's rows
      // (`__grant__channel_participants{userId:U}`), shared across every channel U views and
      // warm for the session; a PER-SCOPE grant is the scope-root row for THIS channel
      // (`__grant__channels{id:C}`). The evaluator filters the per-user snapshot to the scope
      // via the ACL correlation, so the snapshot semantics are unchanged.
      const [col, val] =
        gs.kind === 'per-user' ? [gs.boundColumn as string, userId] : [gs.scopeColumn, partitionValue];
      const gk = syncEngine.subscribe(grantQueryName(gs.table), grantArgs(col, val), connId);
      if (gk) {
        grantByTable.set(gs.table, gk);
        grantInstanceKeys.push(gk);
      }
    }
    subs.set(dataInstanceKey, { grantInstanceKeys });
    obsEmit('sync-sub', {
      action: 'subscribe',
      socketId: connId,
      userId,
      queryName,
      partition: partitionValue,
      rootTable: meta.rootTable,
      instanceKey: dataInstanceKey,
      grants: grantInstanceKeys.length,
    });
    // Reply with the instanceKey so the client can release the instance's rows on unsubscribe.
    ack?.({ instanceKey: dataInstanceKey });
    syncMetrics.count('sync_engine_subscribe_total', { plane: 'gate', queryName, outcome: 'accepted' });
    syncMetrics.observe('sync_engine_subscribe_latency', Date.now() - subStart, { plane: 'gate' });
    void fanout.addClient({
      id: connId,
      socket: emitter,
      userId,
      workspaceId,
      scope: { [meta.partitionColumn]: partitionValue },
      gate,
      dataInstanceKey,
      grantByTable,
      sinceOffset,
    });
  }

  /**
   * Row-level subscribe: one user on a workspace instance, no gate/grants. The instance args are the
   * SOCKET's workspace (forced — never the client's, since the partition is the tenant boundary), so a
   * client cannot reach another tenant's rows; delivery routes each row to socket.userId at the fan-out.
   */
  function subscribeRowLevel(queryName: string, ack?: SubscribeAckFn, sinceOffset?: string, subStart = Date.now()): void {
    const workspaceId = socket.workspaceId;
    if (!workspaceId) return;
    // Runtime eligibility refuse (defense in depth behind the CI guard — the spec's third enforcement
    // arm, the row-level analog of the gate's collapsibility refuse). An allowlist edit that reached
    // prod without a green build would otherwise be SERVED — the quiet over-delivery the R-1 predicate
    // exists to prevent. Cheap (memoized) and BEFORE syncEngine.subscribe, so nothing to roll back.
    const eligible = rowLevelEligibility(queryName);
    if (!eligible.ok) {
      obsEmit('sync-sub', { action: 'reject', socketId: connId, userId, queryName, reason: 'row-level-not-eligible' });
      logger.error('[SyncGateway] row-level query failed eligibility — refusing subscribe', { queryName, reason: eligible.reason });
      socket.emit('sync:error', { queryName, message: 'not a shareable query' });
      syncMetrics.count('sync_engine_subscribe_total', { plane: 'rowlevel', queryName, outcome: 'refused_query' });
      return;
    }
    const wsArgs: ReadonlyJSONValue[] = [{ workspaceId }]; // FORCED from the socket
    const dataInstanceKey = syncEngine.subscribe(queryName, wsArgs, connId);
    if (!dataInstanceKey) {
      obsEmit('sync-sub', { action: 'reject', socketId: connId, userId, queryName, reason: 'row-level-not-shareable' });
      socket.emit('sync:error', { queryName, message: 'not a shareable query' });
      syncMetrics.count('sync_engine_subscribe_total', { plane: 'rowlevel', queryName, outcome: 'refused_query' });
      return;
    }
    // Idempotent re-subscribe (optimistic send races the handler attach / re-fires on sync:ready).
    if (subs.has(dataInstanceKey)) {
      ack?.({ instanceKey: dataInstanceKey });
      return;
    }
    const meta = queryMetaFor(queryName, wsArgs[0]);
    const routeColumn = routeColumnOf(queryName);
    if (!meta || !routeColumn) {
      syncEngine.unsubscribe(dataInstanceKey, connId); // roll back — never reached subs.set
      return;
    }
    // No grants for row-level; the empty grantInstanceKeys lets the shared disconnect/unsubscribe
    // teardown release it uniformly (fanout.removeClient branches to the row-level path by instanceKey).
    subs.set(dataInstanceKey, { grantInstanceKeys: [] });
    ack?.({ instanceKey: dataInstanceKey });
    syncMetrics.count('sync_engine_subscribe_total', { plane: 'rowlevel', queryName, outcome: 'accepted' });
    syncMetrics.observe('sync_engine_subscribe_latency', Date.now() - subStart, { plane: 'rowlevel' });
    obsEmit('sync-sub', {
      action: 'subscribe-rowlevel',
      socketId: connId,
      userId,
      queryName,
      workspaceId,
      rootTable: meta.rootTable,
      routeColumn,
      instanceKey: dataInstanceKey,
    });
    void fanout.addRowLevelClient({
      id: connId,
      socket: emitter,
      userId,
      workspaceId,
      dataInstanceKey,
      sinceOffset,
      meta: { rootTable: meta.rootTable, routeColumn, childLinks: meta.childLinks },
    });
  }

  function unsubscribe(queryName: string, args: ReadonlyJSONValue[]): void {
    // Row-level instances are keyed by the FORCED socket-workspace args (subscribeRowLevel), not the
    // client's — recompute with the same override or the key won't match. (Disconnect uses the stored
    // key directly, so only this explicit-unsubscribe path needs it.) If workspaceId is somehow unset
    // the fallback to client args won't match either — intentionally left to disconnect teardown rather
    // than special-cased, since after `ready` the workspace is always present.
    const effectiveArgs: ReadonlyJSONValue[] =
      (isRowLevelQuery(queryName) || isWorkspacePartitioned(queryName)) && socket.workspaceId
        ? [{ workspaceId: socket.workspaceId }] // same normalization as subscribe — keys must match
        : args;
    const dataInstanceKey = hashOfNameAndArgs(queryName, effectiveArgs);
    const sub = subs.get(dataInstanceKey);
    if (!sub) return;
    syncEngine.unsubscribe(dataInstanceKey, connId);
    for (const g of sub.grantInstanceKeys) syncEngine.unsubscribe(g, connId);
    fanout.removeClient(connId, dataInstanceKey);
    subs.delete(dataInstanceKey);
    obsEmit('sync-sub', { action: 'unsubscribe', socketId: connId, queryName, instanceKey: dataInstanceKey });
  }

  obsEmit('sync-sub', { action: 'connect', socketId: connId, userId, workspaceId: socket.workspaceId });
  logger.debug?.('[SyncGateway] handlers attached', { socketId: connId });

  // Returned to the connection handler: call once workspaceId is resolved. Goes live,
  // tells the client (`sync:ready` → it (re)subscribes), and flushes subscribes that
  // arrived during the async setup. Idempotent.
  return (): void => {
    if (ready) return;
    if (!socket.workspaceId) {
      pending.length = 0; // no workspace — nothing to serve
      return;
    }
    // CONNECTION-level role gate. The shared engine's ACL gate is derived under a non-guest
    // (MEMBER) sentinel, so a guest/unknown principal would be over-admitted (its stricter ACL
    // ignored) — refuse the whole connection. Emit `sync:unavailable` (not `sync:ready`) so the
    // client never engages the engine and stays on native Zero from the first render, rather than
    // subscribing a dead instance and relying on a per-query `sync:error`. The per-subscribe gate
    // in `subscribe()` stays as defense-in-depth (an optimistic subscribe could still race here).
    if (!socket.workspaceRole || !NON_GUEST_ROLES.includes(socket.workspaceRole)) {
      pending.length = 0;
      obsEmit('sync-sub', { action: 'unavailable', socketId: connId, userId, reason: 'guest-or-unknown-role' });
      socket.emit('sync:unavailable', { reason: 'role-not-served' });
      return;
    }
    ready = true;
    socket.emit('sync:ready', { modes: modesSnapshot() });
    for (const p of pending) subscribe(p.queryName, p.args, p.ack, p.sinceOffset);
    pending.length = 0;
  };
}
