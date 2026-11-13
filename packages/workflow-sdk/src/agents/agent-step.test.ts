import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai';
import { AgentStep, AgentStepConfigSchema, type AgentStepConfig } from './agent-step.js';
import { BaseAgentRuntime } from './base-runtime.js';
import { AgentToolRegistry } from './tool-registry.js';
import type { AgentCapabilities, AgentInput } from './types.js';
import type { StepExecutionContext } from '../steps/base-step.js';
import type { WorkflowTool } from './tool-types.js';
import type { StorageAdapter } from '../storage/types.js';
import type { SandboxAdapter } from '../sandbox/types.js';
import { createMockStepContext } from '../testing/mock-step-context.js';
import { Readable } from 'node:stream';
import { createMockContext } from '../testing/mock-context.js';

// ─── Fakes for storage + sandbox ───

function fakeStorage(): StorageAdapter {
  return {
    put: async (_scope, file) => {
      let size = 0;
      for await (const chunk of file.stream) size += (chunk as Uint8Array).length;
      return { name: file.name, mimeType: file.mimeType, handle: `mem://${file.name}`, size };
    },
    stream: async () => Readable.from(Buffer.from('input-bytes')),
    info: async () => ({ size: 'input-bytes'.length, mimeType: 'text/plain' }),
    delete: async () => {},
  };
}

function fakeSandbox(record: {
  created: number;
  destroyed: number;
  written: string[];
}): SandboxAdapter {
  return {
    create: async () => {
      record.created++;
      return { id: 'sb_test' };
    },
    exec: async () => ({ stdout: '', stderr: '', artifacts: [], durationMs: 1 }),
    bash: async () => ({ stdout: '', stderr: '', artifacts: [], durationMs: 1 }),
    writeFiles: async (_handle, files) => {
      record.written.push(...files.map((f) => f.path));
    },
    readFile: async () => new Uint8Array(),
    destroy: async () => {
      record.destroyed++;
    },
  };
}

// ─── Helpers ───

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function makeUsage(input: number, output: number): Usage {
  return { ...ZERO_USAGE, input, output, totalTokens: input + output };
}

