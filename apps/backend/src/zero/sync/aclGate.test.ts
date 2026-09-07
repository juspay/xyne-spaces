import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveAclGate, validateGateAst, type Cond, type SnapshotProvider } from './aclGate';

const snap =
  (tables: Record<string, Record<string, unknown>[]>): SnapshotProvider =>
  (t) =>
    tables[t] ?? [];

// ---- conversations ACL: whereExists('channel', workspace AND (PUBLIC OR participant)) ----

test('conversations: grant tables are derived from the ACL whereExists chain', () => {
  const gate = deriveAclGate('conversations');
  assert.equal(gate.rootTable, 'conversations');
  assert.deepEqual(gate.grantTables.slice().sort(), ['channel_participants', 'channels']);
});

test('conversations: private channel — only participants admitted', () => {
  const gate = deriveAclGate('conversations');
  const scope = { channelId: 'C1' };
  const snapshot = snap({
    channels: [{ id: 'C1', workspaceId: 'W1', visibility: 'PRIVATE' }],
    channel_participants: [{ channelId: 'C1', userId: 'U1' }],
  });
  assert.equal(gate.evaluate(scope, 'U1', 'W1', snapshot), true, 'participant admitted');
  assert.equal(gate.evaluate(scope, 'U2', 'W1', snapshot), false, 'non-participant denied');
});

test('conversations: public channel — any workspace member admitted', () => {
  const gate = deriveAclGate('conversations');
  const snapshot = snap({
    channels: [{ id: 'C1', workspaceId: 'W1', visibility: 'PUBLIC' }],
    channel_participants: [],
  });
  assert.equal(gate.evaluate({ channelId: 'C1' }, 'U2', 'W1', snapshot), true);
});

test('conversations: wrong workspace denied even for a participant', () => {
  const gate = deriveAclGate('conversations');
  const snapshot = snap({
    channels: [{ id: 'C1', workspaceId: 'W1', visibility: 'PUBLIC' }],
    channel_participants: [{ channelId: 'C1', userId: 'U1' }],
  });
  assert.equal(gate.evaluate({ channelId: 'C1' }, 'U1', 'W2', snapshot), false);
});

// ---- message_attachments ACL: workspace AND (createdBy=me OR conversation→channel→(PUBLIC OR participant)) ----

test('message_attachments: grant tables span the 3-hop chain', () => {
  const gate = deriveAclGate('message_attachments');
  assert.deepEqual(
    gate.grantTables.slice().sort(),
    ['channel_participants', 'channels', 'conversations'],
  );
});

test('message_attachments: own attachment (createdBy) admitted regardless of channel', () => {
  const gate = deriveAclGate('message_attachments');
  const scope = { conversationId: 'CONV1', createdBy: 'U1', workspaceId: 'W1' };
  const snapshot = snap({
    conversations: [{ conversationId: 'CONV1', channelId: 'C1' }],
    channels: [{ id: 'C1', workspaceId: 'W1', visibility: 'PRIVATE' }],
    channel_participants: [{ channelId: 'C1', userId: 'U2' }],
  });
  assert.equal(gate.evaluate(scope, 'U1', 'W1', snapshot), true);
});

test('message_attachments: non-owner admitted via channel participation (3 hops)', () => {
  const gate = deriveAclGate('message_attachments');
  const scope = { conversationId: 'CONV1', createdBy: 'U1', workspaceId: 'W1' };
  const snapshot = snap({
    conversations: [{ conversationId: 'CONV1', channelId: 'C1' }],
    channels: [{ id: 'C1', workspaceId: 'W1', visibility: 'PRIVATE' }],
    channel_participants: [{ channelId: 'C1', userId: 'U2' }],
  });
  assert.equal(gate.evaluate(scope, 'U2', 'W1', snapshot), true, 'participant of the attachment\'s channel');
  assert.equal(gate.evaluate(scope, 'U3', 'W1', snapshot), false, 'not owner, not participant, private');
});

test('message_attachments: non-owner admitted via public channel', () => {
  const gate = deriveAclGate('message_attachments');
  const scope = { conversationId: 'CONV1', createdBy: 'U1', workspaceId: 'W1' };
  const snapshot = snap({
    conversations: [{ conversationId: 'CONV1', channelId: 'C1' }],
    channels: [{ id: 'C1', workspaceId: 'W1', visibility: 'PUBLIC' }],
    channel_participants: [],
  });
  assert.equal(gate.evaluate(scope, 'U3', 'W1', snapshot), true);
});

// ---- fail-safe: unsupported ACL shapes are refused at derivation, not silently un-admitting ----

test('validateGateAst: supported and/or/simple/EXISTS shape passes', () => {
  const ast: Cond = {
    type: 'and',
    conditions: [
      { type: 'simple', left: { name: 'workspaceId' }, op: '=', right: { value: 'W' } },
      {
        type: 'correlatedSubquery',
        op: 'EXISTS',
        related: {
          correlation: { parentField: ['id'], childField: ['channelId'] },
          subquery: {
            table: 'channel_participants',
            where: { type: 'simple', left: { name: 'userId' }, op: '=', right: { value: 'U' } },
          },
        },
      },
    ],
  };
  assert.doesNotThrow(() => validateGateAst(ast));
});

test('validateGateAst: unsupported simple operator is rejected', () => {
  const ast = { type: 'simple', left: { name: 'n' }, op: 'IN', right: { value: [1] } } as unknown as Cond;
  assert.throws(() => validateGateAst(ast), /unsupported operator 'IN'/);
});

test('validateGateAst: unsupported subquery op is rejected', () => {
  const ast = {
    type: 'correlatedSubquery',
    op: 'ANY',
    related: { correlation: { parentField: ['id'], childField: ['cid'] }, subquery: { table: 't' } },
  } as unknown as Cond;
  assert.throws(() => validateGateAst(ast), /unsupported subquery op 'ANY'/);
});

test('validateGateAst: unsupported node type is rejected', () => {
  const ast = { type: 'literal' } as unknown as Cond;
  assert.throws(() => validateGateAst(ast), /unsupported condition 'literal'/);
});

test('validateGateAst: unsupported op nested in a subquery where is rejected', () => {
  const ast = {
    type: 'correlatedSubquery',
    op: 'EXISTS',
    related: {
      correlation: { parentField: ['id'], childField: ['cid'] },
      subquery: {
        table: 't',
        where: { type: 'simple', left: { name: 'x' }, op: '>', right: { value: 1 } },
      },
    },
  } as unknown as Cond;
  assert.throws(() => validateGateAst(ast), /unsupported operator '>'/);
});

test('real allowlisted ACLs derive without over-rejecting', () => {
  assert.doesNotThrow(() => deriveAclGate('conversations'));
  assert.doesNotThrow(() => deriveAclGate('message_attachments'));
});
