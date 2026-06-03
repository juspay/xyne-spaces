import { Client, type ClientConfig } from 'pg';
import { config as appConfig } from '@/config/env';
import { ConnectorBase } from '../ConnectorBase';
import type {
  ConnectionConfig,
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
import { pgNativeToCanonical } from './typeMapping';

export class PostgresConnector extends ConnectorBase {
  private readonly clientConfig: ClientConfig;

  constructor(config: ConnectionConfig) {
    super(config);
    this.clientConfig = {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl
        ? { rejectUnauthorized: appConfig.env === 'production' }
        : false,
      connectionTimeoutMillis: appConfig.dashboard.pgConnectionTimeoutMs,
      statement_timeout: appConfig.dashboard.pgStatementTimeoutMs,
    };
  }

  protected quoteIdent(s: string): string {
    return '"' + s.replace(/"/g, '""') + '"';
  }

  async connect(): Promise<void> {
    if (this.client) return;
    const client = new Client(this.clientConfig);
    await client.connect();
    this.client = client;
  }

  async close(): Promise<void> {
    if (!this.client) return;
    await (this.client as Client).end();
    this.client = null;
  }

  async testConnection(): Promise<TestConnectionResult> {
    let temp: Client | null = null;
    try {
      temp = new Client(this.clientConfig);
      await temp.connect();
      const { rows } = await temp.query<{ version: string }>(
        'SELECT version() AS version',
      );
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
    const client = this.requireClient<Client>();
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
      const estimate = r.row_count_estimate !== null
        ? Number(r.row_count_estimate)
        : null;
      return {
        schemaName: r.schema_name,
        tableName: r.table_name,
        rowCountEstimate: estimate !== null && Number.isFinite(estimate)
          ? BigInt(Math.floor(estimate))
          : null,
      };
    });
  }

  async listColumns(
    schemaName: string,
    tableName: string,
  ): Promise<DiscoveredColumn[]> {
    const client = this.requireClient<Client>();
    const { rows } = await client.query<{
      column_name: string;
      ordinal_position: number;
      udt_name: string;
      is_nullable: 'YES' | 'NO';
      is_primary_key: boolean;
      pk_position: number | null;
    }>(
      `
      WITH pk_cols AS (
        SELECT
          a.attname                                        AS column_name,
          (array_position(i.indkey::INTEGER[], a.attnum) + 1)::INTEGER AS pk_position
        FROM pg_index i
        JOIN pg_class c       ON c.oid = i.indrelid
        JOIN pg_namespace n   ON n.oid = c.relnamespace
        JOIN pg_attribute a   ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
        WHERE i.indisprimary
          AND n.nspname = $1
          AND c.relname = $2
      )
      SELECT
        col.column_name,
        col.ordinal_position::INTEGER     AS ordinal_position,
        col.udt_name,
        col.is_nullable,
        (pk.column_name IS NOT NULL)      AS is_primary_key,
        pk.pk_position                    AS pk_position
      FROM information_schema.columns col
      LEFT JOIN pk_cols pk ON pk.column_name = col.column_name
      WHERE col.table_schema = $1
        AND col.table_name = $2
      ORDER BY col.ordinal_position
      `,
      [schemaName, tableName],
    );
    return rows.map((r) => ({
      columnName: r.column_name,
      ordinalPosition: r.ordinal_position,
      dataTypeNative: r.udt_name,
      dataTypeCanonical: pgNativeToCanonical(r.udt_name),
      isNullable: r.is_nullable === 'YES',
      isPrimaryKey: r.is_primary_key,
      pkPosition: r.pk_position,
    }));
  }

  async listRelationships(): Promise<DiscoveredRelationship[]> {
    const client = this.requireClient<Client>();
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

  async computeNumericStats(
    schemaName: string,
    tableName: string,
    columnName: string,
  ): Promise<NumericStats | null> {
    const client = this.requireClient<Client>();
    const table = this.qualifiedName(schemaName, tableName);
    const col = this.quoteIdent(columnName);
    const { rows } = await client.query<{
      min: string | null; max: string | null;
      avg: string | null; stddev: string | null;
      p50: string | null; p95: string | null; p99: string | null;
    }>(`
      SELECT
        MIN(${col})::TEXT                                            AS min,
        MAX(${col})::TEXT                                            AS max,
        AVG(${col})::TEXT                                            AS avg,
        COALESCE(STDDEV_SAMP(${col}), 0)::TEXT                       AS stddev,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ${col})::TEXT   AS p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${col})::TEXT   AS p95,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ${col})::TEXT   AS p99
      FROM ${table}
      WHERE ${col} IS NOT NULL
    `);
    const r = rows[0];
    if (!r || r.min === null) return null;
    return {
      min:    Number(r.min),
      max:    Number(r.max),
      avg:    Number(r.avg),
      stddev: Number(r.stddev ?? 0),
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
    const client = this.requireClient<Client>();
    const table = this.qualifiedName(schemaName, tableName);
    const col = this.quoteIdent(columnName);
    const { rows } = await client.query<{ min: string | null; max: string | null }>(`
      SELECT
        MIN(${col})::TEXT AS min,
        MAX(${col})::TEXT AS max
      FROM ${table}
      WHERE ${col} IS NOT NULL
    `);
    const r = rows[0];
    if (!r || r.min === null || r.max === null) return null;
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
    const client = this.requireClient<Client>();
    const table = this.qualifiedName(schemaName, tableName);
    const col = this.quoteIdent(columnName);

    const { rows: distinctRows } = await client.query<{ approx: string }>(`
      SELECT COUNT(DISTINCT ${col})::TEXT AS approx
      FROM ${table}
      WHERE ${col} IS NOT NULL
    `);
    const distinctCountApprox = Number(distinctRows[0]?.approx ?? 0);
    const valuesAreExhaustive = distinctCountApprox <= options.distinctThreshold;
    const fetchLimit = valuesAreExhaustive
      ? Math.max(options.distinctThreshold, 1)
      : Math.max(options.topK, 1);

    const { rows: valueRows } = await client.query<{
      value: string | null;
      frequency: string;
    }>(
      `
      SELECT ${col}::TEXT AS value, COUNT(*)::TEXT AS frequency
      FROM ${table}
      WHERE ${col} IS NOT NULL
      GROUP BY ${col}
      ORDER BY COUNT(*) DESC, ${col} ASC
      LIMIT $1
      `,
      [fetchLimit],
    );

    return {
      distinctCountApprox,
      valuesAreExhaustive,
      topValues: valueRows
        .filter((r) => r.value !== null)
        .map((r) => ({
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
    const client = this.requireClient<Client>();
    const table = this.qualifiedName(schemaName, tableName);
    const col = this.quoteIdent(columnName);
    const { rows } = await client.query<{
      null_count: string;
      total_count: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE ${col} IS NULL)::TEXT AS null_count,
        COUNT(*)::TEXT                                AS total_count
      FROM ${table}
    `);
    return {
      nullCount:  Number(rows[0]?.null_count ?? 0),
      totalCount: Number(rows[0]?.total_count ?? 0),
    };
  }

  async runQuery(
    sql: string,
    params: ReadonlyArray<unknown>,
  ): Promise<RunQueryResult> {
    const client = this.requireClient<Client>();
    const result = await client.query<Record<string, unknown>>(sql, params as unknown[]);
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? result.rows.length,
    };
  }
}
