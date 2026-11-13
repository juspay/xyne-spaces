import type { z } from 'zod';
import type { StepType } from '../types/step-types.js';
import type { StepCategory } from '../types/categories.js';
import type { CredentialRequirement } from '../connectors/core/credentials.js';
import type { WorkflowContext } from '../types/context.js';
import type { ResourceAttributes } from '../authz/attributes.js';
import type { WorkflowStepConfig } from '../types/workflow-config.js';
import type { StepProgressEvent } from '../types/step-events.js';
import type { ServiceRegistry } from '../engine/service-registry.js';
import type { FileAccess } from '../storage/files.js';
import type { SandboxAdapter } from '../sandbox/types.js';
import { PauseStep } from '../engine/pause-step.js';
import type { PauseOptions } from '../engine/pause-step.js';
import type { FieldOptionsContext, FieldOptionsPage } from '../schema/options.js';
import type { ConfigIssue, ConfigValidationContext } from '../schema/config-check.js';
import type { ResolvedCredential } from '../common/credentials.js';

// ─── Step Execution Context ───

/**
 * Everything an action step receives at runtime.
 *
 * Generic `TServices` propagates the host's ServiceRegistry type map so steps
 * can call `ctx.services.get('db')` with compile-time safety.
 */
export interface StepExecutionContext<
  TServices extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Full workflow context — trigger data + prior step outputs. */
  readonly workflow: WorkflowContext;

  /** Runtime plumbing for the current execution. */
  readonly runtime: {
    readonly executionId: string;
    /** The config-level step ID (e.g. "send_email_1"). */
    readonly stepId: string;
    readonly stepName: string;
    readonly isResuming: boolean;
    /**
     * The tenant this execution acts as — the workflow's typed scope, carried
     * by the resource because no caller exists at execution time. Pass this to
     * {@link files}; do NOT reach for {@link runtime.metadata}.
     *
     * Mirrors `workflow.workflow.attributes`, surfaced here so steps reach it
     * without the double hop. See {@link WorkflowContext.workflow.attributes}.
     */
    readonly attributes: ResourceAttributes<'workflow'>;
    /**
     * Transient per-call plumbing — `signal`, `resumePayload`, `pauseRequest`,
     * plus the host metadata the workflow was stored with.
     *
     * NOT a tenant scope, despite historically being used as one. It mixes
     * per-call machinery with host data, so anything reading a scope out of it
     * is casting a grab-bag and hoping. Use {@link runtime.attributes}.
     */
    readonly metadata: Record<string, unknown>;
    /**
     * Base URL the deployment is reachable at — sourced from
     * `RuntimeConfig.baseUrl`. Steps building callback URLs (the wait
     * step's webhook mode, for example) prepend this. Empty string when
     * the host hasn't configured one.
     */
    readonly baseUrl: string;
  };

  /**
   * This step's own config *before* variable resolution — `{{ref}}` strings
   * intact.
   *
   * The executor resolves config into plain values before calling `execute`, so
   * by then a step knows *what* a value is but not *where it came from*. A step
   * that needs provenance reads the refs here (the agent step labels injected
   * sources with them so the model can cite what it was given).
   *
   * Use the resolved `config` argument for everything else — this is only for
   * provenance. Optional: absent when the executor had no pre-resolution config.
   */
  readonly rawConfig?: Record<string, unknown> | undefined;

  /** Registered domain services — steps access services through this. */
  readonly services: ServiceRegistry<TServices>;

  /**
   * The files this run carries.
   *
   * Not the host's adapter: a capability built from it and bound to this run's
   * scope, so a step cannot name a tenant other than its own. Always present —
   * ask {@link FileAccess.available} when the step should carry on without
   * storage, rather than checking the field.
   */
  readonly files: FileAccess;

  /**
   * Code-execution sandbox adapter, when the host configured one. The agent
   * step exposes it to the built-in `run_code` tool; a deterministic sandboxed
   * step could use it directly.
   */
  readonly sandbox?: SandboxAdapter | undefined;

  /**
   * Credentials resolved by the executor for this step, keyed by credential
   * slot name. Empty when the step declares no credential slots.
   */
  readonly credentials: Readonly<Record<string, ResolvedCredential>>;

  /** Persistent KV scoped to this workflow definition. */
  readonly staticData: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };

  /**
   * Data from a prior execution of this step, present on:
   * - review-gate retry within the same execution
   * - cross-execution rerun via `rerunFromStep()`
   *
   * Opaque to the framework. Steps that care about continuity (e.g. agent steps)
   * read this to reconstruct their state; others can ignore it.
   */
  readonly priorState?: Readonly<Record<string, unknown>>;

  /** Pause execution and wait for an external resume signal. Never returns. */
  pause(reason: string, opts: PauseOptions): never;

  /** Emit a progress event for real-time observability. Fire-and-forget. */
  emit(event: StepProgressEvent): void;

  /** Structured logger. */
  readonly log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}

