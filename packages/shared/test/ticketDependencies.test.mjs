import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toEdges,
  dependencyPolicy,
  lockedStageIds,
  meetsSatisfiedWhen,
  effectiveStrength,
  deriveDependencyState,
  dependencyGate,
  blockerReadyDate,
  findCycle,
  assertGenericTicketReference,
} from '../dist/tickets/dependencies/index.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 26);
const stage = (boardId, name, sequenceNumber, status = 'STARTED', eta = 2) => ({
  id: `${boardId}:${name}`,
  boardId,
  name,
  sequenceNumber,
  defaultTicketStatusV2: status,
  eta,
});
const boardStages = (id) => [
  stage(id, 'todo', 0, 'TODO'),
  stage(id, 'api', 1),
  stage(id, 'test', 2),
  stage(id, 'done', 3, 'COMPLETED'),
  stage(id, 'cancelled', 4, 'CANCELLED'),
];
const a = {
  id: 'A',
  boardId: 'a',
  stageName: 'todo',
  eta: NOW + DAY,
  activeStageEta: NOW,
};
const b = {
  id: 'B',
  boardId: 'b',
  stageName: 'todo',
  eta: NOW,
  activeStageEta: NOW,
};
const context = () => ({
  ticketsById: new Map([
    ['A', { ...a }],
    ['B', { ...b }],
  ]),
  boardsById: new Map([
    ['a', { id: 'a', boardType: 'DEFAULT' }],
    ['b', { id: 'b', boardType: 'DEFAULT' }],
  ]),
  stagesByBoard: new Map([
    ['a', boardStages('a')],
    ['b', boardStages('b')],
  ]),
});
const edge = (values = {}) => ({
  id: 'edge',
  kind: 'BLOCKS',
  blockerTicketId: 'A',
  dependentTicketId: 'B',
  strength: 'SOFT',
  gatedStageId: null,
  satisfiedStageId: null,
  satisfiedAt: null,
  reviewNeededAt: null,
  override: null,
  ...values,
});

const getStage = (ctx, boardId, name) =>
  ctx.stagesByBoard.get(boardId).find((s) => s.name === name);

test('legacy sub-tickets normalize without backfill; unmapped children and LINKED do not become edges', () => {
  const references = [
    {
      id: 'link',
      relationType: 'LINKED',
      sourceTicketId: 'A',
      targetTicketId: 'B',
    },
    {
      id: 'block',
      relationType: 'BLOCKS',
      sourceTicketId: 'A',
      targetTicketId: 'B',
      strength: 'HARD',
    },
  ];
  const mappings = [
    { id: 'child', ticketId: 'B', subTicketId: 'sub' },
    { id: 'draft', ticketId: 'B', subTicketId: 'draft' },
  ];
  const before = JSON.stringify({ references, mappings });
  const result = toEdges(references, mappings, [
    { id: 'sub', mappedTicketId: 'A' },
    { id: 'draft', mappedTicketId: null },
  ]);
  assert.deepEqual(result, [
    edge({ id: 'block', strength: 'HARD' }),
    edge({ id: 'child', kind: 'CHILD' }),
  ]);
  assert.equal(JSON.stringify({ references, mappings }), before);
});

test('override timestamps include epoch zero; normalization preserves latch and review fields', () => {
  const [result] = toEdges(
    [
      {
        id: 'edge',
        relationType: 'BLOCKS',
        sourceTicketId: 'A',
        targetTicketId: 'B',
        overriddenAt: 0,
        overriddenBy: 'user',
        overrideReason: 'accepted',
        satisfiedAt: 0,
        reviewNeededAt: NOW,
      },
    ],
    [],
    [],
  );
  assert.deepEqual(result.override, { at: 0, by: 'user', reason: 'accepted' });
  assert.equal(result.satisfiedAt, 0);
  assert.equal(result.reviewNeededAt, NOW);
});

