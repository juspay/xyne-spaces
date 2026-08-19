import { config as appConfig } from '@/config/env';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { logger } from '@/utils/logger';
import { ConnectorBase } from '../ConnectorBase';
import { tableKey } from '../../../tableKeys';
import { buildChAggregateScanSql, mapChAggregateScanRow } from './profileSql';
import {
  buildProbeProfile,
  collectDistinctSampleValues,
  buildColumnSpecs,
  groupByTable,
} from '../scanShared';
import type {
  ColumnProfileResult,
  ScanProfileRequest,
  ScanProfileResult,
  TableProfileOptions,
  DiscoveredColumn,
  DiscoveredRelationship,
  DiscoveredTable,
  RunQueryResult,
  TestConnectionResult,
} from '../types';
import { chNativeToCanonical } from './typeMapping';

const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?$/;

function isoToClickHouseDateTime(s: string): string {
  return s.replace('T', ' ').replace(/(?:Z|[+-]\d{2}:?\d{2})$/, '');
}

function translateParams(
  sql: string,
  params: ReadonlyArray<unknown>
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
        typeof sample === 'number' ? (Number.isInteger(sample) ? 'Int64' : 'Float64') : 'String';
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
        `Invalid ClickHouse host: contains URL-reserved characters (got "${this.config.host}")`
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
      ...(this.config.ssl && this.config.ca
        ? { tls: { ca_cert: Buffer.from(this.config.ca) } }
        : {}),
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

  async listRelationships(): Promise<DiscoveredRelationship[]> {
    return [];
  }

  async runQuery(sql: string, params: ReadonlyArray<unknown>): Promise<RunQueryResult> {
    const client = this.requireClient<ClickHouseClient>();
    const { query, query_params } = translateParams(sql, params);
    const rs = await client.query({ query, query_params, format: 'JSONEachRow' });
    const rows = await rs.json<Record<string, unknown>>();
    return { rows, rowCount: rows.length };
  }

  async listAllColumns(): Promise<Map<string, DiscoveredColumn[]>> {
    const client = this.requireClient<ClickHouseClient>();
    const rs = await client.query({
      query: `
        SELECT database, table, name, position, type, is_in_primary_key
        FROM system.columns
        WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
        ORDER BY database, table, position
      `,
      format: 'JSONEachRow',
    });
    const rows = await rs.json<{
      database: string;
      table: string;
      name: string;
      position: number;
      type: string;
      is_in_primary_key: number;
    }>();
    return groupByTable(
      rows,
      (r) => tableKey(r.database, r.table),
      (r, count) => ({
        columnName: r.name,
        ordinalPosition: r.position ?? count + 1,
        dataTypeNative: r.type,
        dataTypeCanonical: chNativeToCanonical(r.type),
        isNullable: r.type.startsWith('Nullable('),
        isPrimaryKey: r.is_in_primary_key === 1,
        pkPosition: r.is_in_primary_key === 1 ? 1 : null,
      })
    );
  }

  async profileTableByScan(
    schemaName: string,
    tableName: string,
    request: ScanProfileRequest,
    _rowCountEstimate: bigint | null,
    options: TableProfileOptions
  ): Promise<ScanProfileResult> {
    const client = this.requireClient<ClickHouseClient>();
    const table = this.qualifiedName(schemaName, tableName);
    const columns = new Map<string, ColumnProfileResult>();
    const sampleValues = new Map<string, string[]>();
    let queryCount = 0;

    // Aggregate stats for every column (uniq() gives an approximate distinct count for
    // text/numeric); then probe the categorical candidates (text/boolean), same as Postgres.
    for (let i = 0; i < request.columns.length; i += options.columnChunkSize) {
      const chunk = request.columns.slice(i, i + options.columnChunkSize);
      const specs = buildColumnSpecs(chunk, (s) => this.quoteIdent(s));
      const rs = await client.query({
        query: buildChAggregateScanSql(table, specs),
        format: 'JSONEachRow',
      });
      queryCount++;
      const rows = await rs.json<Record<string, unknown>>();
      if (!rows[0]) continue;
      const { perColumn } = mapChAggregateScanRow(rows[0], specs);
      for (const [name, summary] of perColumn) {
        columns.set(name, { summary, cardinality: null });
      }
    }

    const probeColumns = request.columns.filter(
      (c) => c.dataTypeCanonical === 'text' || c.dataTypeCanonical === 'boolean'
    );
    for (const col of probeColumns) {
      const ident = this.quoteIdent(col.columnName);
      const rs = await client.query({
        query: `
          SELECT toString(${ident}) AS value, toString(count()) AS frequency
          FROM ${table}
          WHERE ${ident} IS NOT NULL
          GROUP BY ${ident}
          ORDER BY count() DESC, ${ident} ASC
          LIMIT {limit:UInt64}
        `,
        query_params: { limit: options.distinctThreshold + 1 },
        format: 'JSONEachRow',
      });
      queryCount++;
      const rows = await rs.json<{ value: string; frequency: string }>();
      const values = rows.map((r) => ({
        value: this.truncateTopValue(r.value),
        frequency: Number(r.frequency),
      }));
      columns.set(
        col.columnName,
        buildProbeProfile(columns.get(col.columnName)?.summary, values, rows.length, options)
      );
    }

    if (options.sampleValuesPerColumn > 0) {
      try {
        const rs = await client.query({
          query: `SELECT * FROM ${table} LIMIT 100`,
          format: 'JSONEachRow',
        });
        queryCount++;
        const rows = await rs.json<Record<string, unknown>>();
        collectDistinctSampleValues(rows, options.sampleValuesPerColumn, sampleValues);
      } catch (err) {
        logger.warn(
          `[ClickHouseConnector] sample rows failed for ${schemaName}.${tableName}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return { columns, sampleValues, queryCount };
  }
}