/**
 * Extended context for control-flow steps — adds `walkBranch` for
 * recursively executing nested step trees.
 */
export interface ControlFlowExecutionContext<
  TServices extends Record<string, unknown> = Record<string, unknown>,
> extends StepExecutionContext<TServices> {
  /**
   * Recursively execute a branch's steps. The executor addresses each branch
   * with a node-path frame `<controlStepId>:<branchKey>#<iter>`, so a step that
   * pauses inside resumes by its own record — no positional cursor.
   *
   * - `branchKey` names the branch (`if_true`, `case_0`, `body`, a PARALLEL key…).
   * - `iter` distinguishes repeated runs of the same branch (LOOP iterations,
   *   CYCLE rounds); omit (defaults to 0) for single-run branches.
   *
   * Throws `PauseStep` when a step inside the branch parks — control steps catch
   * this (PARALLEL) or let it propagate (LOOP/CONDITIONAL/SWITCH). Throws
   * `BranchSignal` when a GO_TO/FINISH inside jumps — the CYCLE it
   * names catches it, PARALLEL and MAP turn it into an error, and every other
   * step lets it through.
   */
  walkBranch(
    steps: WorkflowStepConfig[],
    context: WorkflowContext,
    branchKey?: string,
    iter?: number,
  ): Promise<void>;
}

/**
 * Create an isolated child scope for a branch / loop iteration. Shares workflow
 * identity + trigger, but gets its own `steps` map so concurrent branches (or
 * successive loop iterations) don't clobber each other's outputs. Prior step
 * outputs are visible (shallow-copied in); new writes stay local to the branch.
 */
export function cloneScope(parent: WorkflowContext): WorkflowContext {
  const clone: WorkflowContext = {
    workflow: parent.workflow,
    execution: parent.execution,
    trigger: parent.trigger,
    steps: { ...parent.steps },
    vars: parent.vars,
  };
  if (parent.__meta !== undefined) {
    clone.__meta = parent.__meta;
  }
  return clone;
}

/**
 * A branch / iteration's TOP-LEVEL step outputs, keyed by step id. The single
 * canonical shape control-flow steps expose under `output.branches.<key>.steps`
 * (PARALLEL/CONDITIONAL/SWITCH) and MAP exposes under `output.items[].steps`.
 * Defined once here so the envelope can't drift across steps + UI. (`output`
 * stays `Record<string, unknown>` — step outputs are genuinely dynamic.)
 */
export type BranchStepOutputs = Record<string, { output: Record<string, unknown> }>;

/**
 * Project a branch's TOP-LEVEL step outputs from a context's steps map, keyed by
 * step id — the shape control-flow steps expose under `output.branches.<key>.steps`
 * (mirrors the main context's `steps.<id>.output`, and matches the schema the
 * harness types from `getBranches`). Pass the context the branch ran in: the
 * isolated clone (PARALLEL) or `ctx.workflow` (CONDITIONAL/SWITCH).
 */
export function collectBranchSteps(
  branchSteps: WorkflowStepConfig[],
  ctx: WorkflowContext,
): BranchStepOutputs {
  const out: BranchStepOutputs = {};
  for (const s of branchSteps) {
    const entry = ctx.steps[s.id];
    if (entry) out[s.id] = { output: entry.output };
  }
  return out;
}

// ─── Step Kind ───

export enum StepKind {
  ACTION = 'action',
  CONTROL = 'control',
}

// ─── Credential Slot ───

export interface CredentialSlot {
  /** Config field containing the credential name and its key in the credential-aware context. */
  readonly name: string;
  readonly required: boolean;
}

// ─── Declared Output ───

export interface DeclaredOutput {
  readonly key: string;
  readonly label: string;
}



// ─── Base Step ───

/**
 * Abstract base for all steps (action + control flow).
 *
 * Type parameters:
 * - `TConfig` — Zod schema describing the step's config shape
 * - `TOutput` — the output record produced by `execute()`
 */
