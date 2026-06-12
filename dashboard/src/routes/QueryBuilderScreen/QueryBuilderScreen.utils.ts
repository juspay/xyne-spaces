// ============================================================================
// Imports
// ============================================================================

import {
  detectFieldType,
  userGroupsToOptions,
  usersToOptions,
} from '../../utils/queryBuilderFieldMappings';

// ============================================================================
// Operator-Type Mapping
// ============================================================================

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'select';
export type ValueEditorType = 'text' | 'select' | 'multiselect' | 'checkbox' | 'date' | 'time';
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
  aggregatable?: boolean;
}

export interface UserGroup {
  id: string;
  name: string;
}

export interface User {
  id: string;
  name?: string;
  email?: string;
}

export type FieldConfig = {
  name: string;
  label: string;
  value: string;
  key: string;
  isCustom: boolean;
  type?: FieldType;
  operators: Array<{ name: string; label: string }>;
  valueEditorType: ValueEditorType | ((operator: string) => ValueEditorType);
  values?: Array<{ name: string; label: string }>;
  aggregatable?: boolean;
};

export function buildFieldsConfig(
  fieldOptions: FieldOption[],
  userGroups?: UserGroup[],
  users?: User[],
  projects?: Array<{ id: string; name: string }>,
  boards?: Array<{ id: string; name: string }>,
): FieldConfig[] {
  const fieldsConfig: FieldConfig[] = [];

  // Ensure all inputs are arrays
  const userGroupsData = Array.isArray(userGroups) ? userGroups : [];
  const usersData = Array.isArray(users) ? users : [];
  const projectsData = Array.isArray(projects) ? projects : [];
  const boardsData = Array.isArray(boards) ? boards : [];

  fieldOptions.forEach(field => {
    const isSelectOrEnum = field.type === 'select';
    const dropdownType = detectFieldType(field.name);

    const fieldConfigObj: FieldConfig = {
      name: field.isCustom ? field.key : field.name,
      label: field.name,
      value: field.isCustom ? field.key : field.name,
      key: field.key,
      isCustom: field.isCustom ?? false,
      type: field.type,
      ...(field.aggregatable !== undefined ? { aggregatable: field.aggregatable } : {}),
      operators: getOperatorsForFieldType(field.type, field.isRequired).map(op => ({
        name: op,
        label: getOperatorLabel(op),
      })),
      valueEditorType: 'text',
    };

    if (field.type === 'date') {
      fieldConfigObj.valueEditorType = 'date';
    } else if (isSelectOrEnum || dropdownType) {
      fieldConfigObj.valueEditorType = (operator: string): ValueEditorType =>
        operator === 'in' || operator === 'notIn' ? 'multiselect' : 'select';

      // Initialize values array - will be populated based on dropdown type
      fieldConfigObj.values = [];

      // Add dropdown options based on field type
      if (dropdownType === 'userGroup') {
        if (userGroupsData.length > 0) {
          fieldConfigObj.values = userGroupsToOptions(userGroupsData);
        }
      } else if (dropdownType === 'user') {
        if (usersData.length > 0) {
          fieldConfigObj.values = usersToOptions(usersData);
        }
      } else if (dropdownType === 'project') {
        if (projectsData.length > 0) {
          fieldConfigObj.values = projectsData.map(p => ({
            name: p.id,
            label: p.name || p.id,
          }));
        }
      } else if (dropdownType === 'board') {
        if (boardsData.length > 0) {
          fieldConfigObj.values = boardsData.map(b => ({
            name: b.id,
            label: b.name || b.id,
          }));
        }
      } else if (field.enumValues && field.enumValues.length > 0) {
        fieldConfigObj.values = field.enumValues.map(v => ({ name: v, label: v }));
      }
    }

    fieldsConfig.push(fieldConfigObj);
  });

  return fieldsConfig;
}

// ============================================================================
// Value Transformation & Operator Mapping Functions
// ============================================================================

export interface FieldCondition {
  field: string;
  operator: string;
  value: unknown;
}

export function transformValueForOperator(operator: string, value: unknown): unknown {
  if (value && typeof value === 'object' && 'id' in value) {
    return value as { id: string; name?: string };
  }
  if (operator === 'in' || operator === 'notIn') {
    if (!Array.isArray(value)) {
      if (typeof value === 'string') {
        const parts = value
          .split(',')
          .map((v: string) => v.trim())
          .filter((v: string) => v.length > 0);
        return parts.length > 0 ? parts : [value];
      }
      return [value];
    }
    if (value.length === 1 && typeof value[0] === 'string' && value[0].includes(',')) {
      const parts = value[0]
        .split(',')
        .map((v: string) => v.trim())
        .filter((v: string) => v.length > 0);
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
  if (operator === '=' || operator === '==') {
    return 'equals';
  }
  if (operator === '!=') {
    return 'notEquals';
  }
  if (operator === '>') {
    return 'gt';
  }
  if (operator === '>=') {
    return 'gte';
  }
  if (operator === '<') {
    return 'lt';
  }
  if (operator === '<=') {
    return 'lte';
  }
  return map[operator] || operator;
}

// ============================================================================
// FilterGroup Conversion Functions (for compatibility with new custom builder)
// ============================================================================

import { FilterGroup, FilterCondition, generateId } from '../../utils/queryBuilder';

export interface LogicalFilter {
  operator: 'AND' | 'OR';
  conditions: Array<{
    field: string;
    operator: ComparisonOperator;
    value: unknown;
  }>;
}

export function createEmptyFilterGroup(): FilterGroup {
  return {
    id: generateId('group'),
    combinator: 'AND',
    conditions: [],
  };
}

export function logicalFilterToFilterGroup(filter: LogicalFilter): FilterGroup {
  const conditions: Array<FilterCondition | FilterGroup> = filter.conditions.map(
    (cond: { field: string; operator: ComparisonOperator; value: unknown }) => ({
      id: generateId('cond'),
      field: cond.field,
      operator: cond.operator,
      value: cond.value,
    }),
  );

  return {
    id: generateId('group'),
    combinator: filter.operator,
    conditions,
  };
}

export function filterGroupToLogicalFilter(group: FilterGroup | null): LogicalFilter {
  if (!group) {
    return { operator: 'AND', conditions: [] };
  }

  const conditions = group.conditions
    .filter(
      (item: FilterCondition | FilterGroup) =>
        'field' in item && 'operator' in item && 'value' in item,
    )
    .map((item: FilterCondition | FilterGroup) => ({
      field: (item as FilterCondition).field,
      operator: (item as FilterCondition).operator,
      value: (item as FilterCondition).value,
    }));

  return {
    operator: group.combinator,
    conditions,
  };
}
