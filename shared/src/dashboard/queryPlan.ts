import { z } from 'zod';

// AI-emitted query plan for a single dashboard component.
//
// Shape is intentionally Prisma-flavored (`model` / `where` / `take` / `skip`
// / `orderBy`) because LLMs are heavily trained on Prisma's JSON. The one
// deliberate departure: analytical aggregations live in a flat top-level
// `measures: [{ column, op, alias? }]` array instead of Prisma's nested
// `_count`/`_sum`/`_avg` operators — flat is cleaner for chart concepts
// and AI emits the flat form more reliably.
//
// Scope: single base table + optional INNER/LEFT joins along introspected
// FK relationships. The compiler still rejects sub-queries, CTEs, window
// functions — anything beyond what the JOIN form expresses.

export const AggregationOpSchema = z.enum([
  'count',
  'count_distinct',
  'sum',
  'avg',
  'min',
  'max',
]);
export type AggregationOp = z.infer<typeof AggregationOpSchema>;

// MeasureSchema is defined further down (after WhereClauseSchema) so the
// optional `filter` can reference the recursive where shape. Search for
// `export const MeasureSchema =` to find it.

export const OrderBySchema = z.object({
  // Refers to either a real column on the model or an alias of a `select`
  // entry, `groupBy` entry, or measure. The compiler resolves aliases when
  // emitting SQL.
  column: z.string().min(1),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
export type OrderBy = z.infer<typeof OrderBySchema>;

// Time-bucket modifier on a groupBy entry. Maps to `date_trunc('bucket', col)`
// in Postgres. AI uses this for line/area charts where the x-axis is time —
// e.g. `groupBy: [{ column: 'placed_at', alias: 'x', bucket: 'day' }]`
// produces one bucket per day instead of one bucket per timestamp.
export const TimeBucketSchema = z.enum(['day', 'week', 'month', 'quarter', 'year']);
export type TimeBucket = z.infer<typeof TimeBucketSchema>;

// A column entry on `select` or `groupBy`. Plain string = the column name;
// object form supports renaming the output column to match a contract
// (e.g. `{ column: 'shipping_country', alias: 'label' }` for BarChartData).
// `bucket` is only valid on groupBy entries (compiler rejects it on select).
export const ColumnRefSchema = z.union([
  z.string().min(1),
  z.object({
    column: z.string().min(1),
    alias: z.string().min(1).optional(),
    bucket: TimeBucketSchema.optional(),
  }),
]);
export type ColumnRef = z.infer<typeof ColumnRefSchema>;

// Filter operators. Mirrors Prisma's where-operator surface, narrowed to the
// ones an analytics UI actually needs.
export const FilterOpSchema = z.enum([
  'equals',
  'not',
  'in',
  'notIn',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'startsWith',
  'endsWith',
  'isNull',
  'notNull',
]);
export type FilterOp = z.infer<typeof FilterOpSchema>;

// A single-column condition. Value is unused for isNull / notNull.
export const ColumnFilterSchema = z.object({
  column: z.string().min(1),
  op: FilterOpSchema,
  // For `in` / `notIn` this MUST be an array. For string ops a string. For
  // numeric/date comparisons a number/string. The compiler enforces shape.
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.union([z.string(), z.number(), z.boolean()])),
    ])
    .optional(),
});
export type ColumnFilter = z.infer<typeof ColumnFilterSchema>;

// Recursive where: either AND/OR/NOT logical groups or a leaf column filter.
// `AND` / `OR` take arrays of sub-clauses; `NOT` takes a single sub-clause.
// Top-level convention: an array implies implicit AND.
export interface WhereClause {
  AND?: WhereClause[];
  OR?: WhereClause[];
  NOT?: WhereClause;
  filter?: ColumnFilter;
}
export const WhereClauseSchema: z.ZodType<WhereClause> = z.lazy(() =>
  z
    .object({
      AND: z.array(WhereClauseSchema).optional(),
      OR: z.array(WhereClauseSchema).optional(),
      NOT: WhereClauseSchema.optional(),
      filter: ColumnFilterSchema.optional(),
    })
    .refine(
      v =>
        // At least one of the four keys must be set.
        v.AND !== undefined ||
        v.OR !== undefined ||
        v.NOT !== undefined ||
        v.filter !== undefined,
      { message: 'WhereClause must set at least one of AND/OR/NOT/filter' },
    ),
);

export const MeasureSchema = z.object({
  // Column to aggregate. For `count` with no column (COUNT(*)), set column to '*'.
  column: z.string().min(1),
  op: AggregationOpSchema,
  // Output column name in the result row. Defaults to `${op}_${column}`.
  alias: z.string().min(1).optional(),
  // Optional per-measure filter. Scopes THIS aggregate to the matching
  // rows only, leaving the plan-level WHERE unchanged. Required for
  // kpi_compare ("current vs previous period") and useful for "% of X"
  // style ratios, "active vs inactive" splits, etc.
  //
  //   measures: [
  //     { column: "total_amount", op: "sum", alias: "current",
  //       filter: { filter: { column: "placed_at", op: "gte", value: "2026-05-01" } } },
  //     { column: "total_amount", op: "sum", alias: "previous",
  //       filter: { AND: [
  //         { filter: { column: "placed_at", op: "gte", value: "2026-04-01" } },
  //         { filter: { column: "placed_at", op: "lt",  value: "2026-05-01" } },
  //       ]} }
  //   ]
  //
  // Postgres compiles to `SUM(col) FILTER (WHERE ...)` (native operator).
  // ClickHouse compiles to `sumIf(col, ...)` / `countIf(...)` (native -If
  // aggregate combinator). Plan-level WHERE still applies via AND with
  // each per-measure filter (the compiler emits both).
  filter: WhereClauseSchema.optional(),
});
export type Measure = z.infer<typeof MeasureSchema>;

// Join spec. Joins extend the base FROM clause with one or more INNER/LEFT
// joins along introspected FK relationships. The executor only allows
// joins between columns that are connected via a DataSourceRelationship
// row, so the AI can't fabricate arbitrary joins (and accidental
// cartesian products get blocked at compile time, not at run time).
//
// `from` is the column reference on the LEFT side of the join — either
// the base table or an already-joined alias. `to` is the column on the
// joined table. Both can be bare ("customer_id") or qualified
// ("orders.customer_id"). When bare, the compiler resolves left-to-right:
// base table first, then each prior join in order.
export const JoinSchema = z.object({
  model: z.string().min(1),                                   // table to join in
  schema: z.string().min(1).optional(),                       // defaults to plan.schema or source default
  type: z.enum(['inner', 'left']).default('inner'),
  on: z.object({
    from: z.string().min(1),                                  // left side column ref
    to: z.string().min(1),                                    // column on the joined table
  }),
  // Alias for the joined table. Required when joining the same table more
  // than once (e.g. self-joins) so column references stay unambiguous;
  // otherwise optional — the compiler uses `model` as the implicit alias.
  alias: z.string().min(1).optional(),
});
export type Join = z.infer<typeof JoinSchema>;

// The root plan. `dataSourceId` ties this plan to a connected source. The
// executor uses it to look up credentials + introspected metadata.
//
// `schema` is optional; when omitted, the compiler uses the source's
// default schema (`public` for Postgres). `select` is for raw-row queries;
// mutually exclusive with `measures` + `groupBy` (validated at compile
// time, not at zod parse).
//
// `joins` is optional. When present, column references throughout the
// plan (select/groupBy/measures/orderBy/where.filter) may be either
// bare ("amount") — in which case the compiler resolves against the
// base table first, then joins in order — or qualified ("orders.amount"
// or "<alias>.amount") for explicit disambiguation.
export const QueryPlanSchema = z.object({
  dataSourceId: z.string().min(1),
  schema: z.string().min(1).optional(),
  model: z.string().min(1), // table name
  joins: z.array(JoinSchema).optional(),
  select: z.array(ColumnRefSchema).optional(),
  where: WhereClauseSchema.optional(),
  groupBy: z.array(ColumnRefSchema).optional(),
  measures: z.array(MeasureSchema).optional(),
  orderBy: z.array(OrderBySchema).optional(),
  take: z.number().int().positive().max(10000).optional(),
  skip: z.number().int().nonnegative().optional(),
});
export type QueryPlan = z.infer<typeof QueryPlanSchema>;

// Helper: normalize a ColumnRef to {column, alias?, bucket?} regardless of
// whether the caller passed a bare string. Used by the compiler.
export function normalizeColumnRef(ref: ColumnRef): {
  column: string;
  alias?: string;
  bucket?: TimeBucket;
} {
  if (typeof ref === 'string') return { column: ref };
  return ref;
}
