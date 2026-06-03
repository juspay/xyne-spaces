import type { BarChartData } from '@xyne/shared';
import { ReactElement } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  CHART_GRID_DASH,
  CHART_GRID_STROKE_COLOR,
  CHART_MARGIN,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_CONTENT_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_WRAPPER_STYLE,
  CHART_XAXIS_MIN_TICK_GAP,
  CHART_YAXIS_WIDTH,
  DASHBOARD_SERIES_COLORS,
} from './constants';
import { defaultLegendLabel } from './utils';

interface BarChartRendererProps {
  data: BarChartData;
  title?: string;
}

const BarChartRenderer = ({ data, title }: BarChartRendererProps): ReactElement => {
  const seriesKey = defaultLegendLabel(title);
  const rows = (Array.isArray(data) ? data : [])
    .filter(
      (r): r is { label: string | number; value: number } =>
        !!r &&
        typeof r === 'object' &&
        (typeof r.label === 'string' || typeof r.label === 'number') &&
        typeof r.value === 'number' &&
        Number.isFinite(r.value),
    )
    .map(r => ({ label: String(r.label), [seriesKey]: r.value }));

  if (rows.length === 0) {
    return (
      <div className='flex items-center justify-center h-full text-xs text-muted-foreground'>
        No rows to plot.
      </div>
    );
  }

  return (
    <div className='h-full w-full p-2'>
      <ResponsiveContainer width='100%' height='100%'>
        <BarChart data={rows} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={CHART_GRID_STROKE_COLOR} />
          <XAxis
            dataKey='label'
            tick={CHART_TICK_STYLE}
            axisLine={false}
            tickLine={false}
            minTickGap={CHART_XAXIS_MIN_TICK_GAP}
          />
          <YAxis
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
            cursor={{ fill: 'var(--accent)', opacity: 0.4 }}
          />
          <Bar
            dataKey={seriesKey}
            fill={DASHBOARD_SERIES_COLORS[0]}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default BarChartRenderer;
