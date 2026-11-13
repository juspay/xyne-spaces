import { z } from 'zod';
import type { TriggerStart } from '../ingest/start-policy.js';
import type { TriggerType } from './trigger-types.js';
import type { StepType } from './step-types.js';
import { BuiltinStepType } from './known-types.js';
import type { ControlFlowStepType } from './known-types.js';
import { ConditionOperatorSchema } from './operators.js';
import type { ConditionOperator } from './operators.js';
import { REF_OR_EXPRESSION_REGEX } from '../expression/format.js';
import { isMarked, markSchema } from '../util/schema-marks.js';
import type { WorkflowVariable } from './workflow-variable.js';

// ─── Variable Reference Helpers ───

/**
 * A pure `{{ref}}` **or** a pure `{% expression %}` — the one spelling for every
 * slot that takes a reference instead of a literal.
 *
 * This is what lets expressions reach anywhere worth having them. A
 * `variableRef(z.number())` field is a union of "a number" and "a string that
 * is a reference"; without widening that string branch an expression is
 * rejected as a shape error, and `{% $sum(…) %}` would only ever work in fields
 * that happen to be plain text. {@link LeafConditionSchema}'s `variable` takes
 * the same schema, so a condition can test something computed.
 *
 * A regex rather than a refinement, so `zod-to-json-schema` keeps emitting a
 * `pattern` for the field and the editor's picture of it does not change shape.
 */
const bindableStringSchema = z
  .string()
  .regex(
    REF_OR_EXPRESSION_REGEX,
    'Must be a {{context.<path>}} reference or a {% expression %}',
  );

/**
 * Wraps a Zod schema to also accept a `{{...}}` variable reference or a
 * `{% ... %}` expression. Used in step config schemas — e.g.
 * `variableRef(z.number())` accepts a literal number, a `{{trigger.count}}`
 * reference, or `{% $sum(steps.a.output.items.amount) %}`.
 *
 * The union is marked rather than described: a reference being legal is a fact
 * about the field, not a sentence about it, and `description` belongs to the
 * author. The inner schema keeps its own description, which is where the editor
 * reads it from.
 */
export function variableRef<T extends z.ZodTypeAny>(
  inner: T,
): z.ZodUnion<[T, z.ZodString]> {
  return markSchema(z.union([inner, bindableStringSchema]), 'isVariableRef') as z.ZodUnion<
    [T, z.ZodString]
  >;
}

/**
 * Given a schema that may be a variableRef union, extract the inner (non-ref) schema.
 * Returns null if the schema is not a variableRef union.
 */
export function getVariableRefInnerSchema(
  schema: z.ZodTypeAny,
): z.ZodTypeAny | null {
  if (schema instanceof z.ZodUnion && isMarked(schema._def, 'isVariableRef')) {
    const options = (schema as z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny]>)._def
      .options;
    return options[0] ?? null;
  }
  return null;
}

// ─── Conditions (used by CONDITIONAL / SWITCH steps) ───

export interface LeafCondition {
  variable: string;
  operator: ConditionOperator;
  value?: unknown;
}

export type Condition =
  | LeafCondition
  | { all: Condition[] }
  | { any: Condition[] };

export const LeafConditionSchema: z.ZodType<LeafCondition> = z.object({
  variable: bindableStringSchema,
  operator: ConditionOperatorSchema,
  value: z.unknown().optional(),
});

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    LeafConditionSchema,
    z.object({ all: z.array(ConditionSchema) }),
    z.object({ any: z.array(ConditionSchema) }),
  ]),
);

// ─── Step Configs ───

/**
 * What happens after a step completes successfully.
 * - `continue` (default): move to the next step
 * - `review`: pause the execution and wait for a human to approve, retry with feedback, or abort
 */
export type StepCompletionGate = 'continue' | 'review';

/**
 * A single author-provided citation: a reference link (a `{{ref}}`, which may
 * point at a step output, trigger value, or an attachment) plus optional
 * human label/description. Purely documentation — resolved + rendered by the
 * reviewer UI; ignored by the executor.
 */