test('policy defaults are independent and malformed metadata cannot crash derivation', () => {
  assert.deepEqual(dependencyPolicy(undefined), {
    defaultStrength: 'SOFT',
    hardGateStageIds: [],
    automationOnSoftGate: 'PROCEED',
  });
  for (const metadata of [null, 1, [], { dependencyPolicy: 'bad' }]) {
    assert.equal(dependencyPolicy(metadata).defaultStrength, 'SOFT');
  }
  const ids = ['b:api', 5];
  const policy = dependencyPolicy({
    dependencyPolicy: {
      defaultStrength: 'HARD',
      hardGateStageIds: ids,
      automationOnSoftGate: 'STOP',
    },
  });
  assert.deepEqual(policy.hardGateStageIds, ['b:api']);
  policy.hardGateStageIds.push('b:test');
  assert.deepEqual(ids, ['b:api', 5]);
});

test('linear locks at and after the gate; null, deleted and foreign gates lock terminal stages', () => {
  const ctx = context(),
    board = ctx.boardsById.get('b'),
    stages = ctx.stagesByBoard.get('b');
  assert.deepEqual(lockedStageIds(board, stages, 'b:test'), ['b:test', 'b:done', 'b:cancelled']);
  for (const gate of [null, 'deleted', 'a:api']) {
    assert.deepEqual(lockedStageIds(board, stages, gate), ['b:done', 'b:cancelled']);
  }
  assert.deepEqual(
    lockedStageIds(board, [...stages, stage('other', 'done', 99, 'COMPLETED')], null),
    ['b:done', 'b:cancelled'],
  );
});

test('nonlinear locks exact gate and terminals; FLOW never locks', () => {
  const stages = boardStages('b');
  assert.deepEqual(lockedStageIds({ id: 'b', boardType: 'NON_LINEAR' }, stages, 'b:api'), [
    'b:api',
    'b:done',
    'b:cancelled',
  ]);
  assert.deepEqual(lockedStageIds({ id: 'b', boardType: 'FLOW' }, stages, 'b:api'), []);
});

test('BLOCKS null clears on completed, child null on any terminal, cancelled BLOCKS needs review', () => {
  const ctx = context(),
    board = ctx.boardsById.get('a'),
    stages = ctx.stagesByBoard.get('a');
  assert.equal(meetsSatisfiedWhen(edge(), board, stages, getStage(ctx, 'a', 'done')), true);
  assert.equal(meetsSatisfiedWhen(edge(), board, stages, getStage(ctx, 'a', 'cancelled')), false);
  assert.equal(
    meetsSatisfiedWhen(edge({ kind: 'CHILD' }), board, stages, getStage(ctx, 'a', 'cancelled')),
    true,
  );
  assert.equal(
    meetsSatisfiedWhen(
      edge({ satisfiedStageId: 'a:api' }),
      board,
      stages,
      getStage(ctx, 'a', 'cancelled'),
    ),
    false,
  );
});

test('satisfaction latches and linear skip-ahead satisfies; nonlinear requires the exact stage', () => {
  const ctx = context(),
    board = ctx.boardsById.get('a'),
    stages = ctx.stagesByBoard.get('a');
  const configured = edge({ satisfiedStageId: 'a:api' });
  assert.equal(meetsSatisfiedWhen(configured, board, stages, getStage(ctx, 'a', 'test')), true);
  assert.equal(
    meetsSatisfiedWhen(
      configured,
      { ...board, boardType: 'NON_LINEAR' },
      stages,
      getStage(ctx, 'a', 'test'),
    ),
    false,
  );
  assert.equal(
    meetsSatisfiedWhen(
      configured,
      { ...board, boardType: 'NON_LINEAR' },
      stages,
      getStage(ctx, 'a', 'api'),
    ),
    true,
  );
  assert.equal(
    meetsSatisfiedWhen(edge({ satisfiedAt: 0 }), board, stages, getStage(ctx, 'a', 'todo')),
    true,
  );
});