function makeAssistantMessage(
  text: string,
  usage?: Usage,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt-4',
    usage: usage ?? ZERO_USAGE,
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

// ─── Mock Runtime ───

class MockRuntime extends BaseAgentRuntime<z.ZodTypeAny> {
  readonly name = 'mock';
  readonly capabilities: AgentCapabilities = {
    streaming: true,
    toolUse: true,
    hooks: true,
    multiTurn: true,
  };
  readonly configSchema = z.object({});

  private eventSequence: AgentEvent[] = [];
  /** Tools to actually invoke before yielding events (to exercise tool ctx). */
  private toolsToInvoke: Array<{ name: string; args: Record<string, unknown> }> = [];

  /** Set the events this runtime will yield. */
  setEvents(events: AgentEvent[]): void {
    this.eventSequence = events;
  }

  /** Make the runtime actually call a converted tool during execute(). */
  invokeTool(name: string, args: Record<string, unknown> = {}): void {
    this.toolsToInvoke.push({ name, args });
  }

  async *execute(
    _config: unknown,
    _input: AgentInput,
    _ctx: StepExecutionContext,
  ): AsyncIterable<AgentEvent> {
    for (const call of this.toolsToInvoke) {
      const tool = _input.tools?.find((t) => t.name === call.name);
      if (tool) await tool.execute('tc_test', call.args, undefined);
    }
    for (const event of this.eventSequence) {
      yield event;
    }
  }
}

// ─── Simple single-turn conversation ───

function singleTurnEvents(text: string, usage?: Usage): AgentEvent[] {
  const msg = makeAssistantMessage(text, usage);
  return [
    { type: 'agent_start' },
    { type: 'turn_start' },
    { type: 'message_start', message: msg },
    { type: 'message_end', message: msg },
    { type: 'turn_end', message: msg, toolResults: [] },
    { type: 'agent_end', messages: [msg] },
  ];
}

function toolCallEvents(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  finalText: string,
): AgentEvent[] {
  const toolMsg = makeAssistantMessage('');
  const finalMsg = makeAssistantMessage(finalText, makeUsage(100, 50));
  const toolCallId = 'tc_1';
  return [
    { type: 'agent_start' },
    // Turn 1: tool call
    { type: 'turn_start' },
    { type: 'message_start', message: toolMsg },
    { type: 'message_end', message: toolMsg },
    {
      type: 'tool_execution_start',
      toolCallId,
      toolName,
      args,
    },
    {
      type: 'tool_execution_end',
      toolCallId,
      toolName,
      result,
      isError: false,
    },
    {
      type: 'turn_end',
      message: toolMsg,
      toolResults: [
        {
          role: 'toolResult' as const,
          toolCallId,
          toolName,
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          isError: false,
          timestamp: Date.now(),
        },
      ],
    },
    // Turn 2: final response
    { type: 'turn_start' },
    { type: 'message_start', message: finalMsg },
    { type: 'message_end', message: finalMsg },
    { type: 'turn_end', message: finalMsg, toolResults: [] },
    { type: 'agent_end', messages: [toolMsg, finalMsg] },
  ];
}

// ─── Tests ───

describe('AgentStep', () => {
  const defaultConfig = {
    systemPrompt: 'You are a helper.',
    userMessage: 'Hello',
    maxTurns: 10,
    toolTimeout: 5000,
  };

  function createStep(runtime?: MockRuntime, registry?: AgentToolRegistry) {
    return new AgentStep(
      runtime ?? new MockRuntime(),
      registry ?? new AgentToolRegistry(),
    );
  }

  describe('metadata', () => {
    it('has correct step type and category', () => {
      const step = createStep();
      expect(step.type).toBe('RUN_AGENT');
      expect(step.category).toBe('ai');
      expect(step.kind).toBe('action');
    });

    it('config schema validates', () => {
      const config = AgentStepConfigSchema.parse({
        systemPrompt: 'test',
        userMessage: 'hello',
      });
      expect(config.maxTurns).toBe(10);
      expect(config.toolTimeout).toBe(30_000);
    });

    it('config schema rejects invalid maxTurns', () => {
      expect(() =>
        AgentStepConfigSchema.parse({
          systemPrompt: 'test',
          userMessage: 'hello',
          maxTurns: 0,
        }),
      ).toThrow();
    });
  });

  describe('execute — basic', () => {
    it('returns response from single-turn conversation', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('Hello! How can I help?'));
      const step = createStep(runtime);
      const ctx = createMockStepContext();

      const result = await step.execute(defaultConfig, ctx);

      expect(result.response).toBe('Hello! How can I help?');
      expect(result.turnCount).toBe(1);
      expect(result.toolCalls).toHaveLength(0);
    });

    it('accumulates usage from assistant messages', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(
        singleTurnEvents('hi', makeUsage(50, 25)),
      );
      const step = createStep(runtime);
      const ctx = createMockStepContext();

      const result = await step.execute(defaultConfig, ctx);

      expect(result.usage.inputTokens).toBe(50);
      expect(result.usage.outputTokens).toBe(25);
    });

    it('emits progress events', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('test'));
      const step = createStep(runtime);
      const events: unknown[] = [];
      const ctx = createMockStepContext({
        emit: (e) => { events.push(e); },
      });

      await step.execute(defaultConfig, ctx);

      const types = events.map(
        (e) => (e as { type: string }).type,
      );
      expect(types).toContain('thinking');
      expect(types).toContain('substep');
    });
  });

  describe('execute — tool calls', () => {
    it('records tool calls with args from start event', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(
        toolCallEvents('search', { q: 'test' }, { hits: 3 }, 'Found 3 results'),
      );
      const step = createStep(runtime);
      const ctx = createMockStepContext();

      const result = await step.execute(defaultConfig, ctx);

      expect(result.response).toBe('Found 3 results');
      expect(result.turnCount).toBe(2);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!.name).toBe('search');
      expect(result.toolCalls[0]!.args).toEqual({ q: 'test' });
      expect(result.toolCalls[0]!.result).toEqual({ hits: 3 });
    });

    it('emits tool_call events for start and end', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(
        toolCallEvents('search', { q: 'x' }, 'ok', 'done'),
      );
      const step = createStep(runtime);
      const events: unknown[] = [];
      const ctx = createMockStepContext({
        emit: (e) => { events.push(e); },
      });

      await step.execute(defaultConfig, ctx);

      const toolEvents = (events as { type: string; data: { phase?: string } }[])
        .filter((e) => e.type === 'tool_call');
      const phases = toolEvents.map((e) => e.data.phase);
      expect(phases).toContain('start');
      expect(phases).toContain('end');
    });
  });

  describe('execute — maxTurns', () => {
    it('stops after maxTurns', async () => {
      const runtime = new MockRuntime();
      // 3 turns
      const msg1 = makeAssistantMessage('turn1');
      const msg2 = makeAssistantMessage('turn2');
      const msg3 = makeAssistantMessage('turn3');
      runtime.setEvents([
        { type: 'agent_start' },
        { type: 'turn_start' },
        { type: 'message_start', message: msg1 },
        { type: 'message_end', message: msg1 },
        { type: 'turn_end', message: msg1, toolResults: [] },
        { type: 'turn_start' },
        { type: 'message_start', message: msg2 },
        { type: 'message_end', message: msg2 },
        { type: 'turn_end', message: msg2, toolResults: [] },
        // This turn exceeds maxTurns=2
        { type: 'turn_start' },
        { type: 'message_start', message: msg3 },
        { type: 'message_end', message: msg3 },
        { type: 'turn_end', message: msg3, toolResults: [] },
        { type: 'agent_end', messages: [msg1, msg2, msg3] },
      ]);
      const step = createStep(runtime);
      const ctx = createMockStepContext();

      const result = await step.execute(
        { ...defaultConfig, maxTurns: 2 },
        ctx,
      );

      // Should have stopped at turn 3 (which exceeds maxTurns=2)
      expect(result.turnCount).toBeLessThanOrEqual(3);
      expect(result.response).toBe('turn2');
    });
  });

  describe('execute — capability degradation', () => {
    it('clamps maxTurns to 1 when multiTurn=false', async () => {
      const runtime = new MockRuntime();
      runtime.capabilities.multiTurn = false;
      const msg1 = makeAssistantMessage('turn1');
      const msg2 = makeAssistantMessage('turn2');
      runtime.setEvents([
        { type: 'agent_start' },
        { type: 'turn_start' },
        { type: 'message_start', message: msg1 },
        { type: 'message_end', message: msg1 },
        { type: 'turn_end', message: msg1, toolResults: [] },
        // Turn 2 exceeds clamped maxTurns=1
        { type: 'turn_start' },
        { type: 'message_start', message: msg2 },
        { type: 'message_end', message: msg2 },
        { type: 'turn_end', message: msg2, toolResults: [] },
        { type: 'agent_end', messages: [msg1, msg2] },
      ]);
      const step = createStep(runtime);
      const ctx = createMockStepContext();

      const result = await step.execute(defaultConfig, ctx);

      expect(result.response).toBe('turn1');
    });

    it('passes empty tools when toolUse=false', async () => {
      const runtime = new MockRuntime();
      runtime.capabilities.toolUse = false;
      let capturedInput: AgentInput | undefined;
      const origExecute = runtime.execute.bind(runtime);
      runtime.execute = async function* (config, input, ctx) {
        capturedInput = input;
        yield* origExecute(config, input, ctx);
      };
      runtime.setEvents(singleTurnEvents('no tools'));

      const registry = new AgentToolRegistry();
      registry.register({
        name: 'ignored',
        description: 'should not appear',
        inputSchema: z.object({}),
        execute: async () => ({}),
      });

      const step = new AgentStep(runtime, registry);
      const ctx = createMockStepContext();

      await step.execute({ ...defaultConfig, tools: ['ignored'] }, ctx);

      expect(capturedInput!.tools).toHaveLength(0);
    });
  });

  describe('onResume', () => {
    it('returns abort result when action=abort', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents([]);
      const step = createStep(runtime);
      const ctx = createMockStepContext({
        runtime: {
          metadata: {
            resumePayload: { action: 'abort' },
          },
        },
      });

      const pauseState = {
        messages: [makeAssistantMessage('partial work')],
        currentTurn: 1,
        completedToolCalls: [
          { name: 'search', args: {}, result: 'found', durationMs: 100 },
        ],
        usage: { inputTokens: 50, outputTokens: 25 },
      };

      const result = await step.onResume!(pauseState, defaultConfig, ctx);

      expect(result.response).toContain('aborted');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 25 });
    });

    it('continues execution on action=approve', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('resumed response'));
      const step = createStep(runtime);
      const ctx = createMockStepContext({
        runtime: {
          metadata: {
            resumePayload: { action: 'approve' },
          },
        },
      });

      const pauseState = {
        messages: [],
        currentTurn: 0,
        completedToolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };

      const result = await step.onResume!(pauseState, defaultConfig, ctx);

      expect(result.response).toBe('resumed response');
    });
  });

  describe('execute — conversation continuity via priorState', () => {
    it('routes to continueConversation when priorState.messages is non-empty', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('continued response'));
      const step = createStep(runtime);

      const priorMessage = makeAssistantMessage('earlier turn', makeUsage(20, 10));
      const ctx = createMockStepContext({
        priorState: {
          messages: [priorMessage],
          currentTurn: 1,
          completedToolCalls: [
            { name: 'search', args: { q: 'x' }, result: 'r', durationMs: 5 },
          ],
          usage: { inputTokens: 20, outputTokens: 10 },
        },
      });

      // Snapshot at capture time — consumeEvents mutates the messages array.
      let capturedMessages: unknown[] | undefined;
      let capturedPayload: unknown;
      let capturedPauseType: string | undefined;
      let capturedPrompt: string | undefined;
      const original = runtime.execute.bind(runtime);
      runtime.execute = async function* (config, input, c) {
        capturedMessages = input.resume ? [...input.resume.messages] : undefined;
        capturedPayload = input.resume?.payload;
        capturedPauseType = input.resume?.pauseState.type;
        capturedPrompt = input.resume?.pauseState.prompt;
        yield* original(config, input, c);
      };

      const result = await step.execute(
        { ...defaultConfig, userMessage: 'continue please' },
        ctx,
      );

      expect(capturedMessages).toHaveLength(1);
      expect(capturedMessages![0]).toBe(priorMessage);
      expect(capturedPayload).toEqual({
        action: 'approve',
        feedback: 'continue please',
      });
      expect(capturedPauseType).toBe('awaiting_feedback');
      expect(capturedPrompt).toBe('continue please');

      // Output should accumulate prior tool calls + usage from new turn
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!.name).toBe('search');
      // currentTurn was 1, the new turn_start bumps it to 2
      expect(result.turnCount).toBe(2);
    });

    it('falls through to fresh execute when priorState is empty', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('fresh response'));
      const step = createStep(runtime);

      let captured: AgentInput | undefined;
      const original = runtime.execute.bind(runtime);
      runtime.execute = async function* (config, input, c) {
        captured = input;
        yield* original(config, input, c);
      };

      const ctx = createMockStepContext({});
      const result = await step.execute(defaultConfig, ctx);

      expect(captured?.resume).toBeUndefined();
      expect(result.response).toBe('fresh response');
    });

    it('falls through to fresh execute when priorState has no messages', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('fresh response'));
      const step = createStep(runtime);

      let captured: AgentInput | undefined;
      const original = runtime.execute.bind(runtime);
      runtime.execute = async function* (config, input, c) {
        captured = input;
        yield* original(config, input, c);
      };

      const ctx = createMockStepContext({
        priorState: { output: { foo: 'bar' } },
      });
      await step.execute(defaultConfig, ctx);

      expect(captured?.resume).toBeUndefined();
    });
  });

  describe('tool conversion', () => {
    it('resolves workflow tools from registry', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('done'));
      const registry = new AgentToolRegistry();
      registry.register({
        name: 'greet',
        description: 'Greet someone',
        inputSchema: z.object({ name: z.string() }),
        execute: async (args) => `Hello ${(args as { name: string }).name}`,
      });

      let capturedInput: AgentInput | undefined;
      const origExecute = runtime.execute.bind(runtime);
      runtime.execute = async function* (config, input, ctx) {
        capturedInput = input;
        yield* origExecute(config, input, ctx);
      };

      const step = new AgentStep(runtime, registry);
      const ctx = createMockStepContext();

      await step.execute(
        { ...defaultConfig, tools: ['greet'] },
        ctx,
      );

      expect(capturedInput!.tools).toHaveLength(1);
      expect(capturedInput!.tools[0]!.name).toBe('greet');
    });

    it('throws when resolving unknown tool', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents([]);
      const step = createStep(runtime);
      const ctx = createMockStepContext();

      await expect(
        step.execute(
          { ...defaultConfig, tools: ['nonexistent'] },
          ctx,
        ),
      ).rejects.toThrow('Tool "nonexistent" not found in registry');
    });
  });

  describe('output type + artifacts', () => {
    it('accepts a runtime ref for json output schema', () => {
      const parsed = AgentStepConfigSchema.safeParse({
        ...defaultConfig,
        outputType: 'json',
        outputSchema: '{{trigger.jsonSchema}}',
      });

      expect(parsed.success).toBe(true);
    });

    it('returns a string response + empty attachments by default', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('plain text'));
      const step = createStep(runtime);

      const result = await step.execute(defaultConfig, createMockStepContext());

      expect(result.response).toBe('plain text');
      expect(result.attachments).toEqual([]);
    });

    it('parses the response as JSON when outputType is "json"', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('{"answer": 42}'));
      const step = createStep(runtime);

      const result = await step.execute(
        { ...defaultConfig, outputType: 'json' },
        createMockStepContext(),
      );

      expect(result.response).toEqual({ answer: 42 });
    });

    it('falls back to { text } when a json response is not valid JSON', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('not json'));
      const step = createStep(runtime);

      const result = await step.execute(
        { ...defaultConfig, outputType: 'json' },
        createMockStepContext(),
      );

      expect(result.response).toEqual({ text: 'not json' });
    });

    it('merges tool-produced artifacts into result.attachments', async () => {
      const registry = new AgentToolRegistry();
      const tool: WorkflowTool = {
        name: 'make_file',
        description: 'writes a file',
        inputSchema: z.object({}),
        execute: async (_args, ctx) => {
          await ctx.addArtifact?.({
            name: 'report.txt',
            mimeType: 'text/plain',
            bytes: new Uint8Array([1, 2, 3]),
          });
          return 'done';
        },
      };
      registry.register(tool);

      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('done'));
      runtime.invokeTool('make_file');
      const step = createStep(runtime, registry);
      const ctx = createMockStepContext({ storage: fakeStorage() });

      const result = await step.execute(
        { ...defaultConfig, tools: ['make_file'] },
        ctx,
      );

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]!.name).toBe('report.txt');
      expect(result.attachments[0]!.handle).toBe('mem://report.txt');
    });

    it('opens a sandbox session, mounts attachments at /mnt/files, and destroys it', async () => {
      const record = { created: 0, destroyed: 0, written: [] as string[] };
      const registry = new AgentToolRegistry();
      const tool: WorkflowTool = {
        name: 'run_code',
        description: 'runs code',
        inputSchema: z.object({}),
        execute: async (_args, ctx) => {
          await ctx.sandbox?.exec('print(1)');
          return 'ran';
        },
      };
      registry.register(tool);

      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('ran'));
      runtime.invokeTool('run_code');
      const step = createStep(runtime, registry);
      const ctx = createMockStepContext({
        storage: fakeStorage(),
        sandbox: fakeSandbox(record),
      });

      const result = await step.execute(
        {
          ...defaultConfig,
          tools: ['run_code'],
          attachments: [
            { name: 'in.pdf', mimeType: 'application/pdf', handle: 'mem://in.pdf', size: 3 },
          ],
        },
        ctx,
      );

      expect(record.created).toBe(1);
      expect(record.destroyed).toBe(1);
      expect(record.written).toContain('/mnt/files/in.pdf');
      expect(result.response).toBe('ran');
    });

    it('does not open a sandbox when run_code is not enabled', async () => {
      const record = { created: 0, destroyed: 0, written: [] as string[] };
      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('hi'));
      const step = createStep(runtime);
      const ctx = createMockStepContext({ sandbox: fakeSandbox(record) });

      await step.execute(defaultConfig, ctx);

      expect(record.created).toBe(0);
    });
  });

  describe('citations (cite: true)', () => {
    /** Workflow context with an OCR step output to cite against. */
    function citeCtx(rawConfig?: Record<string, unknown>) {
      return createMockStepContext({
        workflow: createMockContext({
          steps: {
            ocr: {
              type: 'OCR_DOCUMENT',
              output: {
                results: [
                  {
                    // Mirrors what OcrDocumentStep actually emits: the source
                    // document beside the text, and text only ever per page.
                    source: { name: 'invoice.pdf', mimeType: 'application/pdf', handle: 'mem://1' },
                    pages: [{ page: 1, text: 'INVOICE TOTAL 5000' }],
                  },
                ],
              },
            },
          },
        }),
        ...(rawConfig ? { rawConfig } : {}),
      });
    }

    /** Capture the config the runtime is actually handed (prompt included). */
    function captureConfig(runtime: MockRuntime) {
      const captured: { config?: AgentStepConfig } = {};
      const orig = runtime.execute.bind(runtime);
      runtime.execute = async function* (config, input, ctx) {
        captured.config = config as AgentStepConfig;
        yield* orig(config, input, ctx);
      };
      return captured;
    }

    it('splits a cited json response into value + citation', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(
        singleTurnEvents(
          '{"value":{"total":"5000"},"citation":{"total":[{"kind":"ref","ref":"steps.ocr.output.results.0.pages.0.text","page":3,"quote":"5000"}]}}',
        ),
      );
      const step = createStep(runtime);

      const result = await step.execute(
        { ...defaultConfig, outputType: 'json', cite: true },
        citeCtx(),
      );

      const response = result.response as { value: unknown; citation: Record<string, unknown> };
      expect(response.value).toEqual({ total: '5000' });
      expect(response.citation['total']).toEqual([
        { kind: 'ref', ref: 'steps.ocr.output.results.0.pages.0.text', page: 3, quote: '5000' },
      ]);
    });

    it('degrades to an uncited value when the agent forgets the wrapper', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('{"total":"5000"}'));
      const step = createStep(runtime);

      const result = await step.execute(
        { ...defaultConfig, outputType: 'json', cite: true },
        citeCtx(),
      );

      expect(result.response).toEqual({ value: { total: '5000' }, citation: {} });
    });

    // The whole feature is opt-in: an existing workflow must be byte-identical.
    it('leaves the response flat when cite is off', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('{"total":"5000"}'));
      const step = createStep(runtime);

      const result = await step.execute(
        { ...defaultConfig, outputType: 'json' },
        citeCtx(),
      );

      expect(result.response).toEqual({ total: '5000' });
    });

    it('labels each resolved ref in the user message so the agent can cite it', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('{"value":{},"citation":{}}'));
      const captured = captureConfig(runtime);
      const step = createStep(runtime);

      await step.execute(
        {
          ...defaultConfig,
          userMessage: 'Analyse: INVOICE TOTAL 5000',
          outputType: 'json',
          cite: true,
        },
        // The executor already resolved userMessage; rawConfig still holds the ref.
        citeCtx({ userMessage: 'Analyse: {{steps.ocr.output.results.0.pages.0.text}}' }),
      );

      expect(captured.config!.userMessage).toContain('[source: steps.ocr.output.results.0.pages.0.text]');
      expect(captured.config!.userMessage).toContain('INVOICE TOTAL 5000');
      expect(captured.config!.systemPrompt).toContain('CITATIONS');
    });

    it('adds no citation note or labels when cite is off', async () => {
      const runtime = new MockRuntime();
      runtime.setEvents(singleTurnEvents('hi'));
      const captured = captureConfig(runtime);
      const step = createStep(runtime);

      await step.execute(
        { ...defaultConfig, userMessage: 'Analyse: INVOICE TOTAL 5000' },
        citeCtx({ userMessage: 'Analyse: {{steps.ocr.output.results.0.pages.0.text}}' }),
      );

      expect(captured.config!.userMessage).toBe('Analyse: INVOICE TOTAL 5000');
      expect(captured.config!.systemPrompt).toBe(defaultConfig.systemPrompt);
    });

    describe('resolveOutputJsonSchema', () => {
      const userSchema = { type: 'object', properties: { total: { type: 'string' } } };

      it('wraps the declared schema in value + citation when cite is on', () => {
        const step = createStep();
        const out = step.resolveOutputJsonSchema({
          outputType: 'json',
          outputSchema: userSchema,
          cite: true,
        });

        const response = (out['properties'] as Record<string, Record<string, unknown>>)['response']!;
        const props = response['properties'] as Record<string, unknown>;
        expect(props['value']).toEqual(userSchema);
        expect(props['citation']).toEqual({ type: 'object' });
      });

      it('leaves the declared schema untouched when cite is off', () => {
        const step = createStep();
        const out = step.resolveOutputJsonSchema({
          outputType: 'json',
          outputSchema: userSchema,
        });

        const response = (out['properties'] as Record<string, unknown>)['response'];
        expect(response).toEqual(userSchema);
      });

      it('does not wrap string output', () => {
        const step = createStep();
        const out = step.resolveOutputJsonSchema({ outputType: 'string', cite: true });

        const response = (out['properties'] as Record<string, unknown>)['response'];
        expect(response).toEqual({ type: 'string' });
      });
    });
  });

  describe('JSON repair retry (outputType=json)', () => {
    // A runtime that yields a different event sequence on each execute() call,
    // and records every AgentInput it was called with (to inspect resume/feedback).
    class QueueRuntime extends BaseAgentRuntime<z.ZodTypeAny> {
      readonly name = 'queue';
      readonly capabilities: AgentCapabilities = {
        streaming: true,
        toolUse: true,
        hooks: true,
        multiTurn: true,
      };
      readonly configSchema = z.object({});
      readonly calls: AgentInput[] = [];
      constructor(private readonly seqs: AgentEvent[][]) {
        super();
      }
      async *execute(
        _config: unknown,
        input: AgentInput,
        _ctx: StepExecutionContext,
      ): AsyncIterable<AgentEvent> {
        this.calls.push(input);
        const i = Math.min(this.calls.length - 1, this.seqs.length - 1);
        for (const event of this.seqs[i]!) yield event;
      }
    }

    const jsonConfig = {
      ...defaultConfig,
      outputType: 'json' as const,
    } as unknown as AgentStepConfig;

    it('re-prompts with the parse error and repairs invalid JSON, keeping context', async () => {
      const runtime = new QueueRuntime([
        singleTurnEvents('{"name":"widget","value":42'), // malformed: missing brace
        singleTurnEvents('{"name":"widget","value":42}'), // valid on retry
      ]);
      const step = createStep(runtime);

      const result = await step.execute(jsonConfig, createMockStepContext());

      expect(runtime.calls.length).toBe(2); // retry fired exactly once
      expect(result.response).toEqual({ name: 'widget', value: 42 }); // repaired
      // second call continued the SAME conversation with the prior context + feedback
      const second = runtime.calls[1]!;
      expect(second.resume).toBeDefined();
      const msgs = second.resume!.messages;
      expect(msgs.some((m) => m.role === 'assistant')).toBe(true); // prior turn carried
      const feedback = msgs.find((m) => m.role === 'user'); // the injected repair prompt
      expect(feedback).toBeDefined();
      expect(String((feedback as { content: unknown }).content)).toMatch(
        /not valid JSON|parser error/i,
      ); // parse error fed back to the LLM
    });

    it('re-prompts on an empty response', async () => {
      const runtime = new QueueRuntime([
        singleTurnEvents(''), // empty
        singleTurnEvents('{"ok":true}'), // valid on retry
      ]);
      const step = createStep(runtime);

      const result = await step.execute(jsonConfig, createMockStepContext());

      expect(runtime.calls.length).toBe(2);
      expect(result.response).toEqual({ ok: true });
      const feedback = runtime.calls[1]!.resume!.messages.find(
        (m) => m.role === 'user',
      );
      expect(feedback).toBeDefined();
      expect(String((feedback as { content: unknown }).content)).toMatch(/empty/i);
    });

    it('falls back to {text} after exhausting the retry budget', async () => {
      const runtime = new QueueRuntime([
        singleTurnEvents('not json at all'), // always malformed
      ]);
      const step = createStep(runtime);
      const config = {
        ...jsonConfig,
        jsonRepairRetries: 2,
      } as unknown as AgentStepConfig;

      const result = await step.execute(config, createMockStepContext());

      expect(runtime.calls.length).toBe(3); // initial + 2 retries
      expect(result.response).toEqual({ text: 'not json at all' }); // graceful fallback
    });

    it('does not retry a valid JSON response', async () => {
      const runtime = new QueueRuntime([singleTurnEvents('{"good":true}')]);
      const step = createStep(runtime);

      const result = await step.execute(jsonConfig, createMockStepContext());

      expect(runtime.calls.length).toBe(1); // no retry
      expect(result.response).toEqual({ good: true });
    });

    it('re-prompts an empty response even for string output', async () => {
      const runtime = new QueueRuntime([
        singleTurnEvents(''), // empty
        singleTurnEvents('Here is the answer.'), // recovered on retry
      ]);
      const step = createStep(runtime);
      const stringConfig = {
        ...defaultConfig,
        outputType: 'string' as const,
      } as unknown as AgentStepConfig;

      const result = await step.execute(stringConfig, createMockStepContext());

      expect(runtime.calls.length).toBe(2); // empty was not accepted
      expect(result.response).toBe('Here is the answer.');
      const feedback = runtime.calls[1]!.resume!.messages.find(
        (m) => m.role === 'user',
      );
      expect(String((feedback as { content: unknown }).content)).toMatch(/empty/i);
    });

    it('does not retry a non-empty string response', async () => {
      const runtime = new QueueRuntime([singleTurnEvents('All good.')]);
      const step = createStep(runtime);
      const stringConfig = {
        ...defaultConfig,
        outputType: 'string' as const,
      } as unknown as AgentStepConfig;

      const result = await step.execute(stringConfig, createMockStepContext());

      expect(runtime.calls.length).toBe(1); // non-empty text accepted as-is
      expect(result.response).toBe('All good.');
    });
  });
});
