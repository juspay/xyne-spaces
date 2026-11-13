/**
 * The chart data contract, and the resolution of a dataset against it.
 *
 * Kept separate from components.tsx because this is the only part with real
 * logic — under jsdom a recharts component renders nothing (ResponsiveContainer
 * measures 0×0 and bails), so this is where the behaviour can actually be
 * tested.
 *
 * The contract, in one line: an array of rows, one row per category, with
 * exactly one text column and exactly one numeric column.
 *
 *   [{ stage: 'Eligible', count: 260 }, { stage: 'Contactable', count: 221 }]
 *
 * A step emitting that shape needs no props on the chart. When the data does
 * not match, resolution FAILS with a message naming the fix rather than
 * guessing a column — a guess would resolve by key insertion order, so
 * reordering keys in the emitting step would silently plot a different axis.
 */

/** One category. Text picks the axis, numbers are the series. */
export type ChartRow = Record<string, string | number | null | undefined>;

/** The shape a step should emit for a chart. */
export type ChartData = ChartRow[];

export type ChartResolution =
  | { ok: true; rows: ChartRow[]; xKey: string; yKey: string }
  | { ok: false; message: string };

/**
 * Numbers that arrived as strings still count.
 *
 * Deliberately narrow: '260' is a number that went through JSON or a driver
 * (Postgres returns int8 as a string, for one), while '23.2%' is a number that
 * was formatted too early and is text as far as a chart is concerned. Treating
 * the second as numeric would silently plot a percentage axis as NaN.
 */
const NUMERIC_TEXT = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && NUMERIC_TEXT.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const isBlank = (v: unknown): boolean => v == null || v === '';

const quote = (keys: string[]): string => keys.map((k) => `\`${k}\``).join(', ');

/**
 * Classify a column across every row.
 *
 * A column is numeric only if every value that is present parses as a number —
 * one stray label makes the whole column text, which is what stops a mixed
 * column being plotted as a half-empty series.
 */
function classify(rows: ChartRow[], key: string): 'numeric' | 'text' | 'empty' {
  let seen = false;
  let allNumeric = true;
  for (const row of rows) {
    const v = row[key];
    if (isBlank(v)) continue;
    seen = true;
    if (asNumber(v) === null) allNumeric = false;
  }
  if (!seen) return 'empty';
  return allNumeric ? 'numeric' : 'text';
}

/**
 * Resolve a dataset and optional column overrides into the axes to plot.
 *
 * `x` / `y` are escape hatches for data you do not control. Data that matches
 * the contract needs neither.
 */
export function resolveChart(
  data: unknown,
  x?: string | undefined,
  y?: string | undefined,
): ChartResolution {
  if (!Array.isArray(data)) {
    return { ok: false, message: 'Chart needs an array of rows.' };
  }
  const rows = data.filter((r): r is ChartRow => r !== null && typeof r === 'object' && !Array.isArray(r));
  if (rows.length === 0) {
    return { ok: false, message: 'No data' };
  }

  // First-seen key order, so series colour and axis choice are stable across runs.
  const cols: string[] = [];
  for (const row of rows) {
    for (const k of Object.keys(row)) if (!cols.includes(k)) cols.push(k);
  }

  const numeric = cols.filter((c) => classify(rows, c) === 'numeric');
  const text = cols.filter((c) => classify(rows, c) === 'text');

  // ── category axis ──
  let xKey: string;
  if (x != null && x !== '') {
    if (!cols.includes(x)) {
      return { ok: false, message: `Chart has no column \`${x}\`. Columns: ${quote(cols)}.` };
    }
    xKey = x;
  } else if (text.length === 1) {
    xKey = text[0] as string;
  } else if (text.length === 0) {
    return {
      ok: false,
      message: `Chart needs one text column for the category axis. Columns: ${quote(cols)} — pass x= to choose.`,
    };
  } else {
    return {
      ok: false,
      message: `Chart needs one text column, found ${quote(text)} — pass x= to choose.`,
    };
  }

  // ── series ──
  const candidates = numeric.filter((c) => c !== xKey);
  let yKey: string;
  if (y != null && y !== '') {
    if (!cols.includes(y)) {
      return { ok: false, message: `Chart has no column \`${y}\`. Columns: ${quote(cols)}.` };
    }
    if (classify(rows, y) !== 'numeric') {
      return { ok: false, message: `Column \`${y}\` is not numeric, so it cannot be plotted.` };
    }
    yKey = y;
  } else if (candidates.length === 1) {
    yKey = candidates[0] as string;
  } else if (candidates.length === 0) {
    return {
      ok: false,
      message: `Chart needs one numeric column to plot. Columns: ${quote(cols)}.`,
    };
  } else {
    // Multi-series is deferred; today this is where it lands, and when grouped
    // series arrive this branch becomes the feature rather than the error.
    return {
      ok: false,
      message: `Chart plots one series, found ${quote(candidates)} — pass y= to choose.`,
    };
  }

  return { ok: true, rows, xKey, yKey };
}

/**
 * The plotted points.
 *
 * A missing or non-numeric value becomes `null`, which recharts renders as a
 * gap. It is deliberately not 0 — a zero is a claim about the data, absence is
 * not.
 */
export function chartPoints(
  rows: ChartRow[],
  xKey: string,
  yKey: string,
): Array<{ label: string; value: number | null }> {
  return rows.map((row) => ({
    label: isBlank(row[xKey]) ? '' : String(row[xKey]),
    value: asNumber(row[yKey]),
  }));
}
