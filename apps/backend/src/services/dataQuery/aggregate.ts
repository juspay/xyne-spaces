// count / groupBy for Zero tables: keep Zero's compiled, ACL-filtered inner select and
// replace only its JSON wrapper with an aggregate.

import type { dbProvider } from '@/zero/server';

const WRAPPER =
  /^\s*SELECT\s+COALESCE\(json_agg\(row_to_json\("zql_root"\)\),\s*'\[\]'::json\)::text\s+AS\s+"zql_result"\s+FROM\s+\(([\s\S]+)\)\s+"zql_root"\s*$/;

/** Zero's inner select (filter + ACL), without its top-level ORDER BY. */
export function innerSelect(compiledText: string): string {
  const inner = WRAPPER.exec(compiledText)?.[1];
  if (!inner) throw new Error('Unexpected ZQL compiler output; refusing to aggregate over it.');
  // Only the top-level ORDER BY has no parentheses after it.
  return inner.replace(/\s+ORDER BY [^()]*$/, '');
}

export type Bucket = { column: string; bucket: 'hour' | 'day' | 'week' | 'month'; timezone: string };
export type Measure = { column: string; where?: Record<string, unknown> };
export interface Aggregation {
  operation: 'count' | 'groupBy';
  by?: (string | Bucket)[];
  min?: Record<string, Measure>;
  max?: Record<string, Measure>;
  orderBy?: { by: string; dir: 'asc' | 'desc' }[];
  limit: number;
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Columns must be validated; values are bound after the compiled query's own. */
export function aggregateSql(inner: string, compiledValues: unknown[], agg: Aggregation): { text: string; values: unknown[] } {
  const values = [...compiledValues];
  const param = (v: unknown) => `$${values.push(v)}`;
  const from = `FROM (${inner}) AS "zql_root"`;

  if (agg.operation === 'count') return { text: `SELECT COUNT(*) AS "_count" ${from}`, values };

  const keys = (agg.by ?? []).map((b) => {
    if (typeof b === 'string') return `${ident(b)} AS ${ident(b)}`;
    // Timestamps are epoch ms; returns the bucket start in epoch ms.
    const tz = param(b.timezone);
    const local = `date_trunc(${param(b.bucket)}, to_timestamp(${ident(b.column)} / 1000.0) AT TIME ZONE ${tz})`;
    return `(EXTRACT(EPOCH FROM ${local} AT TIME ZONE ${tz}) * 1000)::bigint AS ${ident(b.column)}`;
  });

  const measures = (['min', 'max'] as const).flatMap((fn) =>
    Object.entries(agg[fn] ?? {}).map(([alias, m]) => {
      const filter = Object.entries(m.where ?? {}).map(([col, v]) =>
        v === null ? `${ident(col)} IS NULL` : Array.isArray(v) ? `${ident(col)} = ANY(${param(v)})` : `${ident(col)} = ${param(v)}`,
      );
      return `${fn.toUpperCase()}(${ident(m.column)})${filter.length ? ` FILTER (WHERE ${filter.join(' AND ')})` : ''} AS ${ident(alias)}`;
    }),
  );

  const order = (agg.orderBy ?? []).map((o) => `${ident(o.by)} ${o.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`);
  const text = [
    `SELECT ${[...keys, 'COUNT(*) AS "_count"', ...measures].join(', ')}`,
    from,
    // Ordinals avoid repeating bucket expressions.
    `GROUP BY ${keys.map((_, i) => i + 1).join(', ')}`,
    order.length ? `ORDER BY ${order.join(', ')}` : '',
    `LIMIT ${param(agg.limit)}`,
  ]
    .filter(Boolean)
    .join('\n');
  return { text, values };
}

/** pg returns bigint/numeric as strings. */
export function toNumbers(row: Record<string, unknown>, numericKeys: string[]): Record<string, unknown> {
  const out = { ...row };
  for (const k of numericKeys) if (typeof out[k] === 'string' && out[k] !== '') out[k] = Number(out[k]);
  return out;
}

/** Runs the aggregate SQL on `provider`. */
export async function runSql(provider: typeof dbProvider, text: string, values: unknown[]): Promise<Record<string, unknown>[]> {
  return provider.transaction(async (tx) => [...(await tx.dbTransaction.query(text, values))] as Record<string, unknown>[]);
}
