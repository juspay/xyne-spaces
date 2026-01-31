import { PrismaClient, FormEntityType } from '@prisma/client';
import {
  GenericQuery,
  Aggregation,
  QueryResult,
  LogicalFilter,
  FieldCondition,
  isLogicalFilter,
  getPrismaModelName,
  normalizeValueForOperator,
} from './types';
import { PrismaFieldType, getFieldMetadata, hasField } from './genericFieldRegistry';

const MAX_QUERY_LIMIT = 5000;
const QUERY_TIMEOUT = 30000;

/**
 * Execute a promise with timeout protection
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = QUERY_TIMEOUT
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Query timeout')), timeoutMs)
    ),
  ]);
}

export class GenericQueryBuilder {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get the Prisma model for a given entity type.
   * Uses a whitelist approach to prevent SQL injection via dynamic model access.
   */
  private getModel(entityType: FormEntityType) {
    const modelMap: Record<FormEntityType, any> = {
      [FormEntityType.TICKET]: this.prisma.ticket,
      // Add other allowed entity types here as needed
    };

    const model = modelMap[entityType];
    if (!model) {
      throw new Error(`Unsupported entity type: ${entityType}`);
    }
    return model;
  }

  /**
   * Execute a generic query
   */
  async execute(query: GenericQuery): Promise<QueryResult> {
    const startTime = Date.now();

    try {
      if (query.aggregations && query.aggregations.length > 0) {
        return this.executeAggregation(query);
      }

      return this.executeFindMany(query);
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return {
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          details: { executionTimeMs: executionTime },
        },
      };
    }
  }

  /**
   * Execute a findMany query
   */
  private async executeFindMany(query: GenericQuery): Promise<QueryResult> {
    const startTime = Date.now();

    const hasCustomFieldFilters = this.hasCustomFieldFilters(query.filters);

    let entityIds: string[] = [];
    if (hasCustomFieldFilters) {
      entityIds = await this.getEntityIdsByCustomFields(query);
      if (entityIds.length === 0) {
        return {
          success: true,
          data: [],
          metadata: {
            count: 0,
            executionTimeMs: Date.now() - startTime,
          },
        };
      }
    }

    const where = await this.buildWhere(query, entityIds);

    const select = this.buildSelect(query);

    const orderBy = this.buildOrderBy(query);

    const safeLimit = Math.min(query.limit || 100, MAX_QUERY_LIMIT);

    const model = this.getModel(query.entityType);

    const results = await withTimeout(
      model.findMany({
        where,
        select,
        orderBy,
        take: safeLimit,
        skip: query.offset,
      })
    ) as unknown[];

    const flattened = await this.attachCustomFields(results, query);

    const executionTime = Date.now() - startTime;

    return {
      success: true,
      data: flattened,
      metadata: {
        count: flattened.length,
        executionTimeMs: executionTime,
      },
    };
  }

  /**
   * Check if the filters include custom field conditions
   */
  private hasCustomFieldFilters(filters?: LogicalFilter): boolean {
    if (!filters) return false;
    return this.hasCustomFieldFiltersRecursive(filters);
  }

  /**
   * Recursively check if LogicalFilter contains custom field conditions
   */
  private hasCustomFieldFiltersRecursive(filter: LogicalFilter): boolean {
    return filter.conditions.some(condition => {
      if (isLogicalFilter(condition)) {
        return this.hasCustomFieldFiltersRecursive(condition);
      }
      return condition.field.startsWith('custom.');
    });
  }

  /**
   * Get entity IDs that match custom field filters
   */
  private async getEntityIdsByCustomFields(query: GenericQuery): Promise<string[]> {
    const { filters, entityType } = query;
    if (!filters) return [];

    const customFieldFilters = this.extractCustomFieldFilters(filters);

    if (!customFieldFilters) {
      return [];
    }

    // Collect unique field IDs from filters
    const fieldIds = new Set<string>();
    const collectFieldIds = (filter: LogicalFilter) => {
      for (const c of filter.conditions) {
        if (isLogicalFilter(c)) {
          collectFieldIds(c);
        } else if (c.field.startsWith('custom.')) {
          fieldIds.add(c.field.replace('custom.', ''));
        }
      }
    };
    collectFieldIds(customFieldFilters);

    // Fetch field types for proper JSON casting
    const formFields = await withTimeout(
      this.prisma.formFields.findMany({
        where: { id: { in: Array.from(fieldIds) } },
        select: { id: true, fieldType: true },
      })
    );

    const fieldTypeMap = new Map(formFields.map(f => [f.id, f.fieldType]));

    const formEntityWhere = this.buildFormEntityValuesWhere(customFieldFilters, entityType, fieldTypeMap);

    const matchingValues = await withTimeout(
      this.prisma.formEntityValues.findMany({
        where: formEntityWhere,
        select: { entityId: true },
        distinct: ['entityId'],
      })
    );

    return matchingValues.map(v => v.entityId);
  }

  /**
   * Extract only custom field filters from a LogicalFilter
   */
  private extractCustomFieldFilters(filter: LogicalFilter): LogicalFilter | null {
    const filteredConditions = filter.conditions
      .map(c => {
        if (isLogicalFilter(c)) {
          return this.extractCustomFieldFilters(c);
        }
        if (c.field.startsWith('custom.')) {
          return c;
        }
        return null;
      })
      .filter((c): c is FieldCondition | LogicalFilter => c !== null);

    if (filteredConditions.length === 0) {
      return null;
    }

    return {
      operator: filter.operator,
      conditions: filteredConditions,
    };
  }

  /**
   * Build where clause for FormEntityValues query
   */
  private buildFormEntityValuesWhere(
    filters: LogicalFilter,
    entityType: FormEntityType,
    fieldTypeMap: Map<string, string>
  ): Record<string, unknown> {
    const baseWhere: Record<string, unknown> = {
      entityType,
    };

    const logicalWhere = this.buildLogicalFormEntityValuesWhere(filters, fieldTypeMap);

    if (logicalWhere.AND) {
      return {
        AND: [baseWhere, ...(logicalWhere.AND as Record<string, unknown>[])],
      };
    }
    if (logicalWhere.OR) {
      return {
        AND: [baseWhere, logicalWhere],
      };
    }
    return { ...baseWhere, ...logicalWhere };
  }

  /**
   * Build logical where clause for FormEntityValues
   */
  private buildLogicalFormEntityValuesWhere(
    filter: LogicalFilter,
    fieldTypeMap: Map<string, string>
  ): Record<string, unknown> {
    const conditions: Record<string, unknown>[] = [];

    for (const condition of filter.conditions) {
      if (isLogicalFilter(condition)) {
        conditions.push(this.buildLogicalFormEntityValuesWhere(condition, fieldTypeMap));
      } else {
        const fieldId = condition.field.replace('custom.', '');
        const result = this.buildFormEntityValueCondition(fieldId, condition.value, fieldTypeMap.get(fieldId));
        // Handle array return (from 'in' operator) - wrap in OR
        if (Array.isArray(result)) {
          conditions.push({ OR: result });
        } else {
          conditions.push(result);
        }
      }
    }

    const prismaOperator = filter.operator.toUpperCase() as 'AND' | 'OR';

    if (conditions.length === 1) {
      return conditions[0];
    }

    return { [prismaOperator]: conditions };
  }

  /**
   * Build a single FormEntityValue condition
   * Returns array for 'in'/'notIn' operators since Prisma Json doesn't support them
   */
  private buildFormEntityValueCondition(
    fieldId: string,
    value: any,
    fieldType?: string
  ): Record<string, unknown> | Record<string, unknown>[] {
    const condition: Record<string, unknown> = { fieldId };

    // If value is a primitive, treat as equals
    if (typeof value !== 'object' || value === null) {
      condition.actualFieldValue = { equals: value };
      return condition;
    }

    if (Array.isArray(value)) {
      // Prisma's Json type doesn't support 'in' operator
      // Return array of conditions to be OR'd together
      const storedAsString = fieldType === 'STRING';
      return value.map(v => ({
        fieldId,
        actualFieldValue: { equals: storedAsString ? String(v) : v },
      }));
    }

    // Object with operators
    const filterObj = value as Record<string, unknown>;

    if ('equals' in filterObj && filterObj.equals !== undefined) {
      condition.actualFieldValue = { equals: filterObj.equals };
    }
    if ('notEquals' in filterObj && filterObj.notEquals !== undefined) {
      condition.actualFieldValue = { not: filterObj.notEquals };
    }
    if ('in' in filterObj && Array.isArray(filterObj.in)) {
      // Prisma's Json type doesn't support 'in' operator - return array for OR
      const storedAsString = fieldType === 'STRING';
      return (filterObj.in as unknown[]).map(v => ({
        fieldId,
        actualFieldValue: { equals: storedAsString ? String(v) : v },
      }));
    }
    if ('notIn' in filterObj && Array.isArray(filterObj.notIn)) {
      // For notIn, use OR with NOT equals for each value
      const storedAsString = fieldType === 'STRING';
      return (filterObj.notIn as unknown[]).map(v => ({
        fieldId,
        actualFieldValue: { not: { equals: storedAsString ? String(v) : v } },
      }));
    }
    if ('contains' in filterObj && filterObj.contains !== undefined) {
      condition.actualFieldValue = { contains: filterObj.contains };
    }
    if ('startsWith' in filterObj && filterObj.startsWith !== undefined) {
      condition.actualFieldValue = { startsWith: filterObj.startsWith };
    }
    if ('endsWith' in filterObj && filterObj.endsWith !== undefined) {
      condition.actualFieldValue = { endsWith: filterObj.endsWith };
    }
    if ('gt' in filterObj && filterObj.gt !== undefined) {
      condition.actualFieldValue = { gt: filterObj.gt };
    }
    if ('gte' in filterObj && filterObj.gte !== undefined) {
      condition.actualFieldValue = { gte: filterObj.gte };
    }
    if ('lt' in filterObj && filterObj.lt !== undefined) {
      condition.actualFieldValue = { lt: filterObj.lt };
    }
    if ('lte' in filterObj && filterObj.lte !== undefined) {
      condition.actualFieldValue = { lte: filterObj.lte };
    }
    if ('between' in filterObj && filterObj.between !== undefined) {
      const betweenValue = filterObj.between;
      if (Array.isArray(betweenValue) && betweenValue.length === 2) {
        condition.actualFieldValue = { gte: betweenValue[0], lte: betweenValue[1] };
      }
    }
    if ('isEmpty' in filterObj && filterObj.isEmpty) {
      condition.actualFieldValue = { equals: null };
    }
    if ('isNotEmpty' in filterObj && filterObj.isNotEmpty) {
      condition.actualFieldValue = { not: { equals: null } };
    }

    return condition;
  }

  /**
   * Execute an aggregation query
   */
  private async executeAggregation(query: GenericQuery): Promise<QueryResult> {
    const startTime = Date.now();

    // Check if we have custom field filters
    const hasCustomFieldFilters = this.hasCustomFieldFilters(query.filters);

    // If we have custom field filters, we need to get matching entity IDs first
    let entityIds: string[] = [];
    if (hasCustomFieldFilters) {
      entityIds = await withTimeout(this.getEntityIdsByCustomFields(query));
      if (entityIds.length === 0) {
        // No entities match the custom field criteria
        return {
          success: true,
          data: [],
          metadata: {
            count: 0,
            executionTimeMs: Date.now() - startTime,
          },
        };
      }
    }

    // Build where clause
    const where = await this.buildWhere(query, entityIds);

    const model = this.getModel(query.entityType);

    // Check if we have groupBy
    if (query.groupBy && query.groupBy.length > 0) {
      // Group by query
      const groupByResult = await model.groupBy({
        by: query.groupBy,
        where,
        ...this.buildAggregateOperations(query.aggregations || []),
      });

      // Format results with aliases
      const formatted = groupByResult.map((row: any) => {
        const formattedRow: Record<string, unknown> = {};
        // Add group by fields
        query.groupBy!.forEach(field => {
          formattedRow[field] = row[field];
        });
        // Add aggregations with aliases
        query.aggregations!.forEach(agg => {
          const alias = agg.alias || `${agg.function.toLowerCase()}_${agg.field}`;
          const aggKey = `_${agg.function.toLowerCase()}`;
          formattedRow[alias] = row[aggKey]?.[agg.field] || 0;
        });
        return formattedRow;
      });

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        data: formatted,
        metadata: {
          count: formatted.length,
          executionTimeMs: executionTime,
        },
      };
    }

    // Simple aggregation without groupBy
    const aggregateResult = await model.aggregate({
      where,
      ...this.buildAggregateOperations(query.aggregations || []),
    });

    // Format result with aliases
    const formattedResult: Record<string, unknown> = {};
    query.aggregations?.forEach(agg => {
      const alias = agg.alias || `${agg.function.toLowerCase()}_${agg.field}`;
      formattedResult[alias] = aggregateResult[`_${agg.function.toLowerCase()}`]?.[agg.field] || 0;
    });

    const executionTime = Date.now() - startTime;

    return {
      success: true,
      data: [formattedResult],
      metadata: {
        count: 1,
        executionTimeMs: executionTime,
      },
    };
  }

  /**
   * Build Prisma where clause from filters
   */
  private async buildWhere(
    query: GenericQuery,
    entityIds: string[] = []
  ): Promise<Record<string, unknown>> {
    const where: Record<string, unknown> = {};

    // Add project filter if provided
    if (query.projectId) {
      where.projectId = query.projectId;
    }

    if (!query.filters) {
      // No filters, just add entity ID filter if present
      if (entityIds.length > 0) {
        where.id = { in: entityIds };
      }
      return where;
    }

    const logicalWhere = await this.buildLogicalWhere(query.filters, query.entityType);

    // If we have entity IDs from custom field filters, we need to AND them with the logicalWhere
    if (entityIds.length > 0) {
      const conditions: Record<string, unknown>[] = [];

      conditions.push({ id: { in: entityIds } });

      if (query.projectId) {
        conditions.push({ projectId: query.projectId });
      }

      if (logicalWhere.and) {
        conditions.push(...(logicalWhere.and as Record<string, unknown>[]));
      } else if (logicalWhere.or) {
        return {
          AND: [
            { id: { in: entityIds } },
            ...(query.projectId ? [{ projectId: query.projectId }] : []),
            logicalWhere,
          ],
        };
      } else if (Object.keys(logicalWhere).length > 0) {
        // Single condition
        conditions.push(logicalWhere);
      }

      return { AND: conditions };
    }

    if (query.projectId) {
      if (logicalWhere.and) {
        return {
          AND: [
            { projectId: query.projectId },
            ...(logicalWhere.and as Record<string, unknown>[]),
          ],
        };
      }
      if (logicalWhere.or) {
        return {
          AND: [{ projectId: query.projectId }, logicalWhere],
        };
      }
      return { projectId: query.projectId, ...logicalWhere };
    }

    return logicalWhere;
  }

  /**
   * Build where clause from LogicalFilter with AND/OR support
   */
  private async buildLogicalWhere(
    filter: LogicalFilter,
    entityType: FormEntityType
  ): Promise<Record<string, unknown>> {
    const conditions = await Promise.all(
      filter.conditions.map(async (condition) => {
        if (isLogicalFilter(condition)) {
          return this.buildLogicalWhere(condition, entityType);
        }
        return this.buildFieldConditionPrisma(condition, entityType);
      })
    );

    const validConditions = conditions.filter(
      c => c !== null && c !== undefined && Object.keys(c).length > 0
    ) as Record<string, unknown>[];

    if (validConditions.length === 0) {
      return {};
    }
    const prismaOperator = filter.operator.toUpperCase() as 'AND' | 'OR';

    if (validConditions.length === 1) {
      return validConditions[0];
    }

    return { [prismaOperator]: validConditions };
  }

  /**
   * Build Prisma where clause from a single FieldCondition
   */
  private async buildFieldConditionPrisma(
    condition: FieldCondition,
    entityType: FormEntityType
  ): Promise<Record<string, unknown>> {
    const { field, operator } = condition;

    // Skip custom fields - they are handled via entityIds in executeFindMany
    if (field.startsWith('custom.')) {
      return {};
    }

    const modelName = getPrismaModelName(entityType);
    if (!hasField(modelName, field)) {
      return {};
    }

    const fieldMetadata = getFieldMetadata(modelName, field);
    if (!fieldMetadata) {
      return {};
    }

    // Handle isEmpty/isNotEmpty specially based on field type
    if (operator === 'isEmpty') {
      if (fieldMetadata.type === 'DateTime') {
        if (fieldMetadata.isRequired) {
          return {}; 
        }
        return { [field]: null };
      }
      if (fieldMetadata.enumValues) {
        if (fieldMetadata.isRequired) {
          return {};
        }
        return { [field]: null };
      }
      return { OR: [{ [field]: null }, { [field]: '' }] };
    }

    if (operator === 'isNotEmpty') {
      if (fieldMetadata.type === 'DateTime') {
        return { [field]: { not: null } };
      }
      if (fieldMetadata.enumValues) {

        if (fieldMetadata.isRequired) {
          return {};
        }
        return { [field]: { not: null } };
      }
      return {
        AND: [
          { [field]: { not: null } },
          { NOT: { [field]: '' } }
        ]
      };
    }

    // Normalize value before processing
    const normalizedValue = normalizeValueForOperator(operator, condition.value);

    if (operator === 'notEquals' && fieldMetadata.type === 'DateTime') {
      const date = this.convertValueForPrismaType(normalizedValue, fieldMetadata.type);
      if (date instanceof Date) {
        return {
          OR: [
            { [field]: { lt: this.getStartOfDay(date) } },
            { [field]: { gt: this.getEndOfDay(date) } }
          ]
        };
      }
      return { [field]: { not: date } };
    }

    const operatorCondition = this.buildOperatorCondition(operator, normalizedValue, fieldMetadata);
    return { [field]: operatorCondition };
  }

  private getStartOfDay(date: Date): Date {
    const normalized = new Date(Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    ));
    normalized.setUTCHours(0, 0, 0, 0);
    return normalized;
  }

  private getEndOfDay(date: Date): Date {
    const normalized = new Date(Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    ));
    normalized.setUTCHours(23, 59, 59, 999);
    return normalized;
  }

  private getStartOfNextDay(date: Date): Date {
    const nextDay = new Date(Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + 1
    ));
    nextDay.setUTCHours(0, 0, 0, 0);
    return nextDay;
  }

  /**
   * Convert a value to the appropriate type based on Prisma field type
   */
  private convertValueForPrismaType(value: any, fieldType: PrismaFieldType): any {
    if (value && typeof value === 'object' && 'id' in value) {
      return value.id;
    }
    if (fieldType === 'DateTime') {
      if (typeof value === 'number') {
        return new Date(value);
      }
      return value;
    }
    if (fieldType === 'Int' || fieldType === 'Float' || fieldType === 'BigInt') {
      if (typeof value === 'string') {
        const num = Number(value);
        return isNaN(num) ? value : num;
      }
      return value;
    }
    if (fieldType === 'Boolean') {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    }
    return value;
  }

  /**
   * Build Prisma condition from operator and value using Prisma types
   */
  private buildOperatorCondition(
    operator: string,
    value: any,
    fieldMetadata: { type: PrismaFieldType }
  ): Record<string, unknown> | any {
    const { type: fieldType } = fieldMetadata;

    switch (operator) {
      case 'equals':
        if (fieldType === 'DateTime') {
          const date = this.convertValueForPrismaType(value, fieldType);
          if (date instanceof Date) {
            // Match the full day
            return { gte: this.getStartOfDay(date), lte: this.getEndOfDay(date) };
          }
          return date;
        }
        return this.convertValueForPrismaType(value, fieldType);
      case 'notEquals':
        if (fieldType === 'DateTime') {
          const date = this.convertValueForPrismaType(value, fieldType);
          return { not: date };
        }
        return { not: this.convertValueForPrismaType(value, fieldType) };
      case 'in': {
        const convertedValue = Array.isArray(value)
          ? value.map(v => this.convertValueForPrismaType(v, fieldType))
          : [this.convertValueForPrismaType(value, fieldType)];
        return { in: convertedValue };
      }
      case 'notIn': {
        const convertedValue = Array.isArray(value)
          ? value.map(v => this.convertValueForPrismaType(v, fieldType))
          : [this.convertValueForPrismaType(value, fieldType)];
        return { notIn: convertedValue };
      }
      case 'contains':
        return { contains: Array.isArray(value) ? value[0] : value };
      case 'startsWith':
        return { startsWith: Array.isArray(value) ? value[0] : value };
      case 'endsWith':
        return { endsWith: Array.isArray(value) ? value[0] : value };
      case 'gt':
        if (fieldType === 'DateTime') {
          const date = this.convertValueForPrismaType(value, fieldType);
          if (date instanceof Date) {
            // Exclude the provided date entirely - use start of next day
            return { gt: this.getStartOfNextDay(date) };
          }
          return { gt: date };
        }
        return { gt: this.convertValueForPrismaType(value, fieldType) };
      case 'gte':
        if (fieldType === 'DateTime') {
          const date = this.convertValueForPrismaType(value, fieldType);
          if (date instanceof Date) {
            return { gte: this.getStartOfDay(date) };
          }
          return { gte: date };
        }
        return { gte: this.convertValueForPrismaType(value, fieldType) };
      case 'lt':
        if (fieldType === 'DateTime') {
          const date = this.convertValueForPrismaType(value, fieldType);
          if (date instanceof Date) {
            return { lt: this.getStartOfDay(date) };
          }
          return { lt: date };
        }
        return { lt: this.convertValueForPrismaType(value, fieldType) };
      case 'lte':
        if (fieldType === 'DateTime') {
          const date = this.convertValueForPrismaType(value, fieldType);
          if (date instanceof Date) {
            return { lte: this.getEndOfDay(date) };
          }
          return { lte: date };
        }
        return { lte: this.convertValueForPrismaType(value, fieldType) };
      case 'between':
        if (Array.isArray(value) && value.length === 2) {
          const startDate = this.convertValueForPrismaType(value[0], fieldType);
          const endDate = this.convertValueForPrismaType(value[1], fieldType);

          if (fieldType === 'DateTime' && startDate instanceof Date && endDate instanceof Date) {
            return { gte: this.getStartOfDay(startDate), lte: this.getEndOfDay(endDate) };
          }

          return {
            gte: startDate,
            lte: endDate,
          };
        }
        return value;
      default:
        return value;
    }
  }

  /**
   * Attach custom fields to results from FormEntityValues
   */
  private async attachCustomFields(
    results: unknown[],
    query: GenericQuery
  ): Promise<Record<string, unknown>[]> {
    // If no results, return early
    if (results.length === 0) {
      return results as Record<string, unknown>[];
    }

    // Determine if we need to fetch custom fields
    const needsCustomFields =
      !query.select || query.select.some(field => field.startsWith('custom.'));

    if (!needsCustomFields) {
      return results as Record<string, unknown>[];
    }

    const entityIds = results
      .map((r: any) => r.id)
      .filter((id: unknown) => id !== undefined && id !== null);

    if (entityIds.length === 0) {
      return results as Record<string, unknown>[];
    }

    // Fetch custom fields for these entities with timeout
    const customFieldValues = await withTimeout(
      this.prisma.formEntityValues.findMany({
        where: {
          entityId: { in: entityIds as string[] },
          entityType: {
            equals: query.entityType,
            mode: 'insensitive',
          },
        },
        select: {
          entityId: true,
          fieldId: true,
          fieldValue: true,
          actualFieldValue: true,
          entityType: true,
        },
      })
    );

    // Get all unique field IDs
    const uniqueFieldIds = [...new Set(customFieldValues.map(cfv => cfv.fieldId))];

    // Fetch FormFields for all unique field IDs with timeout
    const formFields = await withTimeout(
      this.prisma.formFields.findMany({
        where: {
          id: { in: uniqueFieldIds },
        },
        select: {
          id: true,
          formId: true,
          fieldName: true,
          fieldType: true,
        },
      })
    );

    const fieldIdToInfo = new Map(
      formFields.map(ff => [
        ff.id,
        { formId: ff.formId, fieldName: ff.fieldName, fieldType: ff.fieldType },
      ]),
    );

    const selectedCustomFieldIds = new Set(
      (query.select || [])
        .filter(field => field.startsWith('custom.'))
        .map(field => field.replace('custom.', ''))
    );

    const shouldIncludeAllCustomFields = !query.select || query.select.length === 0;

    const customFieldsByEntity = new Map<string, Record<string, unknown>>();
    for (const cfv of customFieldValues) {

      if (!shouldIncludeAllCustomFields && !selectedCustomFieldIds.has(cfv.fieldId)) {
        continue;
      }
      if (!customFieldsByEntity.has(cfv.entityId)) {
        customFieldsByEntity.set(cfv.entityId, {});
      }
      const fieldValue = cfv.actualFieldValue !== null ? cfv.actualFieldValue : cfv.fieldValue;
      const fieldInfo = fieldIdToInfo.get(cfv.fieldId);
      const displayName = fieldInfo?.fieldName || cfv.fieldId;
      customFieldsByEntity.get(cfv.entityId)![`custom.${cfv.fieldId}`] = {
        value: fieldValue,
        displayName,
      };
    }

    const allCustomFieldDisplayNames = new Set<string>();
    customFieldsByEntity.forEach((fields) => {
      Object.values(fields).forEach((data) => {
        if (typeof data === 'object' && data !== null && 'displayName' in data) {
          allCustomFieldDisplayNames.add((data as { displayName: string }).displayName);
        }
      });
    });

    return results.map((row: any) => {
      const result: Record<string, unknown> = { ...row };
      const entityCustomFields = customFieldsByEntity.get(row.id);


      allCustomFieldDisplayNames.forEach((displayName) => {
        if (!(displayName in result)) {
          result[displayName] = null;
        }
      });

      if (entityCustomFields) {
        Object.entries(entityCustomFields).forEach(([key, data]) => {
          if (typeof data !== 'object' || data === null) {
            result[key] = data;
            return;
          }
          const fieldDisplayName = (data as { displayName?: string }).displayName ?? key.replace('custom.', '');
          const value = (data as { value?: unknown }).value ?? data;
          result[fieldDisplayName] = value;
        });
      }
      return result;
    });
  }

  /**
   * Build Prisma select clause
   */
  private buildSelect(query: GenericQuery): Record<string, boolean> | undefined {
    if (!query.select || query.select.length === 0) {
      return undefined;
    }

    const select: Record<string, boolean> = {};
    select.id = true;
    for (const field of query.select) {
      if (!field.startsWith('custom.') && field !== 'id') {
        select[field] = true;
      }
    }

    return select;
  }

  /**
   * Build Prisma orderBy clause
   */
  private buildOrderBy(query: GenericQuery): Record<string, 'asc' | 'desc'>[] | undefined {
    if (!query.orderBy || query.orderBy.length === 0) {
      return undefined;
    }

    return query.orderBy.map(order => ({
      [order.field]: order.direction.toLowerCase() as 'asc' | 'desc',
    }));
  }

  /**
   * Build aggregate operations for Prisma
   */
  private buildAggregateOperations(aggregations: Aggregation[]): Record<string, Record<string, boolean>> {
    const operations: Record<string, Record<string, boolean>> = {};

    for (const agg of aggregations) {
      const key = `_${agg.function.toLowerCase()}`;
      if (!operations[key]) {
        operations[key] = {};
      }
      operations[key][agg.field] = true;
    }

    return operations;
  }
}