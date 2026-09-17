import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rowKey, type Row, type StreamDiff } from './streamState';
import type { RowLevelMeta } from './rowLevelRouting';

/**
 * R3 — LIVE row-level e2e over REAL Redis (the store the fake-store lifecycle test mocks) + the real
 * Fanout XREAD loop + fake sockets. The tap is simulated by writing tap-shaped diffs via
 * RedisStreamStore.applyDiff; this proves the wire format (snapshot CompactedRow, diff.deletes keys,
 * XREAD field parsing) actually matches what seedRowLevel/routeDelta expect end-to-end — the seam a
 * fake store can't cover. SKIPS (does not fail) without Redis/env, like ownership.test.ts. Run:
 *   LIVEKIT_API_KEY=devlocalkey LIVEKIT_API_SECRET=devlocalsecret \
 *     npx dotenv -e .env.local -- tsx --test src/zero/sync/rowLevelE2e.test.ts
 */
let Fanout: (typeof import('./fanout'))['Fanout'] | undefined;
let RedisStreamStore: (typeof import('./redisStore'))['RedisStreamStore'] | undefined;
let disconnectSyncStore: (typeof import('./redisStore'))['disconnectSyncStore'] | undefined;
let redisService: (typeof import('@/services/redisService'))['redisService'] | undefined;
let reason = '';
try {
  ({ Fanout } = await import('./fanout.js'));
  ({ RedisStreamStore, disconnectSyncStore } = await import('./redisStore.js'));
  ({ redisService } = await import('@/services/redisService'));
  await redisService.getClient().ping();
} catch (e) {
  reason = `redis/env unavailable: ${String(e).slice(0, 80)}`;
}
const skip = Fanout && RedisStreamStore && redisService ? false : reason || 'unavailable';

// Close BOTH the health-check client AND the store's dedicated syncClient() connection, else the open
// sockets keep the event loop alive and `node --test` wedges (never exits) — a CI hang, not a failure.
after(() => {
  redisService?.getClient().disconnect();
  disconnectSyncStore?.();
});

const META: RowLevelMeta = {
  rootTable: 'draft_messages',
  routeColumn: 'userId',
  childLinks: [{ childTable: 'message_attachments', childColumn: 'entityId', parentColumn: 'id' }],
};
const PK = { draft_messages: ['id'], message_attachments: ['id'] } as const;
const put = (tableName: string, row: Row) => ({ key: rowKey(tableName, row, PK), tableName, row });
const diff = (over: Partial<StreamDiff>): StreamDiff => ({ upserts: [], deletes: [], cleared: false, ...over });
const rnd = () => 'e2e-' + Math.floor(Math.random() * 1e12);

interface Ev { event: string; payload: Record<string, unknown> }
function sock() {
  const sent: Ev[] = [];
  return { sent, connected: true, emit: (e: string, p: unknown) => sent.push({ event: e, payload: p as Record<string, unknown> }), join() {}, leave() {} };
}
const snaps = (s: ReturnType<typeof sock>) => s.sent.filter((e) => e.event === 'sync:snapshot');
const deltas = (s: ReturnType<typeof sock>) => s.sent.filter((e) => e.event === 'sync:delta');
const ids = (rows: unknown) => (rows as Array<{ row: { id: string } }>).map((r) => r.row.id).sort();

async function waitFor(fn: () => boolean, ms = 5000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return fn();
}

