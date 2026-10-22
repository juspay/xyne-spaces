// Zero internal APIs (mapped via #imports in package.json)
import { compile } from '#zero-internal/compiler';
import { formatPgInternalConvert } from '#zero-internal/sql';
import { schema as appSchema } from '@xyne/shared';
import { logger } from '@/utils/logger';

/**
 * Run a flat catalog query and build its JSON in the application, not in Postgres.
 *
 * Zero's z2s compiler wraps every list query as
 *   SELECT COALESCE(json_agg(row_to_json("zql_root")), '[]'::json)::text AS "zql_result"
 *   FROM (<select>) "zql_root"
 * so Postgres serialises the whole result into ONE text value before sending it.
 * For a large list (e.g. `userAllChannels`, ~130k rows) the DB builds a huge JSON
 * datum in memory, the backend receives it as one string, and then parses it into a
 * second full copy.
 *
 * This path strips the wrapper, lets Postgres return ordinary rows, and converts the
 * few column types where node-pg and row_to_json disagree, so the result is the same
 * value Zero's executor would have returned. Anything it can't reproduce exactly
 * returns NOT_FLAT and the caller uses Zero's executor:
 *   - singular (`.one()`) queries: one row, nothing to gain, different wrapper;
 *   - queries with `.related()`: they need the nested JSON the compiler builds;
 *   - tables with a column type outside the allow-lists below (enum arrays, int8[],
 *     numeric[], timestamp arrays, bytea, interval, ...);
 *   - SQL that doesn't match the expected wrapper (e.g. after a Zero upgrade).
 * `whereExists`, `limit`, `start` and `orderBy` all live inside the inner select, so
 * they carry over unchanged.
 */

/** Returned when the query can't take the flat path; the caller uses Zero's executor. */
export const NOT_FLAT = Symbol('NOT_FLAT');

// The compiler's outer wrapper for list queries. Group 1 is the inner select.
const ZQL_WRAPPER =
  /^\s*SELECT\s+COALESCE\(json_agg\(row_to_json\("zql_root"\)\),\s*'\[\]'::json\)::text\s+AS\s+"zql_result"\s+FROM\s+\(([\s\S]*)\)\s+"zql_root"\s*$/;

// Server types (as Zero's getServerSchema names them) whose node-pg value is already
// identical to what row_to_json + JSON parsing produces.
const SAME_SCALAR =
  /^(text|uuid|integer|smallint|boolean|json|jsonb|"char"|(character varying|character|varchar|bpchar)(\(\d+\))?)$/;
// Floats: node-pg returns numbers, but row_to_json emits Infinity/-Infinity/NaN as strings.
const FLOAT_SCALAR = /^(real|double precision)$/;
// Server types node-pg returns as strings but row_to_json emits as JSON numbers.
// Timestamp/date/time columns are in this list because the compiler selects them as
// `EXTRACT(EPOCH FROM col) * 1000` (numeric) or a bigint expression.
const NUMBER_SCALAR =
  /^(bigint|(numeric|decimal)(\(\d+, ?\d+\))?|date|timestamp|timestamp (with|without) time zone|time|time (with|without) time zone)$/;
// Array element types (pg typname) that node-pg parses into the same JS array.
const SAME_ARRAY_ELEMENT = /^(text|varchar|bpchar|uuid|int2|int4|float4|float8|bool|json|jsonb)$/;

type ServerColumn = { type: string; isEnum: boolean; isArray: boolean };
type ServerSchema = Record<string, Record<string, ServerColumn>>;
type ZqlSchema = {
  tables: Record<string, { serverName?: string; columns: Record<string, { serverName?: string }> }>;
};
type FlatAst = { table: string; related?: readonly unknown[] | undefined };
type FlatFormat = { singular?: boolean } | undefined;
type Row = Record<string, unknown>;
type DbTransaction = { query: (sql: string, params: unknown[]) => Promise<Iterable<Row>> | Iterable<Row> };

