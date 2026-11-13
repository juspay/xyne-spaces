/**
 * PiSessionRuntime — concrete BaseAgentRuntime using @earendil-works/pi-coding-agent's AgentSession.
 * Unlike PiMonoRuntime (which calls agentLoop() directly, bypassing the Agent class
 * error boundary and AgentSession retry), this runtime uses createAgentSession() →
 * piSession.prompt(), gaining:
 * - Agent.runWithLifecycle → handleRunFailure (catches contract violations, synthesizes agent_end)
 * - _isRetryableError → _prepareRetry (auto-retry for 429, 5xx, network errors with exponential backoff)
 * - _checkCompaction (context overflow recovery via auto-compaction)
 * - Per-run AbortController management
 * The runtime is a push→pull bridge: AgentSession is push (subscribe + prompt),
 * BaseAgentRuntime.execute() is pull (AsyncIterable). 
 */

import { z } from 'zod';
import type { AgentEvent,  AgentToolUpdateCallback, BeforeToolCallContext } from '@earendil-works/pi-agent-core';
import type {
  AgentSessionEvent,
  CreateAgentSessionOptions,
  AuthCredential,
  ToolDefinition
} from '@earendil-works/pi-coding-agent';
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import type { Model, Message } from '@earendil-works/pi-ai';
import { BaseAgentRuntime } from './base-runtime.js';
import type { AgentCapabilities, AgentInput } from './types.js';
import type { StepExecutionContext } from '../steps/base-step.js';

// ─── Config Schema (identical to PiMonoConfigSchema) ───

