import { Pool, type PoolClient, type QueryResult } from 'pg';

import { DPIP_TABLE_SPECS } from './schema';
import {
  contextLogFields,
  type DpipLogContext,
  errorLogFields,
  logError,
} from './logging';
import {
  DPIP_TABLE_NAMES,
  type DpipRow,
  type DpipTableName,
  type DpipValue,
  type DpipWriteStats,
} from './types';

const BATCH_SIZE = 500;

let pool: Pool | undefined;

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getPool(): Pool {
  if (pool !== undefined) {
    return pool;
  }

  const instanceConnectionName = requiredEnvironmentVariable(
    'INSTANCE_CONNECTION_NAME',
  );
  const host =
    process.env.DB_HOST ?? `/cloudsql/${instanceConnectionName}`;

  pool = new Pool({
    host,
    port: Number(process.env.DB_PORT ?? '5432'),
    database: requiredEnvironmentVariable('DB_NAME'),
    user: requiredEnvironmentVariable('DB_USER'),
    password: requiredEnvironmentVariable('DB_PASSWORD'),
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'dpip-v2-daily-ingestion',
  });

  pool.on('error', (error) => {
    logError('dpip_database_pool_error', errorLogFields(error));
  });

  return pool;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function valuesClause(
  rows: readonly DpipRow[],
  fields: readonly string[],
): { sql: string; values: DpipValue[] } {
  const values: DpipValue[] = [];
  const groups = rows.map((row) => {
    const placeholders = fields.map((field) => {
      const value = row[field];
      if (value === undefined) {
        throw new Error(`Missing database field: ${field}`);
      }
      values.push(value);
      return `$${values.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  return { sql: groups.join(', '), values };
}

async function writeReports(
  client: PoolClient,
  rows: readonly DpipRow[],
): Promise<DpipWriteStats> {
  const stats: DpipWriteStats = { inserted: 0, updated: 0, conflicts: 0 };
  const fields = Object.keys(DPIP_TABLE_SPECS.reports.fields);

  for (const batch of chunks(rows, BATCH_SIZE)) {
    const values = valuesClause(batch, fields);
    const result = await client.query<{ inserted: boolean }>(
      `
        INSERT INTO dpip.reports (
          identifier_type,
          reported_date,
          party_id,
          sub_source,
          status,
          customer_type,
          metrics_type,
          metrics_value
        )
        VALUES ${values.sql}
        ON CONFLICT (
          identifier_type,
          reported_date,
          party_id,
          sub_source,
          status,
          customer_type,
          metrics_type
        )
        DO UPDATE SET
          metrics_value = EXCLUDED.metrics_value
        RETURNING (xmax = 0) AS inserted
      `,
      values.values,
    );

    for (const row of result.rows) {
      if (row.inserted) {
        stats.inserted += 1;
      } else {
        stats.updated += 1;
      }
    }
  }

  return stats;
}

async function writeScreenings(
  client: PoolClient,
  rows: readonly DpipRow[],
): Promise<DpipWriteStats> {
  const stats: DpipWriteStats = { inserted: 0, updated: 0, conflicts: 0 };
  const fields = Object.keys(DPIP_TABLE_SPECS.screenings.fields);

  for (const batch of chunks(rows, BATCH_SIZE)) {
    const values = valuesClause(batch, fields);
    const result = await client.query<{ inserted: boolean }>(
      `
        INSERT INTO dpip.screenings (
          screening_date,
          party_id,
          event_type,
          screening_status,
          count
        )
        VALUES ${values.sql}
        ON CONFLICT (
          screening_date,
          party_id,
          event_type,
          screening_status
        )
        DO UPDATE SET
          count = EXCLUDED.count
        RETURNING (xmax = 0) AS inserted
      `,
      values.values,
    );

    for (const row of result.rows) {
      if (row.inserted) {
        stats.inserted += 1;
      } else {
        stats.updated += 1;
      }
    }
  }

  return stats;
}

async function writeHistoryTable(
  client: PoolClient,
  table: Exclude<DpipTableName, 'reports' | 'screenings'>,
  rows: readonly DpipRow[],
): Promise<DpipWriteStats> {
  const stats: DpipWriteStats = { inserted: 0, updated: 0, conflicts: 0 };
  const fields = Object.keys(DPIP_TABLE_SPECS[table].fields);

  for (const batch of chunks(rows, BATCH_SIZE)) {
    const values = valuesClause(batch, fields);
    const result: QueryResult = await client.query(
      `
        INSERT INTO dpip.${table} (${fields.join(', ')})
        VALUES ${values.sql}
        ON CONFLICT DO NOTHING
        RETURNING 1
      `,
      values.values,
    );

    stats.inserted += result.rowCount ?? 0;
    stats.conflicts += batch.length - (result.rowCount ?? 0);
  }

  return stats;
}

export async function writeDpipTables(
  tables: Readonly<Record<DpipTableName, DpipRow[]>>,
  logContext?: DpipLogContext,
): Promise<Record<DpipTableName, DpipWriteStats>> {
  const client = await getPool().connect();
  const stats = {} as Record<DpipTableName, DpipWriteStats>;

  try {
    await client.query('BEGIN');

    for (const table of DPIP_TABLE_NAMES) {
      try {
        if (table === 'reports') {
          stats[table] = await writeReports(client, tables[table]);
        } else if (table === 'screenings') {
          stats[table] = await writeScreenings(client, tables[table]);
        } else {
          stats[table] = await writeHistoryTable(
            client,
            table,
            tables[table],
          );
        }
      } catch (error) {
        logError('dpip_database_table_write_failed', {
          ...contextLogFields(logContext),
          table,
          rows: tables[table].length,
          ...errorLogFields(error),
        });
        throw error;
      }
    }

    await client.query('COMMIT');
    return stats;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logError('dpip_database_rollback_failed', {
        ...contextLogFields(logContext),
        ...errorLogFields(rollbackError),
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function readAllDpipTables(
  logContext?: DpipLogContext,
): Promise<Record<DpipTableName, DpipRow[]>> {
  const client = await getPool().connect();
  const tables = {} as Record<DpipTableName, DpipRow[]>;

  try {
    await client.query(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );

    for (const table of DPIP_TABLE_NAMES) {
      const spec = DPIP_TABLE_SPECS[table];
      const fields = Object.keys(spec.fields);
      const textFields = fields.map(
        (field) => `${field}::text AS ${field}`,
      );
      try {
        const result = await client.query<DpipRow>(
          `
            SELECT ${textFields.join(', ')}
            FROM dpip.${table}
            ORDER BY ${spec.key.join(', ')}
          `,
        );
        tables[table] = result.rows;
      } catch (error) {
        logError('dpip_database_table_read_failed', {
          ...contextLogFields(logContext),
          table,
          ...errorLogFields(error),
        });
        throw error;
      }
    }

    await client.query('COMMIT');
    return tables;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logError('dpip_database_report_snapshot_rollback_failed', {
        ...contextLogFields(logContext),
        ...errorLogFields(rollbackError),
      });
    }
    throw error;
  } finally {
    client.release();
  }
}
