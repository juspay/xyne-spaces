import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { config as appConfig } from '@/config/env';
import { ConnectorBase } from '../ConnectorBase';
import type {
  DiscoveredTable,
  DiscoveredColumn,
  DiscoveredRelationship,
  TestConnectionResult,
  CategoricalProbeOptions,
  CategoricalProbeResult,
  CountStatsResult,
  NumericStats,
  TemporalStats,
  RunQueryResult,
} from '../types';
import { chNativeToCanonical } from './typeMapping';

const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?$/;

function isoToClickHouseDateTime(s: string): string {
  return s
    .replace('T', ' ')
    .replace(/(?:Z|[+-]\d{2}:?\d{2})$/, '');
}

function translateParams(
  sql: string,
  params: ReadonlyArray<unknown>,
): { query: string; query_params: Record<string, unknown> } {
  const query_params: Record<string, unknown> = {};
  let query = sql;
  for (let i = params.length; i >= 1; i--) {
    const val = params[i - 1];
    const key = `p${i}`;
    let chType: string;
    let chVal: unknown = val;
    if (typeof val === 'number') {
      chType = Number.isInteger(val) ? 'Int64' : 'Float64';
    } else if (typeof val === 'boolean') {
      chType = 'Bool';
    } else if (Array.isArray(val)) {
      const sample = val[0];
      const elemType =
        typeof sample === 'number'
          ? Number.isInteger(sample) ? 'Int64' : 'Float64'
          : 'String';
      chType = `Array(${elemType})`;
    } else if (typeof val === 'string' && ISO_DATETIME_RE.test(val)) {
      chType = "DateTime64(3, 'UTC')";
      chVal = isoToClickHouseDateTime(val);
    } else {
      chType = 'String';
    }
    query_params[key] = chVal;
    query = query.replace(new RegExp(`\\$${i}`, 'g'), `{${key}:${chType}}`);
  }
  return { query, query_params };
}

