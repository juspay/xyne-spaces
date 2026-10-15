import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ToolInvocation, TurnPart } from '@/src/features/xyne-ai/api/xyneAIEvents';
import {
  formatSeconds,
  groupTurnParts,
  humanizeToolName,
  liveActivity,
  previewOf,
  readableResult,
  summarizeSteps,
  turnDurationLabel,
  type StepPart,
} from '@/src/features/xyne-ai/model/turnTimeline';

const call = (
  id: string,
  toolName: string,
  extra: Partial<ToolInvocation> = {},
): ToolInvocation => ({
  toolCallId: id,
  toolName,
  args: {},
  status: 'completed',
  durationMs: 0,
  ...extra,
});
const lookup = (...calls: ToolInvocation[]): Map<string, ToolInvocation> =>
  new Map(calls.map(c => [c.toolCallId ?? '', c]));

describe('humanizeToolName', () => {
  it('drops the server prefix and title-cases', () => {
    assert.equal(humanizeToolName('Xyne_Spaces__spaces-tickets'), 'Spaces Tickets');
    assert.equal(humanizeToolName('web_search'), 'Web Search');
    assert.equal(humanizeToolName(undefined), '');
  });
});

describe('formatSeconds', () => {
  it('uses seconds, then minutes', () => {
    assert.equal(formatSeconds(200), '1s');
    assert.equal(formatSeconds(4200), '4s');
    assert.equal(formatSeconds(151_000), '2m 31s');
  });
});

describe('summarizeSteps', () => {
  const steps: StepPart[] = [
    { type: 'reasoning', id: 'r', text: '', startedAt: 0, endedAt: 4000 },
    { type: 'tool', id: 'a' },
    { type: 'tool', id: 'b' },
    { type: 'tool', id: 'c' },
  ];

  it('names thinking time and each tool once by how it was used', () => {
    const calls = lookup(
      call('a', 'web_search'),
      call('b', 'create_ticket', { status: 'error' }),
      call('c', 'web_search'),
    );
    assert.deepEqual(summarizeSteps(steps, calls), {
      label: 'Thought for 4s, explored Web Search, used Create Ticket',
      failed: 1,
    });
  });

  it('lists a few names and counts the rest', () => {
    const many: StepPart[] = ['a', 'b', 'c', 'd'].map(id => ({ type: 'tool', id }));
    const calls = lookup(...['a', 'b', 'c', 'd'].map(id => call(id, `create_${id}`)));
    assert.equal(summarizeSteps(many, calls).label, 'Used Create A, Create B and 2 more');
  });

  it('falls back when nothing is known', () => {
    assert.equal(summarizeSteps([], lookup()).label, 'Steps');
  });
});

describe('liveActivity', () => {
  it('shows thinking, else the running call', () => {
    const calls = lookup(call('a', 'web_search', { status: 'running' }), call('b', 'read_file'));
    assert.equal(liveActivity([{ type: 'reasoning', id: 'r', text: '' }], calls), 'Thinking');
    assert.equal(
      liveActivity(
        [
          { type: 'tool', id: 'a' },
          { type: 'tool', id: 'b' },
        ],
        calls,
      ),
      'Web Search',
    );
  });
});

describe('groupTurnParts', () => {
  it('folds runs of steps between texts and drops hidden parts', () => {
    const parts: TurnPart[] = [
      { type: 'reasoning', id: 'r', text: 'x' },
      { type: 'tool', id: 'a' },
      { type: 'tool', id: 'unknown' },
      { type: 'text', id: 't1', text: 'draft', superseded: true },
      { type: 'text', id: 't2', text: 'answer' },
      { type: 'tool', id: 'a' },
    ];
    const segments = groupTurnParts(parts, id => id === 'a');
    assert.deepEqual(
      segments.map(segment => segment.kind),
      ['steps', 'text', 'steps'],
    );
    assert.equal(segments[0]?.kind === 'steps' && segments[0].parts.length, 2);
  });
});

describe('turnDurationLabel', () => {
  it('reads as worked or stopped', () => {
    assert.equal(turnDurationLabel(12_000, false), 'Worked for 12s');
    assert.equal(turnDurationLabel(12_000, true), 'Stopped after 12s');
    assert.equal(turnDurationLabel(undefined, false), null);
  });
});

describe('tool detail', () => {
  it('previews the most telling argument', () => {
    assert.deepEqual(previewOf({ query: ' cats ', url: 'u' }), { key: 'query', text: 'cats' });
    assert.equal(previewOf({ n: 1 }), null);
  });

  it('unwraps an MCP content envelope', () => {
    const wrapped = JSON.stringify({ content: [{ type: 'text', text: 'a' }, { type: 'image' }] });
    assert.equal(readableResult(wrapped), 'a');
    assert.equal(readableResult('plain'), 'plain');
  });
});
