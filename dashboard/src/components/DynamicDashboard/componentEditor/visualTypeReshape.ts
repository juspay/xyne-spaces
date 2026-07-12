import { v4 as uuidv4 } from 'uuid';
import { QueryVisualizationType } from '@xyne/shared';
import type { DataSourceColumn } from '../../../services/DynamicDashboard/dataSourceSchemaService';
import type { GroupByRow, MeasureRow } from './types';
import { isIdLikeColumn } from './queryPlanUtils';

const NO_RESERVED: ReadonlySet<string> = new Set();

function ensureSlotMeasures(
  prev: ReadonlyArray<MeasureRow>,
  slots: ReadonlyArray<string>,
  reserved: ReadonlySet<string>,
  makePlaceholder: (alias: string) => MeasureRow,
): MeasureRow[] {
  const neededSlots = slots.filter(s => !reserved.has(s));
  const leaves = [...prev];
  const result: MeasureRow[] = [];
  neededSlots.forEach((alias, i) => {
    const leaf = leaves[i];
    result.push(leaf ? { ...leaf, alias } : makePlaceholder(alias));
  });
  for (let i = neededSlots.length; i < leaves.length; i++) {
    result.push(leaves[i]!);
  }
  return result;
}

const countPlaceholder = (alias: string): MeasureRow => ({
  id: uuidv4(),
  column: '*',
  op: 'count',
  alias,
});

function pickDefaultLabelColumn(columns: ReadonlyArray<DataSourceColumn>): string {
  return (
    columns.find(c => c.dataTypeCanonical === 'text' && !isIdLikeColumn(c.columnName))
      ?.columnName ??
    columns.find(c => c.dataTypeCanonical !== 'temporal' && !isIdLikeColumn(c.columnName))
      ?.columnName ??
    columns.find(c => c.dataTypeCanonical !== 'temporal')?.columnName ??
    ''
  );
}

function pickDefaultSeriesColumn(columns: ReadonlyArray<DataSourceColumn>): string {
  return (
    columns.find(c => c.dataTypeCanonical === 'text' && !isIdLikeColumn(c.columnName))
      ?.columnName ??
    columns.find(
      c =>
        c.dataTypeCanonical !== 'temporal' &&
        c.dataTypeCanonical !== 'numeric' &&
        !isIdLikeColumn(c.columnName),
    )?.columnName ??
    columns.find(c => c.dataTypeCanonical !== 'temporal' && c.dataTypeCanonical !== 'numeric')
      ?.columnName ??
    ''
  );
}

export function ensureKpiMeasures(
  prev: ReadonlyArray<MeasureRow>,
  reserved: ReadonlySet<string> = NO_RESERVED,
): MeasureRow[] {
  return ensureSlotMeasures(prev, ['value'], reserved, countPlaceholder);
}

export function ensureKpiCompareMeasures(
  prev: ReadonlyArray<MeasureRow>,
  reserved: ReadonlySet<string> = NO_RESERVED,
): MeasureRow[] {
  return ensureSlotMeasures(prev, ['current', 'previous'], reserved, countPlaceholder);
}

export function ensureBarOrPieMeasures(
  prev: ReadonlyArray<MeasureRow>,
  reserved: ReadonlySet<string> = NO_RESERVED,
): MeasureRow[] {
  return ensureSlotMeasures(prev, ['value'], reserved, countPlaceholder);
}

export function ensureBarOrPieGroupBy(
  prev: ReadonlyArray<GroupByRow>,
  columns: ReadonlyArray<DataSourceColumn>,
): GroupByRow[] {
  if (prev.length === 0) {
    const col = pickDefaultLabelColumn(columns);
    return col ? [{ id: uuidv4(), column: col, alias: 'label' }] : [...prev];
  }
  return prev.map((g, i) => (i === 0 ? { ...g, alias: 'label' } : g));
}

export function ensureLineOrAreaMeasures(
  prev: ReadonlyArray<MeasureRow>,
  reserved: ReadonlySet<string> = NO_RESERVED,
): MeasureRow[] {
  return ensureSlotMeasures(prev, ['y'], reserved, countPlaceholder);
}

