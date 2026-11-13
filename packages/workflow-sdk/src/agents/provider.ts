/**
 * Agent provider port — the seam between a workflow's agent step and whoever
 * actually runs the agent.
 *
 * The SDK ships one agent implementation ({@link AgentStep}, which drives an
 * LLM directly through a pi-mono runtime). That works when the SDK owns the
 * agent: the step config carries the system prompt, the tool list and the turn
 * budget, and the SDK drives the loop.
 *
 * It does not work when the *host* already owns agent lifecycle. In xyne-spaces
 * agents live in claw; in xyne-search they live in an `agents` table. In both
 * cases the prompt, tools, MCP connections and model are the host's to resolve
 * — a workflow step should name an agent and hand it a task, not re-specify it.
 *
 * A provider is that: the host's agent platform, behind a port. It resolves
 * config into a run and reports back; the step keeps the workflow contract
 * (output shape, JSON repair, citations, artifacts). See ./host-agent-step.ts.
 *
 * Two transports, because hosts genuinely have both:
 *
 *  - {@link SyncAgentCapability} streams the run. The step holds a worker slot
 *    for its duration and forwards progress to the execution viewer. Right for
 *    a workflow someone is watching.
 *  - {@link AsyncAgentCapability} dispatches the run and parks the step. The
 *    worker slot is released and the execution resumes on callback. Right for
 *    headless automations, and for agents that run for a long time.
 *
 * A provider may implement either or both. Where it implements both, the choice
 * is per-invocation — the same agent, watched or not — so it belongs in step
 * config, not in the provider's identity.
 *
 * Deliberately free of pi-mono imports.
 */

import type { z } from 'zod';
import type { Attachment } from '../common/attachment.js';
import type { StepExecutionContext } from '../steps/base-step.js';
import type { ResumePayload } from '../common/resume-payload.js';
import type { ResponseDefect, ToolCallRecord } from './contract.js';

// ─── Agent Descriptor ───

/**
 * One selectable agent, as shown in the step's agent picker.
 *
 * Returned by {@link BaseAgentProvider.listAgents} and served through the
 * step's `getOptions` — never baked into the config JSON Schema, which is
 * generated once per process and has no tenant context.
 */
export interface AgentDescriptor {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
}

// ─── Run Input ───

/** What the step hands a provider for one invocation. */
export interface AgentRunInput {
  /** The instruction for this run, with workflow refs already resolved. */
  task: string;
  /** Input documents the agent should have access to. */
  attachments: Attachment[];
  /** True when the step expects a JSON object back rather than free text. */
  expectJson: boolean;
  /** The JSON Schema the response should match. Present only when `expectJson`. */
  outputSchema?: Record<string, unknown>;
  /** True when every data point in the response must carry a source citation. */
  cite: boolean;
  /** Aborted when the step's wall-clock budget expires or the execution is cancelled. */
  signal: AbortSignal;
  /**
   * Set when re-prompting after an unusable response. Providers should feed
   * the defect back to the agent rather than starting a fresh conversation.
   */
  repair?: { attempt: number } & ResponseDefect;
  /**
   * Set when the step waits for a reply after each answer (`waitForReply`): the
   * conversation to keep going. `id` is the same for every turn of this step's
   * conversation; `turn` counts them from 0. On a later turn, `task` is the
   * person's reply — continue the conversation `id` with it rather than
   * starting a new one. How is the provider's business (a session on its
   * backend, stored messages, …); one that ignores this starts afresh.
   */
  conversation?: { id: string; turn: number };
}

// ─── Run Events ───

/**
 * What a streaming run reports back.
 *
 * A provider translates its own transport (SSE frames, a websocket, an
 * in-process iterator) into these. Failures are thrown, not yielded — a
 * provider that ends without a `done` event is treated as a failed run.
 */
