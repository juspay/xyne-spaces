import test from 'node:test';
import assert from 'node:assert/strict';

// The built module, as consumers resolve it (see agentCardFlowSchema.test.mjs).
import {
  applyPartDelta,
  applyToolPart,
  closeAssistantParts,
  groupTurnParts,
  legacyParts,
  normalizeAssistantParts,
} from '../dist/ai/assistantParts.js';

const fold = (events) =>
  events.reduce(
    (parts, e) => (e.tool ? applyToolPart(parts, e.tool, e.at) : applyPartDelta(parts, e)),
    [],
  );

test('keeps thinking, text and tools in the order they streamed, across LLM calls', () => {
  const parts = fold([
    { type: 'reasoning', partId: '1:0', delta: 'Plan the ', at: 't0' },
    { type: 'reasoning', partId: '1:0', delta: 'search.', at: 't1' },
    { type: 'text', partId: '1:1', delta: 'Let me look.', at: 't2' },
    { tool: { toolCallId: 'a' }, at: 't3' },
    { tool: { toolCallId: 'b' }, at: 't3' },
    { tool: { toolCallId: 'a' }, at: 't4' }, // the same call finishing
    { tool: { toolCallId: 'c', parentToolCallId: 'b' }, at: 't4' }, // a subagent's call
    { type: 'reasoning', partId: '2:0', delta: 'Compare results.', at: 't5' },
    { type: 'text', partId: '2:1', delta: 'Answer', at: 't6' },
    { type: 'text', partId: '2:1', delta: '.', at: 't7' },
  ]);
  assert.deepEqual(
    parts.map(p => [p.type, p.id, p.type === 'tool' ? '' : p.text]),
    [
      ['reasoning', '1:0', 'Plan the search.'],
      ['text', '1:1', 'Let me look.'],
      ['tool', 'a', ''],
      ['tool', 'b', ''],
      ['reasoning', '2:0', 'Compare results.'],
      ['text', '2:1', 'Answer.'],
    ],
  );
  assert.equal(parts[0].startedAt, 't0');
  assert.equal(parts[0].endedAt, 't2', 'thinking ends when the next part starts');
});

test('without part ids (an older server) a new part starts when the type changes', () => {
  const parts = fold([
    { type: 'reasoning', delta: 'a' },
    { type: 'reasoning', delta: 'b' },
    { type: 'text', delta: 'c' },
    { tool: { toolCallId: 't1' } },
    { type: 'text', delta: 'd' },
  ]);
  assert.deepEqual(parts.map(p => [p.type, p.type === 'tool' ? p.id : p.text]), [
    ['reasoning', 'ab'],
    ['text', 'c'],
    ['tool', 't1'],
    ['text', 'd'],
  ]);
});

test('never mutates its input', () => {
  const before = [{ type: 'text', id: 'x', text: 'hi' }];
  const frozen = JSON.stringify(before);
  applyPartDelta(before, { type: 'text', partId: 'x', delta: '!' });
  applyToolPart(before, { toolCallId: 't' });
  assert.equal(JSON.stringify(before), frozen);
});

test('groups each run of thinking + tools between texts, dropping superseded drafts', () => {
  const segments = groupTurnParts([
    { type: 'reasoning', id: 'r1', text: 'think' },
    { type: 'text', id: 't1', text: 'Let me check.' },
    { type: 'tool', id: 'a' },
    { type: 'reasoning', id: 'r2', text: 'more' },
    { type: 'tool', id: 'b' },
    { type: 'text', id: 't2', text: 'Draft without citations', superseded: true },
    { type: 'reasoning', id: 'r3', text: 'fix citations' },
    { type: 'text', id: 't3', text: 'Final [1]' },
    { type: 'text', id: 't4', text: '   ' },
  ]);
  assert.deepEqual(
    segments.map(s => (s.kind === 'text' ? `text:${s.part.id}` : `steps:${s.parts.map(p => p.id).join(',')}`)),
    ['steps:r1', 'text:t1', 'steps:a,r2,b,r3', 'text:t3'],
  );
});

test('legacy messages render as thinking, tools, then the answer', () => {
  assert.deepEqual(
    legacyParts({ reasoning: 'why', toolCallIds: ['a', 'b'], content: 'answer' }).map(p => p.type),
    ['reasoning', 'tool', 'tool', 'text'],
  );
  assert.deepEqual(legacyParts({ content: 'just text' }).map(p => p.type), ['text']);
});

test('closing the turn stamps thinking still open', () => {
  const parts = closeAssistantParts(
    [
      { type: 'reasoning', id: '1', text: 'one', startedAt: 'a', endedAt: 'b' },
      { type: 'text', id: '2', text: 'x' },
      { type: 'reasoning', id: '3', text: 'two', startedAt: 'c' },
    ],
    'end',
  );
  assert.equal(parts[0].endedAt, 'b');
  assert.equal(parts[2].endedAt, 'end');
});

test('normalizeAssistantParts keeps only well-formed parts', () => {
  assert.equal(normalizeAssistantParts(null), null);
  assert.equal(normalizeAssistantParts([{ type: 'bogus', id: 'x' }]), null);
  assert.deepEqual(
    normalizeAssistantParts([
      { type: 'text', id: 't', text: 'hi', extra: 1 },
      { type: 'tool' },
      { type: 'tool', id: 'a' },
      { type: 'reasoning', id: 'r', text: 'x', startedAt: 's', endedAt: 5 },
    ]),
    [
      { type: 'text', id: 't', text: 'hi' },
      { type: 'tool', id: 'a' },
      { type: 'reasoning', id: 'r', text: 'x', startedAt: 's' },
    ],
  );
});
