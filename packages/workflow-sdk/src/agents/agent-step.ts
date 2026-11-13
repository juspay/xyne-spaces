/**
 * AgentStep — orchestrator step that runs an LLM agent within a workflow.
 *
 * Extends BaseActionStep. Receives a BaseAgentRuntime via composition (not
 * inheritance). Handles tool resolution, interceptor chain, event
 * consumption, pause/resume, and capability-based degradation.
 *
 * All configuration (tools, model, system prompt, MCP servers) comes from
 * per-workflow config — nothing is baked in at registration.
 */

import { z } from 'zod';
import { Readable } from 'node:stream';
import type { AgentEvent, AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai';
import { BaseActionStep } from '../steps/base-step.js';
import type { StepExecutionContext } from '../steps/base-step.js';
import type { StepType } from '../types/step-types.js';
import type { StepCategory } from '../types/categories.js';
import type { BaseAgentRuntime } from './base-runtime.js';
import type { AgentToolRegistry } from './tool-registry.js';
import type { WorkflowTool, ToolExecutionContext } from './tool-types.js';
import { markAttachmentFields } from '../common/attachment.js';
import {
  AgentResultSchema,
  agentContractFields,
  attachmentsField,
  classifyResponse,
  declaredSchema,
  jsonRepairRetriesField,
  resolveAgentOutputJsonSchema,
  shapeAgentResponse,
  withTimeout,
} from './contract.js';
import type { Attachment } from '../common/attachment.js';
import { zodToJsonSchemaRecord } from '../util/schema-convert.js';
import {
  labelSources,
  attachmentRefBase,
  citationSystemNote,
} from './citation-resolve.js';
import { bindSandboxSession } from '../sandbox/types.js';
import type { SandboxHandle, SandboxSession } from '../sandbox/types.js';
import type { StorageScope } from '../storage/types.js';
import type { ProducedFile } from './tool-types.js';
import {
  runInterceptorChain,
  type ToolInterceptor,
} from './interceptor.js';
import { ApprovalGateInterceptor } from './interceptors/approval-gate.js';
import { ToolLoggingInterceptor } from './interceptors/tool-logger.js';
import type {
  AgentResult,
  AgentPauseState,
  AgentHooks,
  AgentInput,
  PauseRequest,
  ResumePayload,
} from './types.js';

// ─── Config Schema ───

export const AgentStepConfigSchema = z.object({
  systemPrompt: z.string().describe('Instructions that define the agent\'s behavior and capabilities'),
  userMessage: z.string().describe('The user message or task prompt sent to the agent'),
  tools: z.array(z.string()).optional().describe('Tool names the agent is allowed to use'),
  requireApproval: z.array(z.string()).optional().describe('Tool names that require human approval before execution'),
  maxTurns: z.number().int().min(1).default(10).describe('Maximum number of agent reasoning turns'),
  toolTimeout: z.number().int().positive().default(30_000).describe('Timeout per tool call in milliseconds'),
  attachments: attachmentsField(
    'Input documents mounted into the sandbox at /mnt/files. Bind to a ref, e.g. {{trigger.attachments}}',
  ),
  outputType: agentContractFields.outputType,
  outputSchema: agentContractFields.outputSchema,
  cite: agentContractFields.cite,
  jsonRepairRetries: jsonRepairRetriesField(
    'When the response is empty (any outputType), or — for outputType "json" — not valid JSON, re-prompt the agent IN THE SAME conversation (with the reason/parse error) up to this many times before returning the last response as-is.',
  ),
  maxRetries: z.number().int().min(0).default(2)
    .describe('Max auto-retry attempts for transient LLM errors (429, 5xx, network). Default: 2.'),
  timeoutMs: agentContractFields.timeoutMs,
});

export type AgentStepConfig = z.infer<typeof AgentStepConfigSchema>;

/** Extract text content from an AssistantMessage.
 *
 * Tolerant of the shapes different providers/runtimes return for `content`:
 * an array of content blocks (pi-ai), a plain string (OpenAI/LiteLLM-style),
 * or null/undefined (tool-call-only turns). */
function extractResponseText(message: AssistantMessage): string {
  const content: unknown = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (c): c is { type: 'text'; text: string } =>
        !!c && typeof c === 'object' && (c as { type?: unknown }).type === 'text'
        && typeof (c as { text?: unknown }).text === 'string',
    )
    .map((c) => c.text)
    .join('');
}

