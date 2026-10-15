import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ToolInvocation, XyneAIEvent } from '@/src/features/xyne-ai/api/xyneAIEvents';
import {
  answerText,
  reduceAssistantTurn,
  settleAssistantTurn,
  startAssistantTurn,
  type AssistantTurn,
} from '@/src/features/xyne-ai/model/assistantTurn';

const replay = (...events: XyneAIEvent[]): AssistantTurn =>
  events.reduce(
    (turn, event, i) => reduceAssistantTurn(turn, event, 1000 + i * 1000),
    startAssistantTurn(0),
  );

const text = (delta: string, partId?: string): XyneAIEvent => ({ type: 'text', delta, partId });
const thought = (delta: string): XyneAIEvent => ({ type: 'reasoning', delta, partId: undefined });
const tool = (overrides: Partial<ToolInvocation>): XyneAIEvent => ({
  type: 'tool',
  invocation: { toolName: 'search', args: {}, status: 'running', durationMs: 0, ...overrides },
});
const complete = (content: string | undefined, extra: Partial<XyneAIEvent> = {}): XyneAIEvent =>
  ({
    type: 'complete',
    content,
    messageId: 'm1',
    userMessageId: 'u1',
    followUps: [],
    durationMs: undefined,
    parts: undefined,
    ...extra,
  }) as XyneAIEvent;

describe('reduceAssistantTurn', () => {
  it('keeps thinking, text and tool calls in arrival order, merging same-kind deltas', () => {
    const turn = replay(
      thought('Think'),
      thought('ing'),
      tool({ toolCallId: 'a' }),
      tool({ toolCallId: 'a', status: 'completed' }),
      text('Hel'),
      text('lo'),
    );
    assert.deepEqual(
      turn.parts.map(part => part.type),
      ['reasoning', 'tool', 'text'],
    );
    assert.equal(answerText(turn), 'Hello');
    assert.deepEqual(turn.parts[0], {
      type: 'reasoning',
      id: 'reasoning-0',
      text: 'Thinking',
      startedAt: 1000,
      endedAt: 3000,
    });
    assert.equal(turn.tools[0]?.status, 'completed');
  });

  it('merges by partId and ignores subagent calls as parts', () => {
    const turn = replay(
      text('a', 'p1'),
      thought('b'),
      text('c', 'p1'),
      tool({ toolCallId: 'child', parentToolCallId: 'a' }),
    );
    assert.equal(turn.parts.length, 2);
    assert.equal(turn.parts[0]?.type === 'text' && turn.parts[0].text, 'ac');
    assert.equal(turn.tools.length, 1);
  });

  it('takes the final content over streamed text and the server parts over both', () => {
    assert.equal(
      answerText(replay(text('partial **bo'), complete('final **bold**'))),
      'final **bold**',
    );
    assert.equal(answerText(replay(text('streamed'), complete(undefined))), 'streamed');
    const server = replay(
      text('streamed'),
      complete('x', {
        parts: [
          { type: 'text', id: 't1', text: 'draft', superseded: true },
          { type: 'text', id: 't2', text: 'rewrite' },
        ],
      } as Partial<XyneAIEvent>),
    );
    assert.equal(answerText(server), 'rewrite');
  });

  it('records message ids and the turn duration', () => {
    const turn = replay(text('Hi'), complete('Hi'));
    assert.equal(turn.userMessageId, 'u1');
    assert.equal(turn.messageId, 'm1');
    assert.equal(turn.durationMs, 2000);
    assert.equal(replay(complete('Hi', { durationMs: 42 } as Partial<XyneAIEvent>)).durationMs, 42);
  });

  it('takes follow-ups that arrive after completion', () => {
    const turn = replay(complete('Done'), { type: 'followUps', suggestions: ['Tell me more'] });
    assert.deepEqual(turn.followUps, ['Tell me more']);
  });

  it('keeps the partial answer and stops running calls when the stream fails', () => {
    const turn = replay(text('Half'), tool({ toolCallId: 'a' }), {
      type: 'error',
      message: 'Overloaded',
      httpStatus: 503,
    });
    assert.equal(turn.status, 'error');
    assert.equal(answerText(turn), 'Half');
    assert.equal(turn.error?.title, 'Model service unavailable');
    assert.equal(turn.tools[0]?.status, 'stopped');
  });
});

describe('settleAssistantTurn', () => {
  const streaming = replay(thought('hm'), text('partial'));

  it('completes a turn whose stream closed without a complete event', () => {
    const turn = settleAssistantTurn(streaming, { kind: 'closed' }, 9000);
    assert.equal(turn.status, 'complete');
    assert.equal(turn.durationMs, 9000);
  });

  it('marks a cancelled turn as stopped and keeps its text', () => {
    const turn = settleAssistantTurn(streaming, { kind: 'stopped' }, 9000);
    assert.equal(turn.status, 'stopped');
    assert.equal(answerText(turn), 'partial');
  });

  it('explains a failed stream from its HTTP status', () => {
    const turn = settleAssistantTurn(streaming, { kind: 'failed', httpStatus: 401 }, 9000);
    assert.equal(turn.error?.message, 'Your session expired. Sign in again.');
  });

  it('leaves a turn the server already finished unchanged', () => {
    const done = replay(complete('Done'));
    assert.equal(settleAssistantTurn(done, { kind: 'failed', httpStatus: 500 }, 9000), done);
  });
});
