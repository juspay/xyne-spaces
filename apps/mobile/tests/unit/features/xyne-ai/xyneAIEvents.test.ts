import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeStreamEvent } from '@/src/features/xyne-ai/api/xyneAIEvents';

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
});
