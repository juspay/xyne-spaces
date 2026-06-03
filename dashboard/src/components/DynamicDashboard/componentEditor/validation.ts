import { QueryVisualizationType } from '@xyne/shared';
import type { AggregationOp, FilterOp } from './types';

export function isColumnCompatibleWithOp(
  dataTypeCanonical: string | undefined,
  op: AggregationOp,
): boolean {
  if (!dataTypeCanonical) return false;
  switch (op) {
    case 'count':
    case 'count_distinct':
      return true;
    case 'sum':
    case 'avg':
      return dataTypeCanonical === 'numeric';
    case 'min':
    case 'max':
      return dataTypeCanonical === 'numeric' || dataTypeCanonical === 'temporal';
  }
}

export function chartTypeUnsupportedReason(
  visualType: QueryVisualizationType,
  columns: ReadonlyArray<{ dataTypeCanonical: string }>,
): string | null {
  const has = (typ: string): boolean => columns.some(c => c.dataTypeCanonical === typ);
  switch (visualType) {
    case QueryVisualizationType.LINE_CHART:
    case QueryVisualizationType.AREA_CHART:
      if (!has('temporal')) return 'No date/time column on this table.';
      if (!has('numeric')) return 'No numeric column to plot.';
      return null;
    case QueryVisualizationType.SCATTER_CHART:
      if (!has('numeric')) return 'Scatter needs numeric columns.';
      return null;
    case QueryVisualizationType.BAR_CHART:
    case QueryVisualizationType.PIE_CHART:
      if (!columns.some(c => c.dataTypeCanonical === 'text')) {
        return 'No text column for the label.';
      }
      return null;
    case QueryVisualizationType.KPI:
    case QueryVisualizationType.KPI_COMPARE:
    case QueryVisualizationType.DATA_TABLE:
      return null;
    default:
      return null;
  }
}

export function isColumnCompatibleWithGroupBy(
  dataTypeCanonical: string | undefined,
  visualType: QueryVisualizationType,
): boolean {
  if (!dataTypeCanonical) return false;
  switch (visualType) {
    case QueryVisualizationType.LINE_CHART:
    case QueryVisualizationType.AREA_CHART:
      return dataTypeCanonical === 'temporal';
    case QueryVisualizationType.BAR_CHART:
    case QueryVisualizationType.PIE_CHART:
    case QueryVisualizationType.SCATTER_CHART:
      return dataTypeCanonical === 'text';
    default:
      return true;
  }
}

export function isUnaryOp(op: FilterOp): boolean {
  return op === 'isNull' || op === 'notNull';
}
