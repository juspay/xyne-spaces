import type { Socket } from 'socket.io';
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import { logger } from '@/utils/logger';
import { syncEngine } from './syncEngine';
import { fanout, type SyncSocket } from './fanout';
import { hashOfNameAndArgs } from './protocol';
import { deriveAclGate } from './aclGate';
import { queryMetaFor } from './queryMeta';
import { grantQueryName, grantArgs } from './grantQueries';
import { obsEmit } from './obs';

/**
 * An authenticated app socket. Matches the shape websocketService's auth middleware
 * attaches (`userId`, `workspaceId`), so its `AuthenticatedSocket` is assignable here
 * without casting. The fan-out delivers over this same socket (see fanout.ts).
 */
export interface SyncIoSocket extends Socket {
  userId: string;
  workspaceId?: string;
  /** Workspace role. The ACL gate is derived with a MEMBER sentinel ctx, so the sync engine
   *  serves MEMBER-role principals only; others (esp. GUEST) are refused fail-closed. */
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

  // Deliver over this socket via the minimal emitter surface the fan-out expects.
  const emitter: SyncSocket = {
    emit: (event, payload) => {
      socket.emit(event, payload);
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
    // FAIL-CLOSED role gate: deriveAclGate freezes the sentinel ctx at role=MEMBER, so the gate is
    // only correct for MEMBER principals. A GUEST evaluated under the MEMBER shape would be admitted
    // to PUBLIC channels the guest ACL (guestChannelAccessWhere) would deny — a leak; ADMIN/OWNER
    // would be under-privileged (safe but wrong). Serve MEMBER only until per-role gates exist; the
    // client falls back to stock Zero for everything else.
    if (socket.workspaceRole !== 'MEMBER') {
      obsEmit('sync-sub', { action: 'reject', socketId: connId, userId, queryName, reason: 'non-member-role' });
      socket.emit('sync:error', { queryName, message: 'sync engine serves member-role principals only' });
      return;
    }
    const dataInstanceKey = syncEngine.subscribe(queryName, args, connId);
    if (!dataInstanceKey) {
      obsEmit('sync-sub', { action: 'reject', socketId: connId, userId, queryName });
      socket.emit('sync:error', { queryName, message: 'not a shareable query' });
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

  function unsubscribe(queryName: string, args: ReadonlyJSONValue[]): void {
    const dataInstanceKey = hashOfNameAndArgs(queryName, args);
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
    ready = true;
    socket.emit('sync:ready');
    for (const p of pending) subscribe(p.queryName, p.args, p.ack, p.sinceOffset);
    pending.length = 0;
  };
}