export const PiSessionConfigSchema = z.object({
  model: z.string().optional(),
  systemPrompt: z.string(),
  userMessage: z.string(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  thinkingLevel: z
    .enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
    .optional(),
  maxRetries: z.number().int().min(0).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export type PiSessionConfig = z.infer<typeof PiSessionConfigSchema>;

// ─── Runtime Options (identical to PiMonoRuntimeOptions) ───

export interface PiSessionRuntimeOptions {
  baseUrl: string;
  auth: AuthCredential;
  model?: string | undefined;
  api?: string | undefined;
  provider: string;
}

// ─── Model Resolver ───

function resolveModel(
  modelId: string,
  baseUrl: string,
  api: string | undefined,
  provider: string | undefined,
  options: {
    maxTokens: number;
    contextWindow: number;
    reasoning: boolean;
    input: ('text' | 'image')[];
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  },
): Model<string> {
  return {
    id: modelId,
    name: modelId,
    api: (api ?? 'openai-completions'),
    provider: provider,
    baseUrl,
    reasoning: options.reasoning,
    input: options.input,
    cost: options.cost,
    contextWindow: options.contextWindow,
    maxTokens: options.maxTokens,
    compat: {
      supportsStore: false,
      supportsStreaming: true,
      supportsToolStreaming: true,
    },
  } as Model<string>;
}

// ─── Runtime ───

export class PiSessionRuntime extends BaseAgentRuntime<typeof PiSessionConfigSchema> {
  override readonly name = 'pi-session';
  override readonly capabilities: AgentCapabilities = {
    streaming: true,
    toolUse: true,
    hooks: true,
    multiTurn: true,
  };
  override readonly configSchema = PiSessionConfigSchema;

  constructor(private readonly options: PiSessionRuntimeOptions) {
    super();
  }

  override async *execute(
    config: PiSessionConfig,
    input: AgentInput,
    _ctx: StepExecutionContext,
  ): AsyncIterable<AgentEvent | AgentSessionEvent> {
    const modelId = config.model ?? this.options.model ?? 'claude-sonnet-4-20250514';
    const modelOptions = {
      maxTokens: config.maxTokens ?? 8192,
      contextWindow: 200_000,
      reasoning: config.thinkingLevel != null && config.thinkingLevel !== 'off',
      input: ['text', 'image'] as ('text' | 'image')[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const provider = this.options.provider;
    const model = resolveModel(
      modelId,
      this.options.baseUrl,
      this.options.api,
      provider,
      modelOptions,
    );

    // ─── Auth (in-memory, no disk) ───
    const authStorage = AuthStorage.inMemory();
    authStorage.set(provider, this.options.auth);
    const modelRegistry = ModelRegistry.inMemory(authStorage);

    // ─── Resource Loader (minimal, no disk deps) ───
    const resourceLoader = new DefaultResourceLoader({
      cwd: '/tmp',
      agentDir: '/tmp',
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: config.systemPrompt,
      agentsFilesOverride: () => ({ agentsFiles: [] }),
    });
    await resourceLoader.reload();

    // ─── Session + Settings (in-memory) ───
    const sessionManager = SessionManager.inMemory();
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: config.maxRetries ?? 2 },
    });

    // ─── Convert tools to ToolDefinition format ───
    const toolDefs: ToolDefinition<any, any, any>[] = input.tools.map((tool) => ({
      name: tool.name,
      label: tool.label ?? tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: async (
        toolCallId: string,
        params: unknown,
        signal: AbortSignal | undefined,
        onUpdate: AgentToolUpdateCallback<any> | undefined,
      ) => {
        const result = await tool.execute(toolCallId, params, signal, onUpdate);
        return result;
      },
    }));

    // ─── Create AgentSession ───
    const sessionOptions: CreateAgentSessionOptions = {
      model,
      noTools: 'builtin',
      customTools: toolDefs,
      resourceLoader,
      authStorage,
      modelRegistry,
      sessionManager,
      settingsManager,
      ...(config.thinkingLevel !== undefined && {
        thinkingLevel: config.thinkingLevel,
      }),
    };

    const { session: piSession } = await createAgentSession(sessionOptions);

    // ─── Wire beforeToolCall for pause support ───
    if (input.hooks.beforeToolCall) {
      const sdkHook = input.hooks.beforeToolCall;
      piSession.agent.beforeToolCall = async (btc: BeforeToolCallContext) => {
        const result = await sdkHook(
          btc.toolCall.name,
          (btc.args as Record<string, unknown>) ?? {},
        );
        if (result === 'deny') {
          return { block: true, reason: 'Denied by interceptor' };
        }
        if (result === 'pause') {
          return { block: true, reason: '__pause__' };
        }
        return undefined;
      };
    }

    // ─── Bridge push events → async iterable ───
    const eventQueue: (AgentEvent | AgentSessionEvent)[] = [];
    let done = false;
    let resolveWaiting: (() => void) | null = null;
    let rejectWaiting: ((err: Error) => void) | null = null;

    function push(event: AgentEvent | AgentSessionEvent): void {
      eventQueue.push(event);
      if (resolveWaiting) {
        const r = resolveWaiting;
        resolveWaiting = null;
        rejectWaiting = null;
        r();
      }
    }

    const unsubscribe = piSession.subscribe((rawEvent) => {
      push(rawEvent as AgentEvent | AgentSessionEvent);
    });

    const timeoutMs = config.timeoutMs;
    const timeoutId = setTimeout(() => {
      piSession.abort().catch(() => { });
      push({
        type: 'agent_end',
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: '' }],
            stopReason: 'error',
            errorMessage: `Agent timed out after ${timeoutMs}ms`,
            timestamp: Date.now(),
          },
        ],
      } as AgentEvent);
      done = true;
      if (rejectWaiting) {
        rejectWaiting(new Error('timeout'));
        resolveWaiting = null;
        rejectWaiting = null;
      }
    }, timeoutMs);

    const promptMessage = input.resume
      ? (input.resume.payload.feedback ?? config.userMessage)
      : config.userMessage;

    if (input.resume?.messages) {
      for (const msg of input.resume.messages) {
        piSession.sessionManager.appendMessage(msg as Message);
      }
    }

    const promptPromise = piSession
      .prompt(promptMessage)
      .catch((err) => {
        push({
          type: 'agent_end',
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: '' }],
              stopReason: 'error',
              errorMessage: err?.message ?? String(err),
              timestamp: Date.now(),
            },
          ],
        } as AgentEvent);
      })
      .finally(() => {
        done = true;
        if (resolveWaiting) {
          const r = resolveWaiting;
          resolveWaiting = null;
          rejectWaiting = null;
          r();
        }
      });

    // ─── Drain events to consumer ───
    try {
      while (true) {
        while (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        }
        if (done) return;
        await new Promise<void>((resolve, reject) => {
          resolveWaiting = resolve;
          rejectWaiting = reject;
        });
      }
    } finally {
      clearTimeout(timeoutId);
      unsubscribe();
      await promptPromise.catch(() => {});
      piSession.dispose();
    }
  }
}
