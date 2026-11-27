import test from 'node:test';
import assert from 'node:assert/strict';
import type { DependencyEdge } from '@xyne/shared';
import {
  ticketDependenciesEnabled,
  TICKET_DEPENDENCIES_ENFORCEMENT_READY,
} from '../../src/services/dependencies/featureFlag';
import { projectDependencyEdges } from '../../src/services/dependencies/projection';
import {
  createBlocksSchema,
  dependencySettingsSchema,
  subTicketGatingSchema,
} from '../../src/services/dependencies/types';
import {
  assertNoDependencyCycle,
  loadDependencyGraph,
  loadDependencyContext,
} from '../../src/bypassAcl/dependencyGraph';

const edge: DependencyEdge = {
  id: 'legacy-id-contains-hidden-ticket',
  kind: 'BLOCKS',
  blockerTicketId: 'hidden-ticket',
  dependentTicketId: 'visible-ticket',
  strength: 'HARD',
  gatedStageId: 'visible-stage',
  satisfiedStageId: 'hidden-stage',
  satisfiedAt: null,
  reviewNeededAt: null,
  override: {
    at: 1,
    by: 'private-actor',
    reason: 'hidden-ticket: private title on a private board',
  },
};
const opaqueId = () => 'opaque';

test('restricted blocker transport contains no hidden ids, stages, author or free text', () => {
  const [projected] = projectDependencyEdges([edge], new Set(['visible-ticket']), opaqueId);
  assert.deepEqual(projected, {
    id: 'opaque',
    kind: 'BLOCKS',
    strength: 'HARD',
    restricted: true,
    blockerTicketId: 'restricted:opaque:blocker',
    dependentTicketId: 'visible-ticket',
    gatedStageId: 'visible-stage',
    satisfiedStageId: null,
    satisfiedAt: null,
    reviewNeededAt: null,
    override: { at: 1, by: null, reason: null },
  });
  assert.doesNotMatch(
    JSON.stringify(projected),
    /hidden-ticket|hidden-stage|private-actor|private title|private board/,
  );
});

test('restricted dependent transport also removes its gate and legacy mapping id', () => {
  const projected = projectDependencyEdges([edge], new Set(['hidden-ticket']), opaqueId)[0]!;
  assert.equal(projected.dependentTicketId, 'restricted:opaque:dependent');
  assert.equal(projected.gatedStageId, null);
  assert.equal(projected.satisfiedStageId, 'hidden-stage');
  assert.equal(projected.id, 'opaque');
  assert.doesNotMatch(JSON.stringify(projected), /visible-ticket|visible-stage|legacy-id/);
});

test('both visible endpoints retain an editable mapping id, without forwarding arbitrary fields', () => {
  const withSecret = { ...edge, title: 'should never be forwarded', boardId: 'secret-board' };
  const projected = projectDependencyEdges(
    [withSecret],
    new Set(['visible-ticket', 'hidden-ticket']),
    opaqueId,
  )[0]!;
  assert.equal(projected.id, edge.id);
  assert.equal(projected.restricted, false);
  assert.equal(projected.blockerTicketId, edge.blockerTicketId);
  assert.doesNotMatch(JSON.stringify(projected), /should never|secret-board|private title/);
});

test('hidden CHILD endpoints and free text get the same redaction as BLOCKS', () => {
  const projected = projectDependencyEdges(
    [{ ...edge, kind: 'CHILD' }],
    new Set(['visible-ticket']),
    opaqueId,
  )[0]!;
  assert.equal(projected.kind, 'CHILD');
  assert.equal(projected.restricted, true);
  assert.doesNotMatch(JSON.stringify(projected), /hidden-ticket|hidden-stage|private title/);
});

test('dependency write schemas cannot accept body-controlled identity or latches', () => {
  const valid = { sourceTicketId: 'a', targetTicketId: 'b' };
  assert.deepEqual(createBlocksSchema.parse(valid), {
    ...valid,
    strength: 'SOFT',
    gatedStageId: null,
    satisfiedStageId: null,
  });
  for (const forbidden of [
    'workspaceId',
    'createdBy',
    'satisfiedAt',
    'overriddenBy',
    'overrideReason',
    'relationType',
    'id',
    'origin',
  ]) {
    assert.equal(
      createBlocksSchema.safeParse({ ...valid, [forbidden]: 'injected' }).success,
      false,
    );
  }
  assert.equal(dependencySettingsSchema.safeParse({ strength: 'INVALID' }).success, false);
  assert.equal(
    subTicketGatingSchema.safeParse({ satisfiedStageId: 'ignored-stage' }).success,
    false,
  );
});

