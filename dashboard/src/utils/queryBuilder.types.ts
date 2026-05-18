/**
 * Custom Query Builder Types
 * Core type definitions for filtering, aggregation, grouping, and ordering
 */

/**
 * Comparison operators supported by the query builder
 */
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
 * A single filter condition
 * Represents one atomic filter rule (e.g., "field equals value")
 */
export interface FilterCondition {
  /** Unique identifier for this condition */
  id: string;
  /** Field to filter on */
  field: string;
  /** Comparison operator */
  operator: ComparisonOperator;
  /** Value to compare against */
  value: unknown;
}

/**
 * A group of filter conditions combined with AND or OR
 * Can contain nested FilterGroups for complex queries
 */
export interface FilterGroup {
  /** Unique identifier for this group */
  id: string;
  /** Combinator: AND all conditions or OR all conditions */
  combinator: 'AND' | 'OR';
  /** Conditions and/or nested groups in this filter */
  conditions: Array<FilterCondition | FilterGroup>;
}

/**
 * Type guard to check if an item is a FilterCondition
 */
export function isFilterCondition(item: FilterCondition | FilterGroup): item is FilterCondition {
  return 'operator' in item && 'value' in item;
}

/**
 * Type guard to check if an item is a FilterGroup
 */
export function isFilterGroup(item: FilterCondition | FilterGroup): item is FilterGroup {
  return 'conditions' in item && Array.isArray(item.conditions);
}

/**
 * Aggregation functions supported
 */
export type AggregationFunction = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';

/**
 * An aggregation rule
 * Represents a calculation over grouped data
 */
export interface AggregationRule {
  /** The aggregation function to apply */
  function: AggregationFunction;
  /** The field to aggregate (or * for COUNT) */
  field: string;
  /** Optional alias for the result */
  alias?: string;
}

/**
 * Sort direction
 */
export type SortDirection = 'ASC' | 'DESC';

/**
 * An order by rule
 * Specifies how to sort results
 */
export interface OrderRule {
  /** Field to sort by */
  field: string;
  /** Sort direction */
  direction: SortDirection;
}

/**
 * Complete query configuration
 * All the information needed to execute a query
 */
export interface QueryConfig {
  /** The entity type being queried */
  entityType: string;
  /** Filter conditions (null means no filtering) */
  filters: FilterGroup | null;
  /** Aggregation rules to apply */
  aggregations: AggregationRule[];
  /** Fields to group by (when using aggregations) */
  groupBy: string[];
  /** Fields to sort results by */
  orderBy: OrderRule[];
  /** Maximum number of results to return */
  limit?: number;
  /** Number of results to skip */
  offset?: number;
  /** Specific fields to select (null means all) */
  select?: string[];
  /** Visualization type for displaying results */
  visualizationType?: string;
}

/**
 * Validation error
 */
export interface ValidationError {
  /** Field or section that has the error */
  field: string;
  /** Human-readable error message */
  message: string;
  /** Severity level */
  severity: 'error' | 'warning';
}

/**
 * Backend query format
 * What gets sent to the server
 */
export interface BackendQueryFormat {
  entityType: string;
  filters?: {
    operator: 'AND' | 'OR';
    conditions: Array<{
      field: string;
      operator: ComparisonOperator;
      value: unknown;
    }>;
  };
  aggregations?: AggregationRule[];
  groupBy?: string[];
  orderBy?: OrderRule[];
  limit?: number;
  offset?: number;
  select?: string[];
}