test('deleted satisfaction stage falls back; no COMPLETED stage permits any terminal', () => {
  const ctx = context(),
    board = ctx.boardsById.get('a'),
    stages = ctx.stagesByBoard.get('a');
  const configured = edge({ satisfiedStageId: 'missing' });
  assert.equal(meetsSatisfiedWhen(configured, board, stages, getStage(ctx, 'a', 'api')), false);
  assert.equal(meetsSatisfiedWhen(configured, board, stages, getStage(ctx, 'a', 'done')), true);
  assert.equal(
    meetsSatisfiedWhen(
      edge(),
      board,
      stages.filter((s) => s.name !== 'done'),
      getStage(ctx, 'a', 'cancelled'),
    ),
    true,
  );
  assert.equal(
    meetsSatisfiedWhen(edge(), board, stages, stage('other', 'done', 10, 'COMPLETED')),
    false,
  );
});

test('effective strength can only be raised by edge, board or gated-stage policy', () => {
  const defaults = dependencyPolicy(null);
  assert.equal(effectiveStrength(edge(), defaults, 'b:api'), 'SOFT');
  assert.equal(effectiveStrength(edge({ strength: 'HARD' }), defaults, 'b:api'), 'HARD');
  assert.equal(
    effectiveStrength(edge(), { ...defaults, defaultStrength: 'HARD' }, 'b:api'),
    'HARD',
  );
  assert.equal(
    effectiveStrength(edge(), { ...defaults, hardGateStageIds: ['b:api'] }, 'b:api'),
    'HARD',
  );
});

test('gate ignores other dependents, satisfied edges, same-stage and backwards moves', () => {
  const ctx = context();
  const edges = [
    edge({ gatedStageId: 'b:api' }),
    edge({ id: 'hard', strength: 'HARD' }),
    edge({ id: 'sat', satisfiedAt: NOW }),
    edge({ id: 'other', dependentTicketId: 'C' }),
  ];
  assert.deepEqual(
    dependencyGate(b, 'b:api', edges, ctx).soft.map((e) => e.id),
    ['edge'],
  );
  const gate = dependencyGate(b, 'b:done', edges, ctx);
  assert.deepEqual(
    gate.hard.map((e) => e.id),
    ['hard'],
  );
  assert.deepEqual(
    gate.soft.map((e) => e.id),
    ['edge'],
  );
  assert.deepEqual(dependencyGate({ ...b, stageName: 'test' }, 'b:api', edges, ctx), {
    hard: [],
    soft: [],
  });
  assert.deepEqual(dependencyGate({ ...b, stageName: 'api' }, 'b:api', edges, ctx), {
    hard: [],
    soft: [],
  });
  ctx.boardsById.set('b', { id: 'b', boardType: 'FLOW' });
  assert.deepEqual(dependencyGate(b, 'b:done', edges, ctx), {
    hard: [],
    soft: [],
  });
});

test('policy uses configured gate rather than later entered stage; null uses terminal target', () => {
  const ctx = context();
  ctx.boardsById.set('b', {
    id: 'b',
    boardType: 'DEFAULT',
    metadata: { dependencyPolicy: { hardGateStageIds: ['b:api', 'b:done'] } },
  });
  assert.equal(dependencyGate(b, 'b:test', [edge({ gatedStageId: 'b:api' })], ctx).hard.length, 1);
  assert.equal(dependencyGate(b, 'b:done', [edge()], ctx).hard.length, 1);
});

test('ready dates use ticket ETA for terminal, active deadline plus remaining durations for linear milestone', () => {
  const ctx = context();
  assert.equal(blockerReadyDate(edge(), ctx), a.eta);
  assert.equal(blockerReadyDate(edge({ satisfiedStageId: 'a:test' }), ctx), NOW + 4 * 3_600_000);
  ctx.boardsById.set('a', { id: 'a', boardType: 'NON_LINEAR' });
  assert.equal(blockerReadyDate(edge({ satisfiedStageId: 'a:test' }), ctx), a.eta);
});

test('missing or invalid dates and durations never invent risk', () => {
  const ctx = context(),
    e = edge({ satisfiedStageId: 'a:test' });
  ctx.stagesByBoard.get('a')[1].eta = null;
  assert.equal(blockerReadyDate(e, ctx), null);
  ctx.ticketsById.set('A', { ...a, eta: 'invalid', activeStageEta: null });
  assert.equal(blockerReadyDate(edge(), ctx), null);
  assert.equal(blockerReadyDate(e, ctx), null);
  ctx.ticketsById.delete('A');
  assert.equal(blockerReadyDate(e, ctx), null);
});

