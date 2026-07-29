import type { ColumnSummary, DataTypeCanonical } from '@/types/dataSource';
import { buildNumericStats, parseTemporalMinMax, scanNum as num } from '../scanShared';

export function buildChAggregateScanSql(
  qualifiedTable: string,
  cols: Array<{ alias: string; ident: string; canonical: DataTypeCanonical }>
): string {
  const parts: string[] = ['toString(count()) AS total_rows'];
  for (const { alias, ident, canonical } of cols) {
    parts.push(`toString(count(${ident})) AS ${alias}_nn`);
    if (canonical === 'numeric') {
      parts.push(
        `toString(min(${ident})) AS ${alias}_min`,
        `toString(max(${ident})) AS ${alias}_max`,
        `toString(avg(${ident})) AS ${alias}_avg`,
        `toString(stddevSamp(${ident})) AS ${alias}_sd`,
        `toString(uniq(${ident})) AS ${alias}_ndv`,
        `quantiles(0.5, 0.95, 0.99)(${ident}) AS ${alias}_q`
      );
    } else if (canonical === 'text') {
      parts.push(`toString(uniq(${ident})) AS ${alias}_ndv`);
    } else if (canonical === 'temporal') {
      parts.push(
        `toString(min(${ident})) AS ${alias}_min`,
        `toString(max(${ident})) AS ${alias}_max`
      );
    }
  }
  return `SELECT\n  ${parts.join(',\n  ')}\nFROM ${qualifiedTable}`;
}

export function mapChAggregateScanRow(
  row: Record<string, unknown>,
  cols: Array<{ alias: string; columnName: string; canonical: DataTypeCanonical }>
): { perColumn: Map<string, ColumnSummary> } {
  const totalCount = Math.round(num(row.total_rows) ?? 0);
  const perColumn = new Map<string, ColumnSummary>();

  for (const { alias, columnName, canonical } of cols) {
    const nonNull = num(row[`${alias}_nn`]) ?? 0;
    const summary: ColumnSummary = {
      totalCount,
      nullCount: Math.max(0, totalCount - Math.round(nonNull)),
      statsSource: 'scan',
    };
    let ndv: number | null = null;

    if (canonical === 'numeric') {
      const q = row[`${alias}_q`];
      const [p50, p95, p99] = Array.isArray(q) ? q.map(num) : [];
      const stats = buildNumericStats({
        min: num(row[`${alias}_min`]),
        max: num(row[`${alias}_max`]),
        avg: num(row[`${alias}_avg`]),
        stddev: num(row[`${alias}_sd`]),
        p50,
        p95,
        p99,
      });
      if (stats) summary.numericStats = stats;
      ndv = num(row[`${alias}_ndv`]);
    } else if (canonical === 'text') {
      ndv = num(row[`${alias}_ndv`]);
    } else if (canonical === 'temporal') {
      const range = parseTemporalMinMax(row[`${alias}_min`], row[`${alias}_max`]);
      if (range) summary.temporalStats = range;
    }
    if (ndv != null && ndv > 0) summary.distinctCountApprox = Math.round(ndv);
    perColumn.set(columnName, summary);
  }
  return { perColumn };
}
