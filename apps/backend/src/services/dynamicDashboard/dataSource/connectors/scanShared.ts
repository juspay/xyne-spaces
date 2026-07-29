import type { ColumnSummary, ColumnValue, DataTypeCanonical } from '@/types/dataSource';

export interface ScanColumnSpec {
  alias: string;
  ident: string;
  columnName: string;
  canonical: DataTypeCanonical;
}

/** Build the per-column aggregate-scan specs (alias/quoted-ident/name/type) shared by both dialects. */
export function buildColumnSpecs(
  cols: ReadonlyArray<{ columnName: string; dataTypeCanonical: DataTypeCanonical }>,
  quote: (ident: string) => string
): ScanColumnSpec[] {
  return cols.map((c, i) => ({
    alias: `c${i}`,
    ident: quote(c.columnName),
    columnName: c.columnName,
    canonical: c.dataTypeCanonical,
  }));
}

/** Group rows into a Map keyed per table, projecting each row (with its position within the group). */
export function groupByTable<R, T>(
  rows: readonly R[],
  keyFn: (row: R) => string,
  project: (row: R, currentCount: number) => T
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    let list = out.get(key);
    if (!list) {
      list = [];
      out.set(key, list);
    }
    list.push(project(row, list.length));
  }
  return out;
}

export function scanNum(v: unknown): number | null {
  if (v == null || v === '' || v === 'nan' || v === 'inf' || v === '-inf') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildNumericStats(parts: {
  min: number | null;
  max: number | null;
  avg?: number | null;
  stddev?: number | null;
  p50?: number | null;
  p95?: number | null;
  p99?: number | null;
}): NonNullable<ColumnSummary['numericStats']> | null {
  const { min, max } = parts;
  if (min == null || max == null) return null;
  const stats: NonNullable<ColumnSummary['numericStats']> = { min, max };
  if (parts.avg != null) stats.avg = parts.avg;
  if (parts.stddev != null) stats.stddev = parts.stddev;
  if (parts.p50 != null) stats.p50 = parts.p50;
  if (parts.p95 != null) stats.p95 = parts.p95;
  if (parts.p99 != null) stats.p99 = parts.p99;
  return stats;
}

export function parseTemporalMinMax(
  minRaw: unknown,
  maxRaw: unknown
): { min: string; max: string } | null {
  if (typeof minRaw !== 'string' || typeof maxRaw !== 'string' || !minRaw || !maxRaw) return null;
  const minD = new Date(minRaw);
  const maxD = new Date(maxRaw);
  if (isNaN(minD.getTime()) || isNaN(maxD.getTime())) return null;
  return { min: minD.toISOString(), max: maxD.toISOString() };
}

export function buildProbeProfile(
  existing: ColumnSummary | undefined,
  values: ColumnValue[],
  rowsReturned: number,
  options: { distinctThreshold: number; topK: number }
): { summary: ColumnSummary; cardinality: 'categorical' | 'high_card' } {
  const exhaustive = rowsReturned <= options.distinctThreshold;
  return {
    summary: {
      ...existing,
      statsSource: 'scan',
      topValues: exhaustive ? values : values.slice(0, options.topK),
      valuesAreExhaustive: exhaustive,
      ...(exhaustive ? { distinctCountApprox: values.length } : {}),
    },
    cardinality: exhaustive ? 'categorical' : 'high_card',
  };
}

export function collectDistinctSampleValues(
  rows: Array<Record<string, unknown>>,
  perColumn: number,
  into: Map<string, string[]>
): void {
  for (const row of rows) {
    for (const [key, raw] of Object.entries(row)) {
      if (raw == null) continue;
      const value = String(raw).slice(0, 120);
      const list = into.get(key) ?? [];
      if (list.length < perColumn && !list.includes(value)) {
        list.push(value);
        into.set(key, list);
      }
    }
  }
}