type Conversions = { numberColumns: string[]; floatColumns: string[] };

/**
 * Columns (by result alias) that need converting to match row_to_json, or null if the
 * table has a selected column this path can't reproduce exactly.
 */
function conversionsFor(table: string, serverSchema: ServerSchema, zqlSchema: ZqlSchema): Conversions | null {
  const zqlTable = zqlSchema.tables[table];
  const serverTable = zqlTable ? serverSchema[zqlTable.serverName ?? table] : undefined;
  if (!zqlTable || !serverTable) return null;

  const numberColumns: string[] = [];
  const floatColumns: string[] = [];
  for (const [column, def] of Object.entries(zqlTable.columns)) {
    const server = serverTable[def.serverName ?? column];
    if (!server) return null;
    if (server.isArray) {
      if (server.isEnum || !SAME_ARRAY_ELEMENT.test(server.type)) return null;
    } else if (server.isEnum || SAME_SCALAR.test(server.type)) {
      continue;
    } else if (NUMBER_SCALAR.test(server.type)) {
      numberColumns.push(column);
    } else if (FLOAT_SCALAR.test(server.type)) {
      floatColumns.push(column);
    } else {
      return null;
    }
  }
  return { numberColumns, floatColumns };
}

/**
 * Same rule as Zero's JSON number parser (shared/src/bigint-json.ts): keep safe
 * numbers and non-integer literals as Number; an unsafe integer would have become a
 * bigint, which extractZqlResult rejects — so reject it too.
 */
function toJsonNumber(value: string, queryName: string, column: string): number | string {
  const n = +value;
  if (!Number.isFinite(n)) return value; // NaN / ±Infinity: row_to_json emits these as strings
  if (n >= Number.MIN_SAFE_INTEGER && n <= Number.MAX_SAFE_INTEGER) return n;
  if (value.includes('.') || value.includes('e') || value.includes('E')) return n;
  throw new Error(`Value exceeds safe Number range in ${queryName}.${column}`);
}

export async function executeFlatCatalogQuery(
  dbTransaction: DbTransaction,
  ast: FlatAst,
  format: FlatFormat,
  serverSchema: unknown,
  queryName: string,
  zqlSchema: ZqlSchema = appSchema as unknown as ZqlSchema,
): Promise<unknown> {
  if (format?.singular) return NOT_FLAT;
  if (ast.related && ast.related.length > 0) return NOT_FLAT;

  const conversions = conversionsFor(ast.table, serverSchema as ServerSchema, zqlSchema);
  if (!conversions) return NOT_FLAT;
  const { numberColumns, floatColumns } = conversions;

  // @ts-ignore - z2s internal types; same call as handleQueriesZqlToSql
  const compiled = formatPgInternalConvert(compile(serverSchema, zqlSchema, ast, format));
  const inner = ZQL_WRAPPER.exec(compiled.text)?.[1];
  // The wrapper must carry no bound parameter, otherwise removing it would shift $N.
  if (inner === undefined || /\$\d/.test(compiled.text.replace(inner, ''))) {
    // Compiler output changed shape (e.g. a Zero upgrade). Fall back rather than guess.
    logger.warn('flat_catalog_query_unrecognised_sql', { query: queryName });
    return NOT_FLAT;
  }

  const result = await dbTransaction.query(`SELECT * FROM (${inner}) "zql_root"`, compiled.values as unknown[]);
  const rows: Row[] = Array.isArray(result) ? (result as Row[]) : [...(result as Iterable<Row>)];

  for (const row of rows) {
    for (const column of numberColumns) {
      const value = row[column];
      if (typeof value === 'string') row[column] = toJsonNumber(value, queryName, column);
    }
    for (const column of floatColumns) {
      const value = row[column];
      if (typeof value === 'number' && !Number.isFinite(value)) row[column] = String(value);
    }
  }
  return rows;
}
