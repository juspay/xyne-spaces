/**
 * HostAgentStep — runs an agent the *host* owns, rather than one the SDK
 * drives.
 *
 * Where {@link AgentStep} asks an author to construct an agent (system prompt,
 * tools, model, turn budget), this asks them to choose one and give it a task.
 * Everything about how that agent behaves — its prompt, its tools, its MCP
 * connections — is resolved by the host's own agent platform behind a
 * {@link BaseAgentProvider}.
 *
 * What stays here is the workflow's contract with the step, and it is identical
 * to the LLM step's: the declared output shape, JSON repair, citation
 * splitting, and artifact persistence. Both steps emit the same
 * {@link AgentResult}, so downstream `{{steps.x.output.response}}` refs bind
 * the same way against either.
 *
 * Registered by the host with its own naming, so a deployment shows the step
 * in the author's vocabulary:
 *
 *     new HostAgentStep(new ClawAgentProvider(deps), {
 *       type: 'RUN_XYNE_AGENT',
 *       name: 'Run Xyne Agent',
 *       description: 'Run an agent from your workspace',
 *     })
 *
 * With `waitForReply`, each answer is shown and the step waits for a reply;
 * the reply runs the next turn in the same conversation (the provider keeps
 * it). A `choice` in the resume data — or an empty reply — ends it: the output
 * is the last answer plus that `choice`.
 *
 * Free of pi-mono imports — a host registering only this step does not pull the
 * LLM runtime into its bundle.
 */

import { z } from 'zod';
import { BaseActionStep } from '../steps/base-step.js';
import { Readable } from 'node:stream';
import type { StepExecutionContext } from '../steps/base-step.js';
import { GateCategory } from '../types/known-types.js';
import type { StepType } from '../types/step-types.js';
import type { StepCategory } from '../types/categories.js';
import { markAttachmentFields } from '../common/attachment.js';
import type { Attachment } from '../common/attachment.js';
import {
  AgentResultSchema,
  agentContractFields,
  attachmentsField,
  classifyResponse,
  declaredSchema,
  isRecord,
  jsonRepairRetriesField,
  resolveAgentOutputJsonSchema,
  shapeAgentResponse,
} from './contract.js';
import type { AgentResult, ResponseDefect } from './contract.js';
import type { ResumePayload } from '../common/resume-payload.js';
import type { FieldOptionsContext, FieldOptionsPage } from '../schema/options.js';
import { resolveAgentMode, supportsAsync, supportsSync } from './provider.js';
import type {
  AgentDispatchRecord,
  AgentRunEvent,
  AgentRunInput,
  AgentRunResult,
  BaseAgentProvider,
} from './provider.js';

// ─── Config Schema ───

/**
 * The fields this step adds on top of the provider's own.
 *
 * `task` is deliberately not called `userMessage`: there is no system prompt to
 * contrast it with here, because the host owns that.
 */
const taskField = z.string()
  .describe('What the agent should do. Supports refs, e.g. {{trigger.body.question}}');

/**
 * Only rendered when the provider implements both transports. Labelled by
 * outcome rather than transport: the author is choosing whether the run holds a
 * worker slot, not which protocol it speaks.
 */
const modeField = z.enum(['sync', 'async']).default('sync')
  .describe('Wait for the result, or continue in the background and resume when the agent reports back');

const hostAgentContractFields = {
  attachments: attachmentsField(
    'Input documents made available to the agent. Bind to a ref, e.g. {{trigger.attachments}}',
  ),
  outputType: agentContractFields.outputType,
  outputSchema: agentContractFields.outputSchema,
  cite: agentContractFields.cite,
  jsonRepairRetries: jsonRepairRetriesField(
    'When the response is empty (any outputType), or — for outputType "json" — not valid JSON, '
    + 're-run the agent with the reason/parse error up to this many times before returning the '
    + 'last response as-is.',
  ),
  timeoutMs: agentContractFields.timeoutMs,
} as const;

const waitForReplyField = z.boolean().default(false)
  .describe('After each answer, wait for a reply and continue the same conversation with it. Ends when they choose where to go next, or send nothing');

const HostAgentBaseSchema = z.object({
  task: taskField,
  mode: modeField,
  waitForReply: waitForReplyField,
  ...hostAgentContractFields,
});

export type HostAgentBaseConfig = z.infer<typeof HostAgentBaseSchema>;

/** The answer, and — for a step that waited for replies — where they chose to go. */
export type HostAgentResult = AgentResult & { choice?: string };