export interface Citation {
  /** A `{{...}}` reference. May resolve to a value or an attachment. */
  ref: string;
  /** Optional short title shown instead of the resolved source name. */
  label?: string;
  /** Optional free-text note explaining the citation. */
  description?: string;
  /**
   * Optional page number within an attachment source — a literal (e.g. "3") or a
   * `{{...}}` reference (e.g. `{{steps.extract.output.response.x.sourcePage}}`).
   * Only meaningful when `ref` resolves to an attachment (a document).
   */
  pageNumber?: string;
}

/**
 * Human-facing documentation fields shared by every step config. Purely
 * organizational — ignored by the executor and validator.
 */
export interface StepConfigBase {
  /** Human alias shown in the UI instead of the step type name. */
  title?: string;
  /** Free-text notes/description for this step instance. */
  description?: string;
  /** Id of the {@link StepGroup} this step belongs to (see {@link WorkflowConfig.groups}). */
  groupId?: string;
  /**
   * Author citations, keyed by a stable {@link CitationPath} into this step's
   * `config` (e.g. `"reason"`, `"display[sec_amt].value"`, `"form.fields[acha]"`).
   * A documentation overlay — never executed; rendered to reviewers.
   */
  citations?: Record<string, Citation[]>;
}

export interface ActionStepConfig extends StepConfigBase {
  id: string;
  type: Exclude<StepType, ControlFlowStepType>;
  config: Record<string, unknown>;
  /** Defaults to 'continue' when omitted. */
  onComplete?: StepCompletionGate;
}

export interface ConditionalStepConfig extends StepConfigBase {
  id: string;
  type: BuiltinStepType.CONDITIONAL;
  config: {
    condition: Condition;
    if_true: WorkflowStepConfig[];
    if_false?: WorkflowStepConfig[];
  };
  onComplete?: StepCompletionGate;
}

export interface SwitchCaseEntry {
  condition: Condition;
  label?: string;
  steps: WorkflowStepConfig[];
}

export interface SwitchStepConfig extends StepConfigBase {
  id: string;
  type: BuiltinStepType.SWITCH;
  config: {
    /**
     * Cases evaluated top-to-bottom; the first whose condition is true wins.
     * May be empty when the step is first created — `default` always runs in that case.
     */
    cases: SwitchCaseEntry[];
    /**
     * Fallback branch — always present, executed when no case matches.
     * May be empty (`[]`) to no-op the fallback.
     */
    default: WorkflowStepConfig[];
  };
  onComplete?: StepCompletionGate;
}

export type WorkflowStepConfig =
  | ActionStepConfig
  | ConditionalStepConfig
  | SwitchStepConfig;

// ─── Step Groups (documentation overlay) ───

/**
 * A named grouping of steps, for documentation/organization only. Steps join a
 * group via their `groupId`; the UI draws a labeled box around a contiguous run
 * of top-level steps sharing the same group. Has no effect on execution.
 */
export interface StepGroup {
  id: string;
  title: string;
  description?: string;
  /**
   * Hoist this group to the Run (top) level of the execution sidebar. Under the
   * default display it merely lifts the group to the top while every other step
   * still renders in place; under {@link WorkflowDisplay.onlyPinned} it doubles as
   * the visibility whitelist — only pinned groups are shown.
   */
  pinned?: boolean;
}

/** Author-time display preferences for the execution viewer. Purely presentational —
 *  has no effect on execution. */
export interface WorkflowDisplay {
  /**
   * Whitelist mode for the execution sidebar: when `true`, ONLY steps belonging to a
   * pinned group are shown; every non-pinned group and ungrouped step is dropped.
   * Default `false` — all steps show and pinned groups are merely hoisted to the top.
   * Use this to present a curated run (e.g. a single cumulative report node) while the
   * intermediate plumbing stays reachable only via the node search palette.
   */
  onlyPinned?: boolean;
}

