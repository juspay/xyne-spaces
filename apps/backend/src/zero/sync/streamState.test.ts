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

test('put: diff carries full-row upserts + advances cookie', () => {
  const s = new ChannelStreamState(pk);
  const diff = s.applyPoke('v1', [put('a', { title: 'A' }), put('b')]);
  assert.deepEqual(diff.upserts.map((u) => u.key).sort(), ['conversations:a', 'conversations:b']);
  assert.deepEqual(diff.upserts.find((u) => u.key === 'conversations:a')?.row, {
    conversationId: 'a',
    title: 'A',
  });
  assert.equal(diff.cleared, false);
  assert.equal(s.cookie(), 'v1');
});

test('del: diff carries the deleted key', () => {
  const s = new ChannelStreamState(pk);
  const diff = s.applyPoke('v2', [del('a')]);
  assert.deepEqual(diff.deletes, ['conversations:a']);
  assert.deepEqual(diff.upserts, []);
});

test('sliding latest-N window: put(new) + del(bumped-out) in one poke', () => {
  const s = new ChannelStreamState(pk);
  const diff = s.applyPoke('v2', [put('c'), del('a')]);
  assert.deepEqual(diff.upserts.map((u) => u.key), ['conversations:c']);
  assert.deepEqual(diff.deletes, ['conversations:a']);
});

// ---- C3: per-key last-op-wins compaction (a key lands in EXACTLY one list) ----

test('C3: del(K) then put(K) in one poke → K is an UPSERT, not a delete (row not lost)', () => {
  const s = new ChannelStreamState(pk);
  const diff = s.applyPoke('v2', [del('a'), put('a', { title: 'back' })]);
  assert.deepEqual(diff.deletes, [], 'del must not survive a later put of the same key');
  assert.deepEqual(diff.upserts.map((u) => u.key), ['conversations:a']);
  assert.equal(diff.upserts[0].row.title, 'back');
});

test('C3: put(K) then del(K) in one poke → K is a DELETE only', () => {
  const s = new ChannelStreamState(pk);
  const diff = s.applyPoke('v2', [put('a'), del('a')]);
  assert.deepEqual(diff.upserts, []);
  assert.deepEqual(diff.deletes, ['conversations:a']);
});

test('C3: repeated put(K) dedupes to one upsert with the last value', () => {
  const s = new ChannelStreamState(pk);
  const diff = s.applyPoke('v2', [put('a', { n: 1 }), put('a', { n: 2 })]);
  assert.equal(diff.upserts.length, 1);
  assert.equal(diff.upserts[0].row.n, 2);
});

test('C3: clear then put(K) → cleared with the post-clear upsert only', () => {
  const s = new ChannelStreamState(pk);
  const diff = s.applyPoke('v2', [put('a'), { op: 'clear' }, put('b')]);
  assert.equal(diff.cleared, true);
  assert.deepEqual(diff.upserts.map((u) => u.key), ['conversations:b']);
  assert.deepEqual(diff.deletes, []);
});

test('stateless: each diff reflects only its own poke (no retained rows)', () => {
  const s = new ChannelStreamState(pk);
  s.applyPoke('v1', [put('a'), put('b')]);
  const diff = s.applyPoke('v2', [del('b'), put('d')]);
  assert.deepEqual(diff.deletes, ['conversations:b']);
  assert.deepEqual(diff.upserts.map((u) => u.key), ['conversations:d']);
  assert.equal(s.cookie(), 'v2');
});

test('clear: reports cleared and wipes the accumulated diff', () => {
  const s = new ChannelStreamState(pk);
  const diff = s.applyPoke('v2', [put('a'), { op: 'clear' }]);
  assert.equal(diff.cleared, true);
  assert.deepEqual(diff.upserts, []);
  assert.deepEqual(diff.deletes, []);
});

test('update (should never happen): RESETS the instance, never a silent skip', () => {
  const s = new ChannelStreamState(pk);
  // logs sync_unexpected_update_op (expected)
  const diff = s.applyPoke('v1', [
    { op: 'update', tableName: 'conversations', id: { conversationId: 'a' }, merge: { x: 1 } } as RowPatchOp,
  ]);
  assert.equal(diff.cleared, true);
  assert.deepEqual(diff.upserts, []);
  assert.deepEqual(diff.deletes, []);
});

test('clear() resets the cookie', () => {
  const s = new ChannelStreamState(pk);
  s.applyPoke('v1', [put('a')]);
  s.clear();
  assert.equal(s.cookie(), null);
});