/**
 * Where a conversation stands, kept on the step's record between pauses:
 * waiting on the `agent` for an answer, or on the `person` for a reply.
 */
interface Conversation {
  id: string;
  turn: number;
  waiting: 'agent' | 'person';
  /** The reply that opened this turn; none on the first. */
  reply?: string;
  /** The answer being shown — the output if they end here. */
  answer?: HostAgentResult;
}

// ─── Step Row Readers ───

/**
 * Recover the dispatch record the step wrote when it parked. Absent means this
 * step never dispatched — a row from an older shape, or a resume aimed at the
 * wrong gate — and the caller refuses to collect rather than guessing.
 */
function readDispatchRecord(rowData: Record<string, unknown>): AgentDispatchRecord | undefined {
  const raw = rowData['agent'];
  if (!isRecord(raw)) return undefined;
  const { provider, attempt, externalRef } = raw;
  if (typeof provider !== 'string' || typeof externalRef !== 'string') return undefined;
  return { provider, externalRef, attempt: typeof attempt === 'number' ? attempt : 0 };
}

function readConversation(rowData: Record<string, unknown>): Conversation | undefined {
  const raw = rowData['conversation'];
  return isRecord(raw) && typeof raw['id'] === 'string' ? (raw as unknown as Conversation) : undefined;
}

/** The payload the host passed to `runtime.resume()`, as the executor stored it. */
function readResumePayload(rowData: Record<string, unknown>): ResumePayload | undefined {
  const raw = rowData['resumePayload'];
  if (!isRecord(raw) || typeof raw['action'] !== 'string') return undefined;
  return raw as unknown as ResumePayload;
}

// ─── Options ───

/**
 * How the step presents itself in the builder. All optional — the defaults
 * describe a generic host agent, which is right when a deployment registers
 * exactly one.
 */
export interface HostAgentStepOptions {
  type?: StepType;
  name?: string;
  description?: string;
  icon?: string;
  category?: StepCategory;
}

// ─── Step ───

export class HostAgentStep<
  TProviderConfig extends z.AnyZodObject = z.AnyZodObject,
