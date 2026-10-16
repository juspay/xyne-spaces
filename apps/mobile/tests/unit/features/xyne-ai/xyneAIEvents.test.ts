import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeLiveEvent, decodeStreamEvent } from '@/src/features/xyne-ai/api/xyneAIEvents';

const decode = (data: unknown): ReturnType<typeof decodeStreamEvent> =>
  decodeStreamEvent(JSON.stringify(data));

const invocation = { toolName: 'search', args: {}, status: 'running', durationMs: 0 };

describe('decodeStreamEvent', () => {
  it('decodes text and reasoning deltas', () => {
    assert.deepEqual(decode({ type: 'delta', content: 'Hel' }), {
      type: 'text',
      delta: 'Hel',
      partId: undefined,
    });
    assert.deepEqual(decode({ type: 'content', content: 'lo' }), {
      type: 'text',
      delta: 'lo',
      partId: undefined,
    });
    assert.deepEqual(decode({ type: 'reasoning_delta', reasoningDelta: 'hmm' }), {
      type: 'reasoning',
      delta: 'hmm',
      partId: undefined,
    });
    assert.deepEqual(decode({ type: 'delta', content: 'x', partId: 'p1' }), {
      type: 'text',
      delta: 'x',
      partId: 'p1',
    });
  });

  it('decodes the start event with its session and trace ids', () => {
    assert.deepEqual(decode({ type: 'start', sessionId: 's1', traceId: 't1' }), {
      type: 'start',
      sessionId: 's1',
      traceId: 't1',
    });
  });

  it('decodes tool invocations but drops follow-up bookkeeping tools', () => {
    assert.deepEqual(decode({ type: 'tool_invocation', toolInvocation: invocation }), {
      type: 'tool',
      invocation,
    });
    assert.equal(
      decode({
        type: 'tool_invocation',
        toolInvocation: { ...invocation, toolName: 'internal-follow-up-diagnostics' },
      }),
      null,
    );
    assert.equal(
      decode({
        type: 'tool_invocation',
        toolInvocation: {
          ...invocation,
          toolName: 'ask-user-question',
          args: { purpose: 'follow_up_suggestions' },
        },
      }),
      null,
    );
  });

  it('decodes complete and done the same way', () => {
    const data = {
      content: 'Final',
      messageId: 'm1',
      userMessageId: 'u1',
      followUpSuggestions: ['Next?', ' ', 3],
    };
    const expected = {
      type: 'complete',
      content: 'Final',
      messageId: 'm1',
      userMessageId: 'u1',
      followUps: ['Next?'],
      durationMs: undefined,
      parts: undefined,
      userTags: undefined,
      attachments: [],
      pendingActions: [],
    };
    assert.deepEqual(decode({ type: 'complete', ...data }), expected);
    assert.deepEqual(decode({ type: 'done', ...data }), expected);
  });

  it('decodes the server parts and duration of a finished turn', () => {
    const event = decode({
      type: 'complete',
      durationMs: 4200,
      parts: [
        { type: 'reasoning', id: 'r', text: 'hm', startedAt: '2026-01-01T00:00:00Z' },
        { type: 'text', id: 't', text: 'draft', superseded: true },
        { type: 'tool', id: 'c' },
        { type: 'bogus', id: 'x' },
      ],
    });
    assert.ok(event?.type === 'complete');
    assert.equal(event.durationMs, 4200);
    assert.deepEqual(event.parts, [
      { type: 'reasoning', id: 'r', text: 'hm', startedAt: Date.parse('2026-01-01T00:00:00Z') },
      { type: 'text', id: 't', text: 'draft', superseded: true },
      { type: 'tool', id: 'c' },
    ]);
  });

  it('decodes streamed and stored attachments, keeping a generated app as a reference', () => {
    const event = decode({
      type: 'complete',
      attachments: [
        { fileName: 'a.pdf', mimeType: 'application/pdf', data: 'QUJD' },
        { id: 'att1', originalFilename: 'b.png', mimeType: 'image/png' },
        {
          id: 'att2',
          originalFilename: 'artifact.json',
          mimeType: 'application/json',
          data: 'e30=',
          metadata: { reactArtifact: { title: 'Tracker', appId: 'app1' } },
        },
        {
          id: 'att3',
          originalFilename: 'orphan.json',
          mimeType: 'application/json',
          metadata: { reactArtifact: { title: 'Old' } },
        },
        { mimeType: 'image/png' },
      ],
    });
    assert.ok(event?.type === 'complete');
    assert.deepEqual(event.attachments, [
      {
        id: undefined,
        filename: 'a.pdf',
        mimeType: 'application/pdf',
        data: 'QUJD',
        app: undefined,
      },
      { id: 'att1', filename: 'b.png', mimeType: 'image/png', data: undefined, app: undefined },
      {
        id: 'att2',
        filename: 'artifact.json',
        mimeType: 'application/json',
        data: undefined,
        app: { id: 'app1', title: 'Tracker' },
      },
    ]);
  });

  it('decodes pending actions and drops ones that cannot be answered', () => {
    const action = {
      id: 'p1',
      serverType: 'mcp',
      tool: 'send-email',
      params: { to: 'a' },
      signature: 's',
    };
    const event = decode({
      type: 'complete',
      pendingActions: [action, { ...action, id: 'p2', resolution: 'declined' }, { tool: 'x' }],
    });
    assert.ok(event?.type === 'complete');
    assert.deepEqual(event.pendingActions, [
      { ...action, resolution: undefined },
      { ...action, id: 'p2', resolution: 'declined' },
    ]);
  });

  it('reads the error status from either field', () => {
    assert.deepEqual(decode({ type: 'error', error: 'Too many requests', statusCode: 429 }), {
      type: 'error',
      message: 'Too many requests',
      httpStatus: 429,
    });
  });

  it('skips heartbeats, unknown types, empty deltas and malformed frames', () => {
    assert.equal(decode({ type: 'ping' }), null);
    assert.equal(decode({ type: 'debug_event' }), null);
    assert.equal(decode({ type: 'delta', content: '' }), null);
    assert.equal(decode([1]), null);
    assert.equal(decodeStreamEvent('{not json'), null);
  });

  it('decodes the userTags of a completed run, ignoring malformed entries', () => {
    const tags = { '<Ada Lovelace>': { name: 'Ada Lovelace', userId: 'u1' }, bad: 'x' };
    assert.deepEqual(
      (decode({ type: 'complete', output: { userTags: tags } }) as { userTags: unknown }).userTags,
      { '<Ada Lovelace>': { name: 'Ada Lovelace', userId: 'u1' } },
    );
  });
});

