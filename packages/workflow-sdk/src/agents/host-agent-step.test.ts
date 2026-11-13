import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createMockStepContext } from '../testing/mock-step-context.js';
import { zodToJsonSchemaRecord } from '../util/schema-convert.js';
import { HostAgentStep } from './host-agent-step.js';
import { BaseAgentProvider } from './provider.js';
import type { AgentRunEvent, AgentRunInput, AgentRunResult } from './provider.js';
import type { StepExecutionContext } from '../steps/base-step.js';
import type { Attachment } from '../common/attachment.js';
import type { StepProgressEvent } from '../types/step-events.js';
import type { PauseStep } from '../engine/pause-step.js';
import type { AgentDispatchRecord } from './provider.js';
import type { ResumePayload } from '../common/resume-payload.js';

// ─── Test Provider ───

const TestConfigSchema = z.object({
  agentId: z.string().describe('Which agent to run'),
});

const emptyResult = (text: string): AgentRunResult => ({
  text,
  toolCalls: [],
  turnCount: 1,
  usage: { inputTokens: 0, outputTokens: 0 },
});

/**
 * A provider driven by a scripted list of event batches — one batch per
 * invocation, so the repair loop can be exercised deterministically.
 */
class ScriptedProvider extends BaseAgentProvider<typeof TestConfigSchema> {
  readonly name = 'Scripted';
  readonly configSchema = TestConfigSchema;
  readonly calls: AgentRunInput[] = [];

  constructor(private readonly script: AgentRunEvent[][]) { super(); }

  async *run(
    _config: z.infer<typeof TestConfigSchema>,
    input: AgentRunInput,
  ): AsyncIterable<AgentRunEvent> {
    const batch = this.script[this.calls.length];
    this.calls.push(input);
    if (!batch) throw new Error('ScriptedProvider ran out of scripted batches');
    for (const event of batch) yield event;
  }
}

/** Dispatch-and-callback only, the way claw's S2S path works. */
class DispatchingProvider extends BaseAgentProvider<typeof TestConfigSchema> {
  readonly name = 'Dispatching';
  readonly configSchema = TestConfigSchema;
  readonly dispatched: AgentRunInput[] = [];
  collected: AgentRunResult = emptyResult('{"ok":true}');

  async dispatch(_c: unknown, input: AgentRunInput): Promise<{ externalRef: string }> {
    this.dispatched.push(input);
    return { externalRef: `session-${String(this.dispatched.length)}` };
  }

  readonly collectedWith: { payload: ResumePayload; record: AgentDispatchRecord }[] = [];

  async collect(
    payload: ResumePayload,
    record: AgentDispatchRecord,
  ): Promise<AgentRunResult> {
    this.collectedWith.push({ payload, record });
    return this.collected;
  }
}

/** Declares no transport at all — neither run() nor dispatch()/collect(). */
class TransportlessProvider extends BaseAgentProvider<typeof TestConfigSchema> {
  readonly name = 'Transportless';
  readonly configSchema = TestConfigSchema;
}

const baseConfig = {
  agentId: 'agent_1',
  task: 'Summarise the thread',
  outputType: 'string' as const,
  cite: false,
  jsonRepairRetries: 3,
  timeoutMs: 60_000,
};

/** A parked step row as it looks once the host has resumed it. */
const resumedRow = (
  record: Partial<AgentDispatchRecord> = {},
  payload: Partial<ResumePayload> = {},
): Record<string, unknown> => ({
  agent: { provider: 'Dispatching', attempt: 0, externalRef: 'session-1', ...record },
  resumePayload: { action: 'approve', data: { status: 'completed' }, ...payload },
});

/** Dispatch and capture the PauseStep the step throws. */
const dispatchAndCatch = async (
  provider: BaseAgentProvider<typeof TestConfigSchema>,
  config: Record<string, unknown> = {},
  ctx?: StepExecutionContext,
) => {
  const step = new HostAgentStep(provider);
  try {
    await step.execute({ ...baseConfig, ...config }, ctx ?? createMockStepContext());
  } catch (err) {
    return err as PauseStep;
  }
  throw new Error('expected the step to pause');
};

const run = async (
  provider: BaseAgentProvider<typeof TestConfigSchema>,
  config: Record<string, unknown> = {},
  ctx?: StepExecutionContext,
) => {
  const step = new HostAgentStep(provider);
  return step.execute({ ...baseConfig, ...config }, ctx ?? createMockStepContext());
};

