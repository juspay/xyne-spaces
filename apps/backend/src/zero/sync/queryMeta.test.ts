import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryMetaFor } from './queryMeta';

// A `__grant__<table>` can be instantiated with different scope columns (per-user {userId} vs
// per-scope {channelId}) that yield DIFFERENT partitionColumns. The cache must key by the scope
// column, not queryName alone — else the second form inherits the first's meta and the demux
// mis-attributes every row (the P1 e2e materialized 0 rows this way). buildGrantBase is pure, so
// this needs no Redis/zero-cache.

test('queryMetaFor: grant meta is per scope column — no cross-partition cache collision', () => {
  const byChannel = queryMetaFor('__grant__channel_participants', { channelId: 'C1' });
  const byUser = queryMetaFor('__grant__channel_participants', { userId: 'U1' });
  assert.equal(byChannel?.rootTable, 'channel_participants');
  assert.equal(byUser?.rootTable, 'channel_participants');
  assert.equal(byChannel?.partitionColumn, 'channelId');
  assert.equal(byUser?.partitionColumn, 'userId', 'per-user form must NOT inherit the channelId meta');
});

test('queryMetaFor: order-independent — user-first then channel is also correct', () => {
  const byUser = queryMetaFor('__grant__channel_participants', { userId: 'U2' });
  const byChannel = queryMetaFor('__grant__channel_participants', { channelId: 'C2' });
  assert.equal(byUser?.partitionColumn, 'userId');
  assert.equal(byChannel?.partitionColumn, 'channelId');
});

// P3(c): a structure instance is `conversations.where(conversationId,C).related('channel')`. Its
// packing meta must derive from the `.related()` AST: partition on the scope column, and a childLink
// for the transitive hop (so the demux attributes channels rows to the conversation's instance). The
// `__rel` arg key must NOT be read as the partition column.
test('queryMetaFor: struct instance derives partition + childLink from the .related() AST', () => {
  const meta = queryMetaFor('__struct__conversations', { conversationId: 'CONV1', __rel: ['channel'] });
  assert.equal(meta?.rootTable, 'conversations');
  assert.equal(meta?.partitionColumn, 'conversationId', 'scope column, not __rel');
  assert.equal(meta?.tables.includes('channels'), true, 'the related child table is covered');
  const link = meta?.childLinks.find((l) => l.childTable === 'channels');
  assert.deepEqual(link, { childTable: 'channels', childColumn: 'id', parentColumn: 'channelId' });
});