test('primary precedence: Blocked > Needs review > At risk > Paused > Gated later > Unblocked', () => {
  const ctx = context();
  const e = edge({ gatedStageId: 'b:api', reviewNeededAt: NOW });
  assert.equal(deriveDependencyState(b, [e], ctx, NOW).primary, 'Blocked');
  e.gatedStageId = 'b:test';
  assert.equal(deriveDependencyState(b, [e], ctx, NOW).primary, 'Needs review');
  e.reviewNeededAt = null;
  assert.equal(deriveDependencyState(b, [e], ctx, NOW).primary, 'At risk');
  assert.equal(deriveDependencyState(b, [e], ctx, NOW).atRiskDays, 1);
  ctx.ticketsById.delete('A');
  assert.equal(
    deriveDependencyState({ ...b, statusV2: 'PAUSED', stageName: 'missing' }, [e], ctx, NOW)
      .primary,
    'Paused',
  );
  assert.equal(deriveDependencyState(b, [e], ctx, NOW).primary, 'Gated later');
  e.satisfiedAt = NOW;
  assert.equal(deriveDependencyState(b, [e], ctx, NOW).primary, 'Unblocked');
});

test('restricted blocker still locks dependent without requiring its ticket details', () => {
  const ctx = context();
  ctx.ticketsById.delete('A');
  const state = deriveDependencyState(b, [edge({ gatedStageId: 'b:api' })], ctx, NOW);
  assert.equal(state.primary, 'Blocked');
  assert.equal(state.blockedBy.length, 1);
  assert.equal(state.atRiskDays, undefined);
});

test('nonlinear is Blocked only when every allowed outgoing stage is locked', () => {
  const ctx = context();
  ctx.boardsById.set('b', { id: 'b', boardType: 'NON_LINEAR' });
  ctx.nextStageIdsByTicket = new Map([['B', ['b:api', 'b:test']]]);
  const e = edge({ gatedStageId: 'b:api' });
  ctx.ticketsById.delete('A');
  assert.equal(deriveDependencyState(b, [e], ctx, NOW).primary, 'Gated later');
  ctx.nextStageIdsByTicket.set('B', ['b:api', 'b:done']);
  assert.equal(deriveDependencyState(b, [e], ctx, NOW).primary, 'Blocked');
  ctx.nextStageIdsByTicket.set('B', []);
  assert.notEqual(deriveDependencyState(b, [e], ctx, NOW).primary, 'Blocked');
});

test('recent unblocked badge expires, future dates excluded; blocking is an independent chip', () => {
  for (const stamp of [NOW - DAY, NOW + 1, 'invalid']) {
    assert.equal(
      deriveDependencyState(b, [edge({ satisfiedAt: stamp })], context(), NOW).primary,
      null,
    );
  }
  assert.equal(
    deriveDependencyState(b, [edge({ satisfiedAt: new Date(NOW - DAY + 1) })], context(), NOW)
      .primary,
    'Unblocked',
  );
  const state = deriveDependencyState(a, [edge()], context(), NOW);
  assert.equal(state.primary, null);
  assert.equal(state.blocking.length, 1);
  assert.equal(state.blockedBy.length, 0);
});

test('stage graph permits valid two-team back-and-forth but rejects a true cycle', () => {
  const ctx = context();
  const first = edge({ satisfiedStageId: 'a:api', gatedStageId: 'b:api' });
  const back = edge({
    id: 'back',
    blockerTicketId: 'B',
    dependentTicketId: 'A',
    satisfiedStageId: 'b:test',
    gatedStageId: 'a:test',
  });
  assert.equal(findCycle([first], back, ctx), null);
  const cycle = findCycle([first], { ...back, gatedStageId: 'a:api' }, ctx);
  assert.deepEqual(cycle, ['A', 'B', 'A']);
});