// ─── Tests ───

describe('HostAgentStep', () => {
  describe('config schema', () => {
    it('composes provider fields ahead of the shared contract fields', () => {
      const step = new HostAgentStep(new ScriptedProvider([]));
      const schema = zodToJsonSchemaRecord(step.configSchema);
      expect(Object.keys((schema as { properties: object }).properties)).toEqual([
        'agentId',
        'task',
        'waitForReply',
        'attachments',
        'outputType',
        'outputSchema',
        'cite',
        'jsonRepairRetries',
        'timeoutMs',
      ]);
    });

    it('takes its picker identity from options', () => {
      const step = new HostAgentStep(new ScriptedProvider([]), {
        type: 'RUN_XYNE_AGENT',
        name: 'Run Xyne Agent',
        description: 'Run an agent from your workspace',
      });
      expect(step.type).toBe('RUN_XYNE_AGENT');
      expect(step.name).toBe('Run Xyne Agent');
      expect(step.category).toBe('ai');
    });

    it('lets the provider decorate its own fields', () => {
      class Decorating extends ScriptedProvider {
        override decorateConfigSchema(jsonSchema: Record<string, unknown>) {
          const props = jsonSchema['properties'] as Record<string, Record<string, unknown>>;
          props['agentId'] = { ...props['agentId'], format: 'agent-ref' };
          return jsonSchema;
        }
      }
      const step = new HostAgentStep(new Decorating([]));
      const decorated = step.decorateConfigSchema(zodToJsonSchemaRecord(step.configSchema));
      const props = decorated['properties'] as Record<string, Record<string, unknown>>;
      expect(props['agentId']?.['format']).toBe('agent-ref');
      // The step's own decorations survive alongside the provider's.
      expect(props['outputSchema']?.['format']).toBe('json-schema');
    });
  });

  describe('output shape', () => {
    it('returns free text unchanged', async () => {
      const result = await run(new ScriptedProvider([[
        { type: 'text', text: 'partial' },
        { type: 'done', result: emptyResult('the answer') },
      ]]));
      expect(result.response).toBe('the answer');
      expect(result.attachments).toEqual([]);
      expect(result.turnCount).toBe(1);
    });

    it('parses JSON output, fences and all', async () => {
      const result = await run(
        new ScriptedProvider([[{ type: 'done', result: emptyResult('```json\n{"ok":true}\n```') }]]),
        { outputType: 'json' },
      );
      expect(result.response).toEqual({ ok: true });
    });

    it('declares an output schema that follows outputType and cite', () => {
      const step = new HostAgentStep(new ScriptedProvider([]));
      const stringShape = step.resolveOutputJsonSchema({ outputType: 'string' });
      expect((stringShape['properties'] as Record<string, unknown>)['response'])
        .toEqual({ type: 'string' });

      const citedShape = step.resolveOutputJsonSchema({ outputType: 'json', cite: true });
      const response = (citedShape['properties'] as Record<string, Record<string, unknown>>)['response'];
      expect(Object.keys(response?.['properties'] as object)).toEqual(['value', 'citation']);
    });
  });

  describe('repair loop', () => {
    it('re-runs on unparseable JSON and reports the defect to the provider', async () => {
      const provider = new ScriptedProvider([
        [{ type: 'done', result: emptyResult('not json at all') }],
        [{ type: 'done', result: emptyResult('{"ok":true}') }],
      ]);
      const result = await run(provider, { outputType: 'json' });

      expect(result.response).toEqual({ ok: true });
      expect(provider.calls).toHaveLength(2);
      expect(provider.calls[0]?.repair).toBeUndefined();
      expect(provider.calls[1]?.repair).toMatchObject({ attempt: 1, reason: 'unparseable' });
      expect(provider.calls[1]?.repair?.error).toBeTruthy();
    });

    it('re-runs on an empty response even for free-text output', async () => {
      const provider = new ScriptedProvider([
        [{ type: 'done', result: emptyResult('   ') }],
        [{ type: 'done', result: emptyResult('finally') }],
      ]);
      const result = await run(provider);
      expect(result.response).toBe('finally');
      expect(provider.calls[1]?.repair).toMatchObject({ reason: 'empty' });
    });

    it('honours the retry budget and returns the last response as-is', async () => {
      const provider = new ScriptedProvider([
        [{ type: 'done', result: emptyResult('nope') }],
        [{ type: 'done', result: emptyResult('still nope') }],
      ]);
      const result = await run(provider, { outputType: 'json', jsonRepairRetries: 1 });

      expect(provider.calls).toHaveLength(2);
      // Unparseable to the end — falls back to the declared object shape.
      expect(result.response).toEqual({ text: 'still nope' });
    });

    it('does not re-run when the first response is usable', async () => {
      const provider = new ScriptedProvider([[{ type: 'done', result: emptyResult('good') }]]);
      await run(provider);
      expect(provider.calls).toHaveLength(1);
    });

    it('re-runs when valid JSON breaks the declared schema, saying how', async () => {
      const outputSchema = {
        type: 'object',
        properties: { screen: { type: 'string', enum: ['start', 'payments'] }, reason: { type: 'string' } },
        required: ['screen', 'reason'],
      };
      const provider = new ScriptedProvider([
        [{ type: 'done', result: emptyResult('{"screen":"billing","reason":"money"}') }],
        [{ type: 'done', result: emptyResult('{"screen":"payments","reason":"money"}') }],
      ]);
      const result = await run(provider, { outputType: 'json', outputSchema });

      expect(result.response).toEqual({ screen: 'payments', reason: 'money' });
      expect(provider.calls[1]?.repair).toMatchObject({ attempt: 1, reason: 'mismatch' });
      expect(provider.calls[1]?.repair?.error).toBe('screen must be one of: start, payments (got "billing")');
    });

    it('holds a JSON schema given as text (a resolved ref) the same way', async () => {
      const provider = new ScriptedProvider([
        [{ type: 'done', result: emptyResult('{"reason":"x"}') }],
        [{ type: 'done', result: emptyResult('{"screen":"start","reason":"x"}') }],
      ]);
      await run(provider, { outputType: 'json', outputSchema: '{"type":"object","required":["screen"]}' as never });
      expect(provider.calls[1]?.repair).toMatchObject({ reason: 'mismatch', error: 'screen is required' });
    });
  });

  describe('artifacts', () => {
    it('stores artifacts through the storage adapter and returns the refs', async () => {
      const stored: Attachment = { name: 'out.csv', mimeType: 'text/csv', handle: 'ref_1' };
      const put = vi.fn().mockResolvedValue(stored);
      const ctx = createMockStepContext({
        storage: { put, stream: vi.fn(), info: vi.fn(), delete: vi.fn() } as never,
      });

      const result = await run(
        new ScriptedProvider([[
          { type: 'artifact', name: 'out.csv', mimeType: 'text/csv', bytes: new Uint8Array([1, 2]) },
          { type: 'done', result: emptyResult('done') },
        ]]),
        {},
        ctx,
      );

      expect(put).toHaveBeenCalledOnce();
      expect(put.mock.calls[0]?.[1]).toMatchObject({ name: 'out.csv', mimeType: 'text/csv' });
      expect(result.attachments).toEqual([stored]);
    });

    it('warns and drops artifacts when no storage adapter is configured', async () => {
      const warn = vi.fn();
      const ctx = createMockStepContext({ log: { info: vi.fn(), warn, error: vi.fn() } });

      const result = await run(
        new ScriptedProvider([[
          { type: 'artifact', name: 'out.csv', mimeType: 'text/csv', bytes: new Uint8Array([1]) },
          { type: 'done', result: emptyResult('done') },
        ]]),
        {},
        ctx,
      );

      expect(result.attachments).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no storage adapter'));
    });
  });

  describe('progress', () => {
    it('forwards text and tool activity to the execution viewer', async () => {
      const emitted: StepProgressEvent[] = [];
      const ctx = createMockStepContext({ emit: (e) => emitted.push(e) });

      await run(
        new ScriptedProvider([[
          { type: 'text', text: 'thinking out loud' },
          { type: 'tool_start', toolCallId: 't1', tool: 'search', args: { q: 'x' } },
          { type: 'tool_end', toolCallId: 't1', tool: 'search', result: 'hit' },
          { type: 'done', result: emptyResult('done') },
        ]]),
        {},
        ctx,
      );

      expect(emitted.map((e) => e.type)).toEqual(['substep', 'tool_call', 'tool_call']);
      expect(emitted[1]?.data).toMatchObject({ tool: 'search', phase: 'start', toolCallId: 't1' });
      expect(emitted[2]?.data).toMatchObject({ tool: 'search', phase: 'end' });
    });

    it('emits a retry substep when re-prompting', async () => {
      const emitted: StepProgressEvent[] = [];
      const ctx = createMockStepContext({ emit: (e) => emitted.push(e) });

      await run(
        new ScriptedProvider([
          [{ type: 'done', result: emptyResult('bad') }],
          [{ type: 'done', result: emptyResult('{"ok":1}') }],
        ]),
        { outputType: 'json' },
        ctx,
      );

      expect(emitted.filter((e) => e.data['type'] === 'retry')).toHaveLength(1);
    });
  });

  describe('background (dispatch/collect) mode', () => {
    it('dispatches and parks the step, recording the correlation reference', async () => {
      const provider = new DispatchingProvider();
      const paused = await dispatchAndCatch(provider);

      expect(paused.name).toBe('PauseStep');
      expect(paused.externalRef).toBe('session-1');
      expect(paused.statePatch?.['agent']).toEqual({
        provider: 'Dispatching', attempt: 0, externalRef: 'session-1',
      });
      expect(provider.dispatched).toHaveLength(1);
    });

    it('omits the mode field when the provider has only one transport', () => {
      const oneWay = new HostAgentStep(new DispatchingProvider());
      expect(Object.keys(oneWay.configSchema.shape)).not.toContain('mode');

      class Both extends DispatchingProvider {
        async *run(): AsyncIterable<AgentRunEvent> { yield { type: 'done', result: emptyResult('x') }; }
      }
      expect(Object.keys(new HostAgentStep(new Both()).configSchema.shape)).toContain('mode');
    });

    it('collects a good response on resume', async () => {
      const provider = new DispatchingProvider();
      const step = new HostAgentStep(provider);
      const result = await step.onResume(
        resumedRow(),
        { ...baseConfig, outputType: 'json' },
        createMockStepContext(),
      );
      expect(result.response).toEqual({ ok: true });
    });

    it('re-dispatches on an unusable response, carrying the attempt across the pause', async () => {
      const provider = new DispatchingProvider();
      provider.collected = emptyResult('not json');
      const step = new HostAgentStep(provider);

      let paused: PauseStep | undefined;
      try {
        await step.onResume(
          resumedRow(),
          { ...baseConfig, outputType: 'json' },
          createMockStepContext(),
        );
      } catch (err) { paused = err as PauseStep; }

      expect(paused?.name).toBe('PauseStep');
      expect(paused?.statePatch?.['agent']).toMatchObject({ attempt: 1 });
      expect(provider.dispatched[0]?.repair).toMatchObject({ attempt: 1, reason: 'unparseable' });
    });

    it('re-dispatches when a background result breaks the schema', async () => {
      const provider = new DispatchingProvider();
      provider.collected = emptyResult('{"screen":"nowhere"}');
      const step = new HostAgentStep(provider);

      let paused: PauseStep | undefined;
      try {
        await step.onResume(
          resumedRow(),
          { ...baseConfig, outputType: 'json', outputSchema: { type: 'object', properties: { screen: { enum: ['start'] } } } },
          createMockStepContext(),
        );
      } catch (err) { paused = err as PauseStep; }

      expect(paused?.name).toBe('PauseStep');
      expect(provider.dispatched[0]?.repair).toMatchObject({ attempt: 1, reason: 'mismatch' });
    });

    it('fails loudly once the repair budget is spent — nothing is watching', async () => {
      const provider = new DispatchingProvider();
      provider.collected = emptyResult('still not json');
      const step = new HostAgentStep(provider);

      await expect(step.onResume(
        resumedRow({ attempt: 2, externalRef: 's' }),
        { ...baseConfig, outputType: 'json', jsonRepairRetries: 2 },
        createMockStepContext(),
      )).rejects.toThrow(/unusable after 2 repair attempt/);
    });

    it('hands the provider the payload and its own dispatch record', async () => {
      const provider = new DispatchingProvider();
      const step = new HostAgentStep(provider);
      await step.onResume(
        resumedRow({ attempt: 1, externalRef: 'session-7' }, { data: { status: 'completed', result: 'x' } }),
        baseConfig,
        createMockStepContext(),
      );
      const seen = provider.collectedWith[0];
      expect(seen?.record).toEqual({ provider: 'Dispatching', attempt: 1, externalRef: 'session-7' });
      expect(seen?.payload.data).toEqual({ status: 'completed', result: 'x' });
      // The provider never had to reach into the step row to find either.
    });

    it('refuses to resume a step that never dispatched', async () => {
      const step = new HostAgentStep(new DispatchingProvider());
      await expect(step.onResume({ resumePayload: { action: 'approve' } }, baseConfig, createMockStepContext()))
        .rejects.toThrow(/no agent dispatch record/);
    });

    it('refuses to resume with no payload', async () => {
      const step = new HostAgentStep(new DispatchingProvider());
      const { resumePayload: _drop, ...parked } = resumedRow();
      await expect(step.onResume(parked, baseConfig, createMockStepContext()))
        .rejects.toThrow(/reported back without a result/);
    });

    it('refuses to collect a run dispatched by a different provider', async () => {
      const step = new HostAgentStep(new DispatchingProvider());
      await expect(step.onResume(
        resumedRow({ provider: 'SomeOtherAgent', externalRef: 's' }),
        baseConfig,
        createMockStepContext(),
      )).rejects.toThrow(/dispatched to agent provider "SomeOtherAgent"/);
    });

    it('returns attachments the provider resolved itself', async () => {
      const provider = new DispatchingProvider();
      const att = { name: 'r.pdf', mimeType: 'application/pdf', handle: 'claw-ref-1' };
      provider.collected = { ...emptyResult('done'), attachments: [att] };
      const step = new HostAgentStep(provider);
      const result = await step.onResume(
        resumedRow({ externalRef: 's' }),
        baseConfig,
        createMockStepContext(),
      );
      expect(result.attachments).toEqual([att]);
    });
  });

  describe('agent picker (getOptions)', () => {
    class Listing extends ScriptedProvider {
      async listAgents() {
        return [
          { id: 'billing-bot', name: 'Billing helper', description: 'Answers payment questions' },
          { id: 'ask-ai', name: 'Ask AI' },
        ];
      }
    }
    const ask = (step: HostAgentStep, extra: Record<string, unknown> = {}) =>
      step.getOptions({ field: 'agentId', config: {}, literal: {}, credentials: {}, attributes: undefined as never, services: undefined as never, caller: {}, ...extra });

    it('offers the provider’s agents, filtered by what the author types', async () => {
      const step = new HostAgentStep(new Listing([]));
      expect((await ask(step)).items).toEqual([
        { value: 'billing-bot', label: 'Billing helper', description: 'Answers payment questions' },
        { value: 'ask-ai', label: 'Ask AI' },
      ]);
      expect((await ask(step, { search: 'bill' })).items.map((i) => i.value)).toEqual(['billing-bot']);
    });

    it('describes saved ids when asked for them by value', async () => {
      const step = new HostAgentStep(new Listing([]));
      expect((await ask(step, { values: ['ask-ai', 'gone'] })).items).toEqual([{ value: 'ask-ai', label: 'Ask AI' }]);
    });

    it('offers nothing when the provider cannot list its agents', async () => {
      expect((await ask(new HostAgentStep(new ScriptedProvider([])))).items).toEqual([]);
    });
  });

  describe('waiting for replies (waitForReply)', () => {
    const answer = (text: string) => [{ type: 'done' as const, result: emptyResult(text) }];
    const convo = { id: 'exec_test/step_test' };
    /** Run and catch the pause; returns what the step parked with. */
    const parkedBy = async (go: () => Promise<unknown>) => {
      try {
        await go();
      } catch (e) {
        return (e as { statePatch?: Record<string, unknown> }).statePatch ?? {};
      }
      throw new Error('expected the step to pause');
    };

    it('starts no conversation when it does not wait for replies', async () => {
      const provider = new ScriptedProvider([answer('Refunds take 5–7 days.')]);
      const result = await run(provider);
      expect(provider.calls[0]!.conversation).toBeUndefined();
      expect(result.response).toBe('Refunds take 5–7 days.');
    });

    it('answers, then pauses for a reply with the answer as the prompt', async () => {
      const provider = new ScriptedProvider([answer('Refunds take 5–7 days.')]);
      const patch = await parkedBy(() => run(provider, { waitForReply: true }));
      expect(provider.calls[0]).toMatchObject({ task: 'Summarise the thread', conversation: { ...convo, turn: 0 } });
      expect(patch['conversation']).toMatchObject({ ...convo, turn: 0, waiting: 'person', answer: { response: 'Refunds take 5–7 days.' } });
      expect(patch['pauseState']).toEqual({ reason: 'Waiting for a reply', prompt: ['Refunds take 5–7 days.'], form: { fields: [{ type: 'textarea', name: 'feedback', label: 'Reply' }] } });
    });

    it('continues the same conversation with a reply, then ends on a choice with the last answer', async () => {
      const provider = new ScriptedProvider([answer('Refunds take 5–7 days.'), answer('Cancelled trips refund at once.')]);
      const step = new HostAgentStep(provider);
      const config = { ...baseConfig, waitForReply: true };
      const first = await parkedBy(() => step.execute(config, createMockStepContext()));

      const second = await parkedBy(() =>
        step.onResume({ ...first, resumePayload: { action: 'approve', feedback: 'And for a cancelled trip?' } }, config, createMockStepContext()),
      );
      expect(provider.calls[1]).toMatchObject({ task: 'And for a cancelled trip?', conversation: { ...convo, turn: 1 } });
      expect(second['conversation']).toMatchObject({ turn: 1, reply: 'And for a cancelled trip?', waiting: 'person' });

      const done = await step.onResume({ ...second, resumePayload: { action: 'approve', data: { choice: 'payments' } } }, config, createMockStepContext());
      expect(done).toMatchObject({ response: 'Cancelled trips refund at once.', choice: 'payments' });
      expect(provider.calls).toHaveLength(2);
    });

    it('ends on an empty reply too, without a choice', async () => {
      const provider = new ScriptedProvider([answer('Refunds take 5–7 days.')]);
      const step = new HostAgentStep(provider);
      const config = { ...baseConfig, waitForReply: true };
      const first = await parkedBy(() => step.execute(config, createMockStepContext()));
      const done = await step.onResume({ ...first, resumePayload: { action: 'approve', feedback: '  ' } }, config, createMockStepContext());
      expect(done.response).toBe('Refunds take 5–7 days.');
      expect(done.choice).toBeUndefined();
    });

    it('in the background: waits on the agent, then on the person, and carries the conversation on the dispatch', async () => {
      const provider = new DispatchingProvider();
      provider.collected = emptyResult('Refunds take 5–7 days.');
      const step = new HostAgentStep(provider);
      const config = { ...baseConfig, waitForReply: true };

      const dispatched = await parkedBy(() => step.execute(config, createMockStepContext()));
      expect(dispatched['conversation']).toMatchObject({ ...convo, turn: 0, waiting: 'agent' });
      expect((dispatched['agent'] as AgentDispatchRecord).conversation).toEqual({ ...convo, turn: 0 });

      const answered = await parkedBy(() =>
        step.onResume({ ...dispatched, resumePayload: { action: 'approve', data: {} } }, config, createMockStepContext()),
      );
      expect(answered['conversation']).toMatchObject({ waiting: 'person', answer: { response: 'Refunds take 5–7 days.' } });

      const next = await parkedBy(() =>
        step.onResume({ ...answered, resumePayload: { action: 'approve', feedback: 'Why so long?' } }, config, createMockStepContext()),
      );
      expect(provider.dispatched[1]).toMatchObject({ task: 'Why so long?', conversation: { ...convo, turn: 1 } });
      expect(next['conversation']).toMatchObject({ turn: 1, reply: 'Why so long?', waiting: 'agent' });
    });

    it('declares `choice` on its output only when it waits for replies', () => {
      const step = new HostAgentStep(new ScriptedProvider([]));
      const props = (c: Record<string, unknown>) => Object.keys((step.resolveOutputJsonSchema(c)['properties'] as object) ?? {});
      expect(props({ ...baseConfig, waitForReply: true })).toContain('choice');
      expect(props(baseConfig)).not.toContain('choice');
    });
  });

  describe('failure modes', () => {
    it('rejects a provider that declares no transport at all', async () => {
      await expect(run(new TransportlessProvider())).rejects.toThrow(
        /implements neither SyncAgentCapability nor AsyncAgentCapability/,
      );
    });

    it('rejects a run that ends without reporting a result', async () => {
      await expect(run(new ScriptedProvider([[{ type: 'text', text: 'orphan' }]])))
        .rejects.toThrow(/without reporting a result/);
    });

    it('propagates provider failures rather than swallowing them', async () => {
      class Failing extends BaseAgentProvider<typeof TestConfigSchema> {
        readonly name = 'Failing';
        readonly configSchema = TestConfigSchema;
        // eslint-disable-next-line require-yield
        async *run(): AsyncIterable<AgentRunEvent> {
          throw new Error('upstream exploded');
        }
      }
      await expect(run(new Failing())).rejects.toThrow('upstream exploded');
    });
  });
});
