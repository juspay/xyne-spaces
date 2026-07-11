import { DASHBOARD_SERIES_COLORS } from './constants';

function trimNum(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

export function seriesColor(idx: number): string {
  return DASHBOARD_SERIES_COLORS[idx % DASHBOARD_SERIES_COLORS.length]!;
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${trimNum(value / 1e7)} Cr`;
  if (abs >= 1e5) return `${trimNum(value / 1e5)} L`;
  if (abs >= 1e3) return `${trimNum(value / 1e3)}K`;
  return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export type UnitPosition = 'prefix' | 'suffix';

const TIGHT_UNITS = new Set(['%', '$', '₹', '€', '£']);
const CURRENCY_UNITS = new Set(['$', '₹', '€', '£']);

export function formatKpiValue(value: number, unit?: string, unitPosition?: UnitPosition): string {
  const num = formatCompact(value);
  if (!unit) return num;
  if (!Number.isFinite(value)) return num;
  const pos: UnitPosition = unitPosition ?? (CURRENCY_UNITS.has(unit) ? 'prefix' : 'suffix');
  const sep = TIGHT_UNITS.has(unit) ? '' : ' ';
  return pos === 'prefix' ? `${unit}${sep}${num}` : `${num}${sep}${unit}`;
}

export function fitYDomain(
  chartRows: Array<Record<string, unknown>>,
  keys: string[],
  includeZero = false,
): [number, number] | ['auto', 'auto'] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of chartRows) {
    for (const k of keys) {
      const n = Number(row[k]);
      if (Number.isFinite(n)) {
        if (n < lo) lo = n;
        if (n > hi) hi = n;
      }
    }
  }
  if (includeZero) {
    if (lo > 0) lo = 0;
    if (hi < 0) hi = 0;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return ['auto', 'auto'];
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.08 || 1;
  return [lo - pad, hi + pad];
}

type SeriesRow = { xLabel: string; [seriesKey: string]: string | number | null };

export function reshapeSeriesRows(
  data: unknown,
  defaultSeries: string,
): { chartRows: SeriesRow[]; keys: string[] } {
  const rows = Array.isArray(data) ? data : [];
  const byX = new Map<string, SeriesRow>();
  const seriesKeys = new Set<string>();
  for (const r of rows as Array<{ x: string | number | Date; y: unknown; series?: string }>) {
    if (!r || typeof r.y !== 'number' || !Number.isFinite(r.y)) continue;
    const xLabel = formatX(r.x);
    const key = r.series ?? defaultSeries;
    seriesKeys.add(key);
    let bucket = byX.get(xLabel);
    if (!bucket) {
      bucket = { xLabel };
      byX.set(xLabel, bucket);
    }
    bucket[key] = r.y;
  }
  return {
    chartRows: Array.from(byX.values()),
    keys: Array.from(seriesKeys),
  };
}

export function formatTimeTick(value: string | number): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
      }).format(asDate);
    }
  }
  return String(value);
}

function formatX(x: string | number | Date): string {
  if (x instanceof Date) return x.toISOString();
  return String(x);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMERIC_RE = /^-?\d+(?:\.\d+)?$/;

function formatDisplayDate(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function formatCellValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isFinite(v) ? formatNumber(v) : String(v);
  if (typeof v === 'string') {
    if (ISO_DATE_RE.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return formatDisplayDate(d);
    }
    if (v.length <= 17 && NUMERIC_RE.test(v)) {
      const n = Number(v);
      if (Number.isFinite(n)) return formatNumber(n);
    }
    return v;
  }
  return toStr(v);
}

export function defaultLegendLabel(title?: string): string {
  return title?.trim() || 'value';
}

export function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  switch (typeof v) {
    case 'string':
      return v;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(v);
    default:
      return JSON.stringify(v);
  }
}

export function humanize(key: string, label: string): string {
  const src = label && label !== key ? label : key;
  return src
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Filter arbitrary rows down to finite {label, value} points (labels stringified).
 *  Shared by the bar and pie renderers. */
export function coerceLabelValueRows(data: unknown): Array<{ label: string; value: number }> {
  const rows: unknown[] = Array.isArray(data) ? data : [];
  const out: Array<{ label: string; value: number }> = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const { label, value } = r as Record<string, unknown>;
    if (
      (typeof label === 'string' || typeof label === 'number') &&
      typeof value === 'number' &&
      Number.isFinite(value)
    ) {
      out.push({ label: String(label), value });
    }
  }
  return out;
}
