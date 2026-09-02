import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelStreamState, type RowPatchOp } from './streamState';

const pk = { conversations: ['conversationId'] as const };

function put(id: string, extra: Record<string, unknown> = {}): RowPatchOp {
  return { op: 'put', tableName: 'conversations', value: { conversationId: id, ...extra } };
}
function del(id: string): RowPatchOp {
  return { op: 'del', tableName: 'conversations', id: { conversationId: id } };
}
function update(id: string, merge: Record<string, unknown>): RowPatchOp {
  return { op: 'update', tableName: 'conversations', id: { conversationId: id }, merge };
}
const ids = (s: ChannelStreamState): string[] =>
  s.snapshot().map((r) => String(r.row.conversationId)).sort();

test('put: rows enter the snapshot; diff carries full-row upserts', () => {
  const s = new ChannelStreamState(pk);
  const diff = s.applyPoke('v1', [put('a', { title: 'A' }), put('b')]);
  assert.deepEqual(ids(s), ['a', 'b']);
  assert.deepEqual(diff.upserts.map((u) => u.key).sort(), ['conversations:a', 'conversations:b']);
  assert.deepEqual(diff.upserts.find((u) => u.key === 'conversations:a')?.row, {
    conversationId: 'a',
    title: 'A',
  });
  assert.equal(s.cookie(), 'v1');
});

test('del: row leaves the snapshot; diff carries the deleted key', () => {
  const s = new ChannelStreamState(pk);
  s.applyPoke('v1', [put('a'), put('b')]);
  const diff = s.applyPoke('v2', [del('a')]);
  assert.deepEqual(ids(s), ['b']);
  assert.deepEqual(diff.deletes, ['conversations:a']);
  assert.deepEqual(diff.upserts, []);
});

test('update: merges into the existing row and emits the MERGED full row as an upsert', () => {
  const s = new ChannelStreamState(pk);
  s.applyPoke('v1', [put('a', { title: 'A', unread: 3 })]);
  const diff = s.applyPoke('v2', [update('a', { unread: 0 })]);
  // snapshot reflects the merge (unchanged fields preserved)
  assert.deepEqual(s.snapshot()[0].row, { conversationId: 'a', title: 'A', unread: 0 });
  // the diff upsert is the FULL merged row — this is what RedisStreamStore HSETs
  assert.deepEqual(diff.upserts, [
    { key: 'conversations:a', tableName: 'conversations', row: { conversationId: 'a', title: 'A', unread: 0 } },
  ]);
});

test('update on a row not present is a no-op (no upsert)', () => {
  const s = new ChannelStreamState(pk);
  const diff = s.applyPoke('v1', [update('ghost', { x: 1 })]);
  assert.equal(s.size(), 0);
  assert.deepEqual(diff.upserts, []);
});

test('sliding latest-N window: put(new) + del(bumped-out)', () => {
  const s = new ChannelStreamState(pk);
  s.applyPoke('v1', [put('a'), put('b')]);
  const diff = s.applyPoke('v2', [put('c'), del('a')]);
  assert.deepEqual(ids(s), ['b', 'c']);
  assert.equal(s.size(), 2);
  assert.deepEqual(diff.upserts.map((u) => u.key), ['conversations:c']);
  assert.deepEqual(diff.deletes, ['conversations:a']);
});

test('clear: wipes state and reports cleared', () => {
  const s = new ChannelStreamState(pk);
  s.applyPoke('v1', [put('a'), put('b')]);
  const diff = s.applyPoke('v2', [{ op: 'clear' }]);
  assert.equal(s.snapshot().length, 0);
  assert.equal(diff.cleared, true);
});

test('hydration equals the compaction of the whole stream', () => {
  const s = new ChannelStreamState(pk);
  s.applyPoke('v1', [put('a'), put('b'), put('c')]);
  s.applyPoke('v2', [update('a', { seen: true }), del('b'), put('d')]);
  assert.deepEqual(ids(s), ['a', 'c', 'd']);
  assert.equal(s.snapshot().find((r) => r.row.conversationId === 'a')?.row.seen, true);
});

test('clear() drops all state and cookie', () => {
  const s = new ChannelStreamState(pk);
  s.applyPoke('v1', [put('a')]);
  s.clear();
  assert.equal(s.size(), 0);
  assert.equal(s.cookie(), null);
});
