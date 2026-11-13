/**
 * getAvailableContext — computes the variable context available at a given step.
 *
 * Pure function: takes the workflow config + registries, returns a map of
 * JSON Schema objects keyed by dotted path (e.g. "trigger", "steps.fetch_data.output").
 * The frontend's variable picker uses this to show what refs are available at each step.
 */

import type {
  WorkflowConfig,
  WorkflowStepConfig,
} from '../types/workflow-config.js';
import { TRIGGER_FILTER_SCOPE } from '../types/workflow-config.js';
import type { ConnectorRegistry } from '../connectors/core/connector-registry.js';
import { BaseControlFlowStep } from '../steps/base-step.js';
import { zodToJsonSchemaRecord } from '../util/schema-convert.js';
import { varsJsonSchema } from '../types/workflow-variable.js';

/**
 * Resolve a step's or trigger's output to a JSON Schema — the single source of
 * truth for "what fields does this produce". Prefers the per-instance
 * `resolveOutputJsonSchema(config)` (e.g. HTTP `body` typed from the author's
 * response schema; webhook/manual payloads) and falls back to the static
 * `outputSchema`. Used by both the variable picker (here) and the config
 * validator, so they never disagree about which paths exist.
 */
export interface OutputSchemaProvider {
  resolveOutputJsonSchema?: (config: Record<string, unknown>) => Record<string, unknown>;
  outputSchema: Parameters<typeof zodToJsonSchemaRecord>[0];
}

export function resolveOutputJsonSchemaOf(
  impl: OutputSchemaProvider,
  config: Record<string, unknown>,
  connectors?: ConnectorRegistry,
): Record<string, unknown> {
  const base = impl.resolveOutputJsonSchema
    ? impl.resolveOutputJsonSchema(config)
    : zodToJsonSchemaRecord(impl.outputSchema);

  // Control-flow steps: splice a config-aware `branches` container so later
  // steps can drill `…output.branches.<key>.steps.<id>.output.<field>`. This is
  // generic over the existing `getBranches()` abstraction — every control-flow
  // step (present and future) gets result-referencing for free. Needs the
  // registry to resolve each inner step's output schema, and recurses so nested
  // control flow types all the way down. Without `steps` it degrades to `base`.
  if (connectors && impl instanceof BaseControlFlowStep && impl.getBranches) {
    const branchProps: Record<string, unknown> = {};
    for (const [key, branchSteps] of Object.entries(impl.getBranches(config))) {
      const stepProps: Record<string, unknown> = {};
      for (const s of branchSteps) {
        if (!connectors.hasStep(s.type)) continue;
        stepProps[s.id] = {
          type: 'object',
          properties: {
            output: resolveOutputJsonSchemaOf(
              connectors.getStep(s.type),
              s.config as Record<string, unknown>,
              connectors,
            ),
          },
        };
      }
      branchProps[key] = {
        type: 'object',
        properties: { steps: { type: 'object', properties: stepProps } },
      };
    }
    const baseProps = (base['properties'] as Record<string, unknown> | undefined) ?? {};
    return {
      ...base,
      type: 'object',
      properties: { ...baseProps, branches: { type: 'object', properties: branchProps } },
    };
  }

  return base;
}

export interface AvailableContext {
  /**
   * Map of context path → JSON Schema.
   *
   * Keys use the same dotted-path convention as variable refs:
   * - `"trigger"` — the trigger's output schema
   * - `"steps.<stepId>.output"` — a preceding step's output schema
   */
  [path: string]: Record<string, unknown>;
}

/**
 * Compute the available variable context at a given step in the workflow.
 *
 * Returns a map of path → JSON Schema for the trigger output and all
 * preceding step outputs. Returns `null` if `atStepId` is not found
 * anywhere in the step tree.
 */
export function getAvailableContext(
  config: WorkflowConfig,
  atStepId: string,
  connectors: ConnectorRegistry,
): AvailableContext | null {
  const ctx: AvailableContext = {};

  // Add trigger output if registered. Use the trigger's per-instance
  // `resolveOutputJsonSchema(config)` when available (lets webhook /
  // manual triggers type headers/body/query from author-supplied schemas);
  // otherwise fall back to the static outputSchema.
  if (config.trigger && connectors.hasTrigger(config.trigger.type)) {
    const triggerImpl = connectors.getTrigger(config.trigger.type);
    ctx['trigger'] = resolveOutputJsonSchemaOf(
      triggerImpl,
      (config.trigger.config ?? {}) as Record<string, unknown>,
    );
  }

  // Author-time workflow variables, referenceable anywhere as {{vars.<key>}}.
  // Only surface the group once at least one variable is actually named.
  if (config.variables?.some((v) => v.key.trim().length > 0)) {
    ctx['vars'] = varsJsonSchema(config.variables);
  }

  // A trigger filter runs before any step exists, so it sees only the above.
  if (atStepId === TRIGGER_FILTER_SCOPE) return ctx;

  const found = walkForContext(config.steps, atStepId, ctx, connectors);
  return found ? ctx : null;
}

/**
 * Walk steps in order. Returns true if `targetId` was found (meaning ctx is populated).
 * Stops as soon as the target is found — no further steps are added.
 */
function walkForContext(
  stepList: WorkflowStepConfig[],
  targetId: string,
  ctx: AvailableContext,
  connectors: ConnectorRegistry,
): boolean {
  for (const step of stepList) {
    // If this is the target step, stop — don't include its own output
    if (step.id === targetId) {
      return true;
    }

    // Register this step's output schema if registered
    if (connectors.hasStep(step.type)) {
      const impl = connectors.getStep(step.type);
      ctx[`steps.${step.id}.output`] = resolveOutputJsonSchemaOf(
        impl,
        step.config as Record<string, unknown>,
        connectors,
      );

      // Recurse into control-flow branches
      if (impl instanceof BaseControlFlowStep && impl.getBranches) {
        const branches = impl.getBranches(
          step.config as Record<string, unknown>,
        );
        // What the step injects into its own branches — a loop's `__loop`, a
        // MAP's `__map`. These are not steps in the config, so a plain walk
        // never sees them; the step is the only thing that knows their shape
        // (CYCLE types `input` from the author's own config). Same hook the
        // validator uses, so the picker offers exactly what validates.
        const scope = impl.branchScopeSchemas?.(
          step.config as Record<string, unknown>,
        ) ?? {};
        for (const branchSteps of Object.values(branches)) {
          // Branch gets a snapshot of current context — steps inside a branch
          // shouldn't leak to sibling branches
          const branchCtx: AvailableContext = { ...ctx };
          // Scoped like the branch itself: visible inside, gone outside, and a
          // nested loop's own `__loop` shadows this one.
          for (const [key, schema] of Object.entries(scope)) {
            branchCtx[`steps.${key}`] = schema;
          }
          if (walkForContext(branchSteps, targetId, branchCtx, connectors)) {
            // Found inside this branch — copy back accumulated context
            Object.assign(ctx, branchCtx);
            return true;
          }
        }
      }
    }
  }

  return false;
}
