import type { z } from 'zod';
import type { WorkflowContext, StepContextEntry } from '../types/context.js';
import type { ResourceAttributes } from '../authz/attributes.js';
import type {
  WorkflowStepConfig,
  WorkflowSettings,
} from '../types/workflow-config.js';
import type { StepType } from '../types/step-types.js';
import type { StepProgressEvent } from '../types/step-events.js';
import { CONTROL_FLOW_STEP_TYPES, GateCategory } from '../types/known-types.js';
import { readWorkflowConfig } from './read-config.js';
import { executionTopic } from '../events/types.js';
import type { EventBusAdapter, ExecutionStreamEvent } from '../events/types.js';
import type { PauseState } from '../types/pause-state.js';
import type { ResumePayload } from '../common/resume-payload.js';
import type { ConnectorRegistry } from '../connectors/core/connector-registry.js';
import {
  BaseActionStep,
  BaseControlFlowStep,
  StepKind,
  createPauseFunction,
} from '../steps/base-step.js';
import type {
  StepExecutionContext,
  CredentialSlot,
} from '../steps/base-step.js';
import type { CredentialRequirement } from '../connectors/core/credentials.js';
import { CredentialResolver } from './credential-resolver.js';
import type { ServiceRegistry } from './service-registry.js';
import { VariableResolver, stripNullForOptionalKeys, coerceResolvedToSchema } from './variable-resolver.js';
import { resolveExpressions } from './resolve-expressions.js';
import { coerceResolvedScalars } from './coerce-resolved-scalars.js';
import { projectVariables } from '../types/workflow-variable.js';
import { PauseStep } from './pause-step.js';
import { BranchSignal } from './branch-signal.js';
import { recordKey, framePrefix } from './node-path.js';
import type { PersistenceAdapter } from '../persistence/types.js';
import type { StorageAdapter } from '../storage/types.js';
import { createFileAccess } from '../storage/files.js';
import type { SandboxAdapter } from '../sandbox/types.js';

// ─── Types ───

/**
 * A persisted step record, parsed and keyed by node-path. The walk's single
 * source of truth: COMPLETED → memoize & skip; EXTERNAL_WAIT → parked leaf
 * (resume when `resumePayload` present, else re-park); REVIEW_WAIT → completed
 * but awaiting `onComplete:'review'` sign-off.
 */
interface MemoEntry {
  status: string;
  data: Record<string, unknown> | null;
  /** Who a parked record waits on, as persistence recorded it. */
  category?: GateCategory;
}

/** Threaded through the whole walk — shared, read-mostly run state. */
interface WalkCtx {
  executionId: string;
  /** Path-qualified step records preloaded once per run (rerun seed / resume). */
  memo: Map<string, MemoEntry>;
  settings: WorkflowSettings | undefined;
  /**
   * True while the first fresh-executing top-level step should consume the
   * rerun seed (`__priorStepState` / `__configOverrides`) from `__meta`.
   * Flipped off after it's consumed once.
   */
  entryExtrasPending: boolean;
}

/** Per-step call context threaded from walkScope → executeStep → buildStepContext. */
interface ExecuteCallCtx {
  executionId: string;
  stepName: string;
  isResuming: boolean;
  /** Data from the prior execution of this step (review-gate retry or rerun). */
  priorState?: Readonly<Record<string, unknown>> | undefined;
  /** Config overrides to merge into step.config (from rerun or retry feedback). */
  configOverrides?: Readonly<Record<string, unknown>> | undefined;
}

export interface ExecutorOptions {
  variableResolver?: VariableResolver;
  /** Pub/sub transport for live execution events. Omit it and the executor publishes nothing. */
  eventBus?: EventBusAdapter;
  /**
   * Base URL the runtime is reachable at. Threaded into the step execution
   * context as `ctx.runtime.baseUrl` so steps can build callback URLs
   * (e.g. the wait step's webhook mode emits `${baseUrl}/wait/callback/<secret>`).
   */
  baseUrl?: string;
  /** Blob storage adapter — threaded into every step's execution context. */
  storage?: StorageAdapter;
  /** Code-execution sandbox adapter — threaded into every step's execution context. */
  sandbox?: SandboxAdapter;
}

export interface ExecutorLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const noopLogger: ExecutorLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Internal signal: a review-gate `abort` reached the walk → cancel the run. */
class AbortExecution extends Error {}

// ─── WorkflowExecutor ───

/**
 * Core runtime engine for executing workflows.
 *
 * Orchestrates: step execution, variable resolution, durable pause/resume at
 * any nesting depth (content-addressed step memoization + level-triggered
 * reconciliation), error handling (onError: continue), retry, timeout,
 * credential resolution, and state persistence.
 *
 * ## Pause/resume model
 *
 * Every step — top-level or nested in any control-flow branch — is keyed by a
 * **node-path** (see `node-path.ts`). The walk always starts from the root and
 * each step self-decides from its persisted record:
 *
 * - `COMPLETED` → restore output, skip (memoized; never re-executes).
 * - `EXTERNAL_WAIT` leaf → resume via `onResume` if its record carries a
 *   `resumePayload`, otherwise re-park (still waiting).
 * - `REVIEW_WAIT` → apply the review decision (approve / retry / abort).
 * - control step with `EXTERNAL_WAIT` → re-execute (re-enter its branches; the
 *   completed branch steps memo-skip, the parked one resumes).
 *
 * Pausing throws to unwind — it carries no positional path, because the records
 * hold the position. Resume = a payload written into the target node's record +
 * re-enqueue; the next walk reconciles. N concurrent pauses, nested arbitrarily,
 * fall out for free.
 *
 * Host provides: PersistenceAdapter, StepRegistry, TriggerRegistry,
 * ServiceRegistry, and an optional logger.
 */