describe('decodeLiveEvent', () => {
  const live = (name: string, data: unknown): ReturnType<typeof decodeLiveEvent> =>
    decodeLiveEvent(name, JSON.stringify(data));

  it('reports an empty snapshot as no live run', () => {
    assert.deepEqual(live('snapshot', {}), { events: [], ended: true, isSnapshot: true });
    assert.deepEqual(live('snapshot', { inProgress: [] }), {
      events: [],
      ended: true,
      isSnapshot: true,
    });
  });

  it('turns a snapshot into the progress so far', () => {
    const toolInvocation = { toolName: 'search', toolCallId: 'c1', args: {}, status: 'running' };
    assert.deepEqual(
      live('snapshot', {
        partial: { msgId: 'm1', content: 'Hello', reasoning: 'Hmm' },
        inProgress: [toolInvocation],
      }),
      {
        ended: false,
        isSnapshot: true,
        events: [
          { type: 'reasoning', delta: 'Hmm', partId: 'live-reasoning' },
          { type: 'text', delta: 'Hello', partId: 'live-text' },
          { type: 'tool', invocation: toolInvocation },
        ],
      },
    );
  });

  it('decodes deltas, reasoning, invocations and plans', () => {
    assert.deepEqual(live('delta', { textDelta: 'a', reasoningDelta: 'b' }).events, [
      { type: 'reasoning', delta: 'b', partId: 'live-reasoning' },
      { type: 'text', delta: 'a', partId: 'live-text' },
    ]);
    assert.deepEqual(live('reasoning', { delta: 'x' }).events, [
      { type: 'reasoning', delta: 'x', partId: 'live-reasoning' },
    ]);
    assert.equal(live('invocation', { toolInvocation: { toolName: 'search' } }).events.length, 1);
    assert.deepEqual(live('plan', { title: 'Plan', todos: [] }).events, [
      { type: 'plan', title: 'Plan', todos: [] },
    ]);
  });

  it('ends on done or when live updates are disabled, and ignores the rest', () => {
    assert.equal(live('done', {}).ended, true);
    assert.equal(live('live-disabled', {}).ended, true);
    assert.deepEqual(live('label', { toolLabel: 'Searching' }), { events: [], ended: false });
    assert.deepEqual(decodeLiveEvent('delta', '{not json'), { events: [], ended: false });
  });

  it("replays the running message's flow cards from the snapshot", () => {
    const flow = { screenId: 'plan-1', components: [] };
    const { events } = live('snapshot', {
      partial: { msgId: 'm1' },
      uiFlowsByMsgId: { m1: [flow, { title: 'no screen' }], other: [{ screenId: 'x' }] },
    });
    assert.deepEqual(events, [{ type: 'uiFlow', flow }]);
    assert.deepEqual(live('ui-flow', { flow }).events, [{ type: 'uiFlow', flow }]);
    assert.deepEqual(live('ui-flow', {}).events, []);
  });
});

describe('decodeStreamEvent ui_flow', () => {
  it('keeps a card that has a screen id and drops the rest', () => {
    const flow = { screenId: 's1', components: [] };
    assert.deepEqual(decode({ type: 'ui_flow', flow }), { type: 'uiFlow', flow });
    assert.equal(decode({ type: 'ui_flow', flow: {} }), null);
    assert.equal(decode({ type: 'ui_flow' }), null);
  });
});