export class ClickHouseConnector extends ConnectorBase {
  protected quoteIdent(s: string): string {
    return '`' + s.replace(/`/g, '``') + '`';
  }

  private buildClient(): ClickHouseClient {
    const protocol = this.config.ssl ? 'https' : 'http';
    if (/[@/?#[\]\\]/.test(this.config.host)) {
      throw new Error(
        `Invalid ClickHouse host: contains URL-reserved characters (got "${this.config.host}")`,
      );
    }
    const url = new URL(`${protocol}://${this.config.host}:${this.config.port}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Invalid ClickHouse host: URL must contain only host + port');
    }
    return createClient({
      url: url.toString(),
      username: this.config.user,
      password: this.config.password,
      database: this.config.database,
      request_timeout: appConfig.dashboard.chRequestTimeoutMs,
      clickhouse_settings: {
        max_execution_time: Math.floor(appConfig.dashboard.pgStatementTimeoutMs / 1000),
      },
    });
  }

  async connect(): Promise<void> {
    if (this.client) return;
    this.client = this.buildClient();
  }

  async close(): Promise<void> {
    if (!this.client) return;
    await (this.client as ClickHouseClient).close();
    this.client = null;
  }

  async testConnection(): Promise<TestConnectionResult> {
    let temp: ClickHouseClient | null = null;
    try {
      temp = this.buildClient();
      const rs = await temp.query({ query: 'SELECT version() AS version', format: 'JSONEachRow' });
      const rows = await rs.json<{ version: string }>();
      return { ok: true, version: rows[0]?.version };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (temp) await temp.close().catch(() => undefined);
    }
  }

  async listTables(): Promise<DiscoveredTable[]> {
    const client = this.requireClient<ClickHouseClient>();
    const rs = await client.query({
      query: `
        SELECT database AS schema_name, name AS table_name, total_rows
        FROM system.tables
        WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
          AND is_temporary = 0
        ORDER BY database, name
      `,
      format: 'JSONEachRow',
    });
    const rows = await rs.json<{
      schema_name: string;
      table_name: string;
      total_rows: string | null;
    }>();
    return rows.map((r) => ({
      schemaName: r.schema_name,
      tableName: r.table_name,
      rowCountEstimate: r.total_rows != null ? BigInt(r.total_rows) : null,
    }));
  }

  async listColumns(schemaName: string, tableName: string): Promise<DiscoveredColumn[]> {
    const client = this.requireClient<ClickHouseClient>();
    const rs = await client.query({
      query: `
        SELECT name, position, type, is_in_primary_key
        FROM system.columns
        WHERE database = {db:String} AND table = {tbl:String}
        ORDER BY position
      `,
      query_params: { db: schemaName, tbl: tableName },
      format: 'JSONEachRow',
    });
    const rows = await rs.json<{
      name: string;
      position: number;
      type: string;
      is_in_primary_key: number;
    }>();
    return rows.map((r, idx) => ({
      columnName: r.name,
      ordinalPosition: r.position ?? idx + 1,
      dataTypeNative: r.type,
      dataTypeCanonical: chNativeToCanonical(r.type),
      isNullable: r.type.startsWith('Nullable('),
      isPrimaryKey: r.is_in_primary_key === 1,
      pkPosition: r.is_in_primary_key === 1 ? 1 : null,
    }));
  }

  async listRelationships(): Promise<DiscoveredRelationship[]> {
    return [];
  }

  async computeNumericStats(
    schemaName: string,
    tableName: string,
    columnName: string,
  ): Promise<NumericStats | null> {
    const client = this.requireClient<ClickHouseClient>();
    const table = this.qualifiedName(schemaName, tableName);
    const col = this.quoteIdent(columnName);
    const rs = await client.query({
      query: `
        SELECT
          toString(min(${col}))     AS min,
          toString(max(${col}))     AS max,
          toString(avg(${col}))     AS avg,
          toString(stddevSamp(${col})) AS stddev,
          toString(quantile(0.50)(${col})) AS p50,
          toString(quantile(0.95)(${col})) AS p95,
          toString(quantile(0.99)(${col})) AS p99
        FROM ${table}
        WHERE ${col} IS NOT NULL
      `,
      format: 'JSONEachRow',
    });
    const rows = await rs.json<{
      min: string; max: string; avg: string; stddev: string;
      p50: string; p95: string; p99: string;
    }>();
    const r = rows[0];
    if (!r || r.min === '' || r.min === 'nan') return null;
    return {
      min:    Number(r.min),
      max:    Number(r.max),
      avg:    Number(r.avg),
      stddev: Number(r.stddev || '0'),
      p50:    Number(r.p50),
      p95:    Number(r.p95),
      p99:    Number(r.p99),
    };
  }

  async computeTemporalStats(
    schemaName: string,
    tableName: string,
    columnName: string,
  ): Promise<TemporalStats | null> {
    const client = this.requireClient<ClickHouseClient>();
    const table = this.qualifiedName(schemaName, tableName);
    const col = this.quoteIdent(columnName);
    const rs = await client.query({
      query: `
        SELECT
          toString(min(${col})) AS min,
          toString(max(${col})) AS max
        FROM ${table}
        WHERE ${col} IS NOT NULL
      `,
      format: 'JSONEachRow',
    });
    const rows = await rs.json<{ min: string; max: string }>();
    const r = rows[0];
    if (!r || !r.min) return null;
    const minDate = new Date(r.min);
    const maxDate = new Date(r.max);
    if (isNaN(minDate.getTime()) || isNaN(maxDate.getTime())) return null;
    return {
      min: minDate.toISOString(),
      max: maxDate.toISOString(),
    };
  }

  async computeCategoricalProbe(
    schemaName: string,
    tableName: string,
    columnName: string,
    options: CategoricalProbeOptions,
  ): Promise<CategoricalProbeResult> {
    const client = this.requireClient<ClickHouseClient>();
    const table = this.qualifiedName(schemaName, tableName);
    const col = this.quoteIdent(columnName);

    const distinctRs = await client.query({
      query: `SELECT uniqExact(${col}) AS approx FROM ${table} WHERE ${col} IS NOT NULL`,
      format: 'JSONEachRow',
    });
    const distinctRows = await distinctRs.json<{ approx: string }>();
    const distinctCountApprox = Number(distinctRows[0]?.approx ?? 0);
    const valuesAreExhaustive = distinctCountApprox <= options.distinctThreshold;
    const fetchLimit = valuesAreExhaustive
      ? Math.max(options.distinctThreshold, 1)
      : Math.max(options.topK, 1);

    const valueRs = await client.query({
      query: `
        SELECT toString(${col}) AS value, count() AS frequency
        FROM ${table}
        WHERE ${col} IS NOT NULL
        GROUP BY ${col}
        ORDER BY frequency DESC, ${col} ASC
        LIMIT {limit:UInt64}
      `,
      query_params: { limit: fetchLimit },
      format: 'JSONEachRow',
    });
    const valueRows = await valueRs.json<{ value: string; frequency: string }>();

    return {
      distinctCountApprox,
      valuesAreExhaustive,
      topValues: valueRows.map((r) => ({
        value: this.truncateTopValue(r.value),
        frequency: Number(r.frequency),
      })),
    };
  }

  async computeCountStats(
    schemaName: string,
    tableName: string,
    columnName: string,
  ): Promise<CountStatsResult> {
    const client = this.requireClient<ClickHouseClient>();
    const table = this.qualifiedName(schemaName, tableName);
    const col = this.quoteIdent(columnName);
    const rs = await client.query({
      query: `
        SELECT
          countIf(${col} IS NULL)  AS null_count,
          count()                   AS total_count
        FROM ${table}
      `,
      format: 'JSONEachRow',
    });
    const rows = await rs.json<{ null_count: string; total_count: string }>();
    return {
      nullCount:  Number(rows[0]?.null_count ?? 0),
      totalCount: Number(rows[0]?.total_count ?? 0),
    };
  }

  async runQuery(sql: string, params: ReadonlyArray<unknown>): Promise<RunQueryResult> {
    const client = this.requireClient<ClickHouseClient>();
    const { query, query_params } = translateParams(sql, params);
    const rs = await client.query({ query, query_params, format: 'JSONEachRow' });
    const rows = await rs.json<Record<string, unknown>>();
    return { rows, rowCount: rows.length };
  }
}
