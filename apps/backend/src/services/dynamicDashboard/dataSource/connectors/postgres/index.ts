import { Pool, Client, type PoolConfig } from 'pg';
import { checkServerIdentity as tlsCheckServerIdentity, type PeerCertificate } from 'node:tls';
import { isIP } from 'node:net';
import { config as appConfig } from '@/config/env';
import { logger } from '@/utils/logger';
import { ConnectorBase } from '../ConnectorBase';
import { tableKey } from '../../../tableKeys';
import {
  buildProbeProfile,
  collectDistinctSampleValues,
  buildColumnSpecs,
  groupByTable,
} from '../scanShared';
import { buildAggregateScanSql, mapAggregateScanRow, samplePercentFor } from './profileSql';
import type {
  ConnectionConfig,
  DiscoveredTable,
  DiscoveredColumn,
  DiscoveredRelationship,
  TestConnectionResult,
  ColumnProfileResult,
  ScanProfileRequest,
  ScanProfileResult,
  TableProfileOptions,
  RunQueryResult,
} from '../types';
import { pgNativeToCanonical } from './typeMapping';

// Skip the hostname check only where it cannot succeed: an IP host whose cert lists no
// IP SANs, as Cloud SQL never issues them. Certs that do list IPs are still enforced.
function verifyServerIdentity(host: string, cert: PeerCertificate): Error | undefined {
  const err = tlsCheckServerIdentity(host, cert);
  if (!err) return undefined;
  if (isIP(host) !== 0 && !cert.subjectaltname?.includes('IP Address:')) {
    logger.warn('[PostgresConnector] hostname verification skipped: certificate has no IP SANs', {
      host,
      certSubject: cert.subject?.CN ?? null,
      certSans: cert.subjectaltname ?? null,
    });
    return undefined;
  }
  return err;
}

function buildSslConfig(config: ConnectionConfig): PoolConfig['ssl'] {
  if (!config.ssl) return false;

  const verify = appConfig.env === 'production';

  return {
    ...(config.ca ? { ca: config.ca } : {}),
    host: config.host,
    rejectUnauthorized: verify,
    checkServerIdentity: verifyServerIdentity,
  };
}

export class PostgresConnector extends ConnectorBase {
  private readonly poolConfig: PoolConfig;

  constructor(config: ConnectionConfig) {
    super(config);
    this.poolConfig = {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: buildSslConfig(config),
      connectionTimeoutMillis: appConfig.dashboard.pgConnectionTimeoutMs,
      statement_timeout: appConfig.dashboard.pgStatementTimeoutMs,
      max: appConfig.dataSource.edaConcurrency,
      keepAlive: true,
      keepAliveInitialDelayMillis: 30_000,
      maxUses: 7_500,
    };
  }

  protected quoteIdent(s: string): string {
    return '"' + s.replace(/"/g, '""') + '"';
  }

  async connect(): Promise<void> {
    if (this.client) return;
    const pool = new Pool(this.poolConfig);
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      await pool.end().catch(() => undefined);
      throw err;
    }
    this.client = pool;
  }

  async close(): Promise<void> {
    if (!this.client) return;
    await (this.client as Pool).end();
    this.client = null;
  }

  async testConnection(): Promise<TestConnectionResult> {
    let temp: Client | null = null;
    try {
      temp = new Client(this.poolConfig);
      await temp.connect();
      const { rows } = await temp.query<{ version: string }>('SELECT version() AS version');
      return { ok: true, version: rows[0]?.version };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (temp) await temp.end().catch(() => undefined);
    }
  }

  async listTables(): Promise<DiscoveredTable[]> {
    const client = this.requireClient<Pool>();
    const { rows } = await client.query<{
      schema_name: string;
      table_name: string;
      row_count_estimate: string | null;
    }>(`
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        CASE WHEN c.reltuples >= 0 THEN c.reltuples::TEXT ELSE NULL END
          AS row_count_estimate
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND n.nspname NOT LIKE 'pg_temp_%'
        AND n.nspname NOT LIKE 'pg_toast_temp_%'
      ORDER BY n.nspname, c.relname
    `);
    return rows.map((r) => {
      const estimate = r.row_count_estimate !== null ? Number(r.row_count_estimate) : null;
      return {
        schemaName: r.schema_name,
        tableName: r.table_name,
        rowCountEstimate:
          estimate !== null && Number.isFinite(estimate) ? BigInt(Math.floor(estimate)) : null,
      };
    });
  }

  async listRelationships(): Promise<DiscoveredRelationship[]> {
    const client = this.requireClient<Pool>();
    const { rows } = await client.query<{
      from_schema: string;
      from_table: string;
      from_column: string;
      to_schema: string;
      to_table: string;
      to_column: string;
      from_is_unique: boolean;
    }>(`
      WITH fk AS (
        SELECT
          c.oid                                          AS conoid,
          fn.nspname                                     AS from_schema,
          ft.relname                                     AS from_table,
          fa.attname                                     AS from_column,
          fa.attnum                                      AS from_attnum,
          ft.oid                                         AS from_relid,
          tn.nspname                                     AS to_schema,
          tt.relname                                     AS to_table,
          ta.attname                                     AS to_column,
          (array_position(c.conkey, fa.attnum))::INTEGER AS key_position
        FROM pg_constraint c
        JOIN pg_class       ft ON ft.oid = c.conrelid
        JOIN pg_namespace   fn ON fn.oid = ft.relnamespace
        JOIN pg_class       tt ON tt.oid = c.confrelid
        JOIN pg_namespace   tn ON tn.oid = tt.relnamespace
        JOIN unnest(c.conkey)  WITH ORDINALITY AS fk_cols(attnum, ord) ON TRUE
        JOIN unnest(c.confkey) WITH ORDINALITY AS pk_cols(attnum, ord) ON pk_cols.ord = fk_cols.ord
        JOIN pg_attribute   fa ON fa.attrelid = ft.oid AND fa.attnum = fk_cols.attnum
        JOIN pg_attribute   ta ON ta.attrelid = tt.oid AND ta.attnum = pk_cols.attnum
        WHERE c.contype = 'f'
          AND fn.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND tn.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      )
      SELECT
        fk.from_schema,
        fk.from_table,
        fk.from_column,
        fk.to_schema,
        fk.to_table,
        fk.to_column,
        EXISTS (
          SELECT 1
          FROM pg_constraint u
          WHERE u.conrelid = fk.from_relid
            AND u.contype IN ('p', 'u')
            AND u.conkey = ARRAY[fk.from_attnum]::SMALLINT[]
        )                                                  AS from_is_unique
      FROM fk
      ORDER BY fk.from_schema, fk.from_table, fk.from_column
    `);
    return rows.map((r) => ({
      fromSchema: r.from_schema,
      fromTable: r.from_table,
      fromColumn: r.from_column,
      toSchema: r.to_schema,
      toTable: r.to_table,
      toColumn: r.to_column,
      cardinality: r.from_is_unique ? 'one_to_one' : 'one_to_many',
    }));
  }

