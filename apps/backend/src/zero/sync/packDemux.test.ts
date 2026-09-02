import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PackDemux } from './packDemux';
import type { QueryMeta } from './queryMeta';
import type { RowPatchOp } from './streamState';

// channelLatest packing shape: root conversations partitioned by channelId; related
// message_attachments linked by entityId → conversations.initialMessageId.
const META: QueryMeta = {
  rootTable: 'conversations',
  partitionColumn: 'channelId',
  tables: ['conversations', 'message_attachments'],
  childLinks: [{ childTable: 'message_attachments', childColumn: 'entityId', parentColumn: 'initialMessageId' }],
};
const PK = { conversations: ['conversationId'], message_attachments: ['id'] } as const;

const conv = (id: string, channelId: string, initialMessageId: string): RowPatchOp => ({
  op: 'put',
  tableName: 'conversations',
  value: { conversationId: id, channelId, initialMessageId },
});
const attach = (id: string, entityId: string): RowPatchOp => ({
  op: 'put',
  tableName: 'message_attachments',
  value: { id, entityId },
});
const keys = (diff: { upserts: { key: string }[] } | undefined): string[] =>
  (diff?.upserts ?? []).map((u) => u.key).sort();

test('root rows demux to their instance by partition column', () => {
  const d = new PackDemux(META, PK);
  d.addInstance('IK1', 'C1');
  d.addInstance('IK2', 'C2');
  const diffs = d.applyPoke('v1', [conv('cv1', 'C1', 'm1'), conv('cv2', 'C2', 'm2')]);
  assert.deepEqual(keys(diffs.get('IK1')), ['conversations:cv1']);
  assert.deepEqual(keys(diffs.get('IK2')), ['conversations:cv2']);
});

test('related rows demux via child-FK — even when they precede their parent in the poke', () => {
  const d = new PackDemux(META, PK);
  d.addInstance('IK1', 'C1');
  d.addInstance('IK2', 'C2');
  // attachments listed BEFORE their conversations: two-pass must still attribute them.
  const diffs = d.applyPoke('v1', [
    attach('a1', 'm1'),
    attach('a2', 'm2'),
    conv('cv1', 'C1', 'm1'),
    conv('cv2', 'C2', 'm2'),
  ]);
  assert.deepEqual(keys(diffs.get('IK1')), ['conversations:cv1', 'message_attachments:a1']);
  assert.deepEqual(keys(diffs.get('IK2')), ['conversations:cv2', 'message_attachments:a2']);
});

test('del/update attribute via the owner index (PK only)', () => {
  const d = new PackDemux(META, PK);
  d.addInstance('IK1', 'C1');
  d.addInstance('IK2', 'C2');
  d.applyPoke('v1', [conv('cv1', 'C1', 'm1'), attach('a1', 'm1'), conv('cv2', 'C2', 'm2')]);
  const diffs = d.applyPoke('v2', [
    { op: 'del', tableName: 'conversations', id: { conversationId: 'cv1' } },
    { op: 'del', tableName: 'message_attachments', id: { id: 'a1' } },
  ]);
  assert.deepEqual(diffs.get('IK1')?.deletes.sort(), ['conversations:cv1', 'message_attachments:a1']);
  assert.equal(diffs.has('IK2'), false);
});

test('clear resets every instance in the group', () => {
  const d = new PackDemux(META, PK);
  d.addInstance('IK1', 'C1');
  d.addInstance('IK2', 'C2');
  d.applyPoke('v1', [conv('cv1', 'C1', 'm1'), conv('cv2', 'C2', 'm2')]);
  const diffs = d.applyPoke('v2', [{ op: 'clear' }]);
  assert.equal(diffs.get('IK1')?.cleared, true);
  assert.equal(diffs.get('IK2')?.cleared, true);
});

test('a row for a non-subscribed partition is dropped, not misrouted', () => {
  const d = new PackDemux(META, PK);
  d.addInstance('IK1', 'C1');
  const diffs = d.applyPoke('v1', [conv('cv1', 'C1', 'm1'), conv('cvX', 'C9', 'mX')]);
  assert.deepEqual(keys(diffs.get('IK1')), ['conversations:cv1']);
  assert.equal(diffs.size, 1);
});

test('removeInstance clears its attribution state', () => {
  const d = new PackDemux(META, PK);
  d.addInstance('IK1', 'C1');
  d.applyPoke('v1', [conv('cv1', 'C1', 'm1')]);
  d.removeInstance('IK1', 'C1');
  assert.equal(d.size(), 0);
  // a later poke for C1 no longer routes anywhere
  const diffs = d.applyPoke('v2', [conv('cv2', 'C1', 'm2')]);
  assert.equal(diffs.size, 0);
});