test('per-user isolation + live insert/delete/related routing + cross-workspace deny', { skip }, async () => {
  const store = new RedisStreamStore!();
  const instW1 = rnd();
  const instW2 = rnd();
  const f = new Fanout!();
  f.start();
  try {
    // Tap-simulate the seed: W1 has U1's D1(+attachment A1) and U2's D2; W2 has U3's D5.
    await store.applyDiff(instW1, '1-a', diff({
      upserts: [
        put('draft_messages', { id: 'D1', userId: 'U1', workspaceId: 'W1' }),
        put('draft_messages', { id: 'D2', userId: 'U2', workspaceId: 'W1' }),
        put('message_attachments', { id: 'A1', entityId: 'D1' }),
      ],
    }));
    await store.applyDiff(instW2, '1-a', diff({ upserts: [put('draft_messages', { id: 'D5', userId: 'U3', workspaceId: 'W2' })] }));

    const u1 = sock(), u2 = sock(), u3 = sock();
    await f.addRowLevelClient({ id: 'c1', socket: u1, userId: 'U1', workspaceId: 'W1', dataInstanceKey: instW1, meta: META });
    await f.addRowLevelClient({ id: 'c2', socket: u2, userId: 'U2', workspaceId: 'W1', dataInstanceKey: instW1, meta: META });
    await f.addRowLevelClient({ id: 'c3', socket: u3, userId: 'U3', workspaceId: 'W2', dataInstanceKey: instW2, meta: META });
    await f.drainDispatch();

    assert.deepEqual(ids(snaps(u1)[0].payload.rows), ['A1', 'D1'], 'U1 sees only its draft + attachment');
    assert.deepEqual(ids(snaps(u2)[0].payload.rows), ['D2'], 'U2 sees only its draft');
    assert.deepEqual(ids(snaps(u3)[0].payload.rows), ['D5'], 'U3 (other workspace) sees only its own');

    // Live insert of U1's D3 → only U1.
    await store.applyDiff(instW1, '2-a', diff({ upserts: [put('draft_messages', { id: 'D3', userId: 'U1', workspaceId: 'W1' })] }));
    assert.ok(await waitFor(() => deltas(u1).some((d) => ids(d.payload.upserts).includes('D3'))), 'U1 received D3');
    assert.equal(deltas(u2).length, 0, 'U2 received nothing from U1 insert');

    // Related insert (attachment on U2's D2) → follows the owner U2.
    await store.applyDiff(instW1, '3-a', diff({ upserts: [put('message_attachments', { id: 'A9', entityId: 'D2' })] }));
    assert.ok(await waitFor(() => deltas(u2).some((d) => ids(d.payload.upserts).includes('A9'))), 'U2 received its related attachment');

    // Delete of U1's D1 (PK-only on the wire) → routed to U1 via the owner map.
    await store.applyDiff(instW1, '4-a', diff({ deletes: [rowKey('draft_messages', { id: 'D1' }, PK)] }));
    assert.ok(await waitFor(() => deltas(u1).some((d) => (d.payload.deletes as string[])?.includes('draft_messages:D1'))), 'U1 received the delete');

    // Cross-workspace: U3 never saw any W1 traffic.
    assert.equal(deltas(u3).length, 0, 'U3 saw no W1 deltas (tenant isolation)');
  } finally {
    f.stop();
    await store.teardownInstance(instW1);
    await store.teardownInstance(instW2);
  }
});

test('restart → delete routes via the owner map rebuilt from the snapshot', { skip }, async () => {
  const store = new RedisStreamStore!();
  const inst = rnd();
  try {
    await store.applyDiff(inst, '1-a', diff({ upserts: [put('draft_messages', { id: 'D1', userId: 'U1', workspaceId: 'W1' })] }));

    // First materializer builds the owner map, then dies.
    const f1 = new Fanout!();
    f1.start();
    const u1a = sock();
    await f1.addRowLevelClient({ id: 'c1', socket: u1a, userId: 'U1', workspaceId: 'W1', dataInstanceKey: inst, meta: META });
    await f1.drainDispatch();
    f1.stop();

    // Fresh materializer (owner map empty) → must reseed from the snapshot to route a PK-only delete.
    const f2 = new Fanout!();
    f2.start();
    const u1b = sock();
    await f2.addRowLevelClient({ id: 'c2', socket: u1b, userId: 'U1', workspaceId: 'W1', dataInstanceKey: inst, meta: META });
    await f2.drainDispatch();
    try {
      await store.applyDiff(inst, '2-a', diff({ deletes: [rowKey('draft_messages', { id: 'D1' }, PK)] }));
      assert.ok(
        await waitFor(() => deltas(u1b).some((d) => (d.payload.deletes as string[])?.includes('draft_messages:D1'))),
        'post-restart delete routed via the reseeded owner map',
      );
    } finally {
      f2.stop();
    }
  } finally {
    await store.teardownInstance(inst);
  }
});

test('resume: a put-only range after the offset replays as a per-user delta (no snapshot)', { skip }, async () => {
  const store = new RedisStreamStore!();
  const inst = rnd();
  const f = new Fanout!();
  f.start();
  try {
    await store.applyDiff(inst, '1-a', diff({ upserts: [put('draft_messages', { id: 'D1', userId: 'U1', workspaceId: 'W1' })] }));
    const u1 = sock();
    await f.addRowLevelClient({ id: 'c1', socket: u1, userId: 'U1', workspaceId: 'W1', dataInstanceKey: inst, meta: META });
    await f.drainDispatch();
    const offset = String(snaps(u1)[0].payload.offset);

    // A put lands while the client is "away", then it reconnects with its offset.
    await store.applyDiff(inst, '2-a', diff({ upserts: [put('draft_messages', { id: 'D2', userId: 'U1', workspaceId: 'W1' })] }));
    const u1b = sock();
    await f.addRowLevelClient({ id: 'c1b', socket: u1b, userId: 'U1', workspaceId: 'W1', dataInstanceKey: inst, sinceOffset: offset, meta: META });
    await f.drainDispatch();

    assert.equal(snaps(u1b).length, 0, 'resumed client got NO snapshot');
    assert.ok(deltas(u1b).some((d) => ids(d.payload.upserts).includes('D2')), 'resumed client replayed D2 as a delta');
  } finally {
    f.stop();
    await store.teardownInstance(inst);
  }
});
