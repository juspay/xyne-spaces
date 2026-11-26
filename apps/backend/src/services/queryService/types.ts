import { z } from 'zod';
import { FormEntityType } from '@xyne/shared';

/**
 * The only tables the analytics query route may read. Adding one here exposes every scalar
 * column of that model to any authenticated user (rows are still filtered by its ACL), so
 * check the model's columns before extending this list.
 */
export const SUPPORTED_ENTITY_TYPES = [
  FormEntityType.TICKET,
  'USER_WORKLOAD_MAPPING',
] as const;

export type SupportedEntityType = (typeof SUPPORTED_ENTITY_TYPES)[number];

export function isSupportedEntityType(entityType: string): entityType is SupportedEntityType {
  return (SUPPORTED_ENTITY_TYPES as readonly string[]).includes(entityType);
}

export const ENTITY_TYPE_TO_PRISMA_MODEL: Record<SupportedEntityType, string> = {
  [FormEntityType.TICKET]: 'Ticket',
  USER_WORKLOAD_MAPPING: 'UserWorkloadMapping',
};

export function getPrismaModelName(entityType: SupportedEntityType): string {
  return ENTITY_TYPE_TO_PRISMA_MODEL[entityType];
}

export function isValidFormEntityType(entityType: string): entityType is FormEntityType {
  return Object.values(FormEntityType).includes(entityType as FormEntityType);
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
  entityType: string;
  projectId?: string;
  select?: string[];
  filters?: LogicalFilter;
  aggregations?: Aggregation[];
  groupBy?: string[];
  orderBy?: OrderBy[];
  limit?: number;
  offset?: number;
  dateGranularity?: 'hour' | 'day' | 'week' | 'month';
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

// ----------------------------------------------------------------------------
// Request schema. The request body is attacker-controlled and its pieces end up as Prisma
// arguments, so every list and string is bounded. Unknown keys are stripped rather than
// rejected (saved dashboards carry UI-only keys such as visualizationType); that is safe
// because only the parsed output, which holds the keys declared here, reaches the builder.
// ----------------------------------------------------------------------------

export const MAX_QUERY_LIMIT = 10000;
const MAX_OFFSET = 100000;
const MAX_FIELD_NAME_LENGTH = 128;
const MAX_FILTER_DEPTH = 5;
const MAX_FILTER_CONDITIONS = 100;
/** Conditions plus the groups holding them. */
const MAX_FILTER_NODES = MAX_FILTER_CONDITIONS * 2;
const MAX_VALUE_LIST_LENGTH = 1000;

/** A system column name or `custom.<fieldId>`; anything else cannot name a real field. */
const FieldNameSchema = z
  .string()
  .min(1)
  .max(MAX_FIELD_NAME_LENGTH)
  .regex(/^(custom\.)?[A-Za-z0-9_-]+$/, 'Invalid field name');

const ScalarValueSchema = z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]);

/**
 * The picker sends `{ id, name }` for user/board/project options (any other keys are
 * stripped). Only `id` is ever used, and it must be a scalar: an object here would be passed
 * to Prisma as a filter of its own.
 */
const OptionValueSchema = z
  .object({ id: z.union([z.string().max(1000), z.number()]), name: z.string().max(1000).optional() });

const FilterValueSchema = z.union([
  ScalarValueSchema,
  OptionValueSchema,
  z.array(z.union([ScalarValueSchema, OptionValueSchema])).max(MAX_VALUE_LIST_LENGTH),
]);

const RESERVED_ALIASES = new Set(['__proto__', 'constructor', 'prototype']);

const AggregationSchema = z
  .object({
    function: z.enum(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']),
    field: FieldNameSchema,
    // Free text from the dashboard ("Avg (hrs)", "% done", non-English names). It is only
    // ever a key of a plain result object, so only the prototype-related names are refused.
    alias: z
      .string()
      .min(1)
      .max(200)
      .refine(a => !RESERVED_ALIASES.has(a), 'Invalid alias')
      .optional(),
  })

const OrderBySchema = z
  .object({
    field: FieldNameSchema,
    direction: z.enum(['ASC', 'DESC']),
  })

const FieldConditionSchema = z
  .object({
    field: FieldNameSchema,
    operator: z.enum(COMPARISON_OPERATORS),
    value: FilterValueSchema.optional(),
  })

const LogicalFilterSchema: z.ZodType<LogicalFilter> = z.lazy(() =>
  z
    .object({
      operator: z.enum(LOGICAL_OPERATORS),
      conditions: z
        .array(z.union([FieldConditionSchema, LogicalFilterSchema]))
        .min(1)
        .max(MAX_FILTER_CONDITIONS),
    }),
) as z.ZodType<LogicalFilter>;

/**
 * Depth and size of the raw filter tree, checked before zod sees it. zod's recursive schema
 * would otherwise walk an arbitrarily deep tree (a 10mb body nests ~300k levels) and overflow
 * the stack. Iterative, and stops at the first limit it passes.
 */
function checkRawFilterShape(raw: unknown): string | null {
  const pending: Array<{ node: unknown; depth: number }> = [{ node: raw, depth: 1 }];
  let nodes = 0;
  while (pending.length > 0) {
    const { node, depth } = pending.pop()!;
    if (++nodes > MAX_FILTER_NODES) {
      return `Filters may hold at most ${MAX_FILTER_CONDITIONS} conditions`;
    }
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    const conditions = (node as { conditions?: unknown }).conditions;
    if (!Array.isArray(conditions)) continue;
    if (depth > MAX_FILTER_DEPTH) {
      return `Filters may nest at most ${MAX_FILTER_DEPTH} levels`;
    }
    if (conditions.length > MAX_FILTER_CONDITIONS) {
      return `Filters may hold at most ${MAX_FILTER_CONDITIONS} conditions`;
    }
    for (const condition of conditions) pending.push({ node: condition, depth: depth + 1 });
  }
  return null;
}

const GenericQuerySchema = z
  .object({
    entityType: z.enum(SUPPORTED_ENTITY_TYPES),
    projectId: z.string().max(MAX_FIELD_NAME_LENGTH).optional(),
    select: z.array(FieldNameSchema).max(200).optional(),
    filters: LogicalFilterSchema.optional(),
    aggregations: z.array(AggregationSchema).max(20).optional(),
    groupBy: z.array(FieldNameSchema).max(5).optional(),
    orderBy: z.array(OrderBySchema).max(5).optional(),
    limit: z.number().int().positive().max(MAX_QUERY_LIMIT).optional(),
    offset: z.number().int().nonnegative().max(MAX_OFFSET).optional(),
    dateGranularity: z.enum(['hour', 'day', 'week', 'month']).optional(),
  });

/**
 * Parse and validate a generic query
 */
export function parseGenericQuery(data: unknown): { success: boolean; query?: GenericQuery; error?: string } {
  if (data && typeof data === 'object' && 'filters' in data) {
    const shapeError = checkRawFilterShape((data as { filters?: unknown }).filters);
    if (shapeError) return { success: false, error: shapeError };
  }
  const result = GenericQuerySchema.safeParse(data);
  if (!result.success) {
    return {
      success: false,
      error: result.error.issues.map(e => e.message).join(', '),
    };
  }
  return { success: true, query: result.data as GenericQuery };
}