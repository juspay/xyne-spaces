/**
 * How a condition is said to an author.
 *
 * The engine's operator is a token (`eq`, `not_contains`); what an author reads
 * is a word. That mapping is the whole of this file, and it lives outside the
 * editor because the map says the same sentence on a card, and a card should not
 * have to pull the editor in to say it.
 */
import {
  fieldName,
  joinOf,
  leavesOf,
  takesValue,
  ConditionOperator,
  OPERATOR_DESCRIPTORS,
  type Condition,
} from '@xyne/workflow-sdk/conversational-flow';

/**
 * Driven by the engine's own catalogue, so an operator added there appears in
 * the editor — worded if we have words for it, in its own label if not.
 */
const SAID: Partial<Record<ConditionOperator, string>> = {
  [ConditionOperator.EQ]: 'is',
  [ConditionOperator.NEQ]: 'is not',
  [ConditionOperator.CONTAINS]: 'contains',
  [ConditionOperator.NOT_CONTAINS]: 'does not contain',
  [ConditionOperator.STARTS_WITH]: 'starts with',
  [ConditionOperator.ENDS_WITH]: 'ends with',
  [ConditionOperator.GT]: 'is more than',
  [ConditionOperator.GTE]: 'is at least',
  [ConditionOperator.LT]: 'is less than',
  [ConditionOperator.LTE]: 'is at most',
  [ConditionOperator.EXISTS]: 'is there',
  [ConditionOperator.NOT_EXISTS]: 'is missing',
  [ConditionOperator.IS_EMPTY]: 'is empty',
};

/** Every operator the engine has, in the order and words the editor offers. */
export const OPERATORS = OPERATOR_DESCRIPTORS.map((o) => ({ ...o, said: SAID[o.value] ?? o.label }));

/** How one operator is said. */
export function saidOperator(operator: string): string {
  return SAID[operator as ConditionOperator] ?? operator;
}

/** A whole condition on one line — for a tooltip, or anywhere prose is enough. */
export function said(condition: Condition): string {
  const join = joinOf(condition) === 'any' ? ' or ' : ' and ';
  return leavesOf(condition)
    .map((leaf) => {
      const how = saidOperator(leaf.operator);
      const name = fieldName(leaf.variable);
      return takesValue(leaf.operator) ? `${name} ${how} ${String(leaf.value ?? '')}` : `${name} ${how}`;
    })
    .join(join);
}
