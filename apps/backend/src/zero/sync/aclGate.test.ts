import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveAclGate, validateGateAst, boundColumnOf, SENTINEL_USER, SENTINEL_WORKSPACE, type Cond, type SnapshotProvider } from './aclGate';

const uEq = (col: string): Cond => ({ type: 'simple', left: { name: col }, op: '=', right: { value: SENTINEL_USER } });
const lit = (col: string, value: unknown): Cond => ({ type: 'simple', left: { name: col }, op: '=', right: { value } });

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

test('message_attachments: evaluate runs the FULL ACL — the createdBy arm admits the creator', () => {
  // The gate evaluates the full un-excluded ACL per row: a creator is admitted by `createdBy==me`
  // even if not a channel member. This per-row arm is EXACTLY why message_attachments is NOT a
  // shareable query (collapsibility rejects it — see the collapsibility tests below); evaluate here
  // is never reached in prod for a standalone attachments instance. Kept to pin the raw-ACL semantics.
  const gate = deriveAclGate('message_attachments');
  const scope = { conversationId: 'CONV1', createdBy: 'U1', workspaceId: 'W1' };
  const snapshot = snap({
    conversations: [{ conversationId: 'CONV1', channelId: 'C1' }],
    channels: [{ id: 'C1', workspaceId: 'W1', visibility: 'PRIVATE' }],
    channel_participants: [{ channelId: 'C1', userId: 'U2' }],
  });
  assert.equal(gate.evaluate(scope, 'U1', 'W1', snapshot), true, 'creator admitted by the createdBy arm');
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

test('validateGateAst: COMPOUND correlation is refused (would over-admit — collapsibility+evalCond read field[0] only)', () => {
  const ast = {
    type: 'correlatedSubquery',
    op: 'EXISTS',
    related: {
      correlation: { parentField: ['channelId', 'perRowCol'], childField: ['id', 'other'] },
      subquery: { table: 'channels' },
    },
  } as unknown as Cond;
  assert.throws(() => validateGateAst(ast), /unsupported compound correlation/);
});

test('real allowlisted ACLs derive without over-rejecting', () => {
  assert.doesNotThrow(() => deriveAclGate('conversations'));
  assert.doesNotThrow(() => deriveAclGate('message_attachments'));
});

// ---- GATE-ONLY shareability: collapsibility() accepts gate ACLs, rejects per-row ACLs ----

test('collapsibility: channelLatest (conversations) IS gate-collapsible on channelId', () => {
  // Only top-level term is exists('channel') correlated on channelId = the partition; workspace/
  // visibility/membership live INSIDE the subquery ⇒ instance-constant ⇒ one boolean per user.
  const c = deriveAclGate('conversations').collapsibility('channelId');
  assert.equal(c.ok, true, c.reason);
});

test('collapsibility: calls is REJECTED (per-row membership joins, not partition-anchored)', () => {
  // userActiveCalls is argless → partition degenerates to `status`. Arms reference createdByUserId
  // (per-row simple) + exists(participants, callId) + exists(channel, channelId) — none anchored on
  // `status` ⇒ per-row admission ⇒ not shareable.
  const c = deriveAclGate('calls').collapsibility('status');
  assert.equal(c.ok, false);
  assert.match(c.reason ?? '', /per-row/);
});

test('collapsibility: standalone message_attachments is REJECTED (top-level createdBy/workspaceId per-row)', () => {
  // Whatever the standalone partition, the top-level `workspaceId==ws` and `createdBy==me` simples
  // are base columns other than the partition ⇒ per-row ⇒ reject (matches the "attachments N/A" finding).
  const c = deriveAclGate('message_attachments').collapsibility('conversationId');
  assert.equal(c.ok, false);
});

test('collapsibility: a partition-anchored exists on the WRONG column is rejected', () => {
  // channelLatest's ACL is gate on channelId; asking to partition it on a different column exposes
  // the exists correlation (channelId) as per-row ⇒ reject. Proves the check is partition-relative.
  const c = deriveAclGate('conversations').collapsibility('conversationId');
  assert.equal(c.ok, false);
  assert.match(c.reason ?? '', /correlated on per-row column 'channelId'/);
});

test('collapsibility: escape hatch — partitionDetermines admits an FK-determined column', () => {
  // If a query legitimately had a top-level workspaceId guard determined by the partition via a DB FK,
  // the audited escape hatch admits it. (No current query needs this; asserts the mechanism.)
  const gate = deriveAclGate('conversations');
  // channelId partition already passes; adding a determines list must not break it.
  assert.equal(gate.collapsibility('channelId', ['workspaceId']).ok, true);
});

// ---- P1(a): per-user vs per-scope grant classification (drives the two-plane partition) ----

test('conversations: channel_participants is PER-USER (bound on userId); channels is PER-SCOPE', () => {
  const gate = deriveAclGate('conversations');
  const byTable = new Map(gate.grantSources.map((s) => [s.table, s]));
  const parts = byTable.get('channel_participants');
  assert.equal(parts?.kind, 'per-user');
  assert.equal(parts?.boundColumn, 'userId', 'partition key is the SENTINEL_USER-bound column');
  assert.equal(parts?.scopeColumn, 'channelId', 'scoped to the channel at eval');
  const channels = byTable.get('channels');
  assert.equal(channels?.kind, 'per-scope', 'the visibility/workspace root row is shared per scope');
  assert.equal(channels?.boundColumn, undefined);
});

test('message_attachments: the userId-binding leaf is PER-USER, structural hops PER-SCOPE', () => {
  const gate = deriveAclGate('message_attachments');
  const byTable = new Map(gate.grantSources.map((s) => [s.table, s]));
  assert.equal(byTable.get('channel_participants')?.kind, 'per-user');
  assert.equal(byTable.get('channel_participants')?.boundColumn, 'userId');
  assert.equal(byTable.get('channels')?.kind, 'per-scope');
  assert.equal(byTable.get('conversations')?.kind, 'per-scope', 'the conversation→channel hop is structural, not user-bound');
});

// ---- boundColumnOf: the conservative partition rules (real ACLs don't exercise all arms) ----

test('boundColumnOf: simple ==/IS SENTINEL_USER binds; other simples do not', () => {
  assert.equal(boundColumnOf(uEq('userId')), 'userId');
  assert.equal(boundColumnOf({ type: 'simple', left: { name: 'userId' }, op: 'IS', right: { value: SENTINEL_USER } }), 'userId');
  assert.equal(boundColumnOf(lit('visibility', 'PUBLIC')), null);
  assert.equal(boundColumnOf(lit('workspaceId', SENTINEL_WORKSPACE)), null, 'workspace sentinel is not the user sentinel');
  assert.equal(boundColumnOf({ type: 'simple', left: { name: 'userId' }, op: '!=', right: { value: SENTINEL_USER } }), null);
});

test('boundColumnOf: AND binds if ANY conjunct binds (extra conjuncts are row filters)', () => {
  assert.equal(boundColumnOf({ type: 'and', conditions: [lit('workspaceId', SENTINEL_WORKSPACE), uEq('userId')] }), 'userId');
});

test('boundColumnOf: OR binds only if EVERY arm binds the SAME column', () => {
  assert.equal(boundColumnOf({ type: 'or', conditions: [uEq('userId'), uEq('userId')] }), 'userId');
  assert.equal(boundColumnOf({ type: 'or', conditions: [uEq('userId'), lit('visibility', 'PUBLIC')] }), null, 'a non-binding arm grants regardless ⇒ not per-user');
  assert.equal(boundColumnOf({ type: 'or', conditions: [uEq('userId'), uEq('memberId')] }), null, 'different bound columns ⇒ not a single partition key');
});

test('boundColumnOf: a nested correlatedSubquery does not bind THIS table', () => {
  const nested: Cond = {
    type: 'correlatedSubquery', op: 'EXISTS',
    related: { correlation: { parentField: ['id'], childField: ['channelId'] }, subquery: { table: 'channel_participants', where: uEq('userId') } },
  };
  assert.equal(boundColumnOf(nested), null);
});