test('cycle graph includes CHILD edges and terminal defaults, ignores latched edges, replaces on edit', () => {
  const ctx = context(),
    first = edge({ kind: 'CHILD' });
  const back = edge({
    id: 'back',
    blockerTicketId: 'B',
    dependentTicketId: 'A',
  });
  assert.ok(findCycle([first], back, ctx));
  assert.equal(findCycle([{ ...first, satisfiedAt: NOW }], back, ctx), null);
  assert.equal(
    findCycle([first], { ...first, blockerTicketId: 'B', dependentTicketId: 'A' }, ctx),
    null,
  );
  assert.deepEqual(findCycle([], edge({ dependentTicketId: 'A' }), ctx), ['A', 'A']);
});

test('NON_LINEAR graph collapses ticket stages; FLOW dependents have no gates', () => {
  const ctx = context();
  ctx.boardsById.set('a', { id: 'a', boardType: 'NON_LINEAR' });
  const first = edge({ satisfiedStageId: 'a:api', gatedStageId: 'b:api' });
  const back = edge({
    id: 'back',
    blockerTicketId: 'B',
    dependentTicketId: 'A',
    satisfiedStageId: 'b:test',
    gatedStageId: 'a:test',
  });
  assert.ok(findCycle([first], back, ctx));
  ctx.boardsById.set('a', { id: 'a', boardType: 'FLOW' });
  assert.equal(findCycle([first], back, ctx), null);
});

test('cycle check fails closed on incomplete server context', () => {
  const ctx = context();
  ctx.ticketsById.delete('A');
  assert.throws(() => findCycle([], edge(), ctx), /complete ticket and board context/);
  const other = context();
  other.stagesByBoard.delete('a');
  assert.throws(() => findCycle([], edge(), other), /complete stage context/);
});

test('generic references refuse only BLOCKS, preserving every existing relation type', () => {
  assert.throws(() => assertGenericTicketReference('BLOCKS'), /dependency mutations/);
  for (const type of ['LINKED', 'DUPLICATE_POSSIBLE', 'DUPLICATE_CONFIRMED', 'MERGED_INTO']) {
    assert.doesNotThrow(() => assertGenericTicketReference(type));
  }
});

test('linear next-stage rule uses sequenceNumber + 1 and never mutates stage arrays', () => {
  const ctx = context();
  ctx.ticketsById.delete('A');
  const stages = ctx.stagesByBoard.get('b');
  stages.find((s) => s.name === 'api').sequenceNumber = 10;
  stages.find((s) => s.name === 'test').sequenceNumber = 20;
  stages.reverse();
  const before = JSON.stringify(stages);
  assert.equal(
    deriveDependencyState(b, [edge({ gatedStageId: 'b:api' })], ctx, NOW).primary,
    'Gated later',
  );
  assert.equal(JSON.stringify(stages), before);
});

test('RELEASE boards use the existing sequential stage semantics', () => {
  const ctx = context();
  ctx.boardsById.set('b', { id: 'b', boardType: 'RELEASE' });
  assert.deepEqual(lockedStageIds(ctx.boardsById.get('b'), ctx.stagesByBoard.get('b'), 'b:test'), [
    'b:test',
    'b:done',
    'b:cancelled',
  ]);
  assert.equal(
    dependencyGate({ ...b, stageName: 'test' }, 'b:api', [edge({ gatedStageId: 'b:api' })], ctx)
      .soft.length,
    0,
  );
});

test('cycle traversal handles a deep chain without recursion', () => {
  const ctx = {
    ticketsById: new Map(),
    boardsById: new Map([['board', { id: 'board', boardType: 'NON_LINEAR' }]]),
    stagesByBoard: new Map([['board', [stage('board', 'done', 0, 'COMPLETED')]]]),
  };
  const edges = [];
  for (let i = 0; i < 12_000; i++) {
    ctx.ticketsById.set(String(i), { id: String(i), boardId: 'board', stageName: 'done' });
    if (i > 0)
      edges.push(
        edge({ id: `edge-${i}`, blockerTicketId: String(i - 1), dependentTicketId: String(i) }),
      );
  }
  const candidate = edge({ id: 'last', blockerTicketId: '11999', dependentTicketId: '0' });
  const loop = findCycle(edges, candidate, ctx);
  assert.equal(loop.length, 12_001);
  assert.equal(loop[0], loop[loop.length - 1]);
});
