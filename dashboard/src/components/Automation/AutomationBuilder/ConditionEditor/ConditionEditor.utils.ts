import type { Condition, JsonSchema, LeafCondition } from '../../Automation.types';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import { parseReference } from '../VariablePicker/VariablePicker.utils';
import { resolveSchema } from '../SchemaForm/SchemaForm.utils';

export function makeEmptyLeaf(): LeafCondition {
  return { variable: '', operator: 'eq', value: '' };
}

export function isLeaf(c: Condition): c is LeafCondition {
  return 'variable' in c && 'operator' in c;
}

export function isAndGroup(c: Condition): c is { all: Condition[] } {
  return 'all' in c && Array.isArray((c as { all: unknown }).all);
}

export function isOrGroup(c: Condition): c is { any: Condition[] } {
  return 'any' in c && Array.isArray((c as { any: unknown }).any);
}

export function isEmptyLeaf(c: Condition): boolean {
  if (!isLeaf(c)) return false;
  const variableEmpty = !c.variable || c.variable.trim().length === 0;
  return variableEmpty;
}

const OPERATOR_VERBS: Record<string, string> = {
  eq: 'equals',
  neq: 'does not equal',
  contains: 'contains',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  exists: 'exists',
};

export function summarizeCondition(condition: Condition | undefined): string {
  if (!condition) return 'Click to set a condition';
  if (isLeaf(condition)) {
    if (isEmptyLeaf(condition)) return 'Click to set a condition';
    const lhs = formatVariableRef(condition.variable);
    const verb = OPERATOR_VERBS[condition.operator] ?? condition.operator;
    if (condition.operator === 'exists') return `${lhs} ${verb}`;
    const rhs = formatValue(condition.value);
    return `${lhs} ${verb} ${rhs}`;
  }
  if (isAndGroup(condition)) {
    if (condition.all.length === 0) return 'Click to set a condition';
    return `(${condition.all.map(summarizeCondition).join(' AND ')})`;
  }
  if (isOrGroup(condition)) {
    if (condition.any.length === 0) return 'Click to set a condition';
    return `(${condition.any.map(summarizeCondition).join(' OR ')})`;
  }
  return 'Condition';
}

function formatVariableRef(value: string): string {
  const match = /^\{\{context\.([^}]+)\}\}$/.exec(value);
  if (!match || !match[1]) return value || '<empty>';
  const segments = match[1].split('.').filter(s => s !== 'output' && s !== 'input');
  return segments.slice(-2).join('.') || match[1];
}

export function resolveLeafSchema(
  reference: string,
  sources: VariablePickerSource[],
): { schema: JsonSchema; lastKey: string } | null {
  const parsed = parseReference(reference);
  if (!parsed) return null;
  const source = sources.find(s => s.sourceKey === parsed.sourceKey && s.role === parsed.role);
  if (!source) return null;

  let current: JsonSchema = resolveSchema(source.schema);
  const segments = parsed.path.split('.').filter(s => s.length > 0);
  if (segments.length === 0) return null;

  for (let i = 0; i < segments.length; i += 1) {
    const key = segments[i];
    if (!key) return null;
    const concrete = unwrapAnyOf(current);
    const props = concrete.properties;
    if (!props || !(key in props)) return null;
    const next = props[key];
    if (!next) return null;
    current = resolveSchema(next);
  }
  return {
    schema: unwrapAnyOf(current),
    lastKey: segments[segments.length - 1] ?? '',
  };
}

function unwrapAnyOf(schema: JsonSchema): JsonSchema {
  if (!schema.anyOf || schema.anyOf.length === 0) return schema;
  const concrete = schema.anyOf.find(s => s.type !== 'null');
  return concrete ?? schema.anyOf[0] ?? schema;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '∅';
  if (typeof value === 'string') return value.length === 0 ? '""' : `"${value}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
