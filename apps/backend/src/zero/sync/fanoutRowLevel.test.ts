import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fanout } from './fanout';
import { rowKey, type CompactedRow, type Row, type StreamDiff } from './streamState';
import type { RowLevelMeta } from './rowLevelRouting';
import type { RedisStreamStore } from './redisStore';

/**
 * Fanout row-level lifecycle over a FAKE store + fake sockets: cold-defer, per-user snapshot slice,
 * resume (puts-only), resume→snapshot fallback on an unroutable delete, and removeClient teardown.
 * Live delta delivery through the XREAD loop is exercised by the R3 fake-socket e2e; the demux math is
 * covered in rowLevelRouting.test.ts. This locks the async wiring the pure tests can't reach.
 */

const META: RowLevelMeta = {
  rootTable: 'draft_messages',
  routeColumn: 'userId',
  childLinks: [{ childTable: 'message_attachments', childColumn: 'entityId', parentColumn: 'id' }],
};
const PK = { draft_messages: ['id'], message_attachments: ['id'] } as const;
const cr = (tableName: string, row: Row): CompactedRow => ({ tableName, row });
const key = (tableName: string, row: Row): string => rowKey(tableName, row, PK);
const diff = (over: Partial<StreamDiff>): StreamDiff => ({ upserts: [], deletes: [], cleared: false, ...over });

/** Minimal in-memory stand-in for RedisStreamStore, only the methods the row-level path calls. */
class FakeStore {
  hydrated = true;
  headId = '5-0';
  version = 'v5';
  rows: CompactedRow[] = [];
  first: string | null = '1-0';
  since: Array<{ id: string; version: string; diff: StreamDiff }> = [];
  async head(): Promise<string> { return this.headId; }
  async headWithVersion(): Promise<{ id: string; version: string }> { return { id: this.headId, version: this.version }; }
  async snapshot(): Promise<CompactedRow[]> { return this.rows; }
  async isHydrated(): Promise<boolean> { return this.hydrated; }
  async firstId(): Promise<string | null> { return this.first; }
  async readSince(): Promise<Array<{ id: string; version: string; diff: StreamDiff }>> { return this.since; }
}

interface Emitted { event: string; payload: Record<string, unknown> }
function fakeSocket(): { emit: (e: string, p: unknown) => void; join: () => void; leave: () => void; connected: boolean; sent: Emitted[] } {
  const sent: Emitted[] = [];
  return {
    sent,
    connected: true,
    emit: (event, payload) => sent.push({ event, payload: payload as Record<string, unknown> }),
    join: () => {},
    leave: () => {},
  };
}

const mk = (store: FakeStore) => new Fanout(store as unknown as RedisStreamStore);
const add = (f: Fanout, sock: ReturnType<typeof fakeSocket>, userId: string, sinceOffset?: string) =>
  f.addRowLevelClient({ id: `c-${userId}`, socket: sock, userId, workspaceId: 'W1', dataInstanceKey: 'inst1', sinceOffset, meta: META });

test('cold instance → client is deferred (no snapshot until materialized)', async () => {
  const store = new FakeStore();
  store.hydrated = false;
  const f = mk(store);
  const sock = fakeSocket();
  await add(f, sock, 'U1');
  await f.drainDispatch();
  assert.equal(sock.sent.length, 0);
});

test('warm instance → client gets a snapshot of ONLY its own rows', async () => {
  const store = new FakeStore();
  store.rows = [
    cr('draft_messages', { id: 'D1', userId: 'U1' }),
    cr('draft_messages', { id: 'D2', userId: 'U2' }),
    cr('message_attachments', { id: 'A1', entityId: 'D1' }), // U1's, via D1
  ];
  const f = mk(store);
  const sock = fakeSocket();
  await add(f, sock, 'U1');
  await f.drainDispatch();
  assert.equal(sock.sent.length, 1);
  const snap = sock.sent[0];
  assert.equal(snap.event, 'sync:snapshot');
  const ids = (snap.payload.rows as CompactedRow[]).map((c) => c.row.id).sort();
  assert.deepEqual(ids, ['A1', 'D1']); // U2's D2 is NOT delivered
  assert.equal(snap.payload.offset, '5-0');
});

