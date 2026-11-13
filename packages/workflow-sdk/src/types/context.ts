import type { StepType } from './step-types.js';
import type { ResourceAttributes } from '../authz/attributes.js';
import type { VariableValue } from './workflow-variable.js';

/**
 * Trigger context is generic in the SDK — host defines concrete shapes.
 * Must have at minimum a `type` field for matching.
 */
export type TriggerContext = Record<string, unknown> & { type: string };

export interface StepContextEntry {
  type: StepType;
  input?: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string;
}

/**
 * The shared context that flows through a workflow execution.
 *
 * - `workflow` — identity: the workflow id, its typed scope, and host metadata
 * - `trigger` — the event/webhook/cron payload that started the execution
 * - `steps` — accumulated outputs from each step (keyed by step id)
 * - `__meta` — internal bookkeeping (error state, execution chain for cycle detection)
 *
 * The SDK only needs `workflow.id` internally (static data scoping, execution tracking).
 */
export interface WorkflowContext {
  workflow: {
    id: string;
    /**
     * The workflow's scoping attributes — *which tenant this execution acts as*.
     *
     * At execution time there is no caller to authorize: a cron tick or a
     * webhook has no user. So the scope is carried by the resource itself, and
     * this is it. Credential resolution and attachment storage key off this, so
     * it decides which tenant's secrets and files the run touches.
     *
     * The executor re-hydrates this from the workflow record on every run — it
     * is deliberately NOT trusted from the persisted execution context, which
     * would go stale if the workflow were re-scoped mid-flight.
     *
     * Typed via {@link Register}; `unknown` until a product opts in.
     */
    attributes: ResourceAttributes<'workflow'>;
    /**
     * Host-defined metadata — the workflow's `name`, and whatever else the host
     * stored alongside it. NOT a scope: put scoping data in `attributes`, which
     * is typed and which the authorizer actually sees.
     */
    metadata: Record<string, unknown>;
  };
  /**
   * The run's own identity.
   *
   * A step often needs to address something the run itself produced — a
   * generated document, this execution's page — and the only stable handle for
   * that is the execution id. Without it a workflow can read its own outputs
   * but cannot say where they live, so a link back to them has to be assembled
   * by hand outside the run.
   *
   * The executor is the authority and rewrites this on entry to every run,
   * including resumes; the copy inside a persisted context is never trusted.
   */
  execution: {
    id: string;
  };
  trigger: TriggerContext;
  steps: Record<string, StepContextEntry>;
  vars: Record<string, VariableValue>;
  __meta?: {
    error?: string | null;
    chain?: readonly string[];

    /**
     * Set when this execution was created via `rerunFromStep()`.
     * Tells the executor to start at `fromStepIndex` (skipping cached prior steps).
     */
    rerunSource?: {
      executionId: string;
      fromStepIndex: number;
      fromStepId: string;
    };
    /**
     * Prior execution's data for the first step being re-executed
     * (review-gate retry or cross-execution rerun). The executor hydrates this
     * from persistence on entry and exposes it via `ctx.priorState`.
     * Transient — not persisted in this shape; lives inside `runExecution`.
     */
    __priorStepState?: Record<string, unknown>;
    /**
     * Config overrides for the first re-executing step, supplied by
     * `rerunFromStep({ configOverrides })`. Merged into `step.config`
     * before variable resolution.
     */
    __configOverrides?: Record<string, unknown>;
  };
}