// ─── Workflow Settings ───

/**
 * How each run of a workflow is identified — the name people use for a run
 * ("Loan 4521"), stored on the execution and unique within the workflow.
 *
 *  - `template`: built from the trigger input, e.g. `{{trigger.loanId}}`.
 *    A clash gets `#1`, `#2`… since nobody chose the exact string.
 *  - `user`: typed by whoever starts the run. A clash is refused instead, so
 *    they can pick another rather than silently get a name they did not type.
 *    Left blank, the run gets a generated `Run-<time>` name.
 */
export const WorkflowRunNamingSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('template'), template: z.string() }),
  z.object({ mode: z.literal('user') }),
]);

export type WorkflowRunNaming = z.infer<typeof WorkflowRunNamingSchema>;

export const WorkflowSettingsSchema = z.object({
  onError: z.enum(['stop', 'continue']).default('stop'),
  retry: z
    .object({
      maxAttempts: z.number().int().min(1).max(10),
      intervalMs: z.number().int().min(1000),
    })
    .optional(),
  /** How each run is identified. Absent: runs get a generated `Run-<time>` name. */
  runNaming: WorkflowRunNamingSchema.optional(),
});

export type WorkflowSettings = z.infer<typeof WorkflowSettingsSchema>;

// ─── Top-Level Workflow Config ───

/**
 * The complete configuration for a workflow.
 *
 * - `trigger` — what starts the workflow (host-defined type + config)
 * - `steps` — the tree of steps to execute
 * - `settings` — error handling, retry, timeout (optional — defaults to stop-on-error)
 */
export interface WorkflowConfig {
  trigger: {
    type: TriggerType;
    config: Record<string, unknown>;
    /**
     * Which arriving events start a run. Separate from `config` because it has a
     * different lifecycle: config is what the trigger is connected to, the filter
     * is which of its events the workflow wants. See {@link TriggerFilter}.
     */
    filter?: TriggerFilter;
    /**
     * When a matching event becomes a run — immediately, or later. A delayed
     * binding is armed on arrival and admitted when it fires, so {@link filter}
     * and the trigger's own filter judge the world as it is then, not as it was.
     * See {@link TriggerStart}.
     */
    start?: TriggerStart;
  };
  steps: WorkflowStepConfig[];
  settings?: WorkflowSettings;
  /** Optional documentation groups referenced by step `groupId`. */
  groups?: StepGroup[];
  /** Optional presentational preferences for the execution viewer (no effect on execution). */
  display?: WorkflowDisplay;
  /**
   * Author-time variables — fixed values (scalars, JSON, uploaded documents)
   * defined once here and referenced by steps as `{{vars.<key>}}`. The same for
   * every execution, so they replace re-passing constant data per run. See
   * {@link WorkflowVariable}.
   */
  variables?: WorkflowVariable[];
}

// ─── Trigger filter ───

/**
 * An author-configured condition on the trigger's events, evaluated by the
 * engine before a run is created. An event that fails it leaves no trace.
 */
export interface TriggerFilter {
  /**
   * The same condition tree the Conditional step uses. Variables may reference
   * `{{trigger.*}}` and `{{vars.*}}` only — nothing else exists before a run.
   */
  conditions?: Condition;
}

export const TriggerFilterSchema: z.ZodType<TriggerFilter> = z
  .object({ conditions: ConditionSchema.optional() })
  .strict() as z.ZodType<TriggerFilter>;

/**
 * The scope id that asks for the context a trigger filter can see — the trigger
 * output and variables, no steps. Pass it wherever an `atStepId` is expected.
 */
export const TRIGGER_FILTER_SCOPE = '$trigger';

// ─── Utility ───

/**
 * Read a dotted path from a nested object.
 * `readDottedPath({ a: { b: 1 } }, 'a.b')` → `1`
 */
export function readDottedPath(
  payload: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path.split('.');
  let current: unknown = payload;
  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object'
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