test('graph loading includes only mapped CHILD rows; unrelated sub-ticket rows are not dependencies', async () => {
  let subTicketQuery: unknown;
  const tx = {
    ticketReferenceMapping: { findMany: async () => [] },
    ticketSubTicketMapping: {
      findMany: async () => [{ id: 'map', ticketId: 'parent', subTicketId: 'sub' }],
    },
    subTicket: {
      findMany: async (args: unknown) => {
        subTicketQuery = args;
        return [{ id: 'sub', mappedTicketId: 'child' }];
      },
    },
  };
  const { edges } = await loadDependencyGraph(tx as never, 'workspace');
  assert.equal(edges.length, 1);
  assert.equal(edges[0]!.kind, 'CHILD');
  assert.equal(edges[0]!.blockerTicketId, 'child');
  assert.deepEqual(subTicketQuery, {
    where: { workspaceId: 'workspace', id: { in: ['sub'] } },
    select: { id: true, mappedTicketId: true },
  });
});

test('cycle checking fails closed on missing/cross-workspace endpoints without returning their ids', async () => {
  const tx = {
    ticketReferenceMapping: { findMany: async () => [] },
    ticketSubTicketMapping: { findMany: async () => [] },
    ticket: { findMany: async () => [] },
    board: { findMany: async () => [] },
    stage: { findMany: async () => [] },
    stageTransition: { findMany: async () => [] },
    ticketStageEta: { findMany: async () => [] },
  };
  await assert.rejects(assertNoDependencyCycle(tx as never, 'workspace', edge), error => {
    assert.equal((error as Error).message, 'Dependency graph requires repair');
    assert.doesNotMatch(JSON.stringify(error), /hidden-ticket|visible-ticket/);
    return true;
  });
});

test('context resolves current-board stages, outgoing transitions and latest active ETA without cross-board name collisions', async () => {
  const latest = new Date('2026-11-28T00:00:00Z');
  const tx = {
    ticket: {
      findMany: async () => [
        { id: 't', boardId: 'b', stageName: 'Started', statusV2: 'STARTED', eta: null },
      ],
    },
    board: { findMany: async () => [{ id: 'b', boardType: 'NON_LINEAR', metadata: null }] },
    stage: {
      findMany: async () => [
        { id: 'other-stage', boardId: 'other-board', name: 'Started', sequenceNumber: 0 },
        { id: 'current', boardId: 'b', name: 'Started', sequenceNumber: 0 },
      ],
    },
    stageTransition: {
      findMany: async () => [
        { boardId: 'b', fromStageId: 'current', toStageId: 'next' },
        { boardId: 'b', fromStageId: null, toStageId: 'global' },
        { boardId: 'b', fromStageId: 'different-stage', toStageId: 'not-allowed' },
      ],
    },
    ticketStageEta: {
      findMany: async () => [
        { ticketId: 't', stageId: 'other-stage', stageEta: new Date(0) },
        { ticketId: 't', stageId: 'current', stageEta: latest },
        { ticketId: 't', stageId: 'current', stageEta: new Date(0) },
      ],
    },
  };
  const context = await loadDependencyContext(tx as never, 'workspace', ['t']);
  assert.equal(context.ticketsById.get('t')!.activeStageEta, latest);
  assert.deepEqual(context.nextStageIdsByTicket!.get('t'), ['next', 'global']);
});

test('unready enforcement cannot be enabled and does not load the native flag provider', async () => {
  assert.equal(TICKET_DEPENDENCIES_ENFORCEMENT_READY, false);
  assert.equal(await ticketDependenciesEnabled('workspace'), false);
});

test('CHILD Zero schema cannot replicate override author or free text', async () => {
  const { schema } = await import('@xyne/shared');
  for (const column of ['overriddenAt', 'overriddenBy', 'overrideReason']) {
    assert.equal(column in schema.tables.ticket_sub_ticket_mappings.columns, false);
  }
});

test('flag evaluation fallback is not an explicit permission to disable enforcement', async () => {
  const { requireBooleanFlag } = await import('../../src/services/requiredFeatureFlag');
  assert.equal(requireBooleanFlag({ value: true, reason: 'TARGETING_MATCH' }), true);
  assert.equal(requireBooleanFlag({ value: false, reason: 'STATIC' }), false);
  for (const details of [
    { value: false, reason: 'ERROR' },
    { value: false, reason: 'DEFAULT' },
    { value: false, reason: 'UNKNOWN', errorCode: 'PROVIDER_NOT_READY' },
  ])
    assert.throws(() => requireBooleanFlag(details), /Required feature flag/);
});

test('empty dependency selections do not read workspace mappings or context', async () => {
  const tx = new Proxy(
    {},
    {
      get: () => {
        throw new Error('unexpected database read');
      },
    },
  );
  assert.deepEqual(await loadDependencyGraph(tx as never, 'workspace', []), {
    edges: [],
    references: [],
    mappings: [],
  });
  assert.equal((await loadDependencyContext(tx as never, 'workspace', [])).ticketsById.size, 0);
});

