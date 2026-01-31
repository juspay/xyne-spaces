import type { RuleGroupType, ValueEditorType } from 'react-querybuilder';

// ============================================================================
// Operator-Type Mapping
// ============================================================================

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'select';
export type ComparisonOperator =
  | 'equals'
  | 'notEquals'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'isEmpty'
  | 'isNotEmpty';

/**
 * Type-specific operators for each field type
 */
const TYPE_SPECIFIC_OPERATORS: Record<FieldType, ComparisonOperator[]> = {
  string: ['in', 'notIn', 'contains', 'startsWith', 'endsWith'],
  number: ['in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'between'],
  boolean: [],
  date: ['gt', 'gte', 'lt', 'lte', 'between'],
  select: ['in', 'notIn'],
};

/**
 * Operators valid for all field types (universal operators)
 */
const UNIVERSAL_OPERATORS: ComparisonOperator[] = ['equals', 'notEquals', 'isEmpty', 'isNotEmpty'];

/**
 * Get all valid operators for a given field type
 */
export function getOperatorsForFieldType(
  fieldType: FieldType,
  isRequired?: boolean,
): ComparisonOperator[] {
  const allOperators = [...UNIVERSAL_OPERATORS, ...TYPE_SPECIFIC_OPERATORS[fieldType]];
  if (isRequired) {
    return allOperators.filter(op => op !== 'isEmpty' && op !== 'isNotEmpty');
  }
  return allOperators;
}

/**
 * Operator labels for display
 */
export const OPERATOR_LABELS: Record<ComparisonOperator, string> = {
  equals: '=',
  notEquals: '!=',
  in: 'in',
  notIn: 'not in',
  contains: 'contains',
  startsWith: 'starts with',
  endsWith: 'ends with',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  between: 'between',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
};

/**
 * Get operator label for display
 */
export function getOperatorLabel(operator: ComparisonOperator): string {
  return OPERATOR_LABELS[operator];
}

export interface FieldOption {
  name: string;
  key: string;
  type: FieldType;
  enumValues?: string[];
  isCustom?: boolean;
  fieldId?: string;
  isRequired?: boolean;
}

export type FieldConfig = {
  name: string;
  label: string;
  value: string;
  key: string;
  isCustom: boolean;
  operators: Array<{ name: string; label: string }>;
  valueEditorType: ValueEditorType | ((operator: string) => ValueEditorType);
  values?: Array<{ name: string; label: string }>;
};

export function buildFieldsConfig(fieldOptions: FieldOption[]): FieldConfig[] {
  const fieldsConfig: FieldConfig[] = [];

  fieldOptions.forEach(field => {
    const isSelectOrEnum = field.type === 'select';

    const fieldConfigObj: FieldConfig = {
      name: field.isCustom ? field.key : field.name,
      label: field.name,
      value: field.isCustom ? field.key : field.name,
      key: field.key,
      isCustom: field.isCustom ?? false,
      operators: getOperatorsForFieldType(field.type, field.isRequired).map(op => ({
        name: op,
        label: getOperatorLabel(op),
      })),
      valueEditorType: 'text',
    };

    if (isSelectOrEnum) {
      fieldConfigObj.valueEditorType = (operator: string): ValueEditorType =>
        operator === 'in' || operator === 'notIn' ? 'multiselect' : 'select';
      if (field.enumValues) {
        fieldConfigObj.values = field.enumValues.map(v => ({ name: v, label: v }));
      }
    }

    fieldsConfig.push(fieldConfigObj);
  });

  return fieldsConfig;
}

// ============================================================================
// Query Transformation Functions
// These are pure functions that transform between react-querybuilder format
// and the backend logical filter format
// ============================================================================

export interface FieldCondition {
  field: string;
  operator: string;
  value: unknown;
}

export interface LogicalFilter {
  operator: 'AND' | 'OR';
  conditions: Array<FieldCondition | LogicalFilter>;
}

type FilterCondition = FieldCondition | LogicalFilter;

export function transformValueForOperator(operator: string, value: unknown): unknown {
  if (value && typeof value === 'object' && 'id' in value) {
    return value as { id: string; name?: string };
  }
  if (operator === 'in' || operator === 'notIn') {
    if (!Array.isArray(value)) {
      if (typeof value === 'string') {
        const parts = value
          .split(',')
          .map(v => v.trim())
          .filter(v => v.length > 0);
        return parts.length > 0 ? parts : [value];
      }
      return [value];
    }
    if (value.length === 1 && typeof value[0] === 'string' && value[0].includes(',')) {
      const parts = value[0]
        .split(',')
        .map(v => v.trim())
        .filter(v => v.length > 0);
      return parts.length > 0 ? parts : value;
    }
    return value.map((v: unknown) => (typeof v === 'object' && v !== null && 'id' in v ? v : v));
  }
  if (operator === 'between') {
    return Array.isArray(value) ? value : [value];
  }
  return value;
}

export function mapOperatorToBackend(operator: string): string {
  const map: Record<string, string> = {
    equals: 'equals',
    notEquals: 'notEquals',
    contains: 'contains',
    beginsWith: 'startsWith',
    endsWith: 'endsWith',
    in: 'in',
    notIn: 'notIn',
    null: 'isEmpty',
    notNull: 'isNotEmpty',
    greaterThan: 'gt',
    greaterThanOrEqual: 'gte',
    lessThan: 'lt',
    lessThanOrEqual: 'lte',
    between: 'between',
  };
  if (operator === '=' || operator === '==') return 'equals';
  if (operator === '!=') return 'notEquals';
  if (operator === '>') return 'gt';
  if (operator === '>=') return 'gte';
  if (operator === '<') return 'lt';
  if (operator === '<=') return 'lte';
  return map[operator] || operator;
}

export function transformQueryToLogicalFilter(ruleGroup: RuleGroupType): LogicalFilter {
  const conditions: FilterCondition[] = [];
  for (const rule of ruleGroup.rules) {
    if ('rules' in rule) {
      conditions.push(transformQueryToLogicalFilter(rule));
    } else {
      const backendOperator = mapOperatorToBackend(rule.operator);
      conditions.push({
        field: rule.field,
        operator: backendOperator,
        value: transformValueForOperator(backendOperator, rule.value),
      });
    }
  }
  return { operator: ruleGroup.combinator.toUpperCase() as 'AND' | 'OR', conditions };
}

export function transformLogicalFilterToQuery(filter: LogicalFilter): RuleGroupType {
  const rules: Array<RuleGroupType | { field: string; operator: string; value: unknown }> = [];
  for (const condition of filter.conditions) {
    if ('operator' in condition && 'conditions' in condition) {
      rules.push(transformLogicalFilterToQuery(condition));
    } else {
      rules.push({
        field: condition.field,
        operator: condition.operator,
        value: condition.value,
      });
    }
  }
  return {
    combinator: filter.operator.toLowerCase() as 'and' | 'or',
    rules: rules as RuleGroupType['rules'],
  };
}
