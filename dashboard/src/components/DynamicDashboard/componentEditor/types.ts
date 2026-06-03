import { QueryVisualizationType, type WhereClause } from '@xyne/shared';
import type { DataSourceColumn } from '../../../services/DynamicDashboard/dataSourceSchemaService';

export interface MeasureRow {
  id: string;
  column: string;
  op: AggregationOp;
  alias?: string;
  filter?: WhereClause;
}

export interface GroupByRow {
  id: string;
  column: string;
  alias?: string;
  bucket?: TimeBucket;
}

export interface FilterRow {
  id: string;
  column: string;
  op: FilterOp;
  value: string;
}

export interface OrderByRow {
  id: string;
  column: string;
  dir: 'asc' | 'desc';
}

export interface JoinRow {
  id: string;
  model: string;
  type: 'inner' | 'left';
  on: { from: string; to: string };
  alias?: string;
}

export interface ScopedColumn {
  table: string;
  isBase: boolean;
  columnName: string;
  dataTypeCanonical: DataSourceColumn['dataTypeCanonical'];
  value: string;
}

export type AggregationOp = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max';

export type TimeBucket = 'day' | 'week' | 'month' | 'quarter' | 'year';

export type FilterOp =
  | 'equals'
  | 'not'
  | 'in'
  | 'notIn'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'isNull'
  | 'notNull';

export type ColumnKind = { dataTypeCanonical: DataSourceColumn['dataTypeCanonical'] };

export const ALL_TYPES: ReadonlyArray<{
  value: QueryVisualizationType;
  label: string;
  description: string;
}> = [
  { value: QueryVisualizationType.KPI, label: 'KPI', description: 'A single big number' },
  {
    value: QueryVisualizationType.KPI_COMPARE,
    label: 'KPI compare',
    description: 'Two periods, one delta',
  },
  { value: QueryVisualizationType.BAR_CHART, label: 'Bar', description: 'Compare categories' },
  { value: QueryVisualizationType.PIE_CHART, label: 'Pie', description: 'Share of total' },
  { value: QueryVisualizationType.LINE_CHART, label: 'Line', description: 'Trend over time' },
  {
    value: QueryVisualizationType.AREA_CHART,
    label: 'Area',
    description: 'Filled trend over time',
  },
  { value: QueryVisualizationType.SCATTER_CHART, label: 'Scatter', description: 'x/y correlation' },
  { value: QueryVisualizationType.DATA_TABLE, label: 'Table', description: 'Raw rows' },
];

export const AGG_OPS: ReadonlyArray<AggregationOp> = [
  'count',
  'count_distinct',
  'sum',
  'avg',
  'min',
  'max',
];

export const TIME_BUCKETS: ReadonlyArray<TimeBucket> = ['day', 'week', 'month', 'quarter', 'year'];

export const FILTER_OPS_BY_KIND: Record<DataSourceColumn['dataTypeCanonical'], FilterOp[]> = {
  numeric: ['equals', 'not', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'isNull', 'notNull'],
  text: ['equals', 'not', 'contains', 'startsWith', 'endsWith', 'in', 'notIn', 'isNull', 'notNull'],
  boolean: ['equals', 'not', 'isNull', 'notNull'],
  temporal: ['gt', 'gte', 'lt', 'lte', 'isNull', 'notNull'],
  json: ['isNull', 'notNull'],
  array: ['isNull', 'notNull'],
  binary: ['isNull', 'notNull'],
  unknown: ['equals', 'not', 'isNull', 'notNull'],
};

export const FILTER_OP_LABEL: Record<FilterOp, string> = {
  equals: '=',
  not: '≠',
  in: 'in',
  notIn: 'not in',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: 'contains',
  startsWith: 'starts with',
  endsWith: 'ends with',
  isNull: 'is empty',
  notNull: 'is not empty',
};
