import type { Condition, LeafCondition } from '../types/automation-config';
import type { AutomationContext } from '../types/context';
import { ConditionOperator } from '../types/operators';
import { extractRefPath, isPureRef } from '../util/variable-ref';

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function resolveVariable(variable: string, context: AutomationContext): unknown {
  const path = extractRefPath(variable);
  if (!path) return undefined;

  const segments = path.split('.');
  if (segments.length === 0) return undefined;
  if (segments.some(s => FORBIDDEN_KEYS.has(s))) return undefined;

  const head = segments[0];
  if (head === undefined) return undefined;
  let current: unknown;
  let rest: string[];
  if (head === 'trigger' || head === 'automation') {
    current = (context as unknown as Record<string, unknown>)[head];
    rest = segments.slice(1);
  } else {
    current = context.steps[head];
    rest = segments.slice(1);
  }

  for (const segment of rest) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === 'number' && typeof b === 'string') return a === Number(b);
  if (typeof a === 'string' && typeof b === 'number') return Number(a) === b;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) === Number(b);
  return false;
}

function applyOperator(
  operator: ConditionOperator,
  resolved: unknown,
  refValue: unknown,
): boolean {
  switch (operator) {
    case ConditionOperator.EXISTS:
      return resolved !== undefined && resolved !== null;

    case ConditionOperator.EQ:
      return looseEquals(resolved, refValue);
    case ConditionOperator.NEQ:
      return !looseEquals(resolved, refValue);

    case ConditionOperator.CONTAINS:
      if (typeof resolved === 'string' && typeof refValue === 'string') {
        return resolved.includes(refValue);
      }
      if (Array.isArray(resolved)) return resolved.includes(refValue);
      return false;

    case ConditionOperator.GT:
      return resolved !== undefined && resolved !== null && (resolved as number) > (refValue as number);
    case ConditionOperator.GTE:
      return resolved !== undefined && resolved !== null && (resolved as number) >= (refValue as number);
    case ConditionOperator.LT:
      return resolved !== undefined && resolved !== null && (resolved as number) < (refValue as number);
    case ConditionOperator.LTE:
      return resolved !== undefined && resolved !== null && (resolved as number) <= (refValue as number);
    default:
      return assertNever(operator);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled ConditionOperator: ${String(value)}`);
}

// The right-hand operand may either be a literal constant or, for
// variable-to-variable comparisons, a pure `{{context.<path>}}` reference that
// resolves against the automation context just like the left-hand `variable`.
// Anything that isn't a pure reference (numbers, booleans, plain strings) is
// treated as a literal — keeping existing variable-to-constant conditions intact.
function resolveOperand(value: unknown, context: AutomationContext): unknown {
  if (typeof value === 'string' && isPureRef(value)) {
    return resolveVariable(value, context);
  }
  return value;
}

function evaluateLeaf(leaf: LeafCondition, context: AutomationContext): boolean {
  return applyOperator(leaf.operator, resolveVariable(leaf.variable, context), resolveOperand(leaf.value, context));
}

export class ConditionEvaluator {
  evaluate(condition: Condition, context: AutomationContext): boolean {
    if ('variable' in condition && 'operator' in condition) {
      return evaluateLeaf(condition, context);
    }
    if ('all' in condition) {
      for (const child of condition.all) {
        if (!this.evaluate(child, context)) return false;
      }
      return true;
    }
    if ('any' in condition) {
      for (const child of condition.any) {
        if (this.evaluate(child, context)) return true;
      }
      return false;
    }
    throw new Error(`Unrecognised condition shape: ${JSON.stringify(condition)}`);
  }
}

export const conditionEvaluator = new ConditionEvaluator();