export class WorkflowExecutor<
  TServices extends Record<string, unknown> = Record<string, unknown>,
> {
  private readonly resolver: VariableResolver;
  private readonly log: ExecutorLogger;
  private readonly eventBus?: EventBusAdapter | undefined;
  private readonly baseUrl: string;
  private readonly storage?: StorageAdapter | undefined;
  private readonly sandbox?: SandboxAdapter | undefined;
  private readonly credentialResolver: CredentialResolver;

  constructor(
    // The executor never lists, so the caller's filter type is irrelevant here.
    private readonly persistence: PersistenceAdapter<unknown>,
    // Steps and triggers both come from here: a component reaches the engine
    // only by belonging to a registered connector.
    private readonly connectors: ConnectorRegistry,
    private readonly services: ServiceRegistry<TServices>,
    options?: ExecutorOptions & { logger?: ExecutorLogger },
  ) {
    this.resolver = options?.variableResolver ?? new VariableResolver();
    this.log = options?.logger ?? noopLogger;
    this.eventBus = options?.eventBus;
    this.baseUrl = options?.baseUrl ?? '';
    this.storage = options?.storage;
    this.sandbox = options?.sandbox;
    this.credentialResolver = new CredentialResolver(persistence);
  }

  /**
   * Publish an execution stream event (no-op if no eventBus).
   *
   * Deliberately not awaited. Publishing can now cross a network — a Redis or
   * NATS adapter is the whole point of the port — and a run must not slow to the
   * bus's latency, nor fail because the thing it was reporting progress to is
   * down. Live updates are best-effort; the execution record is the truth.
   */
  private emitEvent(executionId: string, event: ExecutionStreamEvent): void {
    const bus = this.eventBus;
    if (!bus) return;
    void bus.publish(executionTopic(executionId), event).catch((err: unknown) => {
      this.log.warn(
        `event bus publish failed (${event.event}, execution ${executionId}): ${String(err)}`,
      );
    });
  }

  // ─── Public API ───

  /**
   * Run or resume an execution by ID.
   *
   * Loads the execution from persistence, preloads its step records into the
   * memo map, then walks the steps from the root. Completed steps short-circuit
   * from the memo; the one (or many) parked step(s) resume from their records.
   */
  async runExecution(executionId: string): Promise<void> {
    const exec = await this.persistence.getExecution(executionId);
    if (!exec) {
      this.log.warn(`runExecution: execution ${executionId} not found`);
      return;
    }

    const isResume = exec.status === 'EXTERNAL_WAIT';
    const isFresh = exec.status === 'PENDING' || exec.status === 'SCHEDULED';
    if (!isFresh && !isResume) {
      this.log.warn(
        `runExecution: execution ${executionId} status=${exec.status} — skipping`,
      );
      return;
    }

    const workflow = await this.persistence.getWorkflow(exec.workflowId);
    if (!workflow) {
      await this.persistence.updateExecutionStatus(executionId, 'CANCELLED');
      this.log.warn(
        `runExecution: workflow ${exec.workflowId} not found — CANCELLED`,
      );
      return;
    }

    const config = readWorkflowConfig(workflow.config);
    const state = await this.persistence.getExecutionState(executionId);
    if (!state?.context) {
      if (isResume) {
        throw new Error(
          `runExecution: pause state missing for resume of ${executionId}`,
        );
      }
      await this.persistence.updateExecutionStatus(executionId, 'FAILED');
      this.log.error(
        `runExecution: state.context missing for ${executionId} — FAILED`,
      );
      return;
    }

    let context: WorkflowContext;
    try {
      context = JSON.parse(state.context) as WorkflowContext;
    } catch {
      if (isResume) {
        throw new Error(
          `runExecution: state.context unparseable for resume of ${executionId}`,
        );
      }
      await this.persistence.updateExecutionStatus(executionId, 'FAILED');
      this.log.error(
        `runExecution: state.context unparseable for ${executionId} — FAILED`,
      );
      return;
    }

    // The execution acts as the workflow's tenant, and the workflow record is
    // the only authority on that. Take it from the record every run rather than
    // trusting the copy in the persisted context: a long-paused execution whose
    // workflow was since re-scoped must not keep resolving the old tenant's
    // credentials and writing to its storage.
    context.workflow.attributes = workflow.attributes as ResourceAttributes<'workflow'>;

    // The run's own id, stamped before the first step resolves a template. It
    // cannot be set where the context is first built — the execution does not
    // exist yet at that point — so the executor is the only writer. Rewritten
    // on resume too: a resumed run keeps its id, a rerun gets a new one, and
    // steps must see the id of the run they are actually part of.
    context.execution = { id: executionId };

    // Author-time variables are re-sourced from the freshly-parsed config every
    // run, for the same reason as attributes above: the copy in the persisted
    // context can go stale if the workflow was edited between runs. The
    // definition is authoritative for constants, never the execution snapshot.
    context.vars = projectVariables(config.variables);

    // `context.trigger` is deliberately NOT touched here. The runtime hydrated
    // and filtered the event once, when it admitted this run, and froze the
    // result — so a condition before a pause and one after it read the same
    // values, and a rerun replays what the run actually saw. A step that needs
    // the world as it is now reads it itself.

    // Preload step records into the memo map. Empty for a brand-new run;
    // seeded with COMPLETED rows for a rerun; full for a resume. The walk
    // consults this by node-path — no positional cursor.
    const memo = new Map<string, MemoEntry>();
    const stepRows = await this.persistence.getStepRows(executionId);
    for (const row of stepRows) {
      memo.set(row.stepName, {
        status: row.status,
        data: row.data ? (safeParseJson(row.data) as Record<string, unknown> | null) : null,
        ...(row.category !== undefined ? { category: row.category } : {}),
      });
    }

    // Preserve transient seed fields (rerun priorState/configOverrides) that
    // the rerun path populated in __meta; reset error/chain bookkeeping.
    const prevMeta = context.__meta ?? {};
    const entryExtrasPending =
      prevMeta.__priorStepState !== undefined || prevMeta.__configOverrides !== undefined;
    context.__meta = {
      ...prevMeta,
      error: null,
      chain: prevMeta.chain ?? [],
    };
    await this.persistence.updateExecutionStatus(executionId, 'RUNNING');
    await this.persistence.persistState(executionId, {
      context: JSON.stringify(context),
      attributes: context.workflow.attributes,
    });

    this.log.info(
      `run ${isResume ? 'RESUMED' : 'STARTED'} execId=${executionId} workflow=${workflow.id}`,
    );

    await this.runWorkflow(executionId, context, config.steps, {
      executionId,
      memo,
      settings: config.settings,
      entryExtrasPending,
    });
  }

  /**
   * Start a fresh execution for a workflow.
   *
   * Creates the execution record + initial state, then runs it.
   * Returns the execution ID.
   */
  async startExecution(
    workflowId: string,
    context: WorkflowContext,
  ): Promise<string> {
    const executionId = await this.persistence.createExecution({
      workflowId,
      status: 'PENDING',
      context: JSON.stringify(context),
      attributes: context.workflow.attributes,
    });
    await this.runExecution(executionId);
    return executionId;
  }

  /**
   * Create a new execution that reruns from `fromStepId`, using the source
   * execution's cached outputs for all prior steps as the resolved context.
   *
   * Prior steps are written as COMPLETED records on the new execution, so the
   * memoized walk skips them. The step at `fromStepId` receives the source
   * row's data as `ctx.priorState` (when `inheritStepState` is true, the
   * default), enabling agents and other stateful steps to continue.
   *
   * Returns the new execution ID. Caller is responsible for enqueueing it.
   */
  async rerunFromStep(
    sourceExecutionId: string,
    fromStepId: string,
    options?: {
      configOverrides?: Record<string, unknown>;
      inheritStepState?: boolean;
    },
  ): Promise<string> {
    const inheritStepState = options?.inheritStepState ?? true;

    const source = await this.persistence.getExecution(sourceExecutionId);
    if (!source) {
      throw new Error(`Source execution ${sourceExecutionId} not found`);
    }
    const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'];
    if (!terminal.includes(source.status)) {
      throw new Error(
        `Cannot rerun from non-terminal execution ${sourceExecutionId} (status: ${source.status})`,
      );
    }

    const workflow = await this.persistence.getWorkflow(source.workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${source.workflowId} not found`);
    }

    const config = readWorkflowConfig(workflow.config);
    const fromStepIndex = config.steps.findIndex((s) => s.id === fromStepId);
    if (fromStepIndex < 0) {
      throw new Error(
        `Step "${fromStepId}" not found in workflow ${source.workflowId}`,
      );
    }

    const sourceState = await this.persistence.getExecutionState(sourceExecutionId);
    if (!sourceState?.context) {
      throw new Error(
        `Source execution ${sourceExecutionId} has no persisted context`,
      );
    }
    const sourceContext = JSON.parse(sourceState.context) as WorkflowContext;

    // Seed the new context with the source's trigger + steps 0..N-1 outputs.
    // Records are keyed by node-path; top-level steps key on their id.
    const seededSteps: WorkflowContext['steps'] = {};
    const stepRows = await this.persistence.getStepRows(sourceExecutionId);
    const rowByName = new Map<string, (typeof stepRows)[number]>();
    for (const row of stepRows) {
      rowByName.set(row.stepName, row);
    }
    for (let i = 0; i < fromStepIndex; i++) {
      const stepCfg = config.steps[i]!;
      const row = rowByName.get(stepCfg.id);
      if (!row?.data) continue;
      const parsed = safeParseJson(row.data) as {
        type?: StepType;
        input?: Record<string, unknown>;
        output?: Record<string, unknown>;
      } | null;
      if (parsed) {
        seededSteps[stepCfg.id] = {
          type: parsed.type ?? stepCfg.type,
          ...(parsed.input !== undefined ? { input: parsed.input } : {}),
          output: parsed.output ?? {},
        };
      }
    }

    // Priorstate for the entry step (the one being re-executed)
    let priorStepState: Record<string, unknown> | undefined;
    if (inheritStepState) {
      const entryRow = rowByName.get(fromStepId);
      if (entryRow?.data) {
        priorStepState =
          (safeParseJson(entryRow.data) as Record<string, unknown> | null) ?? undefined;
      }
    }

    const newContext: WorkflowContext = {
      workflow: sourceContext.workflow,
      // Placeholder only: this context belongs to a run that has not been
      // created yet. runExecution stamps the new run's own id on entry — a
      // rerun must never inherit the id of the run it was seeded from.
      execution: { id: '' },
      trigger: sourceContext.trigger,
      steps: seededSteps,
      // Seed from the source run; runExecution re-sources from config authoritatively.
      vars: sourceContext.vars ?? {},
      __meta: {
        error: null,
        chain: sourceContext.__meta?.chain ?? [],
        rerunSource: {
          executionId: sourceExecutionId,
          fromStepIndex,
          fromStepId,
        },
        ...(priorStepState ? { __priorStepState: priorStepState } : {}),
        ...(options?.configOverrides
          ? { __configOverrides: options.configOverrides }
          : {}),
      },
    };

    const newExecutionId = await this.persistence.createExecution({
      workflowId: source.workflowId,
      // A re-run is the same case again, so it keeps the case's identifier —
      // `Loan 4521#1` — rather than becoming an anonymous run. A generated
      // placeholder is not worth keeping; the store makes a fresh one.
      ...(source.name && !source.nameAutoGenerated
        ? { name: source.name, nameConflict: 'suffix' as const }
        : {}),
      status: 'PENDING',
      context: JSON.stringify(newContext),
      sourceExecutionId,
      attributes: newContext.workflow.attributes,
    });

    // Persist prior steps as COMPLETED on the new execution so the memoized
    // walk skips them (records are the cursor — there is no positional skip).
    for (let i = 0; i < fromStepIndex; i++) {
      const stepCfg = config.steps[i]!;
      const entry = seededSteps[stepCfg.id];
      if (!entry) continue;
      await this.persistence.upsertStep(newExecutionId, stepCfg.id, {
        status: 'COMPLETED',
        executorType: CONTROL_FLOW_STEP_TYPES.has(stepCfg.type)
          ? 'conditional'
          : 'deterministic',
        data: JSON.stringify(entry),
        attributes: newContext.workflow.attributes,
      });
    }

    this.log.info(
      `rerun created exec=${newExecutionId} from=${sourceExecutionId} step=${fromStepId}`,
    );
    return newExecutionId;
  }

  // ─── Internal: run loop ───

  private async runWorkflow(
    executionId: string,
    context: WorkflowContext,
    steps: WorkflowStepConfig[],
    walkCtx: WalkCtx,
  ): Promise<void> {
    try {
      await this.walkScope(steps, context, '', walkCtx);

      await this.persistence.updateExecutionStatus(executionId, 'COMPLETED');
      context.__meta = { ...context.__meta, error: null };
      await this.persistence.persistState(executionId, {
        context: JSON.stringify(context),
        currentStepIndex: steps.length,
        attributes: context.workflow.attributes,
      });
      this.emitEvent(executionId, { event: 'execution_completed', data: { status: 'COMPLETED' } });
      this.log.info(`run ${executionId} COMPLETED`);
    } catch (err) {
      if (err instanceof AbortExecution) {
        await this.persistence.updateExecutionStatus(executionId, 'CANCELLED');
        this.emitEvent(executionId, { event: 'execution_cancelled', data: {} });
        this.log.info(`run ${executionId} CANCELLED (review abort)`);
        return;
      }

      if (PauseStep.is(err)) {
        // walkScope already persisted the paused step record(s). Mark the
        // execution paused and snapshot the context (top-level outputs; branch
        // outputs live in their path-qualified records).
        await this.persistence.persistState(executionId, {
          context: JSON.stringify(context),
          pauseType: err.origin === 'review' ? ('review' as const) : ('step' as const),
          attributes: context.workflow.attributes,
        });
        await this.persistence.updateExecutionStatus(executionId, 'EXTERNAL_WAIT');
        this.log.info(`run ${executionId} PAUSED`);
        return;
      }

      // A jump that reached the root found no CYCLE/LOOP with its target id. The
      // validator rejects that config, so say plainly what went wrong if it runs.
      const errMsg = BranchSignal.is(err)
        ? `${err.message}: no CYCLE with that id contains the step`
        : err instanceof Error ? err.message : String(err);
      await this.persistence.updateExecutionStatus(executionId, 'FAILED');
      context.__meta = { ...context.__meta, error: errMsg };
      await this.persistence.persistState(executionId, {
        context: JSON.stringify(context),
        attributes: context.workflow.attributes,
      });
      this.emitEvent(executionId, { event: 'execution_failed', data: { error: errMsg } });
      this.log.error(`run ${executionId} FAILED: ${errMsg}`);
      throw err;
    }
  }

  /**
   * Walk a scope of steps (the root scope, or one control-flow branch).
   *
   * `prefix` is the node-path prefix for this scope (`''` at the root, a frame
   * prefix like `parallel_x:swot#0` inside a branch). Each step is addressed by
   * `recordKey(prefix, step.id)`. The walk always starts from the first step;
   * memoized records short-circuit completed steps so nothing re-executes.
   *
   * Throws `PauseStep` to unwind when a step (leaf or control) is parked, and
   * `AbortExecution` on a review-gate abort. Settings-driven retry / onError
   * apply at the root only — inside a branch, errors propagate so the enclosing
   * control step (e.g. PARALLEL) can record them.
   */
  private async walkScope(
    steps: WorkflowStepConfig[],
    context: WorkflowContext,
    prefix: string,
    walkCtx: WalkCtx,
  ): Promise<void> {
    const { executionId, memo } = walkCtx;
    const topLevel = prefix === '';
    const onError = topLevel ? (walkCtx.settings?.onError ?? 'stop') : 'stop';
    const retry = topLevel ? walkCtx.settings?.retry : undefined;

    for (const step of steps) {
      const key = recordKey(prefix, step.id);
      const rec = memo.get(key);
      const stepImpl = this.connectors.getStep(step.type);
      const isControl = stepImpl.kind === StepKind.CONTROL;
      const executorType = isControl ? 'conditional' : 'deterministic';

      // 1. Memoized COMPLETED → restore output, skip (never re-executes). A step
      //    that ended with a GO_TO/FINISH raises that jump again instead of
      //    moving on, so the replay lands in the same round the first pass did.
      if (rec?.status === 'COMPLETED') {
        if (rec.data) context.steps[step.id] = entryFromData(rec.data, step.type);
        const jump = BranchSignal.fromRecord(rec.data);
        if (jump) throw jump;
        continue;
      }

      // Decide the execution mode for this step from its record.
      let resumeData: Record<string, unknown> | undefined;
      let priorState: Readonly<Record<string, unknown>> | undefined;
      let configOverrides: Readonly<Record<string, unknown>> | undefined;

      // 2. REVIEW_WAIT — post-completion `onComplete:'review'` gate.
      if (rec?.status === 'REVIEW_WAIT') {
        const payload = rec.data?.['resumePayload'] as ResumePayload | undefined;
        if (!payload) {
          // Still awaiting review — record unchanged, unwind.
          throw reviewPause(step.id);
        }
        const action = payload.action ?? 'approve';
        if (action === 'abort') throw new AbortExecution();
        if (action !== 'retry') {
          // approve → restore output, mark COMPLETED, advance.
          if (rec.data) context.steps[step.id] = entryFromData(rec.data, step.type);
          await this.persistStep(executionId, key, 'COMPLETED', executorType, context.steps[step.id], memo, context.workflow.attributes);
          this.emitEvent(executionId, {
            event: 'step_completed',
            data: { stepName: step.id, nodePath: key, output: (context.steps[step.id]?.output ?? {}) as Record<string, unknown> },
          });
          continue;
        }
        // retry → re-execute this step with prior state + feedback overrides.
        priorState = rec.data ?? undefined;
        configOverrides = extractConfigOverrides(payload);
      } else if (rec?.status === 'EXTERNAL_WAIT' && !isControl) {
        // 3. Parked leaf (WAIT / agent) — resume or re-park.
        const data = rec.data ?? {};
        // A gate resumes when its answer is in — a person's payload or a
        // system's delivery, each routed to this node's own record — or when its
        // own `wakeAt` has passed. Never because a sibling's resume re-ran the
        // walk: addressing is per node, so one gate's answer cannot wake
        // another's.
        const answered = data['resumePayload'] !== undefined || data['delivery'] !== undefined;
        const wakeAt = data['wakeAt'];
        const due = typeof wakeAt === 'string' && Date.parse(wakeAt) <= Date.now();
        if (!answered && !due) {
          // Still waiting — unwind without re-executing (preserves the record).
          // Carry the recorded category forward: the catch below re-persists the
          // row, and a human gate rewritten as a machine one would vanish from
          // the inbox. An unclassified row re-parks as human, the same way the
          // inbox reads a missing category — a missed approval is worse than a
          // stale machine row.
          const reason = typeof data['reason'] === 'string' ? String(data['reason']) : 'waiting';
          throw new PauseStep(reason, { category: rec.category ?? GateCategory.WaitingOnApprover });
        }
        resumeData = data;
      } else if (topLevel && walkCtx.entryExtrasPending) {
        // 4a. First fresh top-level step consumes the rerun seed.
        priorState = context.__meta?.__priorStepState;
        configOverrides = context.__meta?.__configOverrides;
        walkCtx.entryExtrasPending = false;
        if (context.__meta) {
          delete context.__meta.__priorStepState;
          delete context.__meta.__configOverrides;
        }
      }
      // (rec EXTERNAL_WAIT + control → resumeData undefined → re-executes below,
      //  re-entering its branches; completed branch steps memo-skip.)

      const resuming = resumeData !== undefined;
      if (!resuming) {
        await this.persistence.upsertStep(executionId, key, {
          status: 'RUNNING',
          executorType,
          attributes: context.workflow.attributes,
        });
        this.emitEvent(executionId, {
          event: 'step_started',
          data: { stepName: step.id, stepType: step.type, nodePath: key },
        });
      }

      try {
        if (resuming) {
          await this.executeStep(
            step, context,
            { executionId, stepName: key, isResuming: true },
            prefix, walkCtx, resumeData,
          );
        } else {
          await this.executeStepWithRetry(
            step, context,
            { executionId, stepName: key, isResuming: false, priorState, configOverrides },
            prefix, walkCtx, retry,
          );
        }
      } catch (err) {
        if (PauseStep.is(err)) {
          // Leaf called ctx.pause(), or a control step's branch(es) parked.
          const pe = err as PauseStep;
          const ctxEntry = context.steps[step.id];
          const base: Record<string, unknown> = ctxEntry
            ? { ...ctxEntry }
            : { type: step.type, output: {} };
          const merged = pe.statePatch ? { ...base, ...pe.statePatch } : base;
          await this.persistStep(executionId, key, 'EXTERNAL_WAIT', executorType, merged, memo, context.workflow.attributes, pe.category);
          this.emitEvent(executionId, {
            event: 'execution_paused',
            data: {
              stepName: step.id,
              nodePath: key,
              pauseState:
                (merged['pauseState'] as PauseState | undefined) ??
                { reason: pe.message },
            },
          });
          throw pe;
        }

        if (BranchSignal.is(err)) {
          // A GO_TO/FINISH passing through: this step is done, by jumping. Save
          // the jump on its record so a replay raises it again (step 1 above)
          // instead of running the steps that came after it.
          const entry = context.steps[step.id] ?? { type: step.type, output: {} };
          await this.persistStep(executionId, key, 'COMPLETED', executorType, { ...entry, signal: err.signal }, memo, context.workflow.attributes);
          this.emitEvent(executionId, {
            event: 'step_completed',
            data: {
              stepName: step.id,
              nodePath: key,
              output: (entry.output ?? {}) as Record<string, unknown>,
              signal: err.signal,
            },
          });
          throw err;
        }

        const errMsg = err instanceof Error ? err.message : String(err);
        const ctxEntry = context.steps[step.id];

        if (onError === 'continue') {
          context.steps[step.id] = {
            type: step.type,
            ...(ctxEntry?.input !== undefined ? { input: ctxEntry.input } : {}),
            output: ctxEntry?.output ?? {},
            error: errMsg,
          };
          await this.persistence.upsertStep(executionId, key, {
            status: 'FAILED',
            executorType,
            data: JSON.stringify({ ...(ctxEntry ?? {}), error: errMsg }),
            attributes: context.workflow.attributes,
          });
          memo.set(key, { status: 'FAILED', data: { ...(ctxEntry ?? {}), error: errMsg } });
          this.emitEvent(executionId, { event: 'step_failed', data: { stepName: step.id, nodePath: key, error: errMsg } });
          this.log.warn(`step ${step.id} failed but continuing: ${errMsg}`);
          continue;
        }

        await this.persistence.upsertStep(executionId, key, {
          status: 'FAILED',
          executorType,
          data: JSON.stringify({ ...(ctxEntry ?? {}), error: errMsg }),
          attributes: context.workflow.attributes,
        });
        this.emitEvent(executionId, { event: 'step_failed', data: { stepName: step.id, nodePath: key, error: errMsg } });
        throw err;
      }

      const ctxEntry = context.steps[step.id];

      // Review gate: pause after a fresh success when onComplete === 'review'.
      // (A resumed leaf already paused once; it does not re-gate.)
      if (!resuming && step.onComplete === 'review') {
        const reviewPauseState = buildReviewPauseState(step.id, ctxEntry);
        const data = { ...(ctxEntry ?? { type: step.type, output: {} }), pauseState: reviewPauseState };
        await this.persistStep(executionId, key, 'REVIEW_WAIT', executorType, data, memo, context.workflow.attributes, GateCategory.WaitingOnApprover);
        this.emitEvent(executionId, {
          event: 'execution_paused',
          data: { stepName: step.id, nodePath: key, pauseState: reviewPauseState },
        });
        throw reviewPause(step.id);
      }

      await this.persistStep(executionId, key, 'COMPLETED', executorType, ctxEntry, memo, context.workflow.attributes);
      this.emitEvent(executionId, {
        event: 'step_completed',
        data: { stepName: step.id, nodePath: key, output: (ctxEntry?.output ?? {}) as Record<string, unknown> },
      });
    }
  }

  /** Persist a step record + mirror it into the in-memory memo for this run. */
  private async persistStep(
    executionId: string,
    key: string,
    status: string,
    executorType: string,
    entry: StepContextEntry | Record<string, unknown> | undefined,
    memo: Map<string, MemoEntry>,
    /** The tenant this run acts as — see PersistenceAdapter.createExecution. */
    attributes: ResourceAttributes<'workflow'>,
    /** Set only when the record is a gate: who the run is waiting on. */
    category?: GateCategory,
  ): Promise<void> {
    const data: Record<string, unknown> = entry ? { ...entry } : { output: null };
    await this.persistence.upsertStep(executionId, key, {
      status,
      executorType,
      data: JSON.stringify(data),
      attributes,
      ...(category !== undefined ? { category } : {}),
    });
    memo.set(key, { status, data, ...(category !== undefined ? { category } : {}) });
  }

  private async executeStepWithRetry(
    step: WorkflowStepConfig,
    context: WorkflowContext,
    callCtx: ExecuteCallCtx,
    prefix: string,
    walkCtx: WalkCtx,
    retry?: { maxAttempts: number; intervalMs: number },
  ): Promise<void> {
    if (!retry || callCtx.isResuming) {
      await this.executeStep(step, context, callCtx, prefix, walkCtx);
      return;
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      try {
        await this.executeStep(step, context, callCtx, prefix, walkCtx);
        return;
      } catch (err) {
        if (PauseStep.is(err) || BranchSignal.is(err)) throw err;
        lastError = err;
        this.log.warn(
          `step ${step.id} attempt ${String(attempt)}/${String(retry.maxAttempts)} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (attempt < retry.maxAttempts) {
          await delay(retry.intervalMs);
        }
      }
    }
    throw lastError;
  }

  /**
   * Execute one step. Control steps recurse into their branches via the
   * `walkBranch` closure (which addresses each branch with a node-path frame).
   * Action steps resolve config then either `execute()` fresh or `onResume()`
   * when `resumeData` (the parked record) is supplied.
   */
  private async executeStep(
    step: WorkflowStepConfig,
    context: WorkflowContext,
    callCtx: ExecuteCallCtx,
    prefix: string,
    walkCtx: WalkCtx,
    resumeData?: Record<string, unknown>,
  ): Promise<void> {
    const stepImpl = this.connectors.getStep(step.type);

    if (stepImpl.kind === StepKind.CONTROL) {
      const controlImpl = stepImpl as BaseControlFlowStep<
        z.ZodTypeAny,
        Record<string, unknown>
      >;
      const parsed = controlImpl.configSchema.safeParse(step.config);
      if (!parsed.success) {
        throw new Error(
          `Step "${step.id}" (${step.type}) config validation failed:\n${formatZodErrors(parsed.error)}`,
        );
      }

      this.log.info(
        `step ${callCtx.isResuming ? 'RESUME' : 'START'} id=${step.id} type=${step.type}`,
      );
      const stepCtx = await this.buildStepContext(
        context,
        { ...callCtx, stepId: step.id, rawConfig: step.config },
        stepImpl,
        undefined,
        parsed.data as Record<string, unknown>,
      );
      const output = await controlImpl.execute(parsed.data, {
        ...stepCtx,
        walkBranch: (branchSteps, branchScope, branchKey, iter) =>
          this.walkScope(
            branchSteps,
            branchScope,
            framePrefix(prefix, step.id, branchKey ?? 'default', iter ?? 0),
            walkCtx,
          ),
      });
      context.steps[step.id] = { type: step.type, output };
      this.log.info(`step OK id=${step.id} type=${step.type}`);
      return;
    }

    // Action step: merge configOverrides → resolve variables → coerce → validate → execute/resume
    const baseConfig = callCtx.configOverrides
      ? { ...step.config, ...callCtx.configOverrides }
      : step.config;
    // Expressions, then refs. `{% … %}` is evaluated here so that everything
    // after it — the synchronous resolver, the null stripping, the coercions,
    // the `safeParse` below — sees only values and needs no knowledge of
    // expressions at all. See engine/resolve-expressions.ts for why the order
    // matters and why this is the only `await` it costs.
    const { value: preparedConfig, evaluated } = await resolveExpressions(
      baseConfig,
      context,
    );
    if (evaluated.length > 0) {
      // The only record of *which* expressions ran: the persisted input keeps
      // the resolved value and nothing of the expression behind it, and by the
      // time anyone reads the trace the workflow may have been edited. The
      // values themselves stay out of the log — see `describeEvaluated`.
      this.log.info(`step EXPR id=${step.id} ${evaluated.map(describeEvaluated).join(' ')}`);
    }
    const resolvedConfig = coerceResolvedScalars(
      coerceResolvedToSchema(
        stripNullForOptionalKeys(
          this.resolver.resolve(preparedConfig, context) as Record<string, unknown>,
          stepImpl.configSchema,
        ),
        stepImpl.configSchema,
      ),
      stepImpl.configSchema,
    ) as Record<string, unknown>;

    const parsed = stepImpl.configSchema.safeParse(resolvedConfig);
    if (!parsed.success) {
      throw new Error(
        `Step "${step.id}" (${step.type}) config validation failed after variable resolution:\n${formatZodErrors(parsed.error)}`,
      );
    }

    const resolvedInput = parsed.data as Record<string, unknown>;
    const persistedInput = stepImpl.redactInput
      ? stepImpl.redactInput(resolvedInput)
      : resolvedInput;
    context.steps[step.id] = {
      type: step.type,
      input: persistedInput,
      output: {},
    };

    const actionImpl = stepImpl as BaseActionStep<
      z.ZodTypeAny,
      Record<string, unknown>
    >;
    const resumePayload = resumeData?.['resumePayload'] as ResumePayload | undefined;
    const stepCtx = await this.buildStepContext(
      context,
      { ...callCtx, stepId: step.id, rawConfig: baseConfig },
      stepImpl,
      resumePayload,
      resolvedInput,
    );

    this.log.info(
      `step ${callCtx.isResuming ? 'RESUME' : 'START'} id=${step.id} type=${step.type}`,
    );
    try {
      let output: Record<string, unknown>;
      if (resumeData !== undefined) {
        if (typeof actionImpl.onResume === 'function') {
          output = await actionImpl.onResume(resumeData, resolvedInput, stepCtx);
        } else {
          const fallback = resumeData['output'];
          output =
            fallback && typeof fallback === 'object' && !Array.isArray(fallback)
              ? (fallback as Record<string, unknown>)
              : {};
        }
      } else {
        output = await actionImpl.execute(resolvedInput, stepCtx);
      }
      context.steps[step.id] = {
        type: step.type,
        input: persistedInput,
        output,
      };
      this.log.info(`step OK id=${step.id} type=${step.type}`);
    } catch (err) {
      if (!PauseStep.is(err)) {
        this.log.error(
          `step FAIL id=${step.id} type=${step.type} err=${err instanceof Error ? err.message : String(err)}`,
        );
      }
      throw err;
    }
  }

  private async buildStepContext(
    context: WorkflowContext,
    callCtx: {
      executionId: string;
      stepId: string;
      stepName: string;
      isResuming: boolean;
      priorState?: Readonly<Record<string, unknown>> | undefined;
      /** Pre-resolution config — `{{refs}}` intact. See `ctx.rawConfig`. */
      rawConfig?: Record<string, unknown> | undefined;
    },
    stepImpl: {
      credentialSlots?: readonly CredentialSlot[];
      credential?: CredentialRequirement;
    },
    resumePayload?: ResumePayload,
    resolvedConfig?: Readonly<Record<string, unknown>>,
  ): Promise<StepExecutionContext<TServices>> {
    // Pass the running workflow so the adapter can identify and verify the
    // workspace in which this execution is taking place.
    const credentials = await this.credentialResolver.resolve(
      context.workflow,
      stepImpl,
      resolvedConfig,
    );

    // The resume payload rides on `runtime.metadata` (a shallow copy so the
    // persisted workflow metadata isn't polluted) — the agent step reads it
    // there, and onResume also receives it merged into `rowData`.
    const metadata = resumePayload
      ? { ...context.workflow.metadata, resumePayload }
      : context.workflow.metadata;

    const stepContext: StepExecutionContext<TServices> = {
      workflow: context,
      runtime: {
        executionId: callCtx.executionId,
        stepId: callCtx.stepId,
        stepName: callCtx.stepName,
        isResuming: callCtx.isResuming,
        attributes: context.workflow.attributes,
        metadata,
        baseUrl: this.baseUrl,
      },
      ...(callCtx.priorState ? { priorState: callCtx.priorState } : {}),
      ...(callCtx.rawConfig ? { rawConfig: callCtx.rawConfig } : {}),
      services: this.services,
      // Always present, even without an adapter: a step asks `files.available`
      // rather than discovering an undefined field, and the verbs explain
      // themselves when there is nothing behind them.
      files: createFileAccess(this.storage, context.workflow.attributes),
      ...(this.sandbox ? { sandbox: this.sandbox } : {}),
      credentials,
      staticData: {
        get: (key) =>
          this.persistence.getStaticData(context.workflow.id, key),
        set: (key, value) =>
          this.persistence.setStaticData(context.workflow.id, key, value),
        delete: (key) =>
          this.persistence.deleteStaticData(context.workflow.id, key),
      },
      pause: createPauseFunction(),
      emit: (event: StepProgressEvent) => {
        const normalized = {
          type: event.type,
          data: JSON.stringify(event.data),
        };
        // Fire-and-forget — never blocks step execution. Keyed by `stepId` (the
        // config step id, e.g. "agent_analysis") — the SAME key the UI's step
        // state and the activity timeline use — so historical + live align with
        // no client-side remapping.
        this.persistence
          .appendStepEvent(
            callCtx.executionId,
            callCtx.stepId,
            normalized,
            context.workflow.attributes,
          )
          .catch((err: unknown) => {
            this.log.warn(
              `Failed to persist step event: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        // Also forward to the SSE event bus. Keep the event kind (`type`) and
        // payload (`payload`) as distinct keys: the timeline needs the kind, and
        // nesting the payload avoids clobbering it (e.g. `substep` events carry
        // their own `type` inside `data`).
        this.emitEvent(callCtx.executionId, {
          event: 'step_progress',
          data: { stepName: callCtx.stepId, nodePath: callCtx.stepName, type: event.type, payload: event.data },
        });
      },
      log: this.log,
    };

    return stepContext;
  }
}

