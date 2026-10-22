import type { FlowComponentLike, FlowTextNormalizationOptions } from '@/src/utils/flowJsonMarkdown';

export type ChartKind = 'bar' | 'pie' | 'donut' | 'line' | 'area';

export type ChartPoint = {
  label: string;
  value: number;
};

export type ChartSeriesPoint = {
  x: string;
  y: number;
  series?: string;
};

// One union member per kind (distributed over K) so `kind` checks narrow in
// else-branches; a multi-literal `kind` member survives a `!== 'bar'` check.
type ChartViewModelFor<K extends ChartKind> = K extends 'line' | 'area'
  ? { kind: K; series: ChartSeriesPoint[]; caption?: string; fallbackText: string }
  : { kind: K; points: ChartPoint[]; caption?: string; fallbackText: string };

export type ChartViewModel = ChartViewModelFor<ChartKind>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const parseFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
};

export const compactChartValue = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
};

export const parseChartPoints = (value: unknown): ChartPoint[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map(raw => {
      const label = optionalString(raw['label']);
      const num = parseFiniteNumber(raw['value']);
      if (!label || num === null) return null;
      return { label, value: num };
    })
    .filter((point): point is ChartPoint => point !== null);
};

export const parseChartSeries = (value: unknown): ChartSeriesPoint[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map(raw => {
      const x = optionalString(raw['x']);
      const y = parseFiniteNumber(raw['y']);
      if (!x || y === null) return null;
      const series = optionalString(raw['series']);
      return series ? { x, y, series } : { x, y };
    })
    .filter((point): point is ChartSeriesPoint => point !== null);
};

/** Pivot series rows by x — preserve first-seen order of x and series names. */
export const pivotChartSeries = (
  rows: ReadonlyArray<ChartSeriesPoint>,
): { data: Array<Record<string, string | number>>; names: string[] } => {
  const names: string[] = [];
  const byX = new Map<string, Record<string, string | number>>();
  for (const row of rows) {
    const name = row.series ?? 'value';
    if (!names.includes(name)) names.push(name);
    const existing = byX.get(row.x) ?? { x: row.x };
    existing[name] = row.y;
    byX.set(row.x, existing);
  }
  return { data: [...byX.values()], names };
};

export const createChartViewModel = (component: FlowComponentLike): ChartViewModel | null => {
  if (component.type !== 'chart') return null;
  const props = isRecord(component.props) ? component.props : undefined;
  const kind = optionalString(props?.['type']);
  if (!kind) return null;
  const caption = optionalString(props?.['caption']);

  if (kind === 'line' || kind === 'area') {
    const series = parseChartSeries(props?.['series']);
    if (series.length === 0) return null;
    const fallbackText = series.map(point => `${point.x}: ${point.y}`).join('\n');
    return caption ? { kind, series, caption, fallbackText } : { kind, series, fallbackText };
  }

  if (kind === 'bar' || kind === 'pie' || kind === 'donut') {
    const points = parseChartPoints(props?.['points']);
    if (points.length === 0) return null;
    const fallbackText = points.map(point => `${point.label}: ${point.value}`).join('\n');
    return caption ? { kind, points, caption, fallbackText } : { kind, points, fallbackText };
  }

  return null;
};

export const findChartComponent = (
  components: FlowComponentLike[] | undefined,
): FlowComponentLike | undefined => {
  if (!components) return undefined;
  for (const component of components) {
    if (component.type === 'chart') return component;
    const nested = findChartComponent(component.children);
    if (nested) return nested;
  }
  return undefined;
};

export const isChartFlow = (flow: { components?: FlowComponentLike[] | undefined }): boolean =>
  findChartComponent(flow.components) !== undefined;

export const chartComponentToMarkdown = (
  component: FlowComponentLike,
  _options: FlowTextNormalizationOptions = {},
): string => {
  const viewModel = createChartViewModel(component);
  if (!viewModel) return '';

  const lines = [`**Chart** (${viewModel.kind})`];
  if (viewModel.caption) lines.push(viewModel.caption);

  if (viewModel.kind === 'line' || viewModel.kind === 'area') {
    for (const point of viewModel.series) {
      const series = point.series ? ` [${point.series}]` : '';
      lines.push(`- ${point.x}${series}: ${compactChartValue(point.y)}`);
    }
  } else {
    for (const point of viewModel.points) {
      lines.push(`- ${point.label}: ${compactChartValue(point.value)}`);
    }
  }

  return lines.join('\n\n');
};

export const chartNotificationPreview = (viewModel: ChartViewModel): string =>
  viewModel.caption ? `📊 ${viewModel.caption}` : '📊 Shared a chart';
