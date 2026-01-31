import { PrismaClient, FormEntityType } from '@prisma/client';
import { AvailableFields, GenericQuery, QueryResult, FieldCondition, LogicalFilter, isLogicalFilter, isOperatorValidForType, FieldInfo, parseGenericQuery, normalizeValueForOperator, FieldType } from './types';
import { GenericFieldRegistry } from './genericFieldRegistry';
import { GenericQueryBuilder } from './genericQueryBuilder';

// ============================================================================
// Generic Query Service
// ============================================================================

export class GenericQueryService {
  private registry: GenericFieldRegistry;
  private queryBuilder: GenericQueryBuilder;

  constructor(prisma: PrismaClient) {
    this.registry = GenericFieldRegistry.getInstance(prisma);
    this.queryBuilder = new GenericQueryBuilder(prisma);
  }


  parseQuery(raw: unknown): { success: boolean; query?: GenericQuery; error?: string } {
    return parseGenericQuery(raw);
  }


  async validateQuery(query: GenericQuery): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    const availableFields = await this.registry.getAvailableFields(query.entityType);
    const allFields: FieldInfo[] = [
      ...availableFields.system,
      ...availableFields.custom,
    ];


    if (query.filters) {
      const filterErrors = this.validateFilterRecursively(query.filters, allFields);
      errors.push(...filterErrors);
    }

    // Validate orderBy fields are sortable
    if (query.orderBy) {
      for (const order of query.orderBy) {
        const fieldInfo = this.findField(allFields, order.field);
        if (!fieldInfo) {
          errors.push(`Unknown field in orderBy: '${order.field}'`);
        } else if (!fieldInfo.sortable) {
          errors.push(`Field '${order.field}' is not sortable`);
        }
      }
    }

    // Validate aggregations
    if (query.aggregations) {
      for (const agg of query.aggregations) {
        const fieldInfo = this.findField(allFields, agg.field);
        if (!fieldInfo) {
          errors.push(`Unknown field in aggregation: '${agg.field}'`);
        } else if (!fieldInfo.aggregatable) {
          errors.push(`Field '${agg.field}' is not aggregatable`);
        } else if (!this.isAggregationValidForType(agg.function, fieldInfo.type)) {
          errors.push(`Aggregation '${agg.function}' is not valid for '${agg.field}' (type: ${fieldInfo.type})`);
        }
      }
    }

    if (query.groupBy) {
      for (const field of query.groupBy) {
        const fieldInfo = this.findField(allFields, field);
        if (!fieldInfo) {
          errors.push(`Unknown field in groupBy: '${field}'`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }


  private findField(allFields: FieldInfo[], fieldName: string): FieldInfo | undefined {

    if (!fieldName.startsWith('custom.')) {
      return allFields.find(f => f.name === fieldName);
    }

    const fieldId = fieldName.replace('custom.', '');
    return allFields.find(f => f.fieldId === fieldId);
  }

  private isAggregationValidForType(
    func: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
    fieldType: FieldType
  ): boolean {
    if (func === 'COUNT') return true;
    if (func === 'SUM' || func === 'AVG') return fieldType === 'number';
    if (func === 'MIN' || func === 'MAX') return fieldType === 'number' || fieldType === 'date';
    return false;
  }

  /**
   * Validate a filter recursively
   */
  private validateFilterRecursively(
    filter: LogicalFilter | FieldCondition,
    allFields: FieldInfo[]
  ): string[] {
    const errors: string[] = [];

    if (isLogicalFilter(filter)) {
      for (const condition of filter.conditions) {
        errors.push(...this.validateFilterRecursively(condition, allFields));
      }
    } else {
      const fieldInfo = this.findField(allFields, filter.field);

      if (!fieldInfo) {
        errors.push(`Unknown field: '${filter.field}'`);
      } else if (!fieldInfo.filterable) {
        errors.push(`Field '${filter.field}' is not filterable`);
      } else if (!isOperatorValidForType(filter.operator, fieldInfo.type)) {
        errors.push(`Operator '${filter.operator}' is not valid for '${filter.field}' (type: ${fieldInfo.type})`);
      } else {
        const normalizedValue = normalizeValueForOperator(filter.operator, filter.value);
        if (!this.isValueProvidedForOperator(filter.operator, normalizedValue)) {
          errors.push(`Value is required for field '${filter.field}' with operator '${filter.operator}'`);
        } else if (!this.isValueValidForOperator(filter.operator, normalizedValue)) {
          errors.push(`Invalid value type for operator '${filter.operator}' on field '${filter.field}'`);
        }
      }
    }

    return errors;
  }

  private isValueProvidedForOperator(operator: string, value: unknown): boolean {
    const noValueOperators = ['isEmpty', 'isNotEmpty'];
    if (noValueOperators.includes(operator)) {
      return true;
    }

    if (value === null || value === undefined || value === '') {
      return false;
    }

    if (operator === 'in' || operator === 'notIn') {
      if (!Array.isArray(value) || value.length === 0) {
        return false;
      }
    }

    if (operator === 'between') {
      if (!Array.isArray(value) || value.length < 2) {
        return false;
      }
    }
    return true;
  }

  private isValueValidForOperator(operator: string, value: unknown): boolean {
    const singleValueOperators = ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'endsWith'];
    const arrayValueOperators = ['in', 'notIn'];

    // Single value operators should not receive arrays
    if (singleValueOperators.includes(operator)) {
      if (Array.isArray(value)) {
        return false;
      }
    }

    // Array value operators should receive arrays
    if (arrayValueOperators.includes(operator)) {
      if (!Array.isArray(value)) {
        return false;
      }
    }
    
    if (operator === 'between') {
      if (!Array.isArray(value) || value.length !== 2) {
        return false;
      }
    }

    return true;
  }

  async execute(query: GenericQuery): Promise<QueryResult> {
    return this.queryBuilder.execute(query);
  }

  async getAvailableFields(entityType: FormEntityType): Promise<AvailableFields> {
    return this.registry.getAvailableFields(entityType);
  }
}

export function createQueryService(prisma: PrismaClient): GenericQueryService {
  return new GenericQueryService(prisma);
}