import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERIC_FLOW_CARD_LABEL,
  decodeFlowJsonAttribute,
  flowCardLabel,
  flowCardType,
  flowFallbackLabel,
  flowVisibleText,
} from '../dist/utils/flowCardLabel.js';

const card = (type, props, extra = {}) => ({
  version: '2.0',
  screenId: `s-${type}`,
  components: [{ id: 'c1', type, props }],
  ...extra,
});

const asMessage = flow =>
  `<div data-flow-json="${JSON.stringify(flow).replace(/"/g, '&quot;')}">Flow JSON</div>`;

test('pr: number from the URL, status and title', () => {
  const flow = card('pr', {
    status: 'merged',
    provider: 'github',
    title: 'Fix login redirect',
    url: 'https://github.com/juspay/xyne-spaces/pull/3255',
  });
  assert.equal(flowCardLabel(flow), '🔀 PR #3255 · merged · Fix login redirect');
});

test('pr: bitbucket and gitlab URLs, and no URL', () => {
  const base = { status: 'created', provider: 'bitbucket', title: 'Add retries' };
  assert.equal(
    flowCardLabel(card('pr', { ...base, url: 'https://bitbucket.org/a/b/pull-requests/42' })),
    '🔀 PR #42 · created · Add retries',
  );
  assert.equal(
    flowCardLabel(card('pr', { ...base, url: 'https://gitlab.com/a/b/-/merge_requests/7' })),
    '🔀 PR #7 · created · Add retries',
  );
  assert.equal(flowCardLabel(card('pr', base)), '🔀 PR · created · Add retries');
});

test('pr_approval: pending and resolved', () => {
  assert.equal(
    flowCardLabel(card('pr_approval', { phase: 'pending', title: 'Bump deps' })),
    '🔀 Approve merging · Bump deps',
  );
  assert.equal(
    flowCardLabel(card('pr_approval', { phase: 'resolved', title: 'Bump deps', outcome: 'denied' })),
    '🔀 Merge denied · Bump deps',
  );
  assert.equal(
    flowCardLabel(card('pr_approval', { phase: 'resolved', title: 'Bump deps', outcome: 'approved' })),
    '🔀 Merge approved · Bump deps',
  );
});

test('agent: draft phases, profile and update', () => {
  const agent = { name: 'Weather', slug: 'weather' };
  const label = props => flowCardLabel(card('agent', { agent, ...props }));
  assert.equal(label({ variant: 'draft', phase: 'pending' }), '🤖 Drafted an agent · Weather');
  assert.equal(label({ variant: 'draft', phase: 'created' }), '🤖 Created an agent · Weather');
  assert.equal(label({ variant: 'draft', phase: 'rejected' }), '🤖 Agent draft declined · Weather');
  assert.equal(label({ variant: 'draft', phase: 'superseded' }), '🤖 Agent draft replaced · Weather');
  assert.equal(label({ variant: 'profile' }), '🤖 Shared an agent · Weather');
  assert.equal(
    label({ variant: 'update', changes: [{ field: 'name', label: 'Name' }] }),
    '🤖 Proposed changes to an agent · Weather',
  );
});

test('agent_summary: its label, else the count', () => {
  assert.equal(flowCardLabel(card('agent_summary', { total: 12, label: 'Your agents' })), '🤖 Your agents');
  assert.equal(flowCardLabel(card('agent_summary', { total: 12 })), '🤖 12 agents available');
  assert.equal(flowCardLabel(card('agent_summary', { total: 1 })), '🤖 1 agent available');
});

test('mcp_suggest: one, two, and more than two connectors', () => {
  const c = names => card('mcp_suggest', { connectors: names.map(name => ({ serverType: name, name })) });
  assert.equal(flowCardLabel(c(['Jira'])), '🔌 Suggested a connector · Jira');
  assert.equal(flowCardLabel(c(['Jira', 'Slack'])), '🔌 Suggested 2 connectors · Jira, Slack');
  assert.equal(flowCardLabel(c(['Jira', 'Slack', 'GitHub', 'Linear'])), '🔌 Suggested 4 connectors · Jira, Slack +2');
});

test('provider_suggest: names the providers', () => {
  assert.equal(
    flowCardLabel(card('provider_suggest', { providers: [{ provider: 'claude', name: 'Claude' }] })),
    '🔑 Suggested a provider · Claude',
  );
});

test('mcpConfigure: names the server', () => {
  assert.equal(
    flowCardLabel(
      card('mcpConfigure', {
        serverType: 'jira',
        serverName: 'Jira',
        mcpServerId: 'm1',
        fields: [{ key: 'token', label: 'Token' }],
      }),
    ),
    '🔌 Connect a connector · Jira',
  );
});

test('call_schedule: proposed and scheduled', () => {
  assert.equal(
    flowCardLabel(card('call_schedule', { phase: 'proposed', title: 'Sprint sync', attendees: [], slots: [] })),
    '📅 Proposed call times · Sprint sync',
  );
  assert.equal(
    flowCardLabel(card('call_schedule', { phase: 'scheduled', title: 'Sprint sync', attendees: [] })),
    '📅 Scheduled a call · Sprint sync',
  );
});

test('existing card labels are unchanged', () => {
  assert.equal(flowCardLabel(card('plan', { title: 'Rollout', phase: 'proposed' })), '📋 Proposed a plan: Rollout');
  assert.equal(flowCardLabel(card('diff', { path: 'a.ts' })), '📝 Shared a diff: a.ts');
  assert.equal(flowCardLabel(card('code', { language: 'ts' })), '💻 Shared ts code');
  assert.equal(flowCardLabel(card('ticket', { xyneId: 'XYNE-1', title: 'Bug' })), '🎫 Filed XYNE-1: Bug');
  assert.equal(flowCardLabel(card('chart', { caption: 'Latency' })), '📊 Latency');
  assert.equal(flowCardLabel(card('user_question', { questions: [1, 2] })), '💬 Agent wants to ask you 2 questions');
});

test('finds a card nested inside a container', () => {
  const flow = {
    components: [{ id: 'box', type: 'container', children: [{ id: 'p', type: 'pr', props: { status: 'merged', title: 'X' } }] }],
  };
  assert.equal(flowCardType(flow), 'pr');
  assert.equal(flowCardLabel(flow), '🔀 PR · merged · X');
});

test('fallback: fallbackText, then title, then card label, never "Flow JSON"', () => {
  const pr = card('pr', { status: 'merged', title: 'X' });
  assert.equal(flowFallbackLabel({ ...pr, data: { fallbackText: '  Custom  text ' } }), 'Custom text');
  assert.equal(flowFallbackLabel({ ...pr, title: 'Card title' }), 'Card title');
  assert.equal(flowFallbackLabel(pr), '🔀 PR · merged · X');
  assert.equal(flowFallbackLabel(card('text', { content: '' })), GENERIC_FLOW_CARD_LABEL);
  assert.equal(flowFallbackLabel(null), GENERIC_FLOW_CARD_LABEL);
  assert.notEqual(flowFallbackLabel({}), 'Flow JSON');
});

test('decodes the stored message attribute', () => {
  const flow = card('agent', { variant: 'profile', agent: { name: 'Q & A', slug: 'qa' } });
  const decoded = decodeFlowJsonAttribute(asMessage(flow).replace(/&/g, '&amp;').replace(/&amp;quot;/g, '&quot;'));
  assert.equal(flowCardLabel(decoded), '🤖 Shared an agent · Q & A');
  assert.equal(decodeFlowJsonAttribute('<p>plain</p>'), null);
  assert.equal(decodeFlowJsonAttribute('<div data-flow-json="{not json">x</div>'), null);
});

test('cards with no label fall back to their visible text', () => {
  const flow = components => ({ components });
  assert.equal(
    flowFallbackLabel(flow([{ id: 'h', type: 'heading', props: { content: 'Weekly report' } }])),
    'Weekly report',
  );
  assert.equal(
    flowFallbackLabel(flow([{ id: 't', type: 'table', props: { rows: [['Name', 'Owner'], ['a', 'b']] } }])),
    'Name · Owner',
  );
  assert.equal(
    flowFallbackLabel(flow([{ id: 'l', type: 'link', props: { href: 'https://x.dev', label: 'Open dashboard' } }])),
    'Open dashboard',
  );
  assert.equal(
    flowFallbackLabel(flow([{ id: 'i', type: 'image', props: { src: 'x.png', alt: 'Latency graph' } }])),
    'Latency graph',
  );
  assert.equal(
    flowFallbackLabel(
      flow([
        {
          id: 's',
          type: 'slash_command_artifact',
          props: {},
          children: [{ id: 'b', type: 'text', props: { content: 'Incident declared: login down' } }],
        },
      ]),
    ),
    'Incident declared: login down',
  );
  assert.equal(flowFallbackLabel(flow([{ id: 'd', type: 'divider' }])), GENERIC_FLOW_CARD_LABEL);
});

test('visible text is capped', () => {
  const long = 'x'.repeat(500);
  const out = flowVisibleText({ components: [{ id: 't', type: 'text', props: { content: long } }] });
  assert.equal(out.length, 200);
  assert.ok(out.endsWith('…'));
});
