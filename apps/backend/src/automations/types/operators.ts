import { z } from 'zod';

const MAX_CONDITION_REGEX_LENGTH = 500;
const CONDITION_REGEX_FLAGS = /^[imsu]*$/;

export enum ConditionOperator {
  EQ = 'eq',
  NEQ = 'neq',
  CONTAINS = 'contains',
  MATCHES_REGEX = 'matches_regex',
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

/**
 * Compile either a raw pattern (`call\\s+now`) or JavaScript-style pattern
 * (`/call\\s+now/i`). Global/sticky flags are intentionally not accepted so
 * repeated automation evaluations stay deterministic.
 */
export function compileConditionRegex(value: string): RegExp | null {
  let source = value;
  let flags = '';

  if (value.startsWith('/')) {
    const closingSlash = value.lastIndexOf('/');
    if (closingSlash > 0) {
      source = value.slice(1, closingSlash);
      flags = value.slice(closingSlash + 1);
    }
  }

  if (!source || source.length > MAX_CONDITION_REGEX_LENGTH) return null;
  if (!CONDITION_REGEX_FLAGS.test(flags) || new Set(flags).size !== flags.length) return null;

  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}