export type AgentRunEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text?: string }
  | { type: 'tool_start'; toolCallId: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool_end'; toolCallId: string; tool: string; result: unknown }
  /** A file the agent produced. The step stores it; the provider only yields bytes. */
  | { type: 'artifact'; name: string; mimeType: string; bytes: Uint8Array }
  | { type: 'done'; result: AgentRunResult };

/**
 * The outcome of one agent invocation.
 *
 * Note there are no attachments here: artifacts arrive as events and are
 * persisted by the step through `ctx.files`, so storage policy stays in the
 * SDK rather than being re-implemented by every provider.
 */
export interface AgentRunResult {
  /** The agent's response text, unparsed — the step shapes it per `outputType`. */
  text: string;
  toolCalls: ToolCallRecord[];
  turnCount: number;
  usage: { inputTokens: number; outputTokens: number };
  /**
   * Artifacts the provider resolved itself.
   *
   * Streaming providers should leave this unset and yield `artifact` events
   * instead, so the step persists the bytes through `ctx.files` and storage
   * policy stays in one place. Dispatching providers have no byte stream to
   * intercept — their artifacts arrive as references in the callback payload —
   * so they map them to {@link Attachment} themselves.
   */
  attachments?: Attachment[];
}

// ─── Dispatch Record ───

/**
 * What a parked step remembers about its dispatched run, written under
 * `data.agent` on the step record and handed back to {@link
 * AsyncAgentCapability.collect}.
 *
 * `provider` is stamped so a provider swap between dispatch and callback is
 * caught rather than silently mis-resolved. `externalRef` is the correlation
 * key: the SDK does not persist the one passed to `ctx.pause`, so this is the
 * durable copy a host's callback route matches against. `attempt` carries the
 * repair budget across the pause boundary, since the async repair loop is
 * re-entry rather than iteration.
 */
export interface AgentDispatchRecord {
  provider: string;
  attempt: number;
  externalRef: string;
  /** The conversation the dispatched run belongs to, when the step keeps one. */
  conversation?: { id: string; turn: number };
}

// ─── Provider ───

/**
 * A host's agent platform, behind a port.
 *
 * `TConfig` is the provider's own slice of step config — typically just the
 * agent reference, since everything else about the agent is the host's to
 * resolve. The step merges it with the shared contract fields.
 *
 * `TCtx` is the host's authorization context, used only by {@link listAgents},
 * which is called from a request route rather than from step execution.
 */
export abstract class BaseAgentProvider<
  TConfig extends z.ZodTypeAny = z.ZodTypeAny,
  TCtx = unknown,
> {
  /** Human-readable provider name. Also stamped on paused step records so a
   *  provider swap mid-flight is caught rather than silently mis-resolved. */
  abstract readonly name: string;

  /** The provider's config fields, merged into the step's config schema. */
  abstract readonly configSchema: TConfig;

  /**
   * List the agents this caller may run. Backs the step's agent picker: mark the
   * config field that names the agent with `withOptions`, and the step answers
   * the editor's options request for it from here.
   *
   * Omit when the provider's config names an agent some other way (a free-text
   * id, a fixed single agent); the field then stays a plain text box.
   */
  listAgents?(ctx: TCtx): Promise<AgentDescriptor[]>;

  /**
   * Customize the JSON Schema generated from {@link configSchema} — the same
   * hook steps have, scoped to the provider's own fields.
   *
   * Note this runs once per process with no tenant context, so it can inject
   * static metadata (formats, enums over process-global lists) but never a
   * per-workspace list. That is what {@link listAgents} is for.
   */
  decorateConfigSchema?(jsonSchema: Record<string, unknown>): Record<string, unknown>;
}

// ─── Capabilities ───

/**
 * Stream the run and report progress as it happens.
 *
 * The step consumes the iterable to completion, so a provider holding an open
 * connection must release it from the generator's `finally` — the step may stop
 * consuming early (timeout, abort, workflow cancellation).
 */
export interface SyncAgentCapability<TConfig extends z.ZodTypeAny = z.ZodTypeAny> {
  run(
    config: z.infer<TConfig>,
    input: AgentRunInput,
    ctx: StepExecutionContext,
  ): AsyncIterable<AgentRunEvent>;
}

/**
 * Dispatch the run and let the step park until the host calls back.
 *
 * `dispatch` returns a correlation reference the host's callback route carries;
 * the step persists it and pauses. `collect` runs on resume and turns the
 * parked record plus the callback payload into a result.
 */
export interface AsyncAgentCapability<TConfig extends z.ZodTypeAny = z.ZodTypeAny> {
  dispatch(
    config: z.infer<TConfig>,
    input: AgentRunInput,
    ctx: StepExecutionContext,
  ): Promise<{ externalRef: string }>;

  /**
   * Turn the host's callback into a result.
   *
   * `payload` is what the host passed to `runtime.resume()` — a dispatching
   * provider typically reads its own envelope out of `payload.data`. `record`
   * is what this provider stored when it dispatched, so a provider that needs
   * its own correlation reference has it without going near the step row.
   */
  collect(
    payload: ResumePayload,
    record: AgentDispatchRecord,
    config: z.infer<TConfig>,
    ctx: StepExecutionContext,
  ): Promise<AgentRunResult>;
}

/**
 * Resolve which transport an invocation should take.
 *
 * A provider implementing exactly one capability decides it; one implementing
 * both defers to step config, where the author chose per invocation.
 */
export function resolveAgentMode<TConfig extends z.ZodTypeAny, TCtx>(
  provider: BaseAgentProvider<TConfig, TCtx>,
  mode: unknown,
): 'sync' | 'async' {
  const sync = supportsSync(provider);
  const async = supportsAsync(provider);
  if (sync && async) return mode === 'async' ? 'async' : 'sync';
  if (async) return 'async';
  if (sync) return 'sync';
  throw new Error(
    `Agent provider "${provider.name}" implements neither SyncAgentCapability nor AsyncAgentCapability`,
  );
}

/** A provider paired with at least one transport. */
export type AgentProvider<
  TConfig extends z.ZodTypeAny = z.ZodTypeAny,
  TCtx = unknown,
> = BaseAgentProvider<TConfig, TCtx> &
  (SyncAgentCapability<TConfig> | AsyncAgentCapability<TConfig>);

// ─── Capability Detection ───

export function supportsSync<TConfig extends z.ZodTypeAny, TCtx>(
  provider: BaseAgentProvider<TConfig, TCtx>,
): provider is BaseAgentProvider<TConfig, TCtx> & SyncAgentCapability<TConfig> {
  return typeof (provider as { run?: unknown }).run === 'function';
}

export function supportsAsync<TConfig extends z.ZodTypeAny, TCtx>(
  provider: BaseAgentProvider<TConfig, TCtx>,
): provider is BaseAgentProvider<TConfig, TCtx> & AsyncAgentCapability<TConfig> {
  return typeof (provider as { dispatch?: unknown }).dispatch === 'function'
    && typeof (provider as { collect?: unknown }).collect === 'function';
}
