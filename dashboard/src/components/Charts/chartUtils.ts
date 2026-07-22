import type { MetricConfig, ChartDataPoint, CardinalityOption } from '../../types/toolOutput';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const CHART_COLORS = [
  '#7856FF',
  '#72BEF4',
  '#FEBBB2',
  '#7FE1D8',
  '#CB80DC',
  '#5CB7AF',
  '#1E90FF',
  '#E377C2',
  '#9467BD',
  '#1F77B4',
  '#0F7EA0',
  '#17BECF',
  '#BCBD22',
  '#A0872C',
];

export const PIE_COLORS = [
  '#7074FF',
  '#F25920',
  '#96DFFF',
  '#C1B0FF',
  '#FCD2AC',
  '#FF5959',
  '#A4F3B2',
  '#AD46FF',
  '#52534E',
  '#A0A7AB',
];

export function formatLatency(ms: number): string {
  if (ms >= 3600000) return `${(ms / 3600000).toFixed(1)}H`;
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}M`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}S`;
  return `${ms.toFixed(0)}ms`;
}

export function formatIndian(value: number): string {
  if (value >= 10000000) return `${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000) return `${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString('en-IN');
}

export function formatMetricValue(metricType: string, value: number): string {
  switch (metricType) {
    case 'Rate':
      return `${value.toFixed(2)}%`;
    case 'Latency':
      return formatLatency(value);
    case 'Volume':
    case 'Count':
    case 'Amount':
      return formatIndian(value);
    default:
      return value.toLocaleString();
  }
}

export function formatMetricAxisValue(metricType: string, value: number): string {
  switch (metricType) {
    case 'Rate':
      return `${value.toFixed(0)}%`;
    case 'Latency':
      return formatLatency(value);
    case 'Volume':
    case 'Count':
    case 'Amount':
      return formatIndian(value);
    default:
      return value.toLocaleString();
  }
}

export function snakeToTitle(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function getCardinalityNumber(cardinality: CardinalityOption): number {
  switch (cardinality) {
    case 'TOP_3':
      return 3;
    case 'TOP_5':
      return 5;
    case 'TOP_10':
      return 10;
    case 'TOP_15':
      return 15;
    case 'TOP_20':
      return 20;
    default:
      return 5;
  }
}

export function getUniqueValues(data: ChartDataPoint[], key: string): string[] {
  return [...new Set(data.map(item => String(item[key] || '')).filter(Boolean))];
}

export function getTopGroups(
  data: ChartDataPoint[],
  groupKey: string,
  metricColumns: string[],
  limit: number,
): string[] {
  const totals: Record<string, number> = {};
  data.forEach(row => {
    const group = String(row[groupKey] || '');
    if (!group) return;
    const sum = metricColumns.reduce((acc, col) => acc + Number(row[col] || 0), 0);
    totals[group] = (totals[group] ?? 0) + sum;
  });
  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([g]) => g);
}

type Granularity = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';

function detectGranularity(timestamps: string[]): Granularity {
  if (timestamps.length < 2) return 'daily';
  const sorted = timestamps.map(t => new Date(t).getTime()).sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const prev = sorted[i - 1];
    if (cur !== undefined && prev !== undefined) diffs.push(cur - prev);
  }
  const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const hour = 3600000;
  const day = 86400000;
  const week = 7 * day;
  const month = 30 * day;
  if (avg <= hour * 2) return 'hourly';
  if (avg <= day * 2) return 'daily';
  if (avg <= week * 2) return 'weekly';
  if (avg <= month * 2) return 'monthly';
  return 'yearly';
}

export function formatTimestamp(ts: string): string {
  const granularity = detectGranularity([ts]);
  return formatTimestampByGranularity(ts, granularity);
}

export function formatTimestampByGranularity(ts: string, granularity: Granularity): string {
  const date = new Date(ts);
  switch (granularity) {
    case 'hourly':
      return date.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit' });
    case 'daily':
      return date.toLocaleString('en-US', { month: 'short', day: 'numeric' });
    case 'weekly':
    case 'monthly':
      return date.toLocaleString('en-US', { month: 'short', day: 'numeric' });
    case 'yearly':
      return date.getFullYear().toString();
    default:
      return ts;
  }
}