  async runQuery(sql: string, params: ReadonlyArray<unknown>): Promise<RunQueryResult> {
    const client = this.requireClient<Pool>();
    const result = await client.query<Record<string, unknown>>(sql, params as unknown[]);
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? result.rows.length,
    };
  }

  async listAllColumns(): Promise<Map<string, DiscoveredColumn[]>> {
    const client = this.requireClient<Pool>();
    const { rows } = await client.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
      ordinal_position: number;
      udt_name: string;
      is_nullable: 'YES' | 'NO';
      is_primary_key: boolean;
      pk_position: number | null;
    }>(`
      WITH pk_cols AS (
        SELECT i.indrelid, a.attname,
               (array_position(i.indkey::INTEGER[], a.attnum) + 1)::INTEGER AS pk_position
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indisprimary
      )
      SELECT col.table_schema, col.table_name, col.column_name,
             col.ordinal_position::INTEGER AS ordinal_position,
             col.udt_name, col.is_nullable,
             (pk.attname IS NOT NULL) AS is_primary_key,
             pk.pk_position
      FROM information_schema.columns col
      JOIN pg_namespace n ON n.nspname = col.table_schema
      JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = col.table_name AND c.relkind = 'r'
      LEFT JOIN pk_cols pk ON pk.indrelid = c.oid AND pk.attname = col.column_name
      WHERE col.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND col.table_schema NOT LIKE 'pg_temp_%'
      ORDER BY col.table_schema, col.table_name, col.ordinal_position
    `);
    return groupByTable(
      rows,
      (r) => tableKey(r.table_schema, r.table_name),
      (r) => ({
        columnName: r.column_name,
        ordinalPosition: r.ordinal_position,
        dataTypeNative: r.udt_name,
        dataTypeCanonical: pgNativeToCanonical(r.udt_name),
        isNullable: r.is_nullable === 'YES',
        isPrimaryKey: r.is_primary_key,
        pkPosition: r.pk_position,
      })
    );
  }

  async profileTableByScan(
    schemaName: string,
    tableName: string,
    request: ScanProfileRequest,
    rowCountEstimate: bigint | null,
    options: TableProfileOptions
  ): Promise<ScanProfileResult> {
    const client = this.requireClient<Pool>();
    const table = this.qualifiedName(schemaName, tableName);
    const columns = new Map<string, ColumnProfileResult>();
    const sampleValues = new Map<string, string[]>();
    let queryCount = 0;

    const samplePercent = samplePercentFor(rowCountEstimate, options.sampleRowThreshold);
    const scale = samplePercent != null ? 100 / samplePercent : 1;
    const sample = samplePercent != null ? ` TABLESAMPLE SYSTEM (${samplePercent})` : '';

    for (let i = 0; i < request.columns.length; i += options.columnChunkSize) {
      const chunk = request.columns.slice(i, i + options.columnChunkSize);
      const specs = buildColumnSpecs(chunk, (s) => this.quoteIdent(s));
      const sql = buildAggregateScanSql(table, specs, { samplePercent });
      const { rows } = await client.query<Record<string, unknown>>(sql);
      queryCount++;
      if (rows[0]) {
        const { perColumn } = mapAggregateScanRow(rows[0], specs, scale);
        for (const [name, summary] of perColumn) {
          columns.set(name, { summary, cardinality: null });
        }
      }
    }

    const probeColumns = request.columns.filter(
      (c) => c.dataTypeCanonical === 'text' || c.dataTypeCanonical === 'boolean'
    );
    for (const col of probeColumns) {
      const ident = this.quoteIdent(col.columnName);
      const { rows } = await client.query<{ value: string | null; frequency: string }>(
        `
        SELECT ${ident}::TEXT AS value, COUNT(*)::TEXT AS frequency
        FROM ${table}${sample}
        WHERE ${ident} IS NOT NULL
        GROUP BY ${ident}
        ORDER BY COUNT(*) DESC, ${ident} ASC
        LIMIT $1
        `,
        [options.distinctThreshold + 1]
      );
      queryCount++;
      const values = rows
        .filter((r) => r.value !== null)
        .map((r) => ({ value: this.truncateTopValue(r.value), frequency: Number(r.frequency) }));
      columns.set(
        col.columnName,
        buildProbeProfile(columns.get(col.columnName)?.summary, values, rows.length, options)
      );
    }

    if (options.sampleValuesPerColumn > 0) {
      const big = rowCountEstimate != null && Number(rowCountEstimate) > 100_000;
      const sql = big
        ? `SELECT * FROM ${table} TABLESAMPLE SYSTEM (1) LIMIT 100`
        : `SELECT * FROM ${table} LIMIT 100`;
      try {
        const { rows } = await client.query<Record<string, unknown>>(sql);
        queryCount++;
        collectDistinctSampleValues(rows, options.sampleValuesPerColumn, sampleValues);
      } catch (err) {
        logger.warn(
          `[PostgresConnector] sample rows failed for ${schemaName}.${tableName}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return { columns, sampleValues, queryCount };
  }
}
