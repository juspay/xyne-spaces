import type { Condition, JsonSchema, LeafCondition } from '../../Automation.types';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import { formatReferenceLabel, parseReference } from '../VariablePicker/VariablePicker.utils';
import { detectEntityKind, resolveSchema, type EntityKind } from '../SchemaForm/SchemaForm.utils';

export function hasInvalidTagCondition(condition: Condition): boolean {
  if (isLeaf(condition)) {
    if (condition.operator !== 'has_tag') return false;
    const val = typeof condition.value === 'string' ? condition.value : '';
    const firstColon = val.indexOf(':');
    const secondColon = val.indexOf(':', firstColon + 1);
    if (firstColon === -1 || secondColon === -1) return true;
    const category = val.slice(0, firstColon);
    if (!category) return true;
    const tags = val
      .slice(secondColon + 1)
      .split(',')
      .filter(Boolean);
    return tags.length === 0;
  }
  if (isAndGroup(condition)) return condition.all.some(hasInvalidTagCondition);
  if (isOrGroup(condition)) return condition.any.some(hasInvalidTagCondition);
  return false;
}

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
  starts_with: 'starts with',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  exists: 'exists',
  has_tag: 'has tag',
};

/** Looks up the display name of an id picked in an entity field (channel, user…). */
export type EntityNameLookup = (kind: EntityKind, id: string) => string | undefined;

/**
 * One-line summary of a condition: variable references use the condition
 * editor's labels, and a picked channel or user shows by name, not id.
 */
export function summarizeCondition(
  condition: Condition | undefined,
  sources: VariablePickerSource[],
  nameForId: EntityNameLookup,
): string {
  if (!condition) return 'Click to set a condition';
  if (isLeaf(condition)) {
    if (isEmptyLeaf(condition)) return 'Click to set a condition';
    const lhs = formatVariableRef(condition.variable, sources);
    const verb = OPERATOR_VERBS[condition.operator] ?? condition.operator;
    if (condition.operator === 'exists') return `${lhs} ${verb}`;
    const rhs =
      typeof condition.value === 'string' && parseReference(condition.value)
        ? formatReferenceLabel(condition.value, sources)
        : formatValue(entityName(condition, nameForId) ?? condition.value);
    return `${lhs} ${verb} ${rhs}`;
  }
  if (isAndGroup(condition)) {
    if (condition.all.length === 0) return 'Click to set a condition';
    return `(${condition.all.map(c => summarizeCondition(c, sources, nameForId)).join(' AND ')})`;
  }
  if (isOrGroup(condition)) {
    if (condition.any.length === 0) return 'Click to set a condition';
    return `(${condition.any.map(c => summarizeCondition(c, sources, nameForId)).join(' OR ')})`;
  }
  return 'Condition';
}

/** Same entity detection as the editor's value field (`detectEntityKind` on the leaf key). */
function entityName(leaf: LeafCondition, nameForId: EntityNameLookup): string | undefined {
  if (typeof leaf.value !== 'string' || !leaf.value) return undefined;
  const lastKey = parseReference(leaf.variable)?.path.split('.').pop() ?? '';
  const kind = detectEntityKind(lastKey);
  return kind ? nameForId(kind, leaf.value) : undefined;
}

function formatVariableRef(value: string, sources: VariablePickerSource[]): string {
  return parseReference(value) ? formatReferenceLabel(value, sources) : value || '<empty>';
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