export interface ProcessedTimeSeries {
  categories: string[];
  originalTimestamps: string[];
  series: Array<{
    name: string;
    data: (number | null)[];
    color: string;
  }>;
}

export function processTimeSeriesData(
  data: ChartDataPoint[],
  timeColumn: string,
  groupbyKeys: string[],
  metricColumns: string[],
  topGroups: string[],
  labelMapper?: (label: string) => string,
): ProcessedTimeSeries {
  const allTimestamps = [...new Set(data.map(item => String(item[timeColumn])))];
  const sortedTimestamps = allTimestamps.sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );

  const granularity = detectGranularity(sortedTimestamps);
  const categories = sortedTimestamps.map(ts => formatTimestampByGranularity(ts, granularity));

  const series: ProcessedTimeSeries['series'] = [];
  const primaryGroupKey = groupbyKeys[0];

  if (!primaryGroupKey) {
    metricColumns.forEach((col, idx) => {
      const timeMap = new Map<string, number>();
      data.forEach(row => timeMap.set(String(row[timeColumn]), Number(row[col] ?? 0)));
      series.push({
        name: labelMapper ? labelMapper(col) : snakeToTitle(col),
        data: sortedTimestamps.map(ts => timeMap.get(ts) ?? null),
        color: CHART_COLORS[idx % CHART_COLORS.length] ?? CHART_COLORS[0] ?? '#7856FF',
      });
    });
  } else {
    const groups = topGroups.length > 0 ? topGroups : getUniqueValues(data, primaryGroupKey);
    const firstMetric = metricColumns[0];
    if (metricColumns.length === 1 && firstMetric !== undefined) {
      groups.forEach((group, idx) => {
        const groupData = data.filter(row => String(row[primaryGroupKey]) === group);
        const timeMap = new Map<string, number>();
        groupData.forEach(row =>
          timeMap.set(String(row[timeColumn]), Number(row[firstMetric] ?? 0)),
        );
        series.push({
          name: labelMapper ? labelMapper(group) : group,
          data: sortedTimestamps.map(ts => timeMap.get(ts) ?? null),
          color: CHART_COLORS[idx % CHART_COLORS.length] ?? CHART_COLORS[0] ?? '#7856FF',
        });
      });
    } else {
      groups.forEach((group, gIdx) => {
        metricColumns.forEach((col, mIdx) => {
          const groupData = data.filter(row => String(row[primaryGroupKey]) === group);
          const timeMap = new Map<string, number>();
          groupData.forEach(row => timeMap.set(String(row[timeColumn]), Number(row[col] ?? 0)));
          const gName = labelMapper ? labelMapper(group) : group;
          const mName = labelMapper ? labelMapper(col) : snakeToTitle(col);
          series.push({
            name: `${gName} - ${mName}`,
            data: sortedTimestamps.map(ts => timeMap.get(ts) ?? null),
            color:
              CHART_COLORS[(gIdx * metricColumns.length + mIdx) % CHART_COLORS.length] ??
              CHART_COLORS[0] ??
              '#7856FF',
          });
        });
      });
    }
  }

  return { categories, originalTimestamps: sortedTimestamps, series };
}

export function processBarData(
  rawData: Array<Record<string, string | number>>,
  groupKey: string,
  metricKey: string,
  limit: number,
): Array<{ name: string; value: number }> {
  const grouped: Record<string, number> = {};
  rawData.forEach(row => {
    const group = String(row[groupKey] || 'Unknown');
    const val = Number(row[metricKey] ?? 0);
    if (val > 0) grouped[group] = (grouped[group] ?? 0) + val;
  });
  return Object.entries(grouped)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export function formatMetricLabel(config: MetricConfig, value: number): string {
  return formatMetricValue(config.metric_type, value);
}
