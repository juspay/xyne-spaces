import { z } from 'zod';
import { FormEntityType } from '@prisma/client';

/**
 * Mapping of FormEntityType to Prisma model names
 */
export const ENTITY_TYPE_TO_PRISMA_MODEL: Record<FormEntityType, string> = {
  [FormEntityType.TICKET]: 'Ticket',
  [FormEntityType.SUB_TICKET]: 'SubTicket',
  [FormEntityType.RELEASE_ENV_FORM]: "ReleaseChangeType",
  [FormEntityType.RELEASE_MIGRATION_FORM]: "ReleaseChangeType",
} as const;

/**
 * Get Prisma model name from entity type
 */
export function getPrismaModelName(entityType: FormEntityType): string {
  return ENTITY_TYPE_TO_PRISMA_MODEL[entityType];
}

/**
 * Logical operator for combining conditions
 */
export const LOGICAL_OPERATORS = ['AND', 'OR'] as const;
export type LogicalOperator = (typeof LOGICAL_OPERATORS)[number];

/**
 * Comparison operators for field conditions
 */
export const COMPARISON_OPERATORS = [
  'equals',
  'notEquals',
  'in',
  'notIn',
  'contains',
  'startsWith',
  'endsWith',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'isEmpty',
  'isNotEmpty',
] as const;
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];


export const SINGLE_VALUE_OPERATORS = [
  'equals',
  'notEquals',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'startsWith',
  'endsWith',
] as const;


export const ARRAY_VALUE_OPERATORS = ['in', 'notIn', 'between'] as const;

/**
 * Field condition - a single filter on a field
 */
export interface FieldCondition {
  /** Field name (system field or 'custom.<fieldId>') */
  field: string;
  /** Comparison operator */
  operator: ComparisonOperator;
  /** Filter value */
  value: any;
}

/**
 * Logical filter - supports nested AND/OR groups
 */
export interface LogicalFilter {
  /** Logical operator to combine conditions */
  operator: LogicalOperator;
  /** Conditions - can be field conditions or nested logical filters */
  conditions: (FieldCondition | LogicalFilter)[];
}

/**
 * Type guard to check if a filter is a LogicalFilter
 */
export function isLogicalFilter(filter: unknown): filter is LogicalFilter {
  return (
    typeof filter === 'object' &&
    filter !== null &&
    'operator' in filter &&
    (filter.operator === 'AND' || filter.operator === 'OR') &&
    'conditions' in filter &&
    Array.isArray((filter as LogicalFilter).conditions)
  );
}

/**
 * Generic query interface for querying any entity type
 */
export interface GenericQuery {
  entityType: FormEntityType;
  projectId?: string;
  select?: string[];
  filters?: LogicalFilter;
  aggregations?: Aggregation[];
  groupBy?: string[];
  orderBy?: OrderBy[];
  limit?: number;
  offset?: number;
}

/**
 * Aggregation function
 */
export interface Aggregation {
  function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  field: string;
  alias?: string;
}

/**
 * Order by clause
 */
export interface OrderBy {
  field: string;
  direction: 'ASC' | 'DESC';
}

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'select';

/**
 * Normalize value based on operator type
 * - Single-value operators: extract first value from arrays
 */
export function normalizeValueForOperator(operator: string, value: unknown): unknown {
  if (SINGLE_VALUE_OPERATORS.includes(operator as any) && Array.isArray(value)) {
    return value[0];
  }
  return value;
}


const TYPE_SPECIFIC_OPERATORS: Record<FieldType, ComparisonOperator[]> = {
  string: ['in', 'notIn', 'contains', 'startsWith', 'endsWith'],
  number: ['in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'between'],
  boolean: [],
  date: ['gt', 'gte', 'lt', 'lte', 'between'],
  select: ['in', 'notIn'],
};

const UNIVERSAL_OPERATORS: ComparisonOperator[] = ['equals', 'notEquals', 'isEmpty', 'isNotEmpty'];

export function isOperatorValidForType(operator: ComparisonOperator, fieldType: FieldType): boolean {

  if (UNIVERSAL_OPERATORS.includes(operator)) {
    return true;
  }
  return TYPE_SPECIFIC_OPERATORS[fieldType]?.includes(operator) ?? false;
}

export interface FieldInfo {
  name: string;
  type: FieldType;
  sortable: boolean;
  filterable: boolean;
  aggregatable: boolean;
  description?: string;
  enumType?: string;
  enumValues?: string[];
  fieldId?: string;
}

export interface AvailableFields {
  system: FieldInfo[];
  custom: FieldInfo[];
}

export interface QueryResult {
  success: boolean;
  data?: Record<string, unknown>[];
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  metadata?: {
    count: number;
    executionTimeMs: number;
  };
}

const AggregationSchema = z.object({
  function: z.enum(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']),
  field: z.string(),
  alias: z.string().optional(),
});

const OrderBySchema = z.object({
  field: z.string(),
  direction: z.enum(['ASC', 'DESC']),
});

const FieldConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(COMPARISON_OPERATORS),
  value: z.unknown(),
});

const LogicalFilterSchema = z.object({
  operator: z.enum(LOGICAL_OPERATORS),
  conditions: z.array(z.lazy(() => z.union([FieldConditionSchema, LogicalFilterSchema]))).min(1),
}) as any;

const GenericQuerySchema = z.object({
  entityType: z.nativeEnum(FormEntityType),
  projectId: z.string().optional(),
  select: z.array(z.string()).optional(),
  filters: LogicalFilterSchema.optional(),
  aggregations: z.array(AggregationSchema).optional(),
  groupBy: z.array(z.string()).optional(),
  orderBy: z.array(OrderBySchema).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});

/**
 * Parse and validate a generic query
 */
export function parseGenericQuery(data: unknown): { success: boolean; query?: GenericQuery; error?: string } {
  const result = GenericQuerySchema.safeParse(data);
  if (!result.success) {
    return {
      success: false,
      error: result.error.errors.map(e => e.message).join(', '),
    };
  }
  return { success: true, query: result.data };
}