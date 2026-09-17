import { z } from 'zod';
import { QueryVisualizationType } from '../zero/schema';

// Per-component-type output contracts.
//
// The UI for each chart type binds to its own data schema; AI generates a
// QueryPlan whose result rows conform to that schema. This decouples the
// renderer from the query language — the chart just consumes
// `BarChartData` regardless of how the rows were produced.
//
// Convention for AI: use the QueryPlan's `alias` field on groupBy /
// select / measures to rename columns into the contract's field names.
// e.g. for BarChartData: `groupBy: [{column: 'region', alias: 'label'}]`,
// `measures: [{column: 'amount', op: 'sum', alias: 'value'}]`.

// SQL NULL handling. SQL aggregations and group-by columns frequently
// produce JS `null` in result rows:
//   • SUM/AVG/MIN/MAX over zero matching rows return NULL → 0.
//   • GROUP BY on a nullable column produces a "null bucket" row whose
//     dimension is null → "(none)".
// Without these preprocessors any chart with a nullable dimension surfaces
// as a 422 shape_mismatch and the user sees an opaque "UnprocessableEntity"
// instead of their data. Tolerance is a property of the contract.
const NULL_LABEL = '(none)';

const NullSafeNumber = z.preprocess(
  v => (v === null || v === undefined ? 0 : v),
  z.number(),
);

// Dimension columns (label / x / series) that arrive as null because the
// underlying column was nullable. Coerce to a stable string sentinel so the
// renderer can show a "(none)" bucket alongside real categories.
const NullSafeLabel = z.preprocess(
  v => (v === null || v === undefined ? NULL_LABEL : v),
  z.union([z.string(), z.number()]),
);
const NullSafeXAxis = z.preprocess(
  v => (v === null || v === undefined ? NULL_LABEL : v),
  z.union([z.string(), z.number(), z.date()]),
);
// Optional string fields (kpi.label, series in line/area/scatter) — null
// from SQL becomes `undefined` so z.optional() accepts it. Non-string,
// non-null values fall through to z.string() and produce a real error.
const NullSafeOptionalString = z.preprocess(
  v => (v === null ? undefined : v),
  z.string().optional(),
);

// ---------- Bar / Pie ----------
// Both render the same logical row shape: one categorical key + one numeric
// value. Pie chart consumers typically clamp value to >=0 in render; that's
// a UI concern, not a contract concern.
const LabelValueRowSchema = z.object({
  label: NullSafeLabel,
  value: NullSafeNumber,
});
export const BarChartDataSchema = z.array(LabelValueRowSchema);
export type BarChartData = z.infer<typeof BarChartDataSchema>;
export const PieChartDataSchema = z.array(LabelValueRowSchema);
export type PieChartData = z.infer<typeof PieChartDataSchema>;

// ---------- Line / Area ----------
// Time-series: ordered x-axis (typically date_trunc'd to day/week/month via
// the QueryPlan `bucket` modifier) + numeric y. Optional `series` for
// multi-line charts (grouped by an additional dimension).
const SeriesRowSchema = z.object({
  // Date strings come back from `date_trunc` as ISO timestamps via the pg
  // driver; numeric x is also valid (e.g. day-of-week as integer).
  x: NullSafeXAxis,
  y: NullSafeNumber,
  series: NullSafeOptionalString,
});
export const LineChartDataSchema = z.array(SeriesRowSchema);
export type LineChartData = z.infer<typeof LineChartDataSchema>;
export const AreaChartDataSchema = z.array(SeriesRowSchema);
export type AreaChartData = z.infer<typeof AreaChartDataSchema>;

// ---------- KPI ----------
// Single scalar. The query should produce exactly one row containing the
// `value` field; we coerce the row[0] shape rather than asking AI to know
// about array-vs-scalar quirks.
export const KpiDataSchema = z.object({
  value: NullSafeNumber,
  label: NullSafeOptionalString,
});
export type KpiData = z.infer<typeof KpiDataSchema>;

// ---------- KPI Compare ----------
// Two scalars for current vs. previous-period comparison. `deltaPct` is
// optional — renderer computes it from current/previous if absent.
export const KpiCompareDataSchema = z.object({
  current: NullSafeNumber,
  previous: NullSafeNumber,
  label: NullSafeOptionalString,
  deltaPct: z.number().optional(),
});
export type KpiCompareData = z.infer<typeof KpiCompareDataSchema>;

// ---------- Scatter ----------
// X/Y correlation plot. Each point has a numeric y-axis value and an x
// value (numeric or categorical string). An optional `series` string
// groups points into coloured series — useful for multi-group correlations.
//
// QueryPlan convention: use two measures aliased `x` and `y`; add an
// optional groupBy (aliased `series`) for the colour dimension.
// e.g. measures: [{column: 'revenue', op: 'sum', alias: 'x'},
//                 {column: 'order_count', op: 'count', alias: 'y'}]
const NullSafeScatterX = z.preprocess(
  v => (v === null || v === undefined ? 0 : v),
  z.union([z.number(), z.string()]),
);
const ScatterPointSchema = z.object({
  x: NullSafeScatterX,
  y: NullSafeNumber,
  series: NullSafeOptionalString,
});
export const ScatterDataSchema = z.array(ScatterPointSchema);
export type ScatterData = z.infer<typeof ScatterDataSchema>;

// ---------- Table ----------
// Generic tabular output. `columns` describes the header (label + a type
// hint the renderer uses for alignment + formatting); `rows` is raw rows
// keyed by `columns[i].key`. Loosest schema in the set because tables are
// meant to surface arbitrary query output.
export const TableColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['number', 'string', 'date', 'boolean']).optional(),
});
export const TableDataSchema = z.object({
  // Empty `columns` is allowed when the table filtered down to zero
  // matching rows. The renderer short-circuits on `rows.length === 0`
  // and shows a "No rows" empty state instead of trying to render a
  // header from columns. Keeping min(1) turned the empty-filter case
  // into a 422 shape_mismatch which manifested as a stuck skeleton.
  columns: z.array(TableColumnSchema),
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type TableData = z.infer<typeof TableDataSchema>;

// ---------- Component-type → schema map ----------
// Mirrors the `componentType` values stored in dashboard_components.
// Adding a new chart type = one entry here + one Schema above + the matching
// UI renderer.
export function getDataSchemaForComponent(
  componentType: QueryVisualizationType,
): z.ZodTypeAny | null {
  switch (componentType) {
    case QueryVisualizationType.BAR_CHART:
      return BarChartDataSchema;
    case QueryVisualizationType.LINE_CHART:
      return LineChartDataSchema;
    case QueryVisualizationType.AREA_CHART:
      return AreaChartDataSchema;
    case QueryVisualizationType.PIE_CHART:
      return PieChartDataSchema;
    case QueryVisualizationType.KPI:
      return KpiDataSchema;
    case QueryVisualizationType.KPI_COMPARE:
      return KpiCompareDataSchema;
    case QueryVisualizationType.SCATTER_CHART:
      return ScatterDataSchema;
    case QueryVisualizationType.DATA_TABLE:
      return TableDataSchema;
    case QueryVisualizationType.DONUT_CHART:
    case QueryVisualizationType.FUNNEL:
    case QueryVisualizationType.HEATMAP:
      return null;
  }
}

export const SCALAR_OUTPUT_COMPONENT_TYPES: ReadonlySet<QueryVisualizationType> = new Set([
  QueryVisualizationType.KPI,
  QueryVisualizationType.KPI_COMPARE,
]);
