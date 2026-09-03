import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFlowDefinition } from '../dist/validation/flowSchema.js';

/**
 * Schema-side contract for the MCP configure card.
 *
 * The card exists so the agent never handles credentials: it names WHICH inputs
 * to render, the user types them in the dashboard, and the values go
 * browser → claw-auth. These tests pin that boundary — props are strict, so a
 * stray `value` on a field (the obvious way a secret would leak in) fails
 * validation rather than being carried through the flow.
 */
const state = { values:{}, touched:{}, errors:{}, submitting:false, submitted:false, history:[], loadingComponentIds:[] };
const flow = (components) => ({ version:'2.0', screenId:'s1', components, state });

const card = (props) => flow([{ id: 'mcp-configure', type: 'mcpConfigure', props }]);

const valid = {
  serverType: 'github',
  serverName: 'GitHub',
  mcpServerId: 'srv_1',
  fields: [{ name: 'token', label: 'Access token', type: 'password' }],
};

test('a well-formed configure card validates', () => {
  assert.equal(validateFlowDefinition(card(valid)).success, true);
});

test('a field carrying a value is REJECTED — credentials must not ride in props', () => {
  const leaky = { ...valid, fields: [{ ...valid.fields[0], value: 'ghp_secret' }] };
  assert.equal(validateFlowDefinition(card(leaky)).success, false);
});

test('an unknown top-level prop is rejected (strict)', () => {
  assert.equal(validateFlowDefinition(card({ ...valid, credentials: { token: 'x' } })).success, false);
});

test('mcpServerId is required — it is the only id the server acts on', () => {
  const { mcpServerId, ...withoutId } = valid;
  assert.equal(validateFlowDefinition(card(withoutId)).success, false);
});

test('at least one field is required', () => {
  assert.equal(validateFlowDefinition(card({ ...valid, fields: [] })).success, false);
});

test('field type is constrained to text | password', () => {
  const bad = { ...valid, fields: [{ name: 'x', label: 'X', type: 'file' }] };
  assert.equal(validateFlowDefinition(card(bad)).success, false);
});