/**
 * Tell the agent which uploaded files are available, so it knows to read them
 * via `run_code` (otherwise it has no idea attachments exist). Appended to the
 * system prompt when input attachments were mounted into the sandbox.
 */
function attachmentsSystemNote(files: string[], refBase?: string): string {
  // With a ref base, name each file's ref alongside its path — that's what the
  // agent cites when it takes a value from a mounted document. Mount order
  // mirrors the resolved attachment array, so index i is `<base>.i`.
  const list = refBase
    ? files.map((f, i) => `/mnt/files/${f} (ref: ${refBase}.${String(i)})`).join(', ')
    : files.map((f) => `/mnt/files/${f}`).join(', ');
  return (
    `\n\nThe user attached ${files.length} file(s), available in the sandbox at: ${list}. `
    + `Use the run_code tool to read them (e.g. open the file under /mnt/files) before responding. `
    + `Write any files you generate to /mnt/output.`
  );
}

// ─── AgentStep ───

/** How large a document may be to mount into an agent's sandbox. */
const MAX_AGENT_MOUNT_BYTES = 8 * 1024 * 1024;

export class AgentStep extends BaseActionStep<
  typeof AgentStepConfigSchema,
  AgentResult
> {
  override readonly type: StepType = 'RUN_AGENT';
  override readonly name = 'Run Agent';
  override readonly description = 'Execute an LLM agent with tools';
  override readonly configSchema = AgentStepConfigSchema;
  override readonly outputSchema = AgentResultSchema;
  override readonly category: StepCategory = 'ai';

  constructor(
    private readonly runtime: BaseAgentRuntime,
    private readonly toolRegistry: AgentToolRegistry,
  ) {
    super();
  }

  override decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    const props = jsonSchema['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (!props) return jsonSchema;
    if (props['outputSchema']) {
      props['outputSchema'] = { ...props['outputSchema'], format: 'json-schema' };
    }

    markAttachmentFields(jsonSchema, ['attachments']);

    const toolNames = this.toolRegistry.getNames();
    if (toolNames.length === 0) return jsonSchema;

    // Inject enum into tools array items so the generic renderer shows multi-select
    if (props['tools']?.['items']) {
      props['tools'] = {
        ...props['tools'],
        items: { ...(props['tools']['items'] as Record<string, unknown>), enum: toolNames },
      };
    }
    // Same for requireApproval
    if (props['requireApproval']?.['items']) {
      props['requireApproval'] = {
        ...props['requireApproval'],
        items: { ...(props['requireApproval']['items'] as Record<string, unknown>), enum: toolNames },
      };
    }

    return jsonSchema;
  }

  override resolveOutputJsonSchema(config: Record<string, unknown>): Record<string, unknown> {
    return resolveAgentOutputJsonSchema(config);
  }

  override async execute(
    config: AgentStepConfig,
    ctx: StepExecutionContext,
  ): Promise<AgentResult> {
    // Conversation continuity: when a prior run left messages (review-gate
    // retry or rerunFromStep), continue the conversation with the new
    // userMessage as additional context. The agent sees the full history.
    const priorMessages = extractPriorMessages(ctx.priorState);
    if (priorMessages && priorMessages.length > 0) {
      return this.continueConversation(priorMessages, config, ctx);
    }

    // 1. Resolve tools from registry
    const workflowTools = config.tools
      ? this.toolRegistry.resolve(config.tools)
      : [];

    const bag = await this.openToolRuntime(config, ctx);
    try {
      const runConfig = this.withPromptNotes(config, bag.mountedFiles, ctx);
      const piTools = this.convertTools(workflowTools, config.toolTimeout, ctx, bag.extras);

      const effectiveMaxTurns = this.runtime.capabilities.multiTurn
        ? config.maxTurns
        : 1;
      const interceptors = this.buildInterceptors(config, ctx);
      const hooks = this.buildHooks(interceptors, ctx);

      const events = this.runtime.execute(
        runConfig,
        {
          tools: this.runtime.capabilities.toolUse ? piTools : [],
          hooks: this.runtime.capabilities.hooks ? hooks : {},
          signal: ctx.runtime.metadata['signal'] as AbortSignal ?? new AbortController().signal,
        },
        ctx,
      );

      const { result, state } = await this.consumeEvents(events, ctx, effectiveMaxTurns);
      const signal = (ctx.runtime.metadata['signal'] as AbortSignal)
        ?? new AbortController().signal;
      const repaired = await this.repairResponse(
        result, state, runConfig, config, ctx, effectiveMaxTurns, piTools, hooks, signal,
      );
      return this.finalizeResult(repaired, config, bag.collected, ctx);
    } finally {
      await bag.dispose();
    }
  }

  /**
   * Continue a prior conversation. Called from `execute()` when
   * `ctx.priorState.messages` is present (review-gate retry or rerunFromStep).
   *
   * Reconstructs the agent input with the full prior conversation and the
   * current `config.userMessage` as the new user turn. The runtime decides
   * how to inject the new message into the message stream.
   */
  private async continueConversation(
    priorMessages: AgentMessage[],
    config: AgentStepConfig,
    ctx: StepExecutionContext,
  ): Promise<AgentResult> {
    const priorState = (ctx.priorState ?? {}) as Partial<AgentPauseState>;
    const workflowTools = config.tools
      ? this.toolRegistry.resolve(config.tools)
      : [];
    const effectiveMaxTurns = this.runtime.capabilities.multiTurn
      ? config.maxTurns
      : 1;

    const completedToolCalls = priorState.completedToolCalls ?? [];
    const usage = priorState.usage ?? { inputTokens: 0, outputTokens: 0 };
    const currentTurn = priorState.currentTurn ?? 0;

    const bag = await this.openToolRuntime(config, ctx);
    try {
      const runConfig = this.withPromptNotes(config, bag.mountedFiles, ctx);
      const piTools = this.convertTools(workflowTools, config.toolTimeout, ctx, bag.extras);
      const interceptors = this.buildInterceptors(config, ctx);
      const hooks = this.buildHooks(interceptors, ctx);

      const input: import('./types.js').AgentInput = {
        tools: this.runtime.capabilities.toolUse ? piTools : [],
        hooks: this.runtime.capabilities.hooks ? hooks : {},
        signal: ctx.runtime.metadata['signal'] as AbortSignal ?? new AbortController().signal,
        resume: {
          messages: priorMessages,
          payload: { action: 'approve', feedback: config.userMessage },
          pauseState: {
            type: 'awaiting_feedback',
            reason: 'Continuing prior conversation',
            prompt: config.userMessage,
            state: {
              messages: priorMessages,
              currentTurn,
              completedToolCalls,
              usage,
            },
          },
        },
      };

      const events = this.runtime.execute(runConfig, input, ctx);
      const { result, state } = await this.consumeEvents(events, ctx, effectiveMaxTurns, {
        messages: priorMessages,
        currentTurn,
        completedToolCalls,
        usage,
      });
      const signal = (ctx.runtime.metadata['signal'] as AbortSignal)
        ?? new AbortController().signal;
      const repaired = await this.repairResponse(
        result, state, runConfig, config, ctx, effectiveMaxTurns, piTools, hooks, signal,
      );
      return this.finalizeResult(repaired, config, bag.collected, ctx);
    } finally {
      await bag.dispose();
    }
  }

  override async onResume(
    rowData: Record<string, unknown>,
    config: AgentStepConfig,
    ctx: StepExecutionContext,
  ): Promise<AgentResult> {
    const pauseState = rowData as unknown as AgentPauseState;
    const resumePayload = ctx.runtime.metadata['resumePayload'] as ResumePayload | undefined;
    const pauseRequest = ctx.runtime.metadata['pauseRequest'] as PauseRequest | undefined;

    if (resumePayload?.action === 'abort') {
      return {
        response: pauseState.messages.length > 0
          ? 'Agent execution aborted by user.'
          : '',
        toolCalls: pauseState.completedToolCalls,
        turnCount: pauseState.currentTurn,
        usage: pauseState.usage,
        attachments: [],
      };
    }

    // Resolve tools again (MCP tools may have changed)
    const workflowTools = config.tools
      ? this.toolRegistry.resolve(config.tools)
      : [];
    const effectiveMaxTurns = this.runtime.capabilities.multiTurn
      ? config.maxTurns
      : 1;

    const bag = await this.openToolRuntime(config, ctx);
    try {
      const runConfig = this.withPromptNotes(config, bag.mountedFiles, ctx);
      const piTools = this.convertTools(workflowTools, config.toolTimeout, ctx, bag.extras);
      const interceptors = this.buildInterceptors(config, ctx);
      const hooks = this.buildHooks(interceptors, ctx);

      const input: import('./types.js').AgentInput = {
        tools: this.runtime.capabilities.toolUse ? piTools : [],
        hooks: this.runtime.capabilities.hooks ? hooks : {},
        signal: ctx.runtime.metadata['signal'] as AbortSignal ?? new AbortController().signal,
      };
      if (pauseRequest) {
        input.resume = {
          messages: pauseState.messages,
          payload: resumePayload ?? { action: 'approve' },
          pauseState: pauseRequest,
        };
      }

      const events = this.runtime.execute(runConfig, input, ctx);
      // Consume events, carrying over state from before pause
      const { result, state } = await this.consumeEvents(events, ctx, effectiveMaxTurns, pauseState);
      const repairSignal = (ctx.runtime.metadata['signal'] as AbortSignal)
        ?? new AbortController().signal;
      const repaired = await this.repairResponse(
        result, state, runConfig, config, ctx, effectiveMaxTurns, piTools, hooks, repairSignal,
      );
      return this.finalizeResult(repaired, config, bag.collected, ctx);
    } finally {
      await bag.dispose();
    }
  }

  // ─── Private: Tool conversion ───

  private convertTools(
    tools: WorkflowTool[],
    timeoutMs: number,
    ctx: StepExecutionContext,
    extras?: Partial<ToolExecutionContext>,
  ): AgentTool[] {
    return tools.map((tool) => ({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: this.zodToJsonSchema(tool.inputSchema),
      execute: async (
        _toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
      ) => {
        const result = await withTimeout(
          tool.execute(params as Record<string, unknown>, {
            signal: signal ?? new AbortController().signal,
            log: ctx.log,
            ...extras,
          }),
          timeoutMs,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          details: result,
        };
      },
    }));
  }

  /**
   * Convert a Zod schema to a JSON Schema object for the model's tool parameters.
   *
   * Uses the same real converter the chat path uses ({@link zodToJsonSchemaRecord}).
   * The previous implementation guarded on a `schema.jsonSchema()` method that does
   * not exist on `z.object()` instances in the installed Zod (3.25.x), so it
   * SILENTLY fell back to `{ type: 'object' }` — a parameterless schema. The model
   * then never saw a tool's real arguments and had to guess their names (e.g.
   * `command` vs `code` for run_code), which failed intermittently. A proper
   * conversion emits the actual `properties`, so the model uses the real names.
   */
  private zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
    return zodToJsonSchemaRecord(schema);
  }

  // ─── Private: Interceptors ───

  private buildInterceptors(
    config: AgentStepConfig,
    ctx: StepExecutionContext,
  ): ToolInterceptor[] {
    const interceptors: ToolInterceptor[] = [
      new ToolLoggingInterceptor(ctx.emit.bind(ctx)),
    ];
    if (config.requireApproval && config.requireApproval.length > 0) {
      interceptors.push(new ApprovalGateInterceptor(config.requireApproval));
    }
    return interceptors;
  }

  private buildHooks(
    interceptors: ToolInterceptor[],
    _ctx: StepExecutionContext,
  ): AgentHooks {
    return {
      async beforeToolCall(tool, args) {
        return runInterceptorChain(interceptors, tool, args);
      },
      // Note: the tool_call end event is emitted from consumeEvents
      // (tool_execution_end) with the toolCallId, so we don't emit it here too
      // (that produced duplicate timeline entries).
    };
  }

  // ─── Private: Event consumption ───

  private async consumeEvents(
    events: AsyncIterable<AgentEvent | AgentSessionEvent>,
    ctx: StepExecutionContext,
    maxTurns: number,
    initialState?: AgentPauseState,
  ): Promise<{ result: AgentResult; state: AgentPauseState }> {
    const state: AgentPauseState = initialState ?? {
      messages: [],
      currentTurn: 0,
      completedToolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };

    // Track args from tool_execution_start for use in tool_execution_end
    const pendingToolArgs = new Map<string, Record<string, unknown>>();

    for await (const event of events) {
      switch (event.type) {
        case 'turn_start':
          state.currentTurn++;
          if (state.currentTurn > maxTurns) {
            ctx.log.warn(`Agent exceeded maxTurns (${maxTurns}), stopping`);
            return { result: this.buildResult(state), state };
          }
          break;

        case 'message_start':
          ctx.emit({ type: 'thinking', data: { phase: 'start' } });
          break;

        case 'message_update':
          // Partial streaming deltas — intentionally NOT emitted.
          break;

        case 'message_end': {
          const endMsg = (event as { message: AgentMessage }).message;
          state.messages.push(endMsg);
          // Only assistant messages carry array content + usage
          if ('role' in endMsg && endMsg.role === 'assistant') {
            const assistantMsg = endMsg as AssistantMessage;

            // AgentSession retries transient errors (429, 5xx, network) internally,
            // but if retries are exhausted, the error message flows through here.
            // Without this check, the error is silently swallowed and the step
            // completes with garbage output.
            // Guard on willRetry and auto_retry_start: an error that pi is about
            // to retry must NOT fail the step — only throw once the retry budget
            // is exhausted (auto_retry_end with success: false).
            if (assistantMsg.stopReason === 'error') {
              throw new Error(
                (assistantMsg as any).errorMessage ?? 'LLM call failed',
              );
            }
            if (assistantMsg.stopReason === 'aborted') {
              throw new Error(
                (assistantMsg as any).errorMessage ?? 'Agent run aborted',
              );
            }

            if (assistantMsg.usage) {
              state.usage.inputTokens += assistantMsg.usage.input;
              state.usage.outputTokens += assistantMsg.usage.output;
            }
            ctx.emit({
              type: 'substep',
              data: { type: 'message', content: extractResponseText(assistantMsg) },
            });
          }
          break;
        }

        case 'tool_execution_start': {
          const startEvt = event as {
            toolCallId: string;
            toolName: string;
            args: unknown;
          };
          pendingToolArgs.set(
            startEvt.toolCallId,
            (startEvt.args as Record<string, unknown>) ?? {},
          );
          ctx.emit({
            type: 'tool_call',
            data: {
              tool: startEvt.toolName,
              args: startEvt.args,
              phase: 'start',
              toolCallId: startEvt.toolCallId,
            },
          });
          break;
        }

        case 'tool_execution_end': {
          const endEvt = event as {
            toolCallId: string;
            toolName: string;
            result: unknown;
            isError: boolean;
          };
          const toolArgs = pendingToolArgs.get(endEvt.toolCallId) ?? {};
          pendingToolArgs.delete(endEvt.toolCallId);
          state.completedToolCalls.push({
            name: endEvt.toolName,
            args: toolArgs,
            result: endEvt.result,
            durationMs: 0, // pi-mono doesn't provide timing; host can enrich
          });
          ctx.emit({
            type: 'tool_call',
            data: {
              tool: endEvt.toolName,
              result: endEvt.result,
              phase: 'end',
              toolCallId: endEvt.toolCallId,
              isError: endEvt.isError,
            },
          });
          break;
        }

        case 'turn_end': {
          const turnEvt = event as {
            message: AssistantMessage;
            toolResults: ToolResultMessage[];
          };
          // Store tool result messages in state for resume
          for (const tr of turnEvt.toolResults) {
            state.messages.push(tr);
          }
          break;
        }

        case 'agent_end':
          // Final event — loop will exit naturally
          break;

        // ── AgentSession-specific events (retry + compaction visibility) ──
        case 'auto_retry_start' as any: {
          const retryEvt = event as {
            attempt: number;
            maxAttempts: number;
            delayMs: number;
            errorMessage?: string;
          };
          ctx.emit({
            type: 'substep',
            data: {
              type: 'retry',
              attempt: retryEvt.attempt,
              maxAttempts: retryEvt.maxAttempts,
              delayMs: retryEvt.delayMs,
              errorMessage: retryEvt.errorMessage,
            },
          });
          break;
        }

        case 'auto_retry_end' as any: {
          const retryEndEvt = event as {
            success: boolean;
            attempt: number;
            finalError?: string;
          };
          ctx.emit({
            type: 'substep',
            data: {
              type: 'retry_end',
              success: retryEndEvt.success,
              attempt: retryEndEvt.attempt,
              finalError: retryEndEvt.finalError,
            },
          });
          break;
        }

        case 'compaction_start' as any: {
          const compactEvt = event as { reason: string };
          ctx.emit({
            type: 'substep',
            data: { type: 'compaction', reason: compactEvt.reason },
          });
          break;
        }

        default:
          // agent_start, tool_execution_update, etc. — ignore
          break;
      }
    }

    return { result: this.buildResult(state), state };
  }

  private buildResult(state: AgentPauseState): AgentResult {
    // Find the last assistant message for the response text
    let response = '';
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      if (msg && 'role' in msg && msg.role === 'assistant') {
        response = extractResponseText(msg as AssistantMessage);
        break;
      }
    }

    return {
      response,
      toolCalls: state.completedToolCalls,
      turnCount: state.currentTurn,
      usage: state.usage,
      attachments: [],
    };
  }

  // ─── Private: Sandbox session + artifact sink (per execution) ───

  /**
   * Open the per-execution tool runtime: an artifact sink (backed by storage)
   * and — when a SandboxAdapter is configured and the `run_code` tool is
   * enabled — one sandbox session with the step's input attachments mounted at
   * `/mnt/files`. Returns the extras to merge into each tool's context, the
   * collected-artifacts array, and a `dispose()` that tears the sandbox down.
   */
  /**
   * Shape the prompt the runtime actually sees: the uploaded-files note, and —
   * when `cite` is on — source labels around every resolved ref plus the
   * citation instruction. Applied at all three execute entry points.
   */
  private withPromptNotes(
    config: AgentStepConfig,
    mountedFiles: string[],
    ctx: StepExecutionContext,
  ): AgentStepConfig {
    let systemPrompt = config.systemPrompt;
    let userMessage = config.userMessage;

    if (mountedFiles.length > 0) {
      const refBase = config.cite
        ? attachmentRefBase(ctx.rawConfig?.['attachments'])
        : undefined;
      systemPrompt += attachmentsSystemNote(mountedFiles, refBase);
    }

    if (config.cite) {
      // The executor already collapsed `userMessage`'s refs into bare values, so
      // re-render it from the raw template — otherwise the agent has the content
      // but no ref to cite it by.
      const raw = ctx.rawConfig?.['userMessage'];
      if (typeof raw === 'string') userMessage = labelSources(raw, ctx.workflow);
      systemPrompt += citationSystemNote(config.outputType);
    }

    if (systemPrompt === config.systemPrompt && userMessage === config.userMessage) {
      return config;
    }
    return { ...config, systemPrompt, userMessage };
  }

  private async openToolRuntime(
    config: AgentStepConfig,
    ctx: StepExecutionContext,
  ): Promise<{
    extras: Partial<ToolExecutionContext>;
    collected: Attachment[];
    mountedFiles: string[];
    dispose: () => Promise<void>;
  }> {
    const collected: Attachment[] = [];
    const mountedFiles: string[] = [];
    // The workflow's typed scope — NOT the metadata bag, which also carries
    // `signal` / `resumePayload` / `pauseRequest` and was being cast wholesale.
    const scope: StorageScope = ctx.runtime.attributes;
    // Withheld rather than failing when the host stores nothing: a tool that
    // cannot keep its output is better off not being offered.
    const addArtifact = ctx.files.available
      ? async (file: ProducedFile): Promise<Attachment> => {
        const att = await ctx.files.put({
          name: file.name,
          mimeType: file.mimeType,
          stream: Readable.from(Buffer.from(file.bytes)),
        });
        collected.push(att);
        return att;
      }
      : undefined;

    const usesRunCode = config.tools?.includes('run_code') ?? false;
    let handle: SandboxHandle | undefined;
    let session: SandboxSession | undefined;

    if (ctx.sandbox && usesRunCode) {
      handle = await ctx.sandbox.create({ scope });
      session = bindSandboxSession(ctx.sandbox, handle);
      // Mount the step's resolved input documents at /mnt/files. The field is a
      // `variableRef` union (Attachment[] | ref-string); by execute() the
      // resolver has replaced any ref with the concrete array, so a non-array
      // here means "nothing bound".
      const inputs = Array.isArray(config.attachments) ? config.attachments : [];
      if (inputs.length > 0 && ctx.files.available) {
        const files = await Promise.all(
          inputs.map(async (a) => ({
            path: `/mnt/files/${a.name}`,
            // A sandbox takes bytes; this is bounded so a large document fails
            // with a sentence rather than the heap.
            bytes: await ctx.files.buffer(a, { maxBytes: MAX_AGENT_MOUNT_BYTES }),
          })),
        );
        await session.writeFiles(files);
        mountedFiles.push(...inputs.map((a) => a.name));
      }
    }

    // Only the two narrow capabilities are exposed to tools; storage/scope/
    // attachments stay internal to this step (used above to mount inputs and to
    // back addArtifact).
    const extras: Partial<ToolExecutionContext> = {
      ...(session ? { sandbox: session } : {}),
      ...(addArtifact ? { addArtifact } : {}),
    };

    const dispose = async (): Promise<void> => {
      if (ctx.sandbox && handle) {
        try {
          await ctx.sandbox.destroy(handle);
        } catch (err) {
          ctx.log.warn(
            `Failed to destroy sandbox: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    };

    return { extras, collected, mountedFiles, dispose };
  }

  /**
   * Re-prompt the agent IN THE SAME conversation when its final response is
   * unusable, so it can correct itself (up to `jsonRepairRetries` times):
   *   - an EMPTY response — for ANY `outputType` (string or json), and
   *   - a non-parseable response — only when `outputType` is 'json' (fed back
   *     with the parser error).
   * A non-empty string response is always accepted. If still unusable after the
   * retries, returns the last result so `finalizeResult` applies its normal
   * handling (the `{text}` fallback for json) — never hard-fails or loops forever.
   */
  private async repairResponse(
    result: AgentResult,
    state: AgentPauseState,
    runConfig: AgentStepConfig,
    config: AgentStepConfig,
    ctx: StepExecutionContext,
    maxTurns: number,
    piTools: AgentInput['tools'],
    hooks: AgentInput['hooks'],
    signal: AbortSignal,
  ): Promise<AgentResult> {
    const expectJson = config.outputType === 'json';
    const maxRetries = config.jsonRepairRetries ?? 3;
    let curResult = result;
    let curState = state;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const raw = typeof curResult.response === 'string'
        ? curResult.response
        : JSON.stringify(curResult.response);
      const check = classifyResponse(
        raw,
        expectJson,
        declaredSchema(config.outputType, config.outputSchema),
      );
      if (check.ok) break;
      const feedback = check.reason === 'empty'
        ? (expectJson
          ? 'Your previous response was empty. Output ONLY the JSON object for this task now — '
          + 'no explanation, no markdown code fences.'
          : 'Your previous response was empty. Provide your complete response now — '
          + 'do not reply with an empty message.')
        : check.reason === 'mismatch'
          ? `Your previous response did not match the required shape: ${check.error}. `
          + `Output ONLY a single JSON object that matches it now — no explanation, no markdown code fences.`
          : `Your previous response was not valid JSON and could not be parsed (parser error: `
          + `${check.error}). Output ONLY a single valid JSON object now — no explanation, `
          + `no markdown code fences.`;
      ctx.log.warn(
        `Agent ${expectJson ? 'JSON ' : ''}output ${check.reason}; re-prompting with feedback `
        + `(attempt ${attempt}/${maxRetries})`,
      );
      const messages: import('@earendil-works/pi-agent-core').AgentMessage[] = [
        ...curState.messages,
        {
          role: 'user',
          content: feedback,
          timestamp: Date.now(),
        } as import('@earendil-works/pi-agent-core').AgentMessage,
      ];
      const input: AgentInput = {
        tools: piTools,
        hooks,
        signal,
        resume: {
          messages,
          payload: { action: 'approve', feedback },
          pauseState: {
            type: 'awaiting_feedback',
            reason: 'JSON repair re-prompt',
            prompt: feedback,
            state: {
              messages,
              currentTurn: curState.currentTurn,
              completedToolCalls: curState.completedToolCalls,
              usage: curState.usage,
            },
          },
        },
      };
      const events = this.runtime.execute(runConfig, input, ctx);
      const next = await this.consumeEvents(events, ctx, maxTurns, {
        messages,
        currentTurn: curState.currentTurn,
        completedToolCalls: curState.completedToolCalls,
        usage: curState.usage,
      });
      curResult = next.result;
      curState = next.state;
    }
    return curResult;
  }

  /**
   * Attach collected artifacts and shape `response` per `outputType`
   * (parse JSON when requested, and split out citations when `cite` is on).
   * Applied to every successful agent result.
   */
  private finalizeResult(
    result: AgentResult,
    config: AgentStepConfig,
    collected: Attachment[],
    ctx: StepExecutionContext,
  ): AgentResult {
    const response = shapeAgentResponse(
      result.response,
      { outputType: config.outputType, cite: config.cite },
      ctx.log,
    );
    return { ...result, response, attachments: collected };
  }
}

/**
 * Pull prior conversation messages out of an opaque `priorState` blob.
 * Returns null if the shape doesn't match a serialized `AgentPauseState`.
 */
function extractPriorMessages(
  priorState: Readonly<Record<string, unknown>> | undefined,
): AgentMessage[] | null {
  if (!priorState) return null;
  const candidate = priorState['messages'];
  if (!Array.isArray(candidate)) return null;
  return candidate as AgentMessage[];
}

