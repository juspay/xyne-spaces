/**
 * Evaluate a trigger's filter against one event, before any run exists.
 *
 * The filter is the author's data — the same condition tree the Conditional
 * step uses — so a connector never writes filtering code. Variables resolve
 * under `trigger.*` and `vars.*`, the only context that exists before a run.
 */

import type { TriggerFilter, WorkflowConfig } from '../types/workflow-config.js';
import type { WorkflowContext } from '../types/context.js';
import { ConditionEvaluator } from '../engine/condition-evaluator.js';
import { projectVariables } from '../types/workflow-variable.js';

const evaluator = new ConditionEvaluator();

/**
 * True when there is no filter, or the event satisfies it.
 *
 * Async because a filter condition may compare a `{% expression %}`, which only
 * the (async) condition evaluator can read. Callers already await — admission
 * happens inside an async path — so this costs nothing at the call site.
 */
export async function matchesTriggerFilter(
  filter: TriggerFilter | undefined,
  payload: Readonly<Record<string, unknown>>,
  variables: WorkflowConfig['variables'],
): Promise<boolean> {
  if (!filter?.conditions) return true;
  const context = {
    workflow: { id: '', metadata: {} },
    trigger: payload,
    steps: {},
    vars: projectVariables(variables),
  } as unknown as WorkflowContext;
  return evaluator.evaluate(filter.conditions, context);
}
