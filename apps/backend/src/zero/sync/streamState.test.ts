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
