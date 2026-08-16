import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output on purpose: this is exactly the module consumers
// resolve, so a mismatch between src and the published dist shows up here too.
// Run via `pnpm --filter @xyne/shared test` (builds first).
import { validateFlowDefinition } from '../dist/validation/flowSchema.js';

/**
 * Schema-side half of the agent-card contract.
 *
 * apps/backend runs `validateFlowDefinition` over every flow an app posts
 * (apps/controllers/flowController.ts, apps/controllers/chatController.ts)
 * before storing it, so a card whose shape drifts from this schema fails as an
 * HTTP 400 at postMessage — not as a blank card noticed days later.
 *
 * The payloads below mirror what xyne-claw-shared's `buildAgentCardFlow` emits;
 * packages/xyne-claw-shared/src/flow/agent-card.test.ts pins the same prop keys
 * from the emitting side. The two packages can't import each other (claw-shared
 * deliberately avoids a runtime dep on this one), so they move together by
 * convention — change one, change the other.
 */

const identity = {
  name: 'Ticket Triage',
  slug: 'ticket-triage',
  description: 'Triages incoming tickets',
  systemPrompt: 'You are a triage agent.',
  modelId: 'claude-sonnet-5',
  capabilities: [
    { id: 'spaces', label: 'spaces', kind: 'subagent', iconKey: 'xyne-spaces' },
    { id: 'web-search', label: 'Web Search', kind: 'tool', requiresConnection: 'google' },
  ],
  details: [{ label: 'Model', value: 'claude-sonnet-5' }],
};

const flowWith = props => ({
  version: '2.0',
  screenId: 'agent-card-req-1',
  title: 'Agent',
  components: [{ id: 'agent', type: 'agent', props }],
  data: {
    actionType: 'agent-card',
    variant: 'draft',
    requestId: 'req-1',
    agentSlug: 'architect',
    userId: 'user-1',
  },
  state: {
    values: {},
    touched: {},
    errors: {},
    submitting: false,
    submitted: false,
    history: [],
    loadingComponentIds: [],
  },
});

const accepts = props => assert.equal(validateFlowDefinition(flowWith(props)).success, true);
const rejects = props => assert.equal(validateFlowDefinition(flowWith(props)).success, false);

test('accepts a draft card in every phase', () => {
  for (const phase of ['pending', 'created', 'rejected']) {
    accepts({
      variant: 'draft',
      phase,
      agent: identity,
      selected: ['spaces'],
      note: 'skipped unknown tools: foo',
      decidedBy: 'Harsh',
      decidedById: 'usr_1',
      decidedAt: '2026-08-05T10:00:00.000Z',
    });
  }
});

test('accepts a profile card carrying the same identity', () => {
  accepts({ variant: 'profile', agent: identity });
});

test('accepts a minimal identity (name + slug only)', () => {
  accepts({ variant: 'draft', phase: 'pending', agent: { name: 'A', slug: 'a' } });
});

test('rejects an unknown prop key so emitter drift fails loudly', () => {
  rejects({ variant: 'draft', phase: 'pending', agent: identity, todos: [] });
});

test('rejects draft-only fields on a profile card', () => {
  // The variants are a discriminated union precisely so a read-only card can
  // never carry a decision affordance.
  rejects({ variant: 'profile', agent: identity, phase: 'pending' });
  rejects({ variant: 'profile', agent: identity, selected: ['spaces'] });
});

test('rejects unknown variants and phases', () => {
  rejects({ variant: 'editor', agent: identity });
  rejects({ variant: 'draft', phase: 'approved', agent: identity });
});

test('rejects a nameless identity', () => {
  rejects({ variant: 'draft', phase: 'pending', agent: { name: '', slug: 'a' } });
});

test('rejects a capability with an unknown kind', () => {
  rejects({
    variant: 'draft',
    phase: 'pending',
    agent: { name: 'A', slug: 'a', capabilities: [{ id: 'x', label: 'X', kind: 'gateway' }] },
  });
});

test('rejects a non-URL connect link', () => {
  rejects({
    variant: 'draft',
    phase: 'pending',
    agent: {
      name: 'A',
      slug: 'a',
      connectLinks: [{ serverType: 'google', displayName: 'Google', authUrl: 'not-a-url' }],
    },
  });
});
