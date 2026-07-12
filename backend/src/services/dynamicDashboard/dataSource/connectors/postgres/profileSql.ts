import type { ColumnSummary, DataTypeCanonical } from '@/types/dataSource';
import { buildNumericStats, parseTemporalMinMax, scanNum as num } from '../scanShared';

const SAMPLE_TARGET_ROWS = 1_000_000;

export function samplePercentFor(
  rowCountEstimate: bigint | null,
  sampleRowThreshold: number
): number | null {
  if (rowCountEstimate == null) return null;
  const rows = Number(rowCountEstimate);
  if (!Number.isFinite(rows) || rows <= sampleRowThreshold) return null;
  return Math.min(100, Math.max(0.01, (SAMPLE_TARGET_ROWS / rows) * 100));
}

export function buildAggregateScanSql(
  qualifiedTable: string,
  cols: Array<{ alias: string; ident: string; canonical: DataTypeCanonical }>,
  opts: { samplePercent: number | null }
): string {
  const parts: string[] = ['COUNT(*)::float8 AS total_rows'];
  for (const { alias, ident, canonical } of cols) {
    parts.push(`COUNT(${ident})::float8 AS ${alias}_nn`);
    if (canonical === 'numeric') {
      parts.push(
        `MIN(${ident})::TEXT AS ${alias}_min`,
        `MAX(${ident})::TEXT AS ${alias}_max`,
        `AVG(${ident})::TEXT AS ${alias}_avg`,
        `STDDEV_SAMP(${ident})::TEXT AS ${alias}_sd`
      );
    } else if (canonical === 'temporal') {
      parts.push(`MIN(${ident})::TEXT AS ${alias}_min`, `MAX(${ident})::TEXT AS ${alias}_max`);
    }
  }
  const sample = opts.samplePercent != null ? ` TABLESAMPLE SYSTEM (${opts.samplePercent})` : '';
  return `SELECT\n  ${parts.join(',\n  ')}\nFROM ${qualifiedTable}${sample}`;
}

export function mapAggregateScanRow(
  row: Record<string, unknown>,
  cols: Array<{ alias: string; columnName: string; canonical: DataTypeCanonical }>,
  scale: number
): { perColumn: Map<string, ColumnSummary> } {
  const rawTotal = num(row.total_rows) ?? 0;
  const totalCount = Math.round(rawTotal * scale);
  const approx = scale !== 1;
  const perColumn = new Map<string, ColumnSummary>();

  for (const { alias, columnName, canonical } of cols) {
    const nonNull = num(row[`${alias}_nn`]) ?? 0;
    const summary: ColumnSummary = {
      totalCount,
      nullCount: Math.max(0, Math.round((rawTotal - nonNull) * scale)),
      statsSource: 'scan',
    };
    if (approx) summary.approx = true;

    if (canonical === 'numeric') {
      const stats = buildNumericStats({
        min: num(row[`${alias}_min`]),
        max: num(row[`${alias}_max`]),
        avg: num(row[`${alias}_avg`]),
        stddev: num(row[`${alias}_sd`]),
      });
      if (stats) summary.numericStats = stats;
    } else if (canonical === 'temporal') {
      const range = parseTemporalMinMax(row[`${alias}_min`], row[`${alias}_max`]);
      if (range) summary.temporalStats = range;
    }
    perColumn.set(columnName, summary);
  }
  return { perColumn };
}
