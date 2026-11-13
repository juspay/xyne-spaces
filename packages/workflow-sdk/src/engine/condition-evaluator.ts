import type { Condition, LeafCondition } from '../types/workflow-config.js';
import type { WorkflowContext } from '../types/context.js';
import { ConditionOperator } from '../types/operators.js';
import { resolveReference, resolveValue } from './resolve-expressions.js';

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === 'number' && typeof b === 'string')
    return a === Number(b);
  if (typeof a === 'string' && typeof b === 'number')
    return Number(a) === b;
  if (typeof a === 'boolean' || typeof b === 'boolean')
    return Number(a) === Number(b);
  return false;
}

/** Substring for text, membership for a list, false for anything else. */
function contains(resolved: unknown, refValue: unknown): boolean {
  if (typeof resolved === 'string' && typeof refValue === 'string') {
    return resolved.includes(refValue);
  }
  if (Array.isArray(resolved)) return resolved.includes(refValue);
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

    case ConditionOperator.NOT_EXISTS:
      return resolved === undefined || resolved === null;

    /**
     * Absent counts as empty, and so does whitespace: an author asking "is empty"
     * means "there is nothing here", and a field holding `" "` is not something
     * they would call filled in.
     */
    case ConditionOperator.IS_EMPTY:
      if (resolved === undefined || resolved === null) return true;
      if (typeof resolved === 'string') return resolved.trim() === '';
      if (Array.isArray(resolved)) return resolved.length === 0;
      if (typeof resolved === 'object') return Object.keys(resolved).length === 0;
      return false;

    case ConditionOperator.CONTAINS:
      return contains(resolved, refValue);

    /**
     * A missing value does not contain anything, so it satisfies this — the same
     * answer an author expects from "the title does not contain WIP" when there is
     * no title at all.
     */
    case ConditionOperator.NOT_CONTAINS:
      return !contains(resolved, refValue);

    case ConditionOperator.STARTS_WITH:
      return (
        typeof resolved === 'string' &&
        typeof refValue === 'string' &&
        resolved.startsWith(refValue)
      );
    case ConditionOperator.ENDS_WITH:
      return (
        typeof resolved === 'string' &&
        typeof refValue === 'string' &&
        resolved.endsWith(refValue)
      );

    case ConditionOperator.GT:
      return (
        resolved !== undefined &&
        resolved !== null &&
        (resolved as number) > (refValue as number)
      );
    case ConditionOperator.GTE:
      return (
        resolved !== undefined &&
        resolved !== null &&
        (resolved as number) >= (refValue as number)
      );
    case ConditionOperator.LT:
      return (
        resolved !== undefined &&
        resolved !== null &&
        (resolved as number) < (refValue as number)
      );
    case ConditionOperator.LTE:
      return (
        resolved !== undefined &&
        resolved !== null &&
        (resolved as number) <= (refValue as number)
      );
    default:
      throw new Error(`Unhandled ConditionOperator: ${String(operator)}`);
  }
}

/**
 * Resolve a leaf's two halves.
 *
 * Both go through the engine's shared slot resolvers, so a condition accepts
 * exactly what every other config field accepts:
 *
 *   variable  a path, a `{{ref}}`, or a `{% expression %}`  — *where* to look
 *   value     a literal, a `{{ref}}`, or a `{% expression %}` — *what* to compare
 *
 * This is the one component that resolves a condition. The variable resolver and
 * the expression pre-pass both step over condition objects and leave them
 * alone, because this slot holds a reference rather than a value and has to stay
 * a reference until here — flattening it earlier would hand `applyOperator` a
 * value where a path belongs, and every comparison would answer as though the
 * field were missing.
 *
 * Sequential rather than `Promise.all`: a leaf is two cheap reads, and keeping
 * them ordered means a failing `variable` reports before the `value` beside it.
 */
async function evaluateLeaf(
  leaf: LeafCondition,
  context: WorkflowContext,
): Promise<boolean> {
  const resolved = await resolveReference(leaf.variable, context);
  const comparand = await resolveValue(leaf.value, context);
  return applyOperator(leaf.operator, resolved, comparand);
}

/**
 * Evaluates a recursive Condition tree against a WorkflowContext.
 *
 * - Leaf: resolves both halves, applies the operator
 * - `all`: short-circuit AND (all children must be true)
 * - `any`: short-circuit OR (any child must be true)
 *
 * Asynchronous because a condition may now compare a computed value, and
 * evaluating a `{% expression %}` is asynchronous — JSONata offers no
 * synchronous entry point. Nothing else about the contract moved: the children
 * are still awaited one at a time rather than with `Promise.all`, which is what
 * keeps `all`/`any` short-circuiting. An author relying on a later branch not
 * being evaluated — a comparison that would fail on data the earlier test rules
 * out — still gets that.
 */
export class ConditionEvaluator {
  async evaluate(condition: Condition, context: WorkflowContext): Promise<boolean> {
    if ('variable' in condition && 'operator' in condition) {
      return evaluateLeaf(condition, context);
    }
    if ('all' in condition) {
      for (const child of condition.all) {
        if (!(await this.evaluate(child, context))) return false;
      }
      return true;
    }
    if ('any' in condition) {
      for (const child of condition.any) {
        if (await this.evaluate(child, context)) return true;
      }
      return false;
    }
    throw new Error(
      `Unrecognised condition shape: ${JSON.stringify(condition)}`,
    );
  }
}