export abstract class BaseStep<
  TConfig extends z.ZodTypeAny,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
  TCtx = unknown,
> {
  abstract readonly kind: StepKind;
  abstract readonly type: StepType;
  abstract readonly configSchema: TConfig;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly outputSchema: z.ZodTypeAny;
  abstract readonly category: StepCategory;
  readonly icon?: string;

  /**
   * Which connector provides this step.
   *
   * Written by `ConnectorRegistry.register()`, never by the step: ownership is
   * a fact of being registered, and a self-declared id could disagree with the
   * connector that actually registered it.
   */
  readonly connectorId?: string;
  readonly connectorName?: string;
  readonly connectorIcon?: string;

  /** Services this step needs — validated at registration time. */
  readonly requiredServices?: readonly string[];

  /** Credential slots this step declares — resolved before execute(). */
  readonly credentialSlots?: readonly CredentialSlot[];

  /**
   * Which credential TYPES this step can use, as the definitions themselves.
   *
   * Separate from `credentialSlots`, which says whether a credential is
   * REQUIRED. A step may accept several types and still need none —
   * HTTP_REQUEST calls public APIs — so collapsing the two would force a
   * credential on every step that can take one.
   *
   * The registry checks each entry belongs to the step's own connector; the
   * executor checks a resolved credential's shape is one of these before
   * `execute()` runs.
   */
  readonly credential?: CredentialRequirement;

  /** Output branches this step declares (for UI rendering + validation). */
  readonly declaredOutputs?: readonly DeclaredOutput[];

  /** Validate raw config against the step's schema. */
  validate(config: unknown): z.infer<TConfig> {
    return this.configSchema.parse(config) as z.infer<TConfig>;
  }

  /**
   * Choices for one of this step's config fields — see {@link FieldOptionsContext}.
   *
   * One method for every field; `ctx.field` says which is asking, as a dotted
   * path for a field that sits inside an object or a row. Mark the fields it
   * answers for by wrapping them in `withOptions` in the config schema, and the
   * editor turns those from text boxes into pickers.
   */
  getOptions?(
    ctx: FieldOptionsContext<z.infer<TConfig>, Record<string, unknown>, TCtx>,
  ): Promise<FieldOptionsPage>;

  /**
   * Check this step's configuration against the world it names, when the
   * author saves or activates.
   *
   * For what {@link validate} cannot reach: does that channel exist, may this
   * person watch it, can this credential see that repository. Return an empty
   * array to pass; anything returned refuses activation.
   *
   * Three rules. READ-ONLY — never "test" by creating something. Skip anything
   * absent from `ctx.known`, which is how a `{{ref}}` says it cannot be checked
   * yet. And stay CHEAP: one or two lookups that decide whether runs will work,
   * not a round trip per field.
   */
  validateConfig?(
    ctx: ConfigValidationContext<z.infer<TConfig>, Record<string, unknown>, TCtx>,
  ): Promise<ConfigIssue[]>;

  /**
   * Customize the JSON Schema generated from configSchema for UI form rendering.
   * Override to add field metadata, ordering, conditional visibility, etc.
   * Default: return as-is.
   */
  decorateConfigSchema(
    jsonSchema: Record<string, unknown>,
  ): Record<string, unknown> {
    return jsonSchema;
  }

  /**
   * Resolve the output JSON Schema for a specific step instance.
   * Override to produce a config-aware schema (e.g. Code step declares return fields).
   * Default: converts the static outputSchema via zodToJsonSchema.
   */
  resolveOutputJsonSchema?(config: Record<string, unknown>): Record<string, unknown>;

  /** Optional hook to mask sensitive fields before persisting step input. */
  redactInput?(input: Record<string, unknown>): Record<string, unknown>;

  /** Phantom type anchor — never read at runtime. */
  declare readonly __outputPhantom?: TOutput;
}

// ─── Base Action Step ───

/**
 * Base class for action steps — domain logic that does actual work.
 *
 * Steps receive a `StepExecutionContext` with access to services, static data,
 * and the workflow context.
 */
export abstract class BaseActionStep<
  TConfig extends z.ZodTypeAny,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
  TContext extends StepExecutionContext = StepExecutionContext,
