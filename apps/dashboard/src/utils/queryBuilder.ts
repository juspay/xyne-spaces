/**
 * Query Builder Utilities
 * Handles conversions, validation, and utility functions for queries
 */

import type {
  QueryConfig,
  FilterGroup,
  FilterCondition,
  BackendQueryFormat,
  ValidationError,
  AggregationRule,
  OrderRule,
  ComparisonOperator,
} from './queryBuilder.types';
import { isFilterCondition, isFilterGroup } from './queryBuilder.types';

/**
 * Generate a unique ID with a given prefix
 * @param prefix The prefix for the ID (e.g., 'filter', 'cond', 'group')
 * @returns A unique ID like "filter-1234567890-abc123"
 */
export function generateId(prefix: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Query Builder utility class
 * Provides static methods for converting between formats and validating queries
 */
export class QueryBuilder {
  /**
   * Convert QueryConfig to backend JSON format
   * @param config The query configuration
   * @returns Backend query format ready to send to API
   */
  static toBackendFormat(config: QueryConfig): BackendQueryFormat {
    const backend: BackendQueryFormat = {
      entityType: config.entityType,
    };

    // Convert filters if present
    if (config.filters) {
      const flattened = this.flattenFilterGroup(config.filters);
      backend.filters = {
        operator: flattened.operator,
        conditions: flattened.conditions as Array<{
          field: string;
          operator: ComparisonOperator;
          value: unknown;
        }>,
      };
    }

    // Add aggregations if present
    if (config.aggregations && config.aggregations.length > 0) {
      backend.aggregations = config.aggregations;
    }

    // Add groupBy if present
    if (config.groupBy && config.groupBy.length > 0) {
      backend.groupBy = config.groupBy;
    }

    // Add orderBy if present
    if (config.orderBy && config.orderBy.length > 0) {
      backend.orderBy = config.orderBy;
    }

    // Add pagination
    if (config.limit !== undefined) {
      backend.limit = config.limit;
    }
    if (config.offset !== undefined) {
      backend.offset = config.offset;
    }

    // Add select if present
    if (config.select && config.select.length > 0) {
      backend.select = config.select;
    }

    return backend;
  }

  /**
   * Flatten a FilterGroup into backend format
   * Recursively processes nested groups and conditions
   */
  private static flattenFilterGroup(group: FilterGroup): {
    operator: 'AND' | 'OR';
    conditions: Array<{
      field: string;
      operator: string;
      value: unknown;
    }>;
  } {
    const conditions: Array<{
      field: string;
      operator: string;
      value: unknown;
    }> = [];

    for (const item of group.conditions) {
      if (isFilterCondition(item)) {
        conditions.push({
          field: item.field,
          operator: item.operator,
          value: item.value,
        });
      } else if (isFilterGroup(item)) {
        // For nested groups, we might need to handle them differently
        // For now, we flatten them
        const nested = this.flattenFilterGroup(item);
        conditions.push({
          field: `__group_${nested.operator}`,
          operator: 'nested',
          value: nested,
        });
      }
    }

    return {
      operator: group.combinator,
      conditions,
    };
  }

  /**
   * Reconstruct QueryConfig from backend JSON
   * @param json The backend query format
   * @returns Query configuration
   */
  static fromBackendFormat(json: unknown): QueryConfig {
    if (!json || typeof json !== 'object') {
      return this.createEmptyConfig('');
    }

    const obj = json as Record<string, unknown>;

    const config: QueryConfig = {
      entityType: (obj['entityType'] as string) || '',
      filters: obj['filters'] ? this.unflattenFilterGroup(obj['filters']) : null,
      aggregations: (obj['aggregations'] as AggregationRule[]) || [],
      groupBy: (obj['groupBy'] as string[]) || [],
      orderBy: (obj['orderBy'] as OrderRule[]) || [],
    };

    if (obj['limit'] !== undefined) {
      config.limit = obj['limit'] as number;
    }
    if (obj['offset'] !== undefined) {
      config.offset = obj['offset'] as number;
    }
    if (obj['select']) {
      config.select = (obj['select'] as string[]) || [];
    }

    return config;
  }

  /**
   * Reconstruct a FilterGroup from backend format
   */
  private static unflattenFilterGroup(filters: unknown): FilterGroup {
    if (!filters || typeof filters !== 'object') {
      return {
        id: generateId('group'),
        combinator: 'AND',
        conditions: [],
      };
    }

    const filterObj = filters as Record<string, unknown>;
    const operator = (filterObj['operator'] as string) || 'AND';
    const conditionsList = (filterObj['conditions'] as Array<Record<string, unknown>>) || [];

    const conditions: Array<FilterCondition | FilterGroup> = [];

    for (const cond of conditionsList) {
      if (cond['operator'] === 'nested' && cond['value']) {
        // Recursively reconstruct nested groups
        conditions.push(this.unflattenFilterGroup(cond['value']));
      } else {
        conditions.push({
          id: generateId('cond'),
          field: (cond['field'] as string) || '',
          operator: ((cond['operator'] as string) || 'equals') as ComparisonOperator,
          value: cond['value'],
        });
      }
    }

    return {
      id: generateId('group'),
      combinator: (operator as 'AND' | 'OR') || 'AND',
      conditions,
    };
  }

  /**
   * Validate a QueryConfig
   * @param config The query to validate
   * @returns Array of validation errors (empty if valid)
   */
  static validate(config: QueryConfig): ValidationError[] {
    const errors: ValidationError[] = [];

    // Validate entity type
    if (!config.entityType || config.entityType.trim().length === 0) {
      errors.push({
        field: 'entityType',
        message: 'Entity type is required',
        severity: 'error',
      });
    }

    // Validate filters if present
    if (config.filters) {
      errors.push(...this.validateFilterGroup(config.filters));
    }

    // Validate aggregations if present
    if (config.aggregations && config.aggregations.length > 0) {
      errors.push(...this.validateAggregations(config.aggregations));

      // If aggregations exist, groupBy should match
      if (config.groupBy.length === 0) {
        errors.push({
          field: 'groupBy',
          message: 'Group By is required when using aggregations',
          severity: 'warning',
        });
      }
    }

    // Validate orderBy if present
    if (config.orderBy && config.orderBy.length > 0) {
      errors.push(...this.validateOrderBy(config.orderBy));
    }

    // Validate pagination
    if (config.limit !== undefined && config.limit < 1) {
      errors.push({
        field: 'limit',
        message: 'Limit must be greater than 0',
        severity: 'error',
      });
    }

    if (config.offset !== undefined && config.offset < 0) {
      errors.push({
        field: 'offset',
        message: 'Offset cannot be negative',
        severity: 'error',
      });
    }

    return errors;
  }

  /**
   * Validate a FilterGroup
   */
  private static validateFilterGroup(group: FilterGroup): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!group.combinator || (group.combinator !== 'AND' && group.combinator !== 'OR')) {
      errors.push({
        field: 'combinator',
        message: 'Combinator must be AND or OR',
        severity: 'error',
      });
    }

    if (!group.conditions || group.conditions.length === 0) {
      errors.push({
        field: 'conditions',
        message: 'At least one condition is required in a filter group',
        severity: 'error',
      });
    }

    for (const item of group.conditions || []) {
      if (isFilterCondition(item)) {
        if (!item.field || item.field.trim().length === 0) {
          errors.push({
            field: 'field',
            message: 'Filter field is required',
            severity: 'error',
          });
        }

        if (!item.operator) {
          errors.push({
            field: 'operator',
            message: 'Filter operator is required',
            severity: 'error',
          });
        }
      } else if (isFilterGroup(item)) {
        errors.push(...this.validateFilterGroup(item));
      }
    }

    return errors;
  }

  /**
   * Validate aggregation rules
   */
  private static validateAggregations(aggs: AggregationRule[]): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const agg of aggs) {
      if (!agg.function) {
        errors.push({
          field: 'aggregations',
          message: 'Aggregation function is required',
          severity: 'error',
        });
      }

      if (!agg.field || agg.field.trim().length === 0) {
        errors.push({
          field: 'aggregations',
          message: 'Aggregation field is required',
          severity: 'error',
        });
      }
    }

    return errors;
  }

  /**
   * Validate order by rules
   */
  private static validateOrderBy(orders: OrderRule[]): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const order of orders) {
      if (!order.field || order.field.trim().length === 0) {
        errors.push({
          field: 'orderBy',
          message: 'Order by field is required',
          severity: 'error',
        });
      }

      if (!order.direction || (order.direction !== 'ASC' && order.direction !== 'DESC')) {
        errors.push({
          field: 'orderBy',
          message: 'Order by direction must be ASC or DESC',
          severity: 'error',
        });
      }
    }

    return errors;
  }

  /**
   * Check if a query is completely empty
   */
  static isEmpty(config: QueryConfig): boolean {
    return (
      !config.filters &&
      config.aggregations.length === 0 &&
      config.groupBy.length === 0 &&
      config.orderBy.length === 0 &&
      !config.limit &&
      !config.offset
    );
  }

  /**
   * Check if a query has any filters
   */
  static isFiltered(config: QueryConfig): boolean {
    return config.filters !== null && config.filters.conditions.length > 0;
  }

  /**
   * Create an empty query config
   */
  static createEmptyConfig(entityType: string): QueryConfig {
    return {
      entityType,
      filters: null,
      aggregations: [],
      groupBy: [],
      orderBy: [],
      select: [],
    };
  }

  /**
   * Deep clone a query config
   */
  static clone(config: QueryConfig): QueryConfig {
    const cloned: QueryConfig = {
      entityType: config.entityType,
      filters: config.filters ? this.cloneFilterGroup(config.filters) : null,
      aggregations: [...config.aggregations],
      groupBy: [...config.groupBy],
      orderBy: [...config.orderBy],
    };

    if (config.limit !== undefined) {
      cloned.limit = config.limit;
    }
    if (config.offset !== undefined) {
      cloned.offset = config.offset;
    }
    if (config.select) {
      cloned.select = [...config.select];
    }
    if (config.visualizationType) {
      cloned.visualizationType = config.visualizationType;
    }

    return cloned;
  }

  /**
   * Clone a filter group recursively
   */
  private static cloneFilterGroup(group: FilterGroup): FilterGroup {
    return {
      ...group,
      conditions: group.conditions.map(item => {
        if (isFilterCondition(item)) {
          return { ...item };
        }
        return this.cloneFilterGroup(item);
      }),
    };
  }
}

// Re-export types and utilities for convenience
export type {
  FilterGroup,
  FilterCondition,
  ComparisonOperator,
  QueryConfig,
  AggregationRule,
  OrderRule,
  ValidationError,
  BackendQueryFormat,
} from './queryBuilder.types';
export { isFilterCondition, isFilterGroup } from './queryBuilder.types';