export function ensureScatterMeasures(
  prev: ReadonlyArray<MeasureRow>,
  columns: ReadonlyArray<DataSourceColumn>,
  reserved: ReadonlySet<string> = NO_RESERVED,
): MeasureRow[] {
  const firstNumeric = columns.find(c => c.dataTypeCanonical === 'numeric')?.columnName ?? '*';
  return ensureSlotMeasures(prev, ['x', 'y'], reserved, alias => ({
    id: uuidv4(),
    column: firstNumeric,
    op: alias === 'x' ? 'sum' : 'count',
    alias,
  }));
}

export function ensureScatterGroupBy(
  prev: ReadonlyArray<GroupByRow>,
  columns: ReadonlyArray<DataSourceColumn>,
): GroupByRow[] {
  if (prev.length === 0) {
    const col = pickDefaultSeriesColumn(columns);
    return col ? [{ id: uuidv4(), column: col, alias: 'series' }] : [...prev];
  }
  return prev.map((g, i) => (i === 0 ? { ...g, alias: 'series' } : g));
}

export function ensureTimeBucketGroupBy(
  prev: ReadonlyArray<GroupByRow>,
  columns: ReadonlyArray<DataSourceColumn>,
): GroupByRow[] {
  if (prev.some(g => g.bucket)) return [...prev];
  const temporal = columns.find(c => c.dataTypeCanonical === 'temporal');
  if (!temporal) return [...prev];
  return [{ id: uuidv4(), column: temporal.columnName, alias: 'x', bucket: 'day' }];
}

export function defaultTableSelectCols(columns: ReadonlyArray<DataSourceColumn>): string[] {
  return columns.slice(0, 6).map(c => c.columnName);
}

export interface VisualTypeReshapeContext {
  columns: ReadonlyArray<DataSourceColumn>;
  wantsTimeBucket: boolean;
  selectColsLength: number;
  // Aliases owned by stashed expression measures; the reshape must not reassign
  // these to real leaf measures.
  reservedAliases?: ReadonlySet<string>;
}

export interface VisualTypeReshapeOps {
  setMeasures: (updater: (prev: MeasureRow[]) => MeasureRow[]) => void;
  setGroupBy: (updater: (prev: GroupByRow[]) => GroupByRow[]) => void;
  setSelectCols: (next: string[]) => void;
}

export function applyVisualTypeReshape(
  visualType: QueryVisualizationType,
  ctx: VisualTypeReshapeContext,
  ops: VisualTypeReshapeOps,
): void {
  const reserved = ctx.reservedAliases ?? NO_RESERVED;
  switch (visualType) {
    case QueryVisualizationType.KPI:
      ops.setMeasures(prev => ensureKpiMeasures(prev, reserved));
      break;
    case QueryVisualizationType.KPI_COMPARE:
      ops.setMeasures(prev => ensureKpiCompareMeasures(prev, reserved));
      break;
    case QueryVisualizationType.BAR_CHART:
    case QueryVisualizationType.PIE_CHART:
      ops.setMeasures(prev => ensureBarOrPieMeasures(prev, reserved));
      ops.setGroupBy(prev => ensureBarOrPieGroupBy(prev, ctx.columns));
      break;
    case QueryVisualizationType.LINE_CHART:
    case QueryVisualizationType.AREA_CHART:
      ops.setMeasures(prev => ensureLineOrAreaMeasures(prev, reserved));
      break;
    case QueryVisualizationType.SCATTER_CHART:
      ops.setMeasures(prev => ensureScatterMeasures(prev, ctx.columns, reserved));
      ops.setGroupBy(prev => ensureScatterGroupBy(prev, ctx.columns));
      break;
    case QueryVisualizationType.DATA_TABLE:
      if (ctx.selectColsLength === 0 && ctx.columns.length > 0) {
        ops.setSelectCols(defaultTableSelectCols(ctx.columns));
      }
      break;
    default:
      break;
  }
  if (ctx.wantsTimeBucket) {
    ops.setGroupBy(prev => ensureTimeBucketGroupBy(prev, ctx.columns));
  }
}
