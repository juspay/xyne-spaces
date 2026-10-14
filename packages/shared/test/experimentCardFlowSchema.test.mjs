import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFlowDefinition } from '../dist/validation/flowSchema.js';

const state = { values:{}, touched:{}, errors:{}, submitting:false, submitted:false, history:[], loadingComponentIds:[] };
const flow = (components) => ({ version:'2.0', screenId:'s1', components, state });

const statusCard = (props) => flow([{ id: 'experiment-status', type: 'experiment_status', props }]);
const epochCard = (props) => flow([{ id: 'experiment-epoch', type: 'experiment_epoch', props }]);

const status = {
  runId: 'run_1',
  kind: 'experiment',
  status: 'running',
  title: 'dashboard & desktop quality',
  model: 'spaces (default)',
  exitRule: 'Time-boxed: ends at the deadline.',
  startedAt: '2026-10-07T02:29:00.000Z',
  deadlineAt: '2026-10-07T09:29:00.000Z',
  updatedAt: '2026-10-07T07:58:00.000Z',
  epoch: 14,
  counts: { proved: 17, refuted: 0, open: 2 },
  epochs: { completed: 13, failed: 2 },
  findings: [{ title: 'Entry bundle is 37 MB', status: 'proved', epoch: 9, proof: 'area1-bundle.md' }],
  totalFindings: 19,
  needsYou: ['Add a reviewer on PR #2726'],
  links: { preview: 'https://example.test/claw-preview/s1/' },
};

const epoch = {
  runId: 'run_1',
  epoch: 14,
  status: 'done',
  plan: [{ id: 't1', text: 'Measure the entry chunk', status: 'done' }],
  retries: 1,
  summary: 'Entry chunk −70% gzip vs main.',
  attachments: ['area1-bundle.md'],
  findings: [{ title: 'Entry bundle is 37 MB', status: 'proved', epoch: 14 }],
  startedAt: '2026-10-07T07:40:00.000Z',
  endedAt: '2026-10-07T07:58:00.000Z',
};

test('a well-formed experiment status card validates', () => {
  assert.equal(validateFlowDefinition(statusCard(status)).success, true);
});

test('a well-formed experiment epoch card validates', () => {
  assert.equal(validateFlowDefinition(epochCard(epoch)).success, true);
});

test('status card props are strict', () => {
  assert.equal(validateFlowDefinition(statusCard({ ...status, extra: 1 })).success, false);
});

test('status card status is constrained', () => {
  assert.equal(validateFlowDefinition(statusCard({ ...status, status: 'aborted' })).success, false);
});

test('epoch plan rows use the execution status vocabulary', () => {
  const bad = { ...epoch, plan: [{ id: 't1', text: 'x', status: 'completed' }] };
  assert.equal(validateFlowDefinition(epochCard(bad)).success, false);
});

test('a malformed experiment card is rejected rather than passed through as unknown', () => {
  const { runId, ...withoutRun } = status;
  assert.equal(validateFlowDefinition(statusCard(withoutRun)).success, false);
});
