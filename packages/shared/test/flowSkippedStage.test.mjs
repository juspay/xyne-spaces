import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FLOW_STAGE_NAMES,
  FLOW_STAGE_TRANSITIONS,
  FlowPlanModel,
} from '../dist/board-types/flow-plan.js';

const node = (id, parentIds = [], groupId) => ({
  id,
  title: id,
  order: 0,
  parentIds,
  ...(groupId && { groupId }),
});

const planWith = (nodes, groups = []) => ({
  version: 2,
  nodes,
  groups,
  decisions: [],
  updatedAt: 0,
});

test('SKIPPED is reachable from every live stage and is terminal', () => {
  const skipTargets = FLOW_STAGE_TRANSITIONS.filter(
    ([, to]) => to === FLOW_STAGE_NAMES.SKIPPED
  ).map(([from]) => from);
  assert.deepEqual(skipTargets.sort(), ['BACKLOG', 'PAUSED', 'STARTED', 'TODO']);
  assert.deepEqual(
    FLOW_STAGE_TRANSITIONS.filter(([from]) => from === FLOW_STAGE_NAMES.SKIPPED),
    []
  );
});

test('a manually skipped step satisfies its dependents like a backlog step', () => {
  const model = new FlowPlanModel(planWith([node('a'), node('b', ['a'])]));
  const readiness = model.evaluateReadiness(new Map([['a', FLOW_STAGE_NAMES.SKIPPED]]), new Map(), {
    rootActive: true,
  });
  assert.ok(readiness.readyNodeIds.has('b'));
  assert.ok(!readiness.deadNodeIds.has('b'));
});

test('group status: all manually skipped -> SKIPPED, mixed settled -> COMPLETED', () => {
  const model = new FlowPlanModel(
    planWith(
      [node('m1', [], 'g1'), node('m2', ['m1'], 'g1')],
      [{ id: 'g1', name: 'G', parentIds: [] }]
    )
  );
  assert.equal(
    model.deriveGroupStatus(
      'g1',
      new Map([
        ['m1', FLOW_STAGE_NAMES.SKIPPED],
        ['m2', FLOW_STAGE_NAMES.SKIPPED],
      ])
    ),
    'SKIPPED'
  );
  assert.equal(
    model.deriveGroupStatus(
      'g1',
      new Map([
        ['m1', FLOW_STAGE_NAMES.COMPLETED],
        ['m2', FLOW_STAGE_NAMES.SKIPPED],
      ])
    ),
    'COMPLETED'
  );
  // A skipped member never leaves a group stuck in STARTED once the rest is done.
  assert.equal(
    model.deriveGroupStatus(
      'g1',
      new Map([
        ['m1', FLOW_STAGE_NAMES.COMPLETED],
        ['m2', FLOW_STAGE_NAMES.COMPLETED],
      ])
    ),
    'COMPLETED'
  );
});

test('manual skip does not reuse the dead-node (ghost) set', () => {
  const model = new FlowPlanModel(planWith([node('a'), node('b', ['a'])]));
  const skipped = model.skippedPlanNodeIds(new Map([['a', FLOW_STAGE_NAMES.SKIPPED]]), false);
  assert.ok(!skipped.has('a'));
  assert.ok(!skipped.has('b'));
});
