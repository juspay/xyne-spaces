import { z } from 'zod';


export const AggregationOpSchema = z.enum([
  'count',
  'count_distinct',
  'sum',
  'avg',
  'min',
  'max',
  'median',
  'p75',
  'p90',
  'p95',
  'p99',
  'stddev',
  'variance',
]);
export type AggregationOp = z.infer<typeof AggregationOpSchema>;

export const OrderBySchema = z.object({
  column: z.string().min(1),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
export type OrderBy = z.infer<typeof OrderBySchema>;

export const TimeBucketSchema = z.enum(['day', 'week', 'month', 'quarter', 'year']);
export type TimeBucket = z.infer<typeof TimeBucketSchema>;

export const ColumnRefSchema = z.union([
  z.string().min(1),
  z.object({
    column: z.string().min(1),
    alias: z.string().min(1).optional(),
    bucket: TimeBucketSchema.optional(),
  }),
]);
export type ColumnRef = z.infer<typeof ColumnRefSchema>;

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

export const ColumnFilterSchema = z.object({
  column: z.string().min(1),
  op: FilterOpSchema,
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

export interface WhereClause {
  AND?: WhereClause[];
  OR?: WhereClause[];
  NOT?: WhereClause;
  filter?: ColumnFilter;
}

const WHERE_SCHEMA_DEPTH = 2;
const MEASURE_FILTER_DEPTH = 1;
const EXPR_SCHEMA_DEPTH = 5;

function whereClauseAtDepth(depth: number): z.ZodType<WhereClause> {
  const child: z.ZodType<WhereClause> =
    depth <= 1
      ? (z.object({ filter: ColumnFilterSchema }).strict() as unknown as z.ZodType<WhereClause>)
      : whereClauseAtDepth(depth - 1);
  return z
    .object({
      AND: z.array(child).optional(),
      OR: z.array(child).optional(),
      NOT: child.optional(),
      filter: ColumnFilterSchema.optional(),
    })
    .refine(
      v =>
        v.AND !== undefined ||
        v.OR !== undefined ||
        v.NOT !== undefined ||
        v.filter !== undefined,
      { message: 'WhereClause must set at least one of AND/OR/NOT/filter' },
    ) as unknown as z.ZodType<WhereClause>;
}
export const WhereClauseSchema: z.ZodType<WhereClause> = whereClauseAtDepth(WHERE_SCHEMA_DEPTH);
const MeasureFilterSchema: z.ZodType<WhereClause> = whereClauseAtDepth(MEASURE_FILTER_DEPTH);

export const LeafMeasureSchema = z.object({
  column: z.string().min(1),
  op: AggregationOpSchema,
  alias: z.string().min(1).optional(),
  filter: MeasureFilterSchema.optional(),
}).strict();
export type LeafMeasure = z.infer<typeof LeafMeasureSchema>;

export type Expr =
  | { column: string }
  | { const: number }
  | { op: '+' | '-' | '*' | '/'; left: Expr; right: Expr }
  | {
      op: 'date_diff';
      unit: 'second' | 'minute' | 'hour' | 'day';
      start: { column: string };
      end: { column: string };
    }
  | { agg: AggregationOp; arg: Expr; filter?: WhereClause };

function exprAtDepth(depth: number): z.ZodType<Expr> {
  const col = z.object({ column: z.string().min(1) }).strict();
  const konst = z.object({ const: z.number() }).strict();
  if (depth <= 1) {
    return z.union([col, konst]) as unknown as z.ZodType<Expr>;
  }
  const child = exprAtDepth(depth - 1);
  const dateDiff = z
    .object({
      op: z.literal('date_diff'),
      unit: z.enum(['second', 'minute', 'hour', 'day']),
      start: col,
      end: col,
    })
    .strict();
  return z.union([
    col,
    konst,
    z.object({ op: z.enum(['+', '-', '*', '/']), left: child, right: child }).strict(),
    dateDiff,
    z.object({ agg: AggregationOpSchema, arg: child, filter: MeasureFilterSchema.optional() }).strict(),
  ]) as unknown as z.ZodType<Expr>;
}
export const ExprSchema: z.ZodType<Expr> = exprAtDepth(EXPR_SCHEMA_DEPTH);

export const ExprMeasureSchema = z.object({
  alias: z.string().min(1),
  expr: ExprSchema,
}).strict();
export type ExprMeasure = z.infer<typeof ExprMeasureSchema>;

export const MeasureSchema = z.union([
  LeafMeasureSchema.describe('Aggregate one column, e.g. sum(amount) or count(*).'),
  ExprMeasureSchema.describe(
    'Aggregate of a PER-ROW expression (sum(qty * price), avg(date_diff(...))) OR arithmetic over aggregates (sum(a) / count(b)). Wrap every aggregated column in an {agg, arg} node; never divide two sums to fake a per-row product.',
  ),
]);
export type Measure = z.infer<typeof MeasureSchema>;

export type NormalizedMeasure = { alias: string; expr: Expr };

export function normalizeMeasure(m: Measure): NormalizedMeasure {
  if ('expr' in m) return { alias: m.alias, expr: m.expr };
  const alias =
    m.alias ?? `${m.op}_${m.column === '*' ? 'all' : m.column.replace(/^.*\./, '')}`;
  const agg: Expr = {
    agg: m.op,
    arg: { column: m.column },
    ...(m.filter ? { filter: m.filter } : {}),
  };
  return { alias, expr: agg };
}

export const JoinSchema = z.object({
  model: z
    .string()
    .min(1)
    .describe('Bare table name ONLY of the joined table (e.g. "orders"), never "schema.table".'),
  schema: z
    .string()
    .min(1)
    .optional()
    .describe('Schema of the joined table (e.g. "public"). Defaults to the base table\'s schema.'),
  type: z.enum(['inner', 'left']).default('inner'),
  on: z.object({
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  alias: z.string().min(1).optional(),
});
export type Join = z.infer<typeof JoinSchema>;

export const QueryPlanSchema = z.object({
  dataSourceId: z.string().min(1),
  schema: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Schema/namespace of the table, e.g. "public" — the part BEFORE the dot in the "schema.table" names shown to you.',
    ),
  model: z
    .string()
    .min(1)
    .describe(
      'Bare table name ONLY, e.g. "tickets". Tables are displayed to you as "schema.table" (e.g. "public.tickets") — never put that whole string here; put the schema part in the "schema" field and only the bare name here.',
    ),
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

export function normalizeColumnRef(ref: ColumnRef): {
  column: string;
  alias?: string;
  bucket?: TimeBucket;
} {
  if (typeof ref === 'string') return { column: ref };
  return ref;
}
