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
