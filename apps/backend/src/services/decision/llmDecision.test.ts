jest.mock('@framework', () => ({ LLMClient: jest.fn(), createUserMessage: jest.fn() }), { virtual: true });
jest.mock('@/config/env', () => ({ config: { litellm: { baseUrl: '', apiKey: '' } } }));

import { parseLlmAnswers } from './llmDecision';

const questions = {
  urgent: { type: 'noul' as const, instructions: 'Urgent?' },
  team: { type: 'choice' as const, instructions: 'Team?', criteria: { billing: 'Billing', tech: 'Tech' } },
  priority: { type: 'score' as const, instructions: 'Priority?', criteria: ['LOW', 'MEDIUM', 'HIGH'] },
};

describe('parseLlmAnswers', () => {
  it('reads each question type in XOR form', () => {
    const reply = '<think>hmm</think>```json\n{"answers": {"urgent": {"noul": 0.8}, "team": {"choice": "tech"}, "priority": {"level": 2}}}\n```';
    expect(parseLlmAnswers(reply, questions)).toEqual({
      urgent: { type: 'noul', noul: 0.8 },
      team: { type: 'choice', choice: 'tech', probabilities: {} },
      priority: { type: 'score', score: 1, level: 2 },
    });
  });

  it('reads bare values when the model skips the wrapper objects', () => {
    const reply = '```json\n{"answers": {"urgent": 0, "team": "tech", "priority": 2}}\n```';
    expect(parseLlmAnswers(reply, questions)).toEqual({
      urgent: { type: 'noul', noul: 0 },
      team: { type: 'choice', choice: 'tech', probabilities: {} },
      priority: { type: 'score', score: 1, level: 2 },
    });
    expect(parseLlmAnswers('{"answers": {"urgent": "yes"}}', questions)).toEqual({ urgent: { type: 'noul', noul: 1 } });
  });

  it('drops answers outside the question, keeping the rest', () => {
    const reply = '{"answers": {"urgent": {"noul": 2}, "team": {"choice": "constructor"}, "priority": {"level": 1}}}';
    expect(parseLlmAnswers(reply, questions)).toEqual({ priority: { type: 'score', score: 0.5, level: 1 } });
  });

  it('is null when nothing is usable', () => {
    expect(parseLlmAnswers('no json here', questions)).toBeNull();
    expect(parseLlmAnswers('{"answers": {}}', questions)).toBeNull();
  });
});