> extends BaseStep<TConfig, TOutput> {
  override readonly kind: StepKind.ACTION = StepKind.ACTION;

  /** Event types this step may emit (for downstream automation chaining). */
  readonly mayEmit?: readonly string[];

  /** Execute the step with resolved config and full execution context. */
  abstract execute(
    config: z.infer<TConfig>,
    ctx: TContext,
  ): Promise<TOutput>;

  /**
   * Called instead of `execute()` when resuming from a pause.
   * `rowData` contains the persisted step data from the paused execution.
   */
  onResume?(
    rowData: Record<string, unknown>,
    config: z.infer<TConfig>,
    ctx: TContext,
  ): Promise<TOutput>;
}

// ─── Base Control Flow Step ───

/**
 * Base class for control-flow steps — branching, switching, looping.
 *
 * Control-flow steps receive a `ControlFlowExecutionContext` which adds
 * `walkBranch()` for recursively executing nested step trees.
 *
 * The category is always `'control'` — this is enforced by the type system.
 */
/**
 * How a control-flow step's branches should be visualized.
 *
 * - `iterate`: single body repeated N times sequentially (LOOP) — loop ring
 * - `fanout`:  pick among multiple static branches (CONDITIONAL, SWITCH, PARALLEL) —
 *              multi-lane fork, even when only one branch is populated
 * - `map`:     single body fanned out concurrently over a dynamic array (MAP) —
 *              edited as one body (like a loop), but the execution view renders
 *              one lane per runtime iteration (side-by-side, like a fork)
 *
 * Drives canvas rendering only; the executor doesn't read this.
 * Defaults to `fanout` for all control-flow steps unless overridden.
 */
export type BranchModel = 'iterate' | 'fanout' | 'map';

/**
 * How GO_TO and FINISH treat a control-flow step's branches.
 *
 * - `catch`: the step is a loop a jump can target (CYCLE, LOOP)
 * - `pass`:  jumps pass through on their way to a loop further out (CONDITIONAL, SWITCH)
 * - `block`: branches run concurrently, so no jump may leave them (PARALLEL, MAP)
 *
 * The validator checks jumps against this and the builder reads it. The executor
 * doesn't: a jump unwinds until a step catches it, and PARALLEL/MAP refuse one
 * themselves.
 */
export type JumpBehavior = 'catch' | 'pass' | 'block';

export abstract class BaseControlFlowStep<
  TConfig extends z.ZodTypeAny,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> extends BaseStep<TConfig, TOutput> {
  override readonly kind: StepKind.CONTROL = StepKind.CONTROL;
  abstract override readonly category: 'control';

  /**
   * UI hint: does this step iterate a body or fan out across branches?
   * Defaults to `'fanout'` — override on iterating steps (LOOP).
   */
  readonly branchModel: BranchModel = 'fanout';

  /**
   * How GO_TO/FINISH treat this step's branches. Defaults to `'pass'` —
   * override on loops (`'catch'`) and on steps that run branches concurrently
   * (`'block'`).
   */
  readonly jumps: JumpBehavior = 'pass';

  /** Execute the control flow step. */
  abstract execute(
    config: z.infer<TConfig>,
    ctx: ControlFlowExecutionContext,
  ): Promise<TOutput>;

  /**
   * Return the named branches from a step config. Used by the validator
   * to recursively validate nested step trees without hardcoding step types.
   */
  getBranches?(
    config: Record<string, unknown>,
  ): Record<string, WorkflowStepConfig[]>;

  /**
   * References a branch can use on top of the steps before it, keyed the way the
   * validator keys sources (`'<id>.output'` → JSON Schema). A loop returns
   * `{ '__loop.output': … }` so `{{steps.__loop.output.currentItem}}` validates
   * inside its body.
   */
  branchScopeSchemas?(
    config: Record<string, unknown>,
  ): Record<string, Record<string, unknown>>;

  /**
   * Check a GO_TO or FINISH aimed at this step against its config, returning a
   * problem to report or `null`. The validator calls it on `'catch'` steps only;
   * CYCLE uses it to make a GO_TO carry the keys of its `input`.
   */
  checkJump?(
    config: Record<string, unknown>,
    jump: { kind: 'goto' | 'finish'; value: unknown },
  ): string | null;
}

// ─── Utility: createPauseFunction ───

/**
 * Creates the `ctx.pause()` function for a step execution context.
 * Throws `PauseStep` — never returns.
 */
export function createPauseFunction(): StepExecutionContext['pause'] {
  return (reason: string, opts: PauseOptions): never => {
    throw new PauseStep(reason, opts);
  };
}