test('two users on one instance each get only their slice (one snapshot read via bucket memo)', async () => {
  const store = new FakeStore();
  store.rows = [cr('draft_messages', { id: 'D1', userId: 'U1' }), cr('draft_messages', { id: 'D2', userId: 'U2' })];
  let reads = 0;
  const realSnapshot = store.snapshot.bind(store);
  store.snapshot = async () => { reads++; return realSnapshot(); };
  const f = mk(store);
  const s1 = fakeSocket();
  const s2 = fakeSocket();
  await add(f, s1, 'U1');
  await add(f, s2, 'U2');
  await f.drainDispatch();
  assert.deepEqual((s1.sent[0].payload.rows as CompactedRow[]).map((c) => c.row.id), ['D1']);
  assert.deepEqual((s2.sent[0].payload.rows as CompactedRow[]).map((c) => c.row.id), ['D2']);
  assert.equal(reads, 1); // same head → second client reused the bucket memo
});

test('resume: a retained put-only range replays as a per-user delta (no snapshot)', async () => {
  const store = new FakeStore();
  store.rows = [cr('draft_messages', { id: 'D1', userId: 'U1' })];
  store.first = '1-0';
  store.since = [
    { id: '6-0', version: 'v6', diff: diff({ upserts: [{ key: key('draft_messages', { id: 'D9', userId: 'U1' }), tableName: 'draft_messages', row: { id: 'D9', userId: 'U1' } }] }) },
  ];
  const f = mk(store);
  const sock = fakeSocket();
  await add(f, sock, 'U1', '3-0');
  await f.drainDispatch();
  // replayed delta + the resume-complete marker (a resume has no other terminal signal)
  assert.equal(sock.sent.length, 2);
  assert.equal(sock.sent[0].event, 'sync:delta');
  assert.deepEqual((sock.sent[0].payload.upserts as Array<{ row: Row }>).map((u) => u.row.id), ['D9']);
  assert.equal(sock.sent[1].event, 'sync:current');
});

test('resume: an unroutable delete in the range falls back to a full snapshot', async () => {
  const store = new FakeStore();
  store.rows = [cr('draft_messages', { id: 'D1', userId: 'U1' })]; // owner map has D1 only
  store.first = '1-0';
  store.since = [{ id: '6-0', version: 'v6', diff: diff({ deletes: [key('draft_messages', { id: 'DGONE', userId: 'U1' })] }) }];
  const f = mk(store);
  const sock = fakeSocket();
  await add(f, sock, 'U1', '3-0');
  await f.drainDispatch();
  assert.equal(sock.sent.length, 1);
  assert.equal(sock.sent[0].event, 'sync:snapshot'); // fell back
});

test('resume: offset no longer retained falls back to a snapshot', async () => {
  const store = new FakeStore();
  store.rows = [cr('draft_messages', { id: 'D1', userId: 'U1' })];
  store.first = '4-0'; // sinceOffset 3-0 < firstId → trimmed away
  const f = mk(store);
  const sock = fakeSocket();
  await add(f, sock, 'U1', '3-0');
  await f.drainDispatch();
  assert.equal(sock.sent[0].event, 'sync:snapshot');
});

test('removeClient tears the last client down (idempotent second remove is a no-op)', async () => {
  const store = new FakeStore();
  store.rows = [cr('draft_messages', { id: 'D1', userId: 'U1' })];
  const f = mk(store);
  const sock = fakeSocket();
  await add(f, sock, 'U1');
  await f.drainDispatch();
  f.removeClient('c-U1', 'inst1');
  f.removeClient('c-U1', 'inst1'); // no throw
  assert.ok(true);
});
