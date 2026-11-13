/**
 * Reading a condition — the same shape wherever one appears.
 *
 * A condition is a leaf (`read this, compare it that way, against that`) or a
 * group of conditions joined by `all` or `any`. Two places in a conversation
 * carry one: a screen asked differently depending on the data, and an option
 * offered only under it. Both mean the same thing and are edited by the same
 * editor, so what a condition *is* is answered once, here.
 *
 * Nesting deeper than one group is legal in the engine and read faithfully by
 * everything below — it just isn't something this layer writes.
 */
import { VALUE_LESS_OPERATORS, type ConditionOperator } from '../types/operators.js';
import type { Condition, LeafCondition } from '../types/workflow-config.js';

/** A group's join, or `undefined` when it is a single test. */
export function joinOf(condition: Condition): 'all' | 'any' | undefined {
  if ('all' in condition) return 'all';
  if ('any' in condition) return 'any';
  return undefined;
}

/** The conditions directly inside a group; a leaf is its own only part. */
export function partsIn(condition: Condition): Condition[] {
  const join = joinOf(condition);
  return join ? (condition as Record<'all' | 'any', Condition[]>)[join] : [condition];
}

/** Every test a condition makes, however it is grouped. */
export function leavesOf(condition: Condition): LeafCondition[] {
  const join = joinOf(condition);
  if (!join) return isLeaf(condition) ? [condition] : [];
  return (condition as Record<'all' | 'any', Condition[]>)[join].flatMap(leavesOf);
}

/** Whether every part is a test — what the editor can lay out as rows. */
export function isFlat(condition: Condition): boolean {
  return partsIn(condition).every(isLeaf);
}

function isLeaf(condition: Condition): condition is LeafCondition {
  return 'variable' in condition && 'operator' in condition;
}

/** A group of tests, or the test itself when there is one. */
export function group(join: 'all' | 'any', parts: readonly Condition[]): Condition {
  return parts.length === 1 ? parts[0]! : ({ [join]: [...parts] } as Condition);
}

/** Whether this operator reads a value at all — `is there` compares with nothing. */
export function takesValue(operator: string): boolean {
  return !VALUE_LESS_OPERATORS.has(operator as ConditionOperator);
}

/**
 * A short name for a condition, for a place that needs one word about it — a
 * switch case's label in the config, a chip in a list.
 *
 * The field name, not the whole reference: `{{steps.account.output.body.plan}}`
 * is `plan`, which is what the author called it and what they will recognise.
 */
export function labelFor(condition: Condition): string {
  const leaves = leavesOf(condition);
  const first = leaves[0];
  if (!first) return 'when';
  const name = fieldName(first.variable);
  const said = first.value === undefined ? `${name} ${first.operator}` : `${name} ${first.operator} ${String(first.value)}`;
  return leaves.length === 1 ? said : `${said} +${String(leaves.length - 1)}`;
}

/** The last segment of a reference — what the author named the field. */
export function fieldName(variable: string): string {
  return /\.([^.\s}]+)\s*\}\}$/.exec(variable)?.[1] ?? /\{\{\s*([^.}\s]+)\s*\}\}/.exec(variable)?.[1] ?? 'data';
}
