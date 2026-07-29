import type { QueryPlan } from '@xyne/shared';
import {
  getDataSchemaForComponent,
  QueryPlanSchema,
  QueryVisualizationType,
  SCALAR_OUTPUT_COMPONENT_TYPES,
} from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { createConnector } from '../dataSource/connectors/ConnectorFactory';
import type { ConnectionConfig } from '../dataSource/connectors/types';
import { decrypt } from '@/services/encryptionService';
import { queryCache } from '@/services/queryCache';
import { JoinResolutionError, resolveJoinedTablesMetadata } from './joinResolver';
import { compileQueryPlan as compilePg } from './compilers/postgres';
import { compileQueryPlan as compileCh } from './compilers/clickhouse';
import { QueryCompileError, type TableMetadata } from './compilers/types';

export class QueryExecError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'not_found'
      | 'unauthorized'
      | 'invalid_plan'
      | 'execution_failed'
      | 'shape_mismatch',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'QueryExecError';
  }
}

export interface ExecuteQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  data: unknown | null;
  debug: { sql: string; params: ReadonlyArray<unknown> };
}

export interface ExecuteOptions {
  workspaceId: string;
  componentType?: QueryVisualizationType;
  bypassCache?: boolean;
}

function getCompiler(sourceType: string) {
  return sourceType === 'clickhouse' ? compileCh : compilePg;
}

function classifyDriverError(
  errorCode: string | undefined,
  errMsg: string,
): string | undefined {
  const msg = errMsg.toLowerCase();
  if (
    errorCode === 'ECONNREFUSED' ||
    errorCode === 'ENOTFOUND' ||
    errorCode === 'EHOSTUNREACH' ||
    errorCode === 'ETIMEDOUT'
  ) {
    return 'Cannot reach the data source. Check that the database is running and the host/port are correct.';
  }
  if (
    errorCode === '28P01' ||
    errorCode === '28000' ||
    /authentication failed|password/.test(msg)
  ) {
    return 'Authentication failed against the data source. Check the stored credentials.';
  }
  if (errorCode === '42501' || /permission denied/.test(msg)) {
    return 'The data source user lacks permission to read this table or column.';
  }
  if (errorCode === '57014' || /statement timeout|query.* cancel/.test(msg)) {
    return 'Query timed out. Add filters, a take limit, or pre-aggregate the data.';
  }
  if (
    errorCode === '42883' ||
    /function .* does not exist|invalid input syntax|operator does not exist/.test(msg)
  ) {
    return 'The chosen aggregation is not compatible with this column type — pick a numeric column.';
  }
  if (
    errorCode === '42703' ||
    errorCode === '42P01' ||
    /column .* does not exist|relation .* does not exist/.test(msg)
  ) {
    return 'A referenced column or table no longer exists on the data source. Re-introspect the schema.';
  }
  if (
    errorCode === '42803' ||
    /must appear in the group by clause|grouping_error/.test(msg)
  ) {
    return 'The chosen order-by column must be in the group-by or wrapped in an aggregate. Pick one of the measure/group-by aliases instead.';
  }
  return undefined;
}

function normalizeDatesForValidation<T>(value: T): T {
  if (value instanceof Date) {
    return value.toISOString() as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => normalizeDatesForValidation(v)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeDatesForValidation(v);
    }
    return out as T;
  }
  return value;
}

