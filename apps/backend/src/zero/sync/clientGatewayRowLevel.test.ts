import { test, after } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Gateway tenant-boundary test for the row-level branch. Drives the REAL attachSyncHandlers /
 * subscribeRowLevel (eligibility refuse, workspaceId forcing, queryMeta, routeColumn) with a fake io
 * socket, stubbing only the syncEngine/fanout singletons (a test seam — no gateway change). The
 * security invariant: a client's args can NEVER select another tenant's workspace; the instance is
 * always keyed by the SOCKET's workspaceId. No Redis needed (singletons stubbed).
 */
type Sub = { name: string; args: unknown };
let attachSyncHandlers: (typeof import('./clientGateway'))['attachSyncHandlers'] | undefined;
let syncEngine: (typeof import('./syncEngine'))['syncEngine'] | undefined;
let fanout: (typeof import('./fanout'))['fanout'] | undefined;
let hashOfNameAndArgs: (typeof import('./protocol'))['hashOfNameAndArgs'] | undefined;
let disconnectSyncStore: (typeof import('./redisStore'))['disconnectSyncStore'] | undefined;
let redisService: (typeof import('@/services/redisService'))['redisService'] | undefined;
let reason = '';
try {
  ({ attachSyncHandlers } = await import('./clientGateway.js'));
  ({ syncEngine } = await import('./syncEngine.js'));
  ({ fanout } = await import('./fanout.js'));
  ({ hashOfNameAndArgs } = await import('./protocol.js'));
  ({ disconnectSyncStore } = await import('./redisStore.js'));
  ({ redisService } = await import('@/services/redisService'));
} catch (e) {
  reason = `env unavailable: ${String(e).slice(0, 80)}`;
}
const skip = attachSyncHandlers && syncEngine && fanout && hashOfNameAndArgs ? false : reason || 'unavailable';

after(() => {
  redisService?.getClient().disconnect();
  disconnectSyncStore?.();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeSocket(over: Record<string, unknown> = {}): any {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const sent: Array<{ event: string; payload: unknown }> = [];
  return {
    id: 's1', userId: 'U1', workspaceId: 'W_A', workspaceRole: 'MEMBER', connected: true,
    on: (e: string, h: (...a: unknown[]) => void) => { handlers[e] = h; },
    emit: (e: string, p: unknown) => sent.push({ event: e, payload: p }),
    join() {}, leave() {},
    _handlers: handlers, _sent: sent,
    ...over,
  };
}

test('row-level subscribe forces the SOCKET workspace — client args cannot reach another tenant', { skip }, async () => {
  const subCalls: Sub[] = [];
  const addCalls: Array<{ workspaceId: string; userId: string; meta: { rootTable: string; routeColumn: string } }> = [];
  const removed: string[] = [];
  const se = syncEngine!, fo = fanout!, hash = hashOfNameAndArgs!;
  const origSub = se.subscribe, origUnsub = se.unsubscribe, origAdd = fo.addRowLevelClient, origRemove = fo.removeClient;
  // Stub returns the REAL instanceKey so subscribe/unsubscribe key the same map entry.
  se.subscribe = ((name: string, args: readonly unknown[]) => { subCalls.push({ name, args: JSON.parse(JSON.stringify(args)) }); return hash(name, args); }) as typeof se.subscribe;
  se.unsubscribe = (() => {}) as typeof se.unsubscribe;
  fo.addRowLevelClient = (async (sub: { workspaceId: string; userId: string; meta: { rootTable: string; routeColumn: string } }) => { addCalls.push(sub); }) as typeof fo.addRowLevelClient;
  fo.removeClient = ((_id: string, key: string) => { removed.push(key); }) as typeof fo.removeClient;
  try {
    const socket = fakeSocket();
    const trigger = attachSyncHandlers!(socket);
    trigger(); // go ready

    // Client tries to subscribe ANOTHER workspace's drafts.
    socket._handlers['sync:subscribe']({ queryName: 'userDrafts', args: [{ workspaceId: 'W_FOREIGN' }] }, () => {});
    await new Promise((r) => setImmediate(r)); // let the async addRowLevelClient settle

    assert.equal(subCalls.length, 1, 'subscribed exactly once');
    assert.deepEqual(subCalls[0].args, [{ workspaceId: 'W_A' }], 'instance keyed by the SOCKET workspace, NOT the client-supplied W_FOREIGN');
    assert.equal(addCalls.length, 1);
    assert.equal(addCalls[0].workspaceId, 'W_A');
    assert.equal(addCalls[0].userId, 'U1');
    assert.equal(addCalls[0].meta.rootTable, 'draft_messages');
    assert.equal(addCalls[0].meta.routeColumn, 'userId');

    // Idempotent re-subscribe: same forced key → no second addRowLevelClient.
    socket._handlers['sync:subscribe']({ queryName: 'userDrafts', args: [{ workspaceId: 'W_FOREIGN' }] }, () => {});
    await new Promise((r) => setImmediate(r));
    assert.equal(addCalls.length, 1, 'duplicate subscribe did not double-add');

    // Unsubscribe with foreign args still matches — it recomputes the key with the forced workspace.
    socket._handlers['sync:unsubscribe']({ queryName: 'userDrafts', args: [{ workspaceId: 'W_FOREIGN' }] });
    assert.deepEqual(removed, [hash('userDrafts', [{ workspaceId: 'W_A' }])], 'unsubscribe released the socket-workspace instance');
  } finally {
    se.subscribe = origSub; se.unsubscribe = origUnsub; fo.addRowLevelClient = origAdd; fo.removeClient = origRemove;
  }
});

test('a GUEST-role socket is refused the row-level path (MEMBER-only)', { skip }, async () => {
  const addCalls: unknown[] = [];
  const fo = fanout!;
  const origAdd = fo.addRowLevelClient;
  fo.addRowLevelClient = (async (s: unknown) => { addCalls.push(s); }) as typeof fo.addRowLevelClient;
  try {
    const socket = fakeSocket({ workspaceRole: 'GUEST' });
    const trigger = attachSyncHandlers!(socket);
    trigger();
    socket._handlers['sync:subscribe']({ queryName: 'userDrafts', args: [{ workspaceId: 'W_A' }] }, () => {});
    await new Promise((r) => setImmediate(r));
    assert.equal(addCalls.length, 0, 'guest never reaches addRowLevelClient');
    assert.ok(socket._sent.some((e: { event: string }) => e.event === 'sync:error'), 'guest got a sync:error');
  } finally {
    fo.addRowLevelClient = origAdd;
  }
});