// ─── Helpers ───

/**
 * One expression, and the *shape* of what it produced — never the value.
 *
 * A step declares `redactInput` because config values carry the run's data, and
 * a log line is exactly as public as any other. So this says what was computed
 * and what came back, which is what makes a wrong answer findable, without
 * putting a customer's amounts or addresses in the log to do it.
 */
function describeEvaluated({ source, value }: { source: string; value: unknown }): string {
  const shape = Array.isArray(value)
    ? `list of ${String(value.length)}`
    : value === null
      ? 'null'
      : value === undefined
        ? 'nothing'
        : typeof value;
  return `{% ${source} %} => ${shape}`;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Reconstruct a context steps entry from a persisted record's parsed data. */
function entryFromData(
  data: Record<string, unknown>,
  fallbackType: StepType,
): StepContextEntry {
  return {
    type: (data['type'] as StepType | undefined) ?? fallbackType,
    ...(data['input'] !== undefined ? { input: data['input'] as Record<string, unknown> } : {}),
    output: (data['output'] as Record<string, unknown> | undefined) ?? {},
  };
}

/** The engine's own gate on a step's output: a person decides, and `pauseType` says it was a review. */
function reviewPause(stepId: string): PauseStep {
  return new PauseStep(`review gate at ${stepId}`, {
    category: GateCategory.WaitingOnApprover,
    origin: 'review',
  });
}

/** The review-gate PauseState shown to the approver (approve / retry / abort). */
function buildReviewPauseState(
  stepId: string,
  ctxEntry: StepContextEntry | undefined,
): PauseState {
  return {
    reason: `Review output of "${stepId}"`,
    display: ctxEntry?.output
      ? [{ label: 'Output', value: ctxEntry.output }]
      : undefined,
    actions: [
      { key: 'approve', label: 'Approve', style: 'primary' },
      { key: 'retry', label: 'Retry with Feedback', style: 'default', submitsForm: true },
      { key: 'abort', label: 'Reject', style: 'danger', abort: true },
    ],
    form: {
      fields: [
        {
          type: 'textarea',
          name: 'feedback',
          label: 'Feedback',
          placeholder: 'Optional instructions for retry...',
        },
      ],
    },
  };
}

function formatZodErrors(
  error: {
    issues: Array<{ path: Array<string | number>; message: string }>;
  },
): string {
  return error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Convert a review-gate retry's resume payload into config overrides
 * the entry step will see. Surfaces `feedback` + `attachments` as top-level
 * keys (so steps can read them without unwrapping), then merges the opaque
 * `data` blob underneath.
 */
function extractConfigOverrides(
  payload: ResumePayload | null | undefined,
): Record<string, unknown> {
  if (!payload) return {};
  const overrides: Record<string, unknown> = {};
  if (payload.data) {
    Object.assign(overrides, payload.data);
  }
  if (payload.feedback !== undefined) overrides['feedback'] = payload.feedback;
  if (payload.attachments !== undefined) overrides['attachments'] = payload.attachments;
  return overrides;
}