export class QueryExecutor {
  async execute(
    rawPlan: unknown,
    ctx: ExecuteOptions,
  ): Promise<ExecuteQueryResult> {
    const parsed = QueryPlanSchema.safeParse(rawPlan);
    if (!parsed.success) {
      throw new QueryExecError(
        `Invalid query plan: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        'invalid_plan',
      );
    }
    const plan: QueryPlan = parsed.data;

    const dataSource = await repositories.dataSources.findById(plan.dataSourceId);
    if (!dataSource) {
      throw new QueryExecError(`Data source ${plan.dataSourceId} not found`, 'not_found');
    }
    if (dataSource.workspaceId !== ctx.workspaceId) {
      throw new QueryExecError(`Data source ${plan.dataSourceId} not found`, 'not_found');
    }

    const tables = await repositories.dataSourceTables.findByDataSource(dataSource.id);
    const targetTable = tables.find((t) => {
      if (t.tableName !== plan.model) return false;
      if (plan.schema && t.schemaName !== plan.schema) return false;
      return true;
    });
    if (!targetTable) {
      throw new QueryExecError(
        `Table "${plan.schema ? `${plan.schema}.` : ''}${plan.model}" not introspected on data source ${dataSource.id}. Run EDA first.`,
        'not_found',
      );
    }

    const columns = await repositories.dataSourceColumns.findByTable(targetTable.id);
    const tableMeta: TableMetadata = {
      schemaName: targetTable.schemaName,
      tableName: targetTable.tableName,
      columns: columns.map((c) => ({
        columnName: c.columnName,
        dataTypeCanonical: c.dataTypeCanonical,
      })),
    };

    let joinedTablesMeta;
    try {
      joinedTablesMeta = await resolveJoinedTablesMetadata({
        plan,
        targetTable,
        baseColumns: columns,
        tables,
      });
    } catch (e) {
      if (e instanceof JoinResolutionError) {
        throw new QueryExecError(e.message, e.kind);
      }
      throw e;
    }

    const compile = getCompiler(dataSource.sourceType);
    let compiled;
    try {
      compiled = compile(plan, tableMeta, joinedTablesMeta);
    } catch (e) {
      if (e instanceof QueryCompileError) {
        throw new QueryExecError(e.message, 'invalid_plan');
      }
      throw e;
    }

    const credsJson = decrypt(dataSource.credentials);
    const config: ConnectionConfig = JSON.parse(credsJson);

    const cacheInputs = {
      workspaceId: ctx.workspaceId,
      dataSourceId: dataSource.id,
      componentType: ctx.componentType,
      sql: compiled.sql,
      params: compiled.params,
    };
    if (!ctx.bypassCache) {
      const cached = await queryCache.get(cacheInputs);
      if (cached) {
        return {
          rows: cached.rows,
          rowCount: cached.rowCount,
          data: cached.data,
          debug: { sql: compiled.sql, params: compiled.params },
        };
      }
    }

    let connector: Awaited<ReturnType<typeof createConnector>> | null = null;
    try {
      connector = await createConnector(dataSource.sourceType, config);
      await connector.connect();
      const result = await connector.runQuery(compiled.sql, compiled.params);

      let data: unknown | null = null;
      if (ctx.componentType) {
        const schema = getDataSchemaForComponent(ctx.componentType);
        if (schema) {
          const isScalar = SCALAR_OUTPUT_COMPONENT_TYPES.has(ctx.componentType);
          if (isScalar && result.rows.length !== 1) {
            throw new QueryExecError(
              `Scalar component "${ctx.componentType}" requires exactly 1 row; query returned ${result.rows.length}`,
              'shape_mismatch',
              {
                componentType: ctx.componentType,
                rowCount: result.rowCount,
                sample: result.rows.slice(0, 3),
              },
            );
          }
          let candidate: unknown;
          if (isScalar) {
            candidate = result.rows[0] ?? null;
          } else if (ctx.componentType === QueryVisualizationType.DATA_TABLE) {
            const firstRow = result.rows[0] ?? {};
            const tableColumns = Object.keys(firstRow).map((key) => ({ key, label: key }));
            candidate = { columns: tableColumns, rows: result.rows };
          } else {
            candidate = result.rows;
          }
          const normalizedCandidate = normalizeDatesForValidation(candidate);
          const validated = schema.safeParse(normalizedCandidate);
          if (!validated.success) {
            throw new QueryExecError(
              `Query result does not match contract for componentType="${ctx.componentType}"`,
              'shape_mismatch',
              {
                componentType: ctx.componentType,
                issues: validated.error.issues,
                sample: result.rows.slice(0, 3),
              },
            );
          }
          data = validated.data;
        }
      }

      void queryCache.set(cacheInputs, {
        rows: result.rows,
        rowCount: result.rowCount,
        data,
        cachedAt: new Date().toISOString(),
      });

      return {
        rows: result.rows,
        rowCount: result.rowCount,
        data,
        debug: { sql: compiled.sql, params: compiled.params },
      };
    } catch (e) {
      if (e instanceof QueryExecError) {
        throw e;
      }
      const errMsg =
        e instanceof Error
          ? e.message || e.stack || e.name
          : typeof e === 'object' && e !== null
            ? (() => {
                try {
                  return JSON.stringify(e);
                } catch {
                  return String(e);
                }
              })()
            : String(e);
      const errorCode = (e as { code?: string })?.code;
      logger.error('[QueryEngine] execution failed', {
        dataSourceId: dataSource.id,
        model: plan.model,
        error: errMsg,
        errorCode,
      });
      const safeHint = classifyDriverError(errorCode, errMsg);
      throw new QueryExecError(
        safeHint ?? errMsg ?? 'Query execution failed',
        'execution_failed',
        {
          dataSourceId: dataSource.id,
          ...(errorCode ? { errorCode } : {}),
          driverMessage: errMsg,
        },
      );
    } finally {
      if (connector) {
        try {
          await connector.close();
        } catch (closeErr) {
          logger.warn('[QueryEngine] connector close failed', {
            dataSourceId: dataSource.id,
            error: closeErr instanceof Error ? closeErr.message : String(closeErr),
          });
        }
      }
    }
  }
}

export async function executeQueryPlan(
  rawPlan: unknown,
  ctx: ExecuteOptions,
): Promise<ExecuteQueryResult> {
  return new QueryExecutor().execute(rawPlan, ctx);
}
