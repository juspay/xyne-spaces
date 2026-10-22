// Zero internal APIs (mapped via #imports in package.json)
import { compile } from '#zero-internal/compiler';
import { formatPgInternalConvert } from '#zero-internal/sql';
import { schema } from '@xyne/shared';
import { logger } from '@/utils/logger';

/**
 * Run a flat catalog query and build its JSON in the application, not in Postgres.
 *
 * Zero's z2s compiler wraps every query as
 *   SELECT COALESCE(json_agg(row_to_json("zql_root")), '[]'::json)::text AS "zql_result"
 *   FROM (<select>) "zql_root"
 * so Postgres serialises the whole result into ONE text value before sending it.
 * For a large list (e.g. `userAllChannels`, ~130k rows) the DB builds a huge JSON
 * datum in memory, the backend receives it as one string, and then parses it into a
 * second full copy.
 *
 * For queries with no `.related()` (a flat row set) the wrapper adds nothing: strip
 * it, let Postgres stream ordinary rows, and coerce the column types the JSON path
 * would otherwise have normalised. Queries with relationships still need the nested
 * JSON the compiler produces, so they keep using Zero's executor.
 */

/** Returned when the query can't take the flat path; the caller uses Zero's executor. */
export const NOT_FLAT = Symbol('NOT_FLAT');

// The compiler's outer wrapper. Group 1 is the inner select.
const ZQL_WRAPPER =
  /^\s*SELECT\s+COALESCE\(json_agg\(row_to_json\("zql_root"\)\),\s*'\[\]'::json\)::text\s+AS\s+"zql_result"\s+FROM\s+\(([\s\S]*)\)\s+"zql_root"\s*$/;

type FlatAst = { table: string; related?: readonly unknown[] | undefined };
type FlatFormat = { singular?: boolean } | undefined;
type Row = Record<string, unknown>;
type DbTransaction = { query: (sql: string, params: unknown[]) => Promise<Iterable<Row>> | Iterable<Row> };

function numberColumnsOf(table: string): string[] {
  const tables = schema.tables as unknown as Record<string, { columns: Record<string, { type: string }> }>;
  const tableSchema = tables[table];
  if (!tableSchema) return [];
  return Object.entries(tableSchema.columns)
    .filter(([, col]) => col.type === 'number')
    .map(([name]) => name);
}

/**
 * node-pg returns `numeric` (what `EXTRACT(EPOCH ...) * 1000` yields for timestamps)
 * and `bigint` as strings. `row_to_json` emitted them as JSON numbers, so convert
 * them back to keep the result identical to the JSON path.
 */
function coerceNumberColumns(rows: Row[], numberColumns: string[], queryName: string): void {
  if (numberColumns.length === 0) return;
  for (const row of rows) {
    for (const col of numberColumns) {
      const value = row[col];
      if (typeof value !== 'string') continue;
      const n = Number(value);
      if (!Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n))) {
        // Same guarantee as Zero's extractZqlResult: never return a lossy number.
        throw new Error(`Value exceeds safe Number range in ${queryName}.${col}`);
      }
      row[col] = n;
    }
  }
}

/**
 * Array-of-timestamp columns come back from pg as arrays of numeric strings, which
 * the JSON path would have turned into numbers. They are rare; rather than coerce
 * nested values, leave any table that has one on Zero's executor.
 */
function hasTimestampArrayColumn(table: string, serverSchema: unknown): boolean | undefined {
  const tables = schema.tables as unknown as Record<string, { serverName?: string }>;
  const serverName = tables[table]?.serverName ?? table;
  const serverTable = (serverSchema as Record<string, Record<string, { type: string; isArray?: boolean }>>)[serverName];
  if (!serverTable) return undefined;
  return Object.values(serverTable).some((col) => col.isArray === true && /time|date/.test(col.type));
}

export async function executeFlatCatalogQuery(
  dbTransaction: DbTransaction,
  ast: FlatAst,
  format: FlatFormat,
  serverSchema: unknown,
  queryName: string,
): Promise<unknown> {
  if (ast.related && ast.related.length > 0) return NOT_FLAT;
  // `.one()` compiles to `SELECT (row_to_json("zql_root"))::text ... LIMIT 1` with no
  // json_agg: a single row, so there is nothing to gain, and the wrapper regex below
  // would not match it. Leave it on Zero's executor without logging.
  if (format?.singular) return NOT_FLAT;
  if (hasTimestampArrayColumn(ast.table, serverSchema) !== false) return NOT_FLAT;

  // @ts-ignore - z2s internal types; same call as handleQueriesZqlToSql
  const compiled = formatPgInternalConvert(compile(serverSchema, schema, ast, format));
  const match = ZQL_WRAPPER.exec(compiled.text);
  const inner = match?.[1];
  // The wrapper must carry no bound parameter, otherwise removing it would shift $N.
  const wrapper = inner === undefined ? '' : compiled.text.replace(inner, '');
  if (inner === undefined || /\$\d/.test(wrapper)) {
    // Compiler output changed shape (e.g. a Zero upgrade). Fall back rather than guess.
    logger.warn('flat_catalog_query_unrecognised_sql', { query: queryName });
    return NOT_FLAT;
  }

  const result = await dbTransaction.query(`SELECT * FROM (${inner}) "zql_root"`, compiled.values as unknown[]);
  const rows: Row[] = Array.isArray(result) ? (result as Row[]) : [...(result as Iterable<Row>)];

  coerceNumberColumns(rows, numberColumnsOf(ast.table), queryName);

  return rows;
}
