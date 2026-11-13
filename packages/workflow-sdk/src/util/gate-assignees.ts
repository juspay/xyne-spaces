import { walkSteps } from './variable-ref.js';
import { BuiltinStepType } from '../types/known-types.js';

export function collectGateAssignees(config: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  walkSteps(config, (step) => {
    if (step.type !== BuiltinStepType.WAIT_FOR_HUMAN) return;
    const value = (step as { config?: Record<string, unknown> }).config?.['assignee'];
    if (value !== undefined) out.set(step.id, value);
  });
  return out;
}