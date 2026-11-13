/**
 * BaseAgentRuntime — abstract class for LLM runtime implementations.
 *
 * Returns `AsyncIterable<AgentEvent>` (pi-mono type). Single `execute()`
 * method — run and resume use the same entry point (resume context is
 * optional in `AgentInput`).
 *
 * **What the runtime does:**
 * - Sends messages to the LLM
 * - Yields pi-mono AgentEvent stream
 * - Calls tools via hooks
 *
 * **What the runtime does NOT do:**
 * - Tool resolution (AgentStep does this)
 * - HITL / pause decisions (interceptor chain does this)
 * - MCP connections (host-side adapter does this)
 * - Event persistence (AgentStep does this via ctx.emit)
 */

import type { z } from 'zod';
import type { AgentEvent, AgentSessionEvent } from './types.js';
import type { AgentCapabilities, AgentInput } from './types.js';
import type { StepExecutionContext } from '../steps/base-step.js';

export abstract class BaseAgentRuntime<
  TConfig extends z.ZodTypeAny = z.ZodTypeAny,
> {
  abstract readonly name: string;
  abstract readonly capabilities: AgentCapabilities;
  abstract readonly configSchema: TConfig;

  /**
   * Execute the agent. Returns an async iterable of pi-mono events.
   *
   * AgentSessionEvent is a superset of AgentEvent — it adds auto_retry_start/end,
   * compaction_start/end, queue_update, and a willRetry flag on agent_end.
   * Consumers should handle both.
   *
   * - Fresh run: `input.resume` is undefined
   * - Resuming after pause: `input.resume` contains conversation history + user's response
   */
  abstract execute(
    config: z.infer<TConfig>,
    input: AgentInput,
    ctx: StepExecutionContext,
  ): AsyncIterable<AgentEvent | AgentSessionEvent>;
}
