const mockEnv = {
  decisionEngine: 'xor' as 'xor' | 'jev' | 'llm',
  jev: { apiKey: '', url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0' },
  xor: { apiKey: '', url: '', model: 'xor-latest' },
  litellm: { baseUrl: 'https://litellm', apiKey: 'litellm-key' },
  otel: { serviceName: 'test' },
};
const mockRequestJevAnswers = jest.fn();
const mockRecordRun = jest.fn();
const mockRecordAgreement = jest.fn();
const mockRequestLlmAnswers = jest.fn();
const mockEnqueue = jest.fn();

jest.mock('@/config/env', () => ({ config: mockEnv }));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
jest.mock('@/services/queryIntent/jevClient', () => ({
  ...jest.requireActual('@/services/queryIntent/jevClient'),
  requestJevAnswers: (...args: unknown[]) => mockRequestJevAnswers(...args),
  isPrivateJevConfigured: () => Boolean(mockEnv.jev.apiKey && process.env.JEV_URL),
}));
jest.mock('./llmDecision', () => ({
  LLM_DECISION_MODEL: 'llm-test',
  isLlmDecisionConfigured: () => true,
  requestLlmAnswers: (...args: unknown[]) => mockRequestLlmAnswers(...args),
}));
jest.mock('@/services/otel/decisionMetrics', () => ({
  confidenceBucket: jest.requireActual('@/services/otel/decisionMetrics').confidenceBucket,
  recordRun: (...args: unknown[]) => mockRecordRun(...args),
  recordAgreement: (...args: unknown[]) => mockRecordAgreement(...args),
}));
jest.mock('@/queues/decisionEvaluationQueue', () => ({
  COMPARE_JOB: 'compare-xor',
  EVALUATE_JOB: 'evaluate-task',
  decisionEvaluationQueue: { add: (...args: unknown[]) => mockEnqueue(...args) },
}));

import type { AgentsConfig } from '@/agents/config';
import { decide } from './decide';
import { compare, evaluate } from './evaluation';
import { answerConfidence } from './engines';
import { confidenceBucket } from '@/services/otel/decisionMetrics';
import { classifierTarget, isComparisonEngineAvailable, isPrivateDecisionEngineConfigured } from './targets';
import { askDecision } from './ask';
import type { ComparedAnswer, DecisionTask } from './types';

const XOR = { url: 'https://litellm/v1/decisions', apiKey: 'xor-key', model: 'xor-latest' };
const JEV = { url: 'https://jev.internal/v1/systemone', apiKey: 'jev-key', model: 'jev-1.13.0' };

const agentsConfig = (xorSwitch: boolean) =>
  ({ priorityClassificationXorEnabled: xorSwitch, classificationXorEnabled: false }) as AgentsConfig;

/** A two-level priority task whose LLM answers with `llm`. */
const priorityTask = (llm: () => Promise<string | null>): DecisionTask<string> => ({
  feature: 'email_priority',
  input: { channelId: 'channel-1', emailSubject: 's', emailBody: 'b', modelName: 'glm' },
  question: { state: 'email', questions: { priority: { type: 'score', instructions: 'p', criteria: ['LOW', 'HIGH'] } } },
  readAnswers: ({ priority }) => (priority?.type === 'score' ? ['LOW', 'HIGH'][priority.level] : null),
  askLlm: async () => ({ answer: await llm(), model: 'glm', usage: { promptTokens: 10, completionTokens: 2 } }),
  toLabel: (answer) => answer,
});

const scoreAnswer = (level: number) => ({ priority: { type: 'score', score: level, level } });

/** The single job queued so far, as the worker would get it. */
const queuedJob = () => {
  expect(mockEnqueue).toHaveBeenCalledTimes(1);
  const [name, data] = mockEnqueue.mock.calls[0];
  return { name, data: JSON.parse(JSON.stringify(data)) };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEnv.decisionEngine = 'xor';
  mockEnv.jev = { apiKey: '', url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0' };
  mockEnv.xor = { apiKey: '', url: '', model: 'xor-latest' };
  delete process.env.JEV_URL;
});

describe('targets', () => {
  it('uses XOR_* when set', () => {
    mockEnv.xor = { ...XOR };
    expect(classifierTarget('xor')).toEqual(XOR);
    expect(isPrivateDecisionEngineConfigured()).toBe(true);
  });

  it('falls back to an explicitly set JEV_* for XOR, and then does not compare it with itself', () => {
    mockEnv.jev = { ...XOR };
    process.env.JEV_URL = XOR.url;
    expect(classifierTarget('xor')).toEqual(XOR);
    expect(isPrivateDecisionEngineConfigured()).toBe(true);
    expect(isComparisonEngineAvailable('jev', 'xor')).toBe(false);
  });

  it('compares XOR and Jev once they point at different services', () => {
    mockEnv.xor = { ...XOR };
    mockEnv.jev = { ...JEV };
    process.env.JEV_URL = JEV.url;
    expect(classifierTarget('xor')).toEqual(XOR);
    expect(classifierTarget('jev')).toEqual(JEV);
    expect(isComparisonEngineAvailable('jev', 'xor')).toBe(true);
  });

  it('falls back to the default JEV_* for XOR, but not for customer content', () => {
    mockEnv.jev = { ...JEV };
    expect(classifierTarget('xor')).toEqual(JEV);
    expect(isPrivateDecisionEngineConfigured()).toBe(false);
    expect(isComparisonEngineAvailable('jev', 'xor')).toBe(false);
  });

  it('follows DECISION_ENGINE', () => {
    mockEnv.decisionEngine = 'jev';
    mockEnv.jev = { ...JEV };
    process.env.JEV_URL = JEV.url;
    expect(isPrivateDecisionEngineConfigured()).toBe(true);
    mockEnv.decisionEngine = 'llm';
    expect(isPrivateDecisionEngineConfigured()).toBe(true);
    expect(isComparisonEngineAvailable('jev', 'llm')).toBe(true);
  });
});

describe('decide', () => {
  beforeEach(() => {
    mockEnv.xor = { ...XOR };
  });

  it("answers with XOR when the feature's XOR switch is on", async () => {
    mockRequestJevAnswers.mockResolvedValue(scoreAnswer(1));
    const llm = jest.fn();

    await expect(decide(priorityTask(llm), { agentsConfig: agentsConfig(true) })).resolves.toBe('HIGH');
    expect(llm).not.toHaveBeenCalled();
    expect(mockRequestJevAnswers.mock.calls[0][4].target).toEqual(XOR);
  });

  it('uses only the LLM when the switch is off', async () => {
    const llm = jest.fn().mockResolvedValue('LOW');

    await expect(decide(priorityTask(llm), { agentsConfig: agentsConfig(false) })).resolves.toBe('LOW');
    expect(mockRequestJevAnswers).not.toHaveBeenCalled();
  });

  it('falls back to the LLM when XOR gives no answer', async () => {
    mockRequestJevAnswers.mockResolvedValue(null);
    const llm = jest.fn().mockResolvedValue('LOW');

    await expect(decide(priorityTask(llm), { agentsConfig: agentsConfig(true) })).resolves.toBe('LOW');
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('falls back to the LLM when XOR is not configured', async () => {
    mockEnv.xor = { apiKey: '', url: '', model: 'xor-latest' };
    const llm = jest.fn().mockResolvedValue('LOW');

    await expect(decide(priorityTask(llm), { agentsConfig: agentsConfig(true) })).resolves.toBe('LOW');
    expect(mockRequestJevAnswers).not.toHaveBeenCalled();
  });

  it('rethrows what the LLM threw when it was the live engine', async () => {
    const boom = new Error('litellm down');

    await expect(
      decide(priorityTask(() => Promise.reject(boom)), { agentsConfig: agentsConfig(false) })
    ).rejects.toBe(boom);
  });

  it('queues nothing unless asked to evaluate', async () => {
    mockRequestJevAnswers.mockResolvedValue(scoreAnswer(1));

    await decide(priorityTask(jest.fn()), { agentsConfig: agentsConfig(true) });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('queues the decision with its live answers and returns without waiting on other engines', async () => {
    mockRequestJevAnswers.mockResolvedValue(null);
    const llm = jest.fn().mockResolvedValue('LOW');

    await expect(decide(priorityTask(llm), { agentsConfig: agentsConfig(true), evaluate: true })).resolves.toBe('LOW');
    expect(queuedJob()).toEqual({
      name: 'evaluate-task',
      data: {
        feature: 'email_priority',
        input: { channelId: 'channel-1', emailSubject: 's', emailBody: 'b', modelName: 'glm' },
        liveAnswers: [
          { engine: 'xor', label: null },
          { engine: 'llm', label: 'LOW' },
        ],
      },
    });
  });
});

describe('evaluate (worker)', () => {
  const job = (liveAnswers: ComparedAnswer[]) => ({
    feature: 'email_priority' as const,
    input: { channelId: 'channel-1', emailSubject: 's', emailBody: 'b', modelName: 'glm' },
    liveAnswers,
  });

  beforeEach(() => {
    mockEnv.xor = { ...XOR };
  });

  it('asks every engine that did not answer live and counts agreement per pair', async () => {
    mockEnv.jev = { ...JEV };
    process.env.JEV_URL = JEV.url;
    mockRequestJevAnswers.mockResolvedValue(scoreAnswer(0));

    await evaluate(priorityTask(() => Promise.resolve('HIGH')), job([{ engine: 'xor', label: 'HIGH', confidence: 0.93 }]));

    expect(mockRequestJevAnswers.mock.calls[0][4].target).toEqual(JEV);
    expect(mockRecordRun).toHaveBeenCalledWith('email_priority', expect.objectContaining({ engine: 'jev', answer: 'LOW' }), 'shadow');
    expect(mockRecordRun).toHaveBeenCalledWith('email_priority', expect.objectContaining({ engine: 'llm', answer: 'HIGH' }), 'shadow');
    expect(mockRecordAgreement.mock.calls).toEqual([
      ['email_priority', 'xor_jev', false, '0.90'],
      ['email_priority', 'xor_llm', true, '0.90'],
      ['email_priority', 'jev_llm', false, undefined],
    ]);
  });

  it('does not ask an engine again that already ran live, or one that is not configured', async () => {
    const llm = jest.fn();

    await evaluate(priorityTask(llm), job([{ engine: 'xor', label: null }, { engine: 'llm', label: 'LOW' }]));

    expect(llm).not.toHaveBeenCalled();
    expect(mockRequestJevAnswers).not.toHaveBeenCalled();
    expect(mockRecordAgreement).not.toHaveBeenCalled();
  });
});

describe('askDecision', () => {
  const questions = {
    urgent: { type: 'noul' as const, instructions: 'Urgent?' },
    team: { type: 'choice' as const, instructions: 'Team?', criteria: { billing: 'Billing', tech: 'Tech' } },
  };
  const xorAnswers = {
    urgent: { type: 'noul', noul: 0.9 },
    team: { type: 'choice', choice: 'billing', probabilities: {} },
  };

  beforeEach(() => {
    mockEnv.xor = { ...XOR };
  });

  it('asks XOR, counts the run and queues the call for comparison', async () => {
    mockRequestJevAnswers.mockResolvedValue(xorAnswers);

    await expect(askDecision('assistant_route', 'state', questions, 1_000)).resolves.toEqual(xorAnswers);
    expect(mockRequestJevAnswers).toHaveBeenCalledTimes(1);
    expect(mockRequestJevAnswers.mock.calls[0][4].target).toEqual(XOR);
    expect(mockRecordRun).toHaveBeenCalledWith('assistant_route', expect.objectContaining({ engine: 'xor', outcome: 'answered' }), 'live');
    expect(mockRequestLlmAnswers).not.toHaveBeenCalled();
    expect(queuedJob()).toEqual({ name: 'compare-xor', data: { feature: 'assistant_route', liveEngine: 'xor', state: 'state', questions, liveAnswers: xorAnswers } });
  });

  it('queues nothing when the caller cancelled', async () => {
    const controller = new AbortController();
    mockRequestJevAnswers.mockImplementation(async () => {
      controller.abort();
      return null;
    });

    await askDecision('related_context_gate', 'state', questions, 1_000, controller.signal);
    expect(mockRecordRun).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('answers with the LLM when DECISION_ENGINE is llm, and compares the others against it', async () => {
    mockEnv.decisionEngine = 'llm';
    mockRequestLlmAnswers.mockResolvedValue({ answer: xorAnswers, model: 'glm', usage: { promptTokens: 20, completionTokens: 4 } });

    await expect(askDecision('assistant_route', 'state', questions, 1_000)).resolves.toEqual(xorAnswers);
    expect(mockRequestJevAnswers).not.toHaveBeenCalled();
    expect(mockRequestLlmAnswers).toHaveBeenCalledWith('state', questions, 1_000);
    expect(mockRecordRun).toHaveBeenCalledWith('assistant_route', expect.objectContaining({ engine: 'llm', outcome: 'answered' }), 'live');
    expect(queuedJob().data.liveEngine).toBe('llm');
  });

  it('keeps the all-or-nothing rule for the LLM unless partial', async () => {
    mockEnv.decisionEngine = 'llm';
    mockRequestLlmAnswers.mockResolvedValue({ answer: { urgent: xorAnswers.urgent }, model: 'glm' });

    await expect(askDecision('assistant_route', 'state', questions, 1_000)).resolves.toBeNull();
    await expect(askDecision('assistant_route', 'state', questions, 1_000, undefined, { partial: true })).resolves.toEqual({ urgent: xorAnswers.urgent });
  });

  it('does not call out when XOR has no key', async () => {
    mockEnv.xor = { apiKey: '', url: '', model: 'xor-latest' };

    await expect(askDecision('automation_step', 'state', questions, 1_000)).resolves.toBeNull();
    expect(mockRequestJevAnswers).not.toHaveBeenCalled();
  });
});

describe('compare (worker)', () => {
  const questions = {
    urgent: { type: 'noul' as const, instructions: 'Urgent?' },
    team: { type: 'choice' as const, instructions: 'Team?', criteria: { billing: 'Billing', tech: 'Tech' } },
  };
  const xorAnswers = {
    urgent: { type: 'noul' as const, noul: 0.9 },
    team: { type: 'choice' as const, choice: 'billing', probabilities: {} },
  };

  it('asks the engines that did not answer live and counts agreement per question', async () => {
    mockEnv.xor = { ...XOR };
    mockEnv.jev = { ...JEV };
    process.env.JEV_URL = JEV.url;
    mockRequestJevAnswers.mockResolvedValue({
      urgent: { type: 'noul', noul: 0.2 },
      team: { type: 'choice', choice: 'billing', probabilities: {} },
    });
    mockRequestLlmAnswers.mockResolvedValue({ answer: xorAnswers, model: 'glm', usage: { promptTokens: 50, completionTokens: 5 } });

    await compare({ feature: 'assistant_route', liveEngine: 'xor', state: 'state', questions, liveAnswers: xorAnswers });

    expect(mockRequestJevAnswers.mock.calls[0][4].target).toEqual(JEV);
    expect(mockRequestLlmAnswers).toHaveBeenCalledWith('state', questions, 30_000);
    expect(mockRecordRun).toHaveBeenCalledWith('assistant_route', expect.objectContaining({ engine: 'jev' }), 'shadow');
    expect(mockRecordRun).toHaveBeenCalledWith('assistant_route', expect.objectContaining({ engine: 'llm', promptTokens: 50 }), 'shadow');
    expect(mockRecordAgreement.mock.calls).toEqual([
      ['assistant_route', 'xor_jev', false, '0.90'],
      ['assistant_route', 'xor_llm', true, '0.90'],
      ['assistant_route', 'jev_llm', false, undefined],
      ['assistant_route', 'xor_jev', true, 'unknown'],
      ['assistant_route', 'xor_llm', true, 'unknown'],
      ['assistant_route', 'jev_llm', true, undefined],
    ]);
  });
});

describe('XOR confidence', () => {
  it('is the chosen option or level probability, or a yes/no distance from even', () => {
    expect(answerConfidence({ type: 'noul', noul: 0.2 })).toBe(0.8);
    expect(answerConfidence({ type: 'choice', choice: 'a', probabilities: { a: 0.7, b: 0.3 } })).toBe(0.7);
    expect(answerConfidence({ type: 'choice', choice: 'a', probabilities: { a: 0.7 }, confidence: 0.9 })).toBe(0.9);
    expect(answerConfidence({ type: 'score', score: 1, level: 2 })).toBeUndefined();
  });

  it('is bucketed by lower bound', () => {
    expect([0.99, 0.95, 0.93, 0.85, 0.7, 0.55, undefined].map(confidenceBucket)).toEqual([
      '0.95', '0.95', '0.90', '0.80', '0.60', '0.50', 'unknown',
    ]);
  });
});
