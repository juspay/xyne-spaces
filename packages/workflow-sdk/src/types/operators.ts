import { z } from 'zod';
import type { TypeKind } from '../util/type-compat.js';

/**
 * What a condition can ask of a value.
 *
 * Deliberately small: anything the tree can already say another way is left out.
 * `in` is an `any` group of `eq`s, `not in` is an `all` group of `neq`s — adding
 * operators for those would give authors two ways to write one rule. What IS here
 * is what the tree cannot express at all: negation of a substring test, the two
 * ends of a string, and the difference between absent and empty.
 */
export enum ConditionOperator {
  EQ = 'eq',
  NEQ = 'neq',
  CONTAINS = 'contains',
  NOT_CONTAINS = 'not_contains',
  STARTS_WITH = 'starts_with',
  ENDS_WITH = 'ends_with',
  GT = 'gt',
  GTE = 'gte',
  LT = 'lt',
  LTE = 'lte',
  EXISTS = 'exists',
  NOT_EXISTS = 'not_exists',
  IS_EMPTY = 'is_empty',
}

export const ConditionOperatorSchema = z.nativeEnum(ConditionOperator);

export const VALUE_LESS_OPERATORS: ReadonlySet<ConditionOperator> = new Set([
  ConditionOperator.EXISTS,
  ConditionOperator.NOT_EXISTS,
  ConditionOperator.IS_EMPTY,
]);

// ─── Operator Descriptors (for UI condition builder) ───

export interface OperatorDescriptor {
  readonly value: ConditionOperator;
  readonly label: string;
  /**
   * What kind of control the *comparison value* gets. A UI concern: `EQ` is
   * `'string'` because you type into a box, not because it compares text.
   */
  readonly valueType: 'string' | 'number' | 'boolean' | 'none';
  /**
   * What the **left side** has to be for this operator to be able to hold at
   * all, when that is unambiguous. Undefined means "anything", which is most of
   * them, and the absence is as deliberate as the presence:
   *
   * - `EQ`/`NEQ` compare anything, because `looseEquals` coerces on purpose —
   *   `5` equals `"5"` in this engine, so refusing a number against text would
   *   refuse something that works.
   * - `CONTAINS` holds for a substring *or* a list member, and a union is not
   *   something this vocabulary can say.
   * - `EXISTS`/`IS_EMPTY` are about presence, whatever the thing is.
   *
   * So only the four comparisons that are arithmetic, and the two that are
   * really about text, say anything here — and those are the ones where a wrong
   * left side means the condition can never be true.
   */
  readonly needs?: TypeKind;
}

export const OPERATOR_DESCRIPTORS: readonly OperatorDescriptor[] = [
  { value: ConditionOperator.EQ, label: 'equals', valueType: 'string' },
  { value: ConditionOperator.NEQ, label: 'does not equal', valueType: 'string' },
  { value: ConditionOperator.CONTAINS, label: 'contains', valueType: 'string' },
  { value: ConditionOperator.NOT_CONTAINS, label: 'does not contain', valueType: 'string' },
  { value: ConditionOperator.STARTS_WITH, label: 'starts with', valueType: 'string', needs: 'string' },
  { value: ConditionOperator.ENDS_WITH, label: 'ends with', valueType: 'string', needs: 'string' },
  { value: ConditionOperator.GT, label: 'is greater than', valueType: 'number', needs: 'number' },
  { value: ConditionOperator.GTE, label: 'is greater than or equal to', valueType: 'number', needs: 'number' },
  { value: ConditionOperator.LT, label: 'is less than', valueType: 'number', needs: 'number' },
  { value: ConditionOperator.LTE, label: 'is less than or equal to', valueType: 'number', needs: 'number' },
  { value: ConditionOperator.EXISTS, label: 'exists', valueType: 'none' },
  { value: ConditionOperator.NOT_EXISTS, label: 'does not exist', valueType: 'none' },
  { value: ConditionOperator.IS_EMPTY, label: 'is empty', valueType: 'none' },
];
