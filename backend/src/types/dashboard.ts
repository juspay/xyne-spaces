import { z } from 'zod';

export const Aggregation = z.enum([
  'sum',
  'avg',
  'count',
  'count_distinct',
  'min',
  'max',
  'none',
]);
export type Aggregation = z.infer<typeof Aggregation>;

export const FilterOp = z.enum([
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'in',
  'not_in',
  'contains',
  'between',
  'is_null',
  'is_not_null',
]);
export type FilterOp = z.infer<typeof FilterOp>;

export const QuerySelectSchema = z.object({
  columnId: z.string(),
  aggregation: Aggregation.optional(),
  alias: z.string().optional(),     // when present, matches a ComponentTemplate alias slot
});

export const QueryFilterSchema = z.object({
  columnId: z.string(),
  op: FilterOp,
  value: z.unknown().optional(),
  dashboardFilterId: z.string().optional(),
});

export const QueryOrderRefSchema = z.union([
  z.object({ columnId: z.string() }),
  z.object({ alias: z.string() }),
]);

export const QueryOrderSchema = z.object({
  ref: QueryOrderRefSchema,
  direction: z.enum(['asc', 'desc']),
});

export const QueryPlanSchema = z.object({
  from: z.object({ tableId: z.string() }),
  joins: z.array(z.object({ relationshipId: z.string() })).optional(),
  select: z.array(QuerySelectSchema).min(1),
  filters: z.array(QueryFilterSchema).optional(),
  groupBy: z.array(z.object({ columnId: z.string() })).optional(),
  orderBy: z.array(QueryOrderSchema).optional(),
  limit: z.number().int().positive().optional(),
});
export type QueryPlan = z.infer<typeof QueryPlanSchema>;

export const DashboardFilterType = z.enum([
  'temporal',
  'categorical',
  'numeric_range',
]);
export type DashboardFilterType = z.infer<typeof DashboardFilterType>;

export const DashboardFilterSchema = z.object({
  id: z.string(),                   // referenced from component query JSON via dashboardFilterId
  name: z.string(),                 // shown in the filter bar UI
  type: DashboardFilterType,
  defaultValue: z.unknown().optional(),  // shape depends on type
});
export type DashboardFilter = z.infer<typeof DashboardFilterSchema>;

export const DashboardFiltersSchema = z.array(DashboardFilterSchema);
export type DashboardFilters = z.infer<typeof DashboardFiltersSchema>;

export const PositionSchema = z.object({
  x: z.number().int().nonnegative(),    // grid column (0-indexed)
  y: z.number().int().nonnegative(),    // grid row (0-indexed)
  w: z.number().int().positive(),       // width in grid columns (1..12)
  h: z.number().int().positive(),       // height in grid rows
});
export type Position = z.infer<typeof PositionSchema>;

export const dashboardResourceName = (id: string) => `dashboard:${id}` as const;

function jsonCodec<T>(schema: z.ZodType<T>) {
  return {
    parse: (s: string): T => schema.parse(JSON.parse(s)),
    stringify: (v: T): string => JSON.stringify(schema.parse(v)),
  };
}

export const QueryPlanCodec = jsonCodec(QueryPlanSchema);
export const DashboardFiltersCodec = jsonCodec(DashboardFiltersSchema);
export const PositionCodec = jsonCodec(PositionSchema);
