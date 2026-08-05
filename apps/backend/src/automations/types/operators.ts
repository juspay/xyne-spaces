import { z } from 'zod';

export enum ConditionOperator {
  EQ = 'eq',
  NEQ = 'neq',
  CONTAINS = 'contains',
  GT = 'gt',
  GTE = 'gte',
  LT = 'lt',
  LTE = 'lte',
  EXISTS = 'exists',
  HAS_TAG = 'has_tag',
}

export const ConditionOperatorSchema = z.nativeEnum(ConditionOperator);

export const VALUE_LESS_OPERATORS: ReadonlySet<ConditionOperator> = new Set([
  ConditionOperator.EXISTS,
]);
