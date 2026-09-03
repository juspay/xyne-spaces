import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output on purpose — this is the module Spaces' ingest path
// resolves, so src/dist drift shows up here.
import { validateFlowDefinition } from '../dist/validation/flowSchema.js';

/**
 * TEMPORARY — delete alongside the lenient branch in flowSchema.ts once shared,
 * backend and dashboard deploy in lockstep.
 *
 * The component union is a hard gate that runs on Spaces' postMessage ingest, so
 * an unrecognised `type` rejected the ENTIRE flow and the message never reached
 * the thread — silently. A newer claw emitting a card an older backend has never
 * heard of should degrade, not disappear.
 *
 * The risk of widening that door is that malformed KNOWN components stop being
 * caught, so these tests pin both halves: unknown passes, known stays strict.
 */
const state = {
  values: {},
  touched: {},
  errors: {},
  submitting: false,
  submitted: false,
  history: [],
  loadingComponentIds: [],
};

const flow = (components) => ({ version: '2.0', screenId: 's1', components, state });

test('an unknown component type no longer rejects the whole flow', () => {
  const result = validateFlowDefinition(
    flow([
      { id: 'a', type: 'text', props: { content: 'hi' } },
      { id: 'b', type: 'somethingFromTheFuture', props: { anything: 1 } },
    ]),
  );
  assert.equal(result.success, true);
});

test('a malformed KNOWN component is still rejected', () => {
  // `text` requires props.content — this must NOT fall through to the lenient
  // branch and be waved past as an "unsupported card".
  const result = validateFlowDefinition(flow([{ id: 'a', type: 'text', props: {} }]));
  assert.equal(result.success, false);
});

test('a component with no type at all is still rejected', () => {
  const result = validateFlowDefinition(flow([{ id: 'a', props: {} }]));
  assert.equal(result.success, false);
});

test('a component with an empty type is still rejected', () => {
  const result = validateFlowDefinition(flow([{ id: 'a', type: '', props: {} }]));
  assert.equal(result.success, false);
});

test('the agent card validates against its real schema, not the fallback', () => {
  const ok = validateFlowDefinition(
    flow([{ id: 'a', type: 'agent', props: { variant: 'profile', agent: { name: 'x', slug: 'y' } } }]),
  );
  assert.equal(ok.success, true);

  // If `agent` were reaching the lenient branch this would pass too — it must not.
  const bad = validateFlowDefinition(flow([{ id: 'a', type: 'agent', props: { variant: 'nonsense' } }]));
  assert.equal(bad.success, false);
});
