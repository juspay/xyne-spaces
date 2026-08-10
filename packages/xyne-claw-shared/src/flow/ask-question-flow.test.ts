import { describe, it, expect } from 'vitest';
import { buildAskQuestionFlow, ASK_QUESTION_COMPONENT_ID } from './ask-question-flow.js';

describe('buildAskQuestionFlow', () => {
  const context = {
    questionId: 'q-1',
    agentSlug: 'test-agent',
    channelId: 'chan-1',
    conversationId: 'conv-1',
    userId: 'user-1',
  };

  it('produces a pending ask_question flow with the correct shape', () => {
    const flow = buildAskQuestionFlow('Which colour?', ['Red', 'Blue'], context);
    expect(flow.version).toBe('2.0');
    expect(flow.screenId).toBe('agent-question-q-1');

    const comp = flow.components[0];
    expect(comp.id).toBe(ASK_QUESTION_COMPONENT_ID);
    expect(comp.type).toBe('ask_question');
    expect(comp.props).toEqual({
      phase: 'pending',
      question: 'Which colour?',
      options: ['Red', 'Blue'],
    });
    expect(flow.data).toEqual({
      actionType: 'user-answer',
      questionId: 'q-1',
      agentSlug: 'test-agent',
      channelId: 'chan-1',
      conversationId: 'conv-1',
      userId: 'user-1',
    });
  });

  it('produces an answered ask_question flow with the correct shape', () => {
    const flow = buildAskQuestionFlow('Which colour?', ['Red', 'Blue'], context, {
      phase: 'answered',
      answer: 'Blue',
      answeredBy: 'Alice',
      answeredAt: '2026-07-31T20:00:00Z',
    });

    const comp = flow.components[0];
    expect(comp.props).toEqual({
      phase: 'answered',
      question: 'Which colour?',
      answer: 'Blue',
      answeredBy: 'Alice',
      answeredAt: '2026-07-31T20:00:00Z',
    });
  });
});
