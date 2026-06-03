import type { ScatterData } from '@xyne/shared';
import { ReactElement } from 'react';
import {
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CHART_GRID_DASH,
  CHART_GRID_STROKE_COLOR,
  CHART_LEGEND_HEIGHT,
  CHART_LEGEND_ICON_SIZE,
  CHART_LEGEND_STYLE,
  CHART_MARGIN,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_CONTENT_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_WRAPPER_STYLE,
  CHART_YAXIS_WIDTH,
  DASHBOARD_SERIES_COLORS,
} from './constants';
import { defaultLegendLabel } from './utils';

interface ScatterRendererProps {
  data: ScatterData;
  title?: string;
}

type Point = { x: number; y: number; series: string };

const ScatterRenderer = ({ data, title }: ScatterRendererProps): ReactElement => {
  const defaultSeries = defaultLegendLabel(title);
  const points: Point[] = [];
  if (Array.isArray(data)) {
    for (const item of data as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const row = item as { x?: unknown; y?: unknown; series?: unknown };
      if (typeof row.y !== 'number' || !Number.isFinite(row.y)) continue;
      const xNum = typeof row.x === 'number' ? row.x : Number.parseFloat(String(row.x));
      if (!Number.isFinite(xNum)) continue;
      const series =
        typeof row.series === 'string' && row.series.length > 0 ? row.series : defaultSeries;
      points.push({ x: xNum, y: row.y, series });
    }
  }
  const seriesGroups = new Map<string, Point[]>();
  for (const p of points) {
    let bucket = seriesGroups.get(p.series);
    if (!bucket) {
      bucket = [];
      seriesGroups.set(p.series, bucket);
    }
    bucket.push(p);
  }
  const seriesEntries = Array.from(seriesGroups.entries());

  if (points.length === 0) {
    return (
      <div className='flex items-center justify-center h-full text-xs text-muted-foreground'>
        No rows to plot.
      </div>
    );
  }

  return (
    <div className='h-full w-full p-2'>
      <ResponsiveContainer width='100%' height='100%'>
        <ScatterChart margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={CHART_GRID_STROKE_COLOR} />
          <XAxis
            type='number'
            dataKey='x'
            name='x'
            tick={CHART_TICK_STYLE}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type='number'
            dataKey='y'
            name='y'
            tick={CHART_TICK_STYLE}
            axisLine={false}
            tickLine={false}
            width={CHART_YAXIS_WIDTH}
          />
          <Tooltip
            wrapperStyle={CHART_TOOLTIP_WRAPPER_STYLE}
            contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            cursor={{ strokeDasharray: CHART_GRID_DASH, stroke: 'var(--border)' }}
          />
          {seriesEntries.length > 1 && (
            <Legend
              verticalAlign='top'
              height={CHART_LEGEND_HEIGHT}
              iconSize={CHART_LEGEND_ICON_SIZE}
              iconType='circle'
              wrapperStyle={CHART_LEGEND_STYLE}
              formatter={value => (
                <span className='text-xs font-normal text-foreground ml-1 mr-3'>{value}</span>
              )}
            />
          )}
          {seriesEntries.map(([name, pts], idx) => (
            <Scatter
              key={name}
              name={name}
              data={pts}
              fill={DASHBOARD_SERIES_COLORS[idx % DASHBOARD_SERIES_COLORS.length]}
              isAnimationActive={false}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ScatterRenderer;