test('dependency mapping reads are capped and fail closed without returning endpoint identifiers', async () => {
  const tx = {
    ticketReferenceMapping: {
      findMany: async (args: { take: number }) => {
        assert.equal(args.take, 20_001);
        return Array.from({ length: args.take }, () => ({ id: 'private-edge' }));
      },
    },
    ticketSubTicketMapping: { findMany: async () => [] },
  };
  await assert.rejects(loadDependencyGraph(tx as never, 'workspace', ['visible-ticket']), error => {
    assert.equal((error as { code: string }).code, 'DEPENDENCY_GRAPH_LIMIT');
    assert.doesNotMatch(JSON.stringify(error), /private-edge|visible-ticket/);
    return true;
  });
});

test('override parser rejects malformed intent and never trusts request provenance', async () => {
  process.env.FORM_FIELD_TEXT_HASH_KEY ??= '1'.repeat(64);
  const { dependencyRequestMoveOptions } = await import('../../src/bypassAcl/dependencyStageGate');
  assert.deepEqual(
    dependencyRequestMoveOptions('actor', {
      dependencyOverride: { reason: '  Accepted  ', adminOverride: true },
      actorId: 'attacker',
      automation: true,
    }),
    { actorId: 'actor', automation: false, reason: 'Accepted', adminOverride: true },
  );
  for (const input of [
    [],
    { dependencyReason: ' ' },
    { dependencyReason: 'x'.repeat(2001) },
    { dependencyAdminOverride: 'true' },
    { dependencyOverride: [] },
    { dependencyOverride: { reason: 'ok', actorId: 'attacker' } },
    { dependencyOverride: { reason: 'ok' }, dependencyReason: 'other' },
  ]) {
    assert.throws(() => dependencyRequestMoveOptions('actor', input), { code: 'DEPENDENCY_INPUT' });
  }
});

test('dependency application errors expose only counts and live consent eligibility', async () => {
  const { DependencyError } = await import('../../src/services/dependencies/types');
  const error = new DependencyError(
    'DEPENDENCY_HARD_GATE',
    'Unresolved dependencies prevent this stage move',
    409,
    { softCount: 1, hardCount: 2, canAdminOverride: false },
  );
  assert.deepEqual(error.details, {
    code: 'DEPENDENCY_HARD_GATE',
    softCount: 1,
    hardCount: 2,
    canAdminOverride: false,
  });
});

test('cycle checking follows bounded incident frontiers and excludes satisfied paths', async () => {
  const references = [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'd'],
  ].map(([sourceTicketId, targetTicketId], index) => ({
    id: `edge-${index}`,
    relationType: 'BLOCKS',
    sourceTicketId,
    targetTicketId,
    strength: 'HARD',
    gatedStageId: 'done',
    satisfiedStageId: 'done',
    satisfiedAt: null as Date | null,
  }));
  let reads = 0;
  const tx = {
    ticketReferenceMapping: {
      findMany: async (args: {
        take: number;
        where: { workspaceId: string; OR: Array<{ sourceTicketId?: { in: string[] } }> };
      }) => {
        const ids = args.where.OR[0]?.sourceTicketId?.in;
        assert.ok(ids, 'each query must be an incident selection, never a workspace scan');
        assert.ok(ids.length <= 200);
        assert.equal(args.take, 20_001);
        assert.equal(args.where.workspaceId, 'workspace');
        reads++;
        return references.filter(
          row => ids.includes(row.sourceTicketId!) || ids.includes(row.targetTicketId!),
        );
      },
    },
    ticketSubTicketMapping: { findMany: async () => [] },
    ticket: {
      findMany: async () =>
        ['a', 'b', 'c', 'd'].map(id => ({
          id,
          boardId: 'board',
          stageName: 'Todo',
          statusV2: 'TODO',
          eta: null,
        })),
    },
    board: { findMany: async () => [{ id: 'board', boardType: 'DEFAULT', metadata: null }] },
    stage: {
      findMany: async () => [
        {
          id: 'todo',
          boardId: 'board',
          name: 'Todo',
          sequenceNumber: 0,
          defaultTicketStatusV2: 'TODO',
        },
        {
          id: 'done',
          boardId: 'board',
          name: 'Done',
          sequenceNumber: 1,
          defaultTicketStatusV2: 'COMPLETED',
        },
      ],
    },
    stageTransition: { findMany: async () => [] },
    ticketStageEta: { findMany: async () => [] },
  };
  const candidate: DependencyEdge = {
    ...edge,
    id: 'candidate',
    blockerTicketId: 'd',
    dependentTicketId: 'a',
    gatedStageId: 'done',
    satisfiedStageId: 'done',
    override: null,
  };
  await assert.rejects(assertNoDependencyCycle(tx as never, 'workspace', candidate), {
    code: 'DEPENDENCY_CYCLE',
  });
  assert.equal(reads, 2, 'the middle path must be discovered after the endpoint frontier');
  references[1]!.satisfiedAt = new Date();
  await assertNoDependencyCycle(tx as never, 'workspace', candidate);
});
