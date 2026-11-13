/**
 * The classifier against a stubbed service: what it sends, what it reads back,
 * what it does when the model is unsure, and how it treats each failure.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClassifierAgentStep, ClassifierAgentStepConfigSchema, DEFAULT_CLASSIFIER_ENDPOINT } from './classifier-agent.step.js';
import type { ClassifierAgentStepConfig } from './classifier-agent.step.js';
import type { StepExecutionContext } from '../../../steps/base-step.js';
import { CredentialAuthType } from '../../../common/credentials.js';

const step = new ClassifierAgentStep();

const CLASSES = {
  payments_refunds: 'they ask where a refund is',
  payments_double_charge: 'the same trip was charged twice',
  talk_to_a_person: 'they want a human',
};

function config(over: Partial<ClassifierAgentStepConfig> = {}): ClassifierAgentStepConfig {
  return ClassifierAgentStepConfigSchema.parse({
    input: 'I was charged twice for my ride',
    instructions: 'Which screen answers this message?',
    classes: CLASSES,
    ...over,
  });
}

function ctx(credential?: Record<string, unknown>): StepExecutionContext {
  return { credentials: credential ? { credentialName: credential } : {} } as unknown as StepExecutionContext;
}

/** What the service answers when it is happy. */
function answered(over: { choice?: string; confidence?: number } = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () =>
      JSON.stringify({
        model: 'jev-1.13.0',
        answers: {
          class: {
            type: 'choice',
            choice: over.choice ?? 'payments_double_charge',
            probabilities: { payments_double_charge: 0.81, payments_refunds: 0.11, talk_to_a_person: 0.08 },
            confidence: over.confidence ?? 0.74,
          },
        },
        usage: { input_tokens: 296, output_tokens: 20 },
      }),
  } as unknown as Response;
}

const failed = (status: number, body: unknown) =>
  ({ ok: false, status, statusText: 'Error', text: async () => JSON.stringify(body) }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('CLASSIFIER_AGENT', () => {
  it('asks one choice question, with the classes as its criteria', async () => {
    fetchMock.mockResolvedValue(answered());
    const out = await step.execute(config(), ctx());

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(DEFAULT_CLASSIFIER_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'jev-latest',
      state: 'I was charged twice for my ride',
      questions: {
        class: { type: 'choice', instructions: 'Which screen answers this message?', criteria: CLASSES },
      },
    });
    expect(out).toEqual({
      class: 'payments_double_charge',
      confidence: 0.74,
      probabilities: { payments_double_charge: 0.81, payments_refunds: 0.11, talk_to_a_person: 0.08 },
      belowConfidence: false,
      model: 'jev-1.13.0',
      usage: { inputTokens: 296, outputTokens: 20 },
    });
  });

  // The credential says where the service is and what key it takes, so the same
  // workflow asks another model by pointing at another credential. A literal
  // address keeps the SSRF guard from needing DNS.
  it('asks the service its credential names, with that credential’s key', async () => {
    fetchMock.mockResolvedValue(answered());
    await step.execute(
      config({ input: { message: 'where is my refund', plan: 'pro' }, model: 'ours-1' }),
      ctx({ authType: CredentialAuthType.EndpointKey, values: { endpoint: 'https://93.184.216.34/v1/systemone', apiKey: 'sk-test' } }),
    );
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://93.184.216.34/v1/systemone');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk-test');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'ours-1',
      state: { message: 'where is my refund', plan: 'pro' },
    });
  });

  it('falls back to the default endpoint when no credential is set', async () => {
    fetchMock.mockResolvedValue(answered());
    await step.execute(config(), ctx());
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(DEFAULT_CLASSIFIER_ENDPOINT);
    expect(new Headers(init.headers).has('authorization')).toBe(false);
  });

  it('answers the fallback class when the model is less sure than asked', async () => {
    fetchMock.mockResolvedValue(answered({ confidence: 0.32 }));
    const out = await step.execute(config({ minConfidence: 0.6, fallbackClass: 'talk_to_a_person' }), ctx());
    expect(out.class).toBe('talk_to_a_person');
    expect(out.belowConfidence).toBe(true);
    // What the model actually thought is still there.
    expect(out.probabilities['payments_double_charge']).toBe(0.81);
  });

  it('keeps the model’s pick when it is sure enough', async () => {
    fetchMock.mockResolvedValue(answered({ confidence: 0.91 }));
    const out = await step.execute(config({ minConfidence: 0.6, fallbackClass: 'talk_to_a_person' }), ctx());
    expect(out).toMatchObject({ class: 'payments_double_charge', belowConfidence: false });
  });

  it('tries again while the service is busy, then gives up with its message', async () => {
    fetchMock
      .mockResolvedValueOnce(failed(429, { message: 'Rate limit exceeded' }))
      .mockResolvedValueOnce(answered());
    expect((await step.execute(config(), ctx())).class).toBe('payments_double_charge');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockClear().mockResolvedValue(failed(529, { message: 'Overloaded' }));
    await expect(step.execute(config({ maxAttempts: 2 }), ctx())).rejects.toThrow(/Overloaded/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails with what the service said, and never retries a refusal', async () => {
    fetchMock.mockResolvedValue(failed(422, { detail: '`criteria` must have at least two entries' }));
    await expect(step.execute(config(), ctx())).rejects.toThrow(/at least two entries/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a config that cannot classify anything', async () => {
    await expect(step.execute(config({ classes: { only: 'one' } }), ctx())).rejects.toThrow(/at least two classes/);
    await expect(step.execute(config({ fallbackClass: 'talk_to_a_person' }), ctx())).rejects.toThrow(/needs `minConfidence`/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('types its answer as the classes it was given, so later steps can pick them', () => {
    const schema = step.resolveOutputJsonSchema({ classes: CLASSES, fallbackClass: 'talk_to_a_person' });
    const properties = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['class']).toEqual({ type: 'string', enum: [...Object.keys(CLASSES)] });
    expect(properties['confidence']).toEqual({ type: 'number' });
  });
});
