/**
 * PiMonoRuntime — concrete BaseAgentRuntime implementation using pi-mono.
 *
 * Wraps pi-mono's `agentLoop` / `agentLoopContinue` functions.
 * Uses LiteLLM as the provider (OpenAI-compatible proxy).
 *
 * The runtime is thin by design — AgentStep handles tool resolution,
 * interceptor chain, event consumption, and pause/resume orchestration.
 */

import { z } from 'zod';
import { agentLoop, agentLoopContinue } from '@earendil-works/pi-agent-core';
import type {
  AgentEvent,
  AgentContext,
  AgentLoopConfig,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  AfterToolCallResult,
} from '@earendil-works/pi-agent-core';
import type { Message, Model } from '@earendil-works/pi-ai';
import { BaseAgentRuntime } from './base-runtime.js';
import type { AgentCapabilities, AgentInput } from './types.js';
import type { StepExecutionContext } from '../steps/base-step.js';

// ─── Config Schema ───

export const PiMonoConfigSchema = z.object({
  model: z.string().optional(),
  /** System prompt for the agent. */
  systemPrompt: z.string(),
  /** User message to start the conversation. */
  userMessage: z.string(),
  /** LLM temperature. */
  temperature: z.number().optional(),
  /** Max tokens in the response. */
  maxTokens: z.number().optional(),
  /** Thinking level for reasoning models. */
  thinkingLevel: z
    .enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
    .optional(),
});

export type PiMonoConfig = z.infer<typeof PiMonoConfigSchema>;

// ─── Runtime Options ───

export interface PiMonoRuntimeOptions {
  /** LiteLLM base URL (e.g. https://grid.ai.juspay.net/). */
  baseUrl: string;
  /** LiteLLM API key. */
  apiKey: string;
  model?: string | undefined;
  /** Pi-ai API type. Default: 'openai-responses' (LiteLLM is OpenAI-compatible). */
  api?: string | undefined;
}

// ─── Runtime ───

export class PiMonoRuntime extends BaseAgentRuntime<typeof PiMonoConfigSchema> {
  override readonly name = 'pi-mono';
  override readonly capabilities: AgentCapabilities = {
    streaming: true,
    toolUse: true,
    hooks: true,
    multiTurn: true,
  };
  override readonly configSchema = PiMonoConfigSchema;

  constructor(private readonly options: PiMonoRuntimeOptions) {
    super();
  }

  override async *execute(
    config: PiMonoConfig,
    input: AgentInput,
    _ctx: StepExecutionContext,
  ): AsyncIterable<AgentEvent> {
    const modelId = config.model ?? this.options.model ?? 'claude-sonnet-4-20250514';
    const model: Model<string> = {
      id: modelId,
      name: modelId,
      api: this.options.api ?? 'openai-responses',
      provider: 'litellm',
      baseUrl: this.options.baseUrl,
      reasoning: config.thinkingLevel != null && config.thinkingLevel !== 'off',
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: config.maxTokens ?? 8192,
    };

    // 2. Build AgentLoopConfig
    const apiKey = this.options.apiKey;
    const loopConfig: AgentLoopConfig = {
      model,
      convertToLlm: defaultConvertToLlm,
      getApiKey: () => apiKey,
      ...(config.temperature !== undefined && {
        temperature: config.temperature,
      }),
      ...(config.maxTokens !== undefined && { maxTokens: config.maxTokens }),
      ...(config.thinkingLevel && config.thinkingLevel !== 'off' && {
        reasoning: config.thinkingLevel,
      }),
      ...this.buildPiMonoHooks(input),
    };

    // 3. Build context
    const context: AgentContext = {
      systemPrompt: config.systemPrompt,
      messages: input.resume?.messages ?? [],
      ...(input.tools.length > 0 && { tools: input.tools }),
    };

    // 4. Run or resume
    if (input.resume) {
      yield* agentLoopContinue(context, loopConfig, input.signal);
    } else {
      const prompts = [
        {
          role: 'user' as const,
          content: config.userMessage,
          timestamp: Date.now(),
        },
      ];
      yield* agentLoop(prompts, context, loopConfig, input.signal);
    }
  }

  // ─── Private ───

  private buildPiMonoHooks(input: AgentInput): Pick<
    AgentLoopConfig,
    'beforeToolCall' | 'afterToolCall'
  > {
    const hooks: Pick<AgentLoopConfig, 'beforeToolCall' | 'afterToolCall'> = {};

    if (input.hooks.beforeToolCall) {
      const sdkHook = input.hooks.beforeToolCall;
      hooks.beforeToolCall = async (
        btc: BeforeToolCallContext,
      ): Promise<BeforeToolCallResult | undefined> => {
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
        return undefined; // 'allow'
      };
    }

    if (input.hooks.afterToolCall) {
      const sdkHook = input.hooks.afterToolCall;
      hooks.afterToolCall = async (
        atc: AfterToolCallContext,
      ): Promise<AfterToolCallResult | undefined> => {
        await sdkHook(
          atc.toolCall.name,
          (atc.args as Record<string, unknown>) ?? {},
          atc.result,
        );
        return undefined;
      };
    }

    return hooks;
  }
}

// ─── Helpers ───

/**
 * Default message converter — filters for standard LLM message types.
 * Matches pi-mono's built-in default.
 */
function defaultConvertToLlm(messages: unknown[]): Message[] {
  return (messages as Array<{ role: string }>).filter(
    (m) =>
      m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult',
  ) as Message[];
}