> extends BaseActionStep<z.AnyZodObject, HostAgentResult> {
  override readonly type: StepType;
  override readonly name: string;
  override readonly description: string;
  override readonly category: StepCategory;
  declare readonly icon?: string;
  override readonly configSchema: z.AnyZodObject;
  override readonly outputSchema = AgentResultSchema;

  constructor(
    private readonly provider: BaseAgentProvider<TProviderConfig, unknown>,
    options: HostAgentStepOptions = {},
  ) {
    super();
    this.type = options.type ?? 'RUN_HOST_AGENT';
    this.name = options.name ?? 'Run Agent';
    this.description = options.description ?? 'Run an agent from your workspace';
    this.category = options.category ?? 'ai';
    if (options.icon !== undefined) this.icon = options.icon;
    // Provider fields first, so the form reads: pick an agent, then say what it
    // should do, then shape the output. `mode` only appears when the provider
    // can actually do both — otherwise it would be a control with one setting.
    const bothTransports = supportsSync(provider) && supportsAsync(provider);
    this.configSchema = provider.configSchema.extend({
      task: taskField,
      ...(bothTransports ? { mode: modeField } : {}),
      waitForReply: waitForReplyField,
      ...hostAgentContractFields,
    });
  }

  override decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    const props = jsonSchema['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (props?.['outputSchema']) {
      props['outputSchema'] = { ...props['outputSchema'], format: 'json-schema' };
    }
    markAttachmentFields(jsonSchema, ['attachments']);
    // The provider decorates its own fields — the agent picker's `format` hint
    // is declared there, since only the provider knows how its agents are named.
    return this.provider.decorateConfigSchema?.(jsonSchema) ?? jsonSchema;
  }

  /**
   * The agent picker. The provider marks the field that names an agent with
   * `withOptions`; it is answered from the provider's `listAgents`, as the
   * person editing — the same picker in every editor that shows this step.
   */
  override async getOptions(ctx: FieldOptionsContext<Record<string, unknown>>): Promise<FieldOptionsPage> {
    if (!this.provider.listAgents) return { items: [] };
    const agents = await this.provider.listAgents(ctx.caller);
    const search = ctx.search?.trim().toLowerCase();
    const wanted = ctx.values ? new Set(ctx.values) : undefined;
    const items = agents
      .filter((a) => (wanted ? wanted.has(a.id) : !search || `${a.name} ${a.id}`.toLowerCase().includes(search)))
      .map((a) => ({
        value: a.id,
        label: a.name,
        ...(a.description ? { description: a.description } : {}),
        ...(a.avatarUrl ? { icon: a.avatarUrl } : {}),
      }));
    return { items };
  }

  override resolveOutputJsonSchema(config: Record<string, unknown>): Record<string, unknown> {
    const schema = resolveAgentOutputJsonSchema(config);
    if (config['waitForReply'] !== true) return schema;
    const properties = { ...(schema['properties'] as Record<string, unknown>), choice: { type: 'string' } };
    return { ...schema, properties };
  }

  override async execute(
    rawConfig: Record<string, unknown>,
    ctx: StepExecutionContext,
  ): Promise<HostAgentResult> {
    const config = rawConfig as HostAgentBaseConfig & z.infer<TProviderConfig>;
    // Same id through every turn of this visit to the step.
    const conversation: Conversation | undefined = config.waitForReply
      ? { id: `${ctx.runtime.executionId}/${ctx.runtime.stepName}`, turn: 0, waiting: 'agent' }
      : undefined;
    return this.answer(config, ctx, conversation);
  }

  /** One turn: run the agent inline, or dispatch it; with a conversation, then wait for the reply. */
  private async answer(
    config: HostAgentBaseConfig & z.infer<TProviderConfig>,
    ctx: StepExecutionContext,
    conversation: Conversation | undefined,
  ): Promise<HostAgentResult> {
    if (resolveAgentMode(this.provider, config.mode) === 'async') return this.dispatch(config, ctx, 0, undefined, conversation);
    const result = await this.runStreaming(config, ctx, conversation);
    return conversation ? this.awaitReply(result, conversation, ctx) : result;
  }

  /** Show the answer and pause for a reply — the core's `feedback` text input. */
  private awaitReply(answer: HostAgentResult, conversation: Conversation, ctx: StepExecutionContext): never {
    const prompt = typeof answer.response === 'string' ? answer.response : JSON.stringify(answer.response, null, 2);
    ctx.pause('waiting for a reply', {
      category: GateCategory.WaitingOnApprover,
      statePatch: {
        conversation: { ...conversation, waiting: 'person', answer },
        // A list, like every prompt now. `statePatch` is untyped, so nothing but
        // this comment and its test keeps that true.
        pauseState: { reason: 'Waiting for a reply', prompt: [prompt], form: { fields: [{ type: 'textarea', name: 'feedback', label: 'Reply' }] } },
      },
    });
  }

  /**
   * Resume after a dispatched run reported back.
   *
   * This is where the repair loop lives for background runs. It cannot be a
   * loop the way the streaming path is — each attempt crosses a pause boundary,
   * so the budget is carried on the step record and the loop is re-entry.
   */
  override async onResume(
    rowData: Record<string, unknown>,
    rawConfig: Record<string, unknown>,
    ctx: StepExecutionContext,
  ): Promise<HostAgentResult> {
    const conversation = readConversation(rowData);
    if (conversation?.waiting === 'person' && conversation.answer) {
      // They replied: a reply is the next turn; a choice, or nothing, ends it.
      const payload = readResumePayload(rowData);
      const choice = typeof payload?.data?.['choice'] === 'string' ? payload.data['choice'] : '';
      const reply = payload?.feedback?.trim() ?? '';
      if (choice || !reply) return { ...conversation.answer, ...(choice ? { choice } : {}) };
      const next: Conversation = { id: conversation.id, turn: conversation.turn + 1, waiting: 'agent', reply };
      return this.answer(rawConfig as HostAgentBaseConfig & z.infer<TProviderConfig>, ctx, next);
    }

    const provider = this.provider;
    if (!supportsAsync(provider)) {
      throw new Error(
        `Agent provider "${provider.name}" has no collect(); it cannot resume a dispatched run.`,
      );
    }
    const config = rawConfig as HostAgentBaseConfig & z.infer<TProviderConfig>;

    const record = readDispatchRecord(rowData);
    if (!record) {
      throw new Error(
        'Step resumed with no agent dispatch record — it was not parked by this step, '
        + 'so there is no run to collect.',
      );
    }
    // A provider swap between dispatch and callback would otherwise hand this
    // provider a correlation reference minted by a different system.
    if (record.provider !== provider.name) {
      throw new Error(
        `Step was dispatched to agent provider "${record.provider}" but "${provider.name}" is registered now; `
        + 'the parked run cannot be collected.',
      );
    }

    const payload = readResumePayload(rowData);
    if (!payload) {
      throw new Error(
        `Step resumed with no payload — ${provider.name} reported back without a result.`,
      );
    }

    const result = await provider.collect(payload, record, config, ctx);
    const expectJson = config.outputType === 'json';
    const verdict = classifyResponse(result.text, expectJson, declaredSchema(config.outputType, config.outputSchema));
    if (verdict.ok) {
      const answer = this.finalize(result, config, ctx, result.attachments ?? []);
      return conversation ? this.awaitReply(answer, conversation, ctx) : answer;
    }

    const attempt = record.attempt;
    const defect: ResponseDefect = {
      reason: verdict.reason,
      ...(verdict.error ? { error: verdict.error } : {}),
    };
    if (attempt >= config.jsonRepairRetries) {
      // Unlike the streaming path, a background run cannot hand back a partial
      // result and let the author see it — nothing is watching. Fail loudly.
      throw new Error(
        `Agent response unusable after ${String(attempt)} repair attempt(s) (${verdict.reason}`
        + `${verdict.error ? `: ${verdict.error}` : ''})`,
      );
    }

    ctx.log.warn(
      `Agent response unusable (${verdict.reason}); re-dispatching `
      + `(${String(attempt + 1)}/${String(config.jsonRepairRetries)})`,
    );
    ctx.emit({
      type: 'substep',
      data: {
        type: 'retry',
        attempt: attempt + 1,
        maxAttempts: config.jsonRepairRetries,
        reason: verdict.reason,
      },
    });
    return this.dispatch(config, ctx, attempt + 1, defect, conversation);
  }

  /**
   * Hand the run to the provider and park the step. Never returns — `ctx.pause`
   * throws, releasing the worker slot until the host calls back.
   */
  private async dispatch(
    config: HostAgentBaseConfig & z.infer<TProviderConfig>,
    ctx: StepExecutionContext,
    attempt: number,
    defect?: ResponseDefect,
    conversation?: Conversation,
  ): Promise<never> {
    const provider = this.provider;
    if (!supportsAsync(provider)) {
      throw new Error(
        `Agent provider "${provider.name}" does not implement dispatch()/collect(); `
        + 'background runs are not available.',
      );
    }
    const signal = (ctx.runtime.metadata['signal'] as AbortSignal | undefined)
      ?? new AbortController().signal;
    const { externalRef } = await provider.dispatch(
      config,
      this.buildInput(config, signal, attempt, defect, conversation),
      ctx,
    );
    const record: AgentDispatchRecord = {
      provider: provider.name,
      attempt,
      externalRef,
      ...(conversation ? { conversation: { id: conversation.id, turn: conversation.turn } } : {}),
    };
    ctx.pause(`waiting on ${provider.name} agent run`, {
      category: GateCategory.WaitingOnApiCall,
      externalRef,
      statePatch: { agent: record, ...(conversation ? { conversation } : {}) },
    });
  }

  /** Run the agent inline, streaming progress, repairing in a loop. */
  private async runStreaming(
    config: HostAgentBaseConfig & z.infer<TProviderConfig>,
    ctx: StepExecutionContext,
    conversation?: Conversation,
  ): Promise<AgentResult> {
    const provider = this.provider;
    if (!supportsSync(provider)) {
      throw new Error(
        `Agent provider "${provider.name}" does not implement a streaming run(). `
        + 'Set mode to "async" to dispatch it instead.',
      );
    }

    const expectJson = config.outputType === 'json';
    const collected: Attachment[] = [];

    // Link the execution's own abort signal to this step's wall-clock budget,
    // so a provider holding a connection is told to let go either way.
    const controller = new AbortController();
    const executionSignal = ctx.runtime.metadata['signal'] as AbortSignal | undefined;
    const onExecutionAbort = (): void => { controller.abort(); };
    executionSignal?.addEventListener('abort', onExecutionAbort, { once: true });
    const timer = setTimeout(() => { controller.abort(); }, config.timeoutMs);
    if (typeof timer === 'object' && 'unref' in timer) {
      (timer as NodeJS.Timeout).unref();
    }

    try {
      let last: AgentRunResult | undefined;
      let defect: ResponseDefect | undefined;

      // `jsonRepairRetries` counts retries, so attempt 0 is the initial run.
      for (let attempt = 0; attempt <= config.jsonRepairRetries; attempt++) {
        last = await this.consume(
          provider.run(config, this.buildInput(config, controller.signal, attempt, defect, conversation), ctx),
          ctx,
          collected,
        );

        const verdict = classifyResponse(last.text, expectJson, declaredSchema(config.outputType, config.outputSchema));
        if (verdict.ok) break;

        defect = { reason: verdict.reason, ...(verdict.error ? { error: verdict.error } : {}) };
        if (attempt < config.jsonRepairRetries) {
          ctx.log.warn(
            `Agent response unusable (${verdict.reason}); re-prompting `
            + `(${String(attempt + 1)}/${String(config.jsonRepairRetries)})`,
          );
          ctx.emit({
            type: 'substep',
            data: {
              type: 'retry',
              attempt: attempt + 1,
              maxAttempts: config.jsonRepairRetries,
              reason: verdict.reason,
            },
          });
        }
      }

      if (!last) {
        // Unreachable: the loop always runs at least once and `consume` either
        // returns a result or throws. Guarded so a future edit can't silently
        // return an empty agent result.
        throw new Error('Agent run produced no result');
      }

      // The last response is returned as-is even when still unusable — someone
      // is watching this run and can see the failure in the output.
      return this.finalize(last, config, ctx, collected);
    } finally {
      clearTimeout(timer);
      executionSignal?.removeEventListener('abort', onExecutionAbort);
    }
  }

  private buildInput(
    config: HostAgentBaseConfig & z.infer<TProviderConfig>,
    signal: AbortSignal,
    attempt: number,
    defect?: ResponseDefect,
    conversation?: Conversation,
  ): AgentRunInput {
    const expectJson = config.outputType === 'json';
    const outputSchema = isRecord(config.outputSchema) ? config.outputSchema : undefined;
    return {
      // A later turn is the person's reply, in the same conversation.
      task: conversation?.reply ?? config.task,
      // The resolver has replaced any ref with the concrete array by now, so a
      // non-array here means "nothing bound".
      attachments: Array.isArray(config.attachments) ? config.attachments : [],
      expectJson,
      cite: config.cite,
      signal,
      ...(expectJson && outputSchema ? { outputSchema } : {}),
      ...(defect ? { repair: { attempt, ...defect } } : {}),
      ...(conversation ? { conversation: { id: conversation.id, turn: conversation.turn } } : {}),
    };
  }

  private finalize(
    result: AgentRunResult,
    config: HostAgentBaseConfig & z.infer<TProviderConfig>,
    ctx: StepExecutionContext,
    attachments: Attachment[],
  ): AgentResult {
    return {
      response: shapeAgentResponse(
        result.text,
        { outputType: config.outputType, cite: config.cite },
        ctx.log,
      ),
      toolCalls: result.toolCalls,
      turnCount: result.turnCount,
      usage: result.usage,
      attachments,
    };
  }

  /**
   * Drive one streamed run to completion: forward progress to the execution
   * viewer, persist artifacts, and return the result the provider reported.
   */
  private async consume(
    events: AsyncIterable<AgentRunEvent>,
    ctx: StepExecutionContext,
    collected: Attachment[],
  ): Promise<AgentRunResult> {
    let result: AgentRunResult | undefined;

    for await (const event of events) {
      switch (event.type) {
        case 'text':
          if (event.text.length > 0) {
            ctx.emit({ type: 'substep', data: { type: 'message', content: event.text } });
          }
          break;

        case 'thinking':
          ctx.emit({ type: 'thinking', data: { phase: 'start' } });
          break;

        case 'tool_start':
          ctx.emit({
            type: 'tool_call',
            data: {
              tool: event.tool,
              args: event.args,
              phase: 'start',
              toolCallId: event.toolCallId,
            },
          });
          break;

        case 'tool_end':
          ctx.emit({
            type: 'tool_call',
            data: {
              tool: event.tool,
              result: event.result,
              phase: 'end',
              toolCallId: event.toolCallId,
            },
          });
          break;

        case 'artifact': {
          // Storage policy stays in the SDK: the provider yields bytes, the
          // step decides where they land and under whose scope.
          if (!ctx.files.available) {
            ctx.log.warn(
              `Agent produced artifact "${event.name}" but no storage adapter is configured; dropping it`,
            );
            break;
          }
          collected.push(await ctx.files.put({
            name: event.name,
            mimeType: event.mimeType,
            stream: Readable.from(Buffer.from(event.bytes)),
          }));
          break;
        }

        case 'done':
          result = event.result;
          break;
      }
    }

    if (!result) {
      throw new Error(
        `Agent provider "${this.provider.name}" ended the run without reporting a result`,
      );
    }
    return result;
  }
}
