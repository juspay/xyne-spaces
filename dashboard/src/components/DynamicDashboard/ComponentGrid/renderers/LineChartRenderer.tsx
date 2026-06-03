import type { LineChartData } from '@xyne/shared';
import { ReactElement } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
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
  CHART_STROKE_WIDTH,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_CONTENT_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_WRAPPER_STYLE,
  CHART_XAXIS_MIN_TICK_GAP,
  CHART_YAXIS_WIDTH,
  DASHBOARD_SERIES_COLORS,
} from './constants';
import { defaultLegendLabel, formatTimeTick, formatX } from './utils';

interface LineChartRendererProps {
  data: LineChartData;
  title?: string;
}

type Row = { xLabel: string; [seriesKey: string]: string | number };

const LineChartRenderer = ({ data, title }: LineChartRendererProps): ReactElement => {
  const defaultSeries = defaultLegendLabel(title);
  const rows = Array.isArray(data) ? data : [];

  const byX = new Map<string, Row>();
  const seriesKeys = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r.y !== 'number' || !Number.isFinite(r.y)) continue;
    const xLabel = formatX(r.x);
    const key = r.series ?? defaultSeries;
    seriesKeys.add(key);
    let bucket = byX.get(xLabel);
    if (!bucket) {
      bucket = { xLabel };
      byX.set(xLabel, bucket);
    }
    bucket[key] = r.y;
  }
  const chartRows = Array.from(byX.values());
  const keys = Array.from(seriesKeys);

  if (chartRows.length === 0) {
    return (
      <div className='flex items-center justify-center h-full text-xs text-muted-foreground'>
        No rows to plot.
      </div>
    );
  }

  return (
    <div className='h-full w-full p-2'>
      <ResponsiveContainer width='100%' height='100%'>
        <LineChart data={chartRows} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={CHART_GRID_STROKE_COLOR} />
          <XAxis
            dataKey='xLabel'
            tickFormatter={formatTimeTick}
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
            labelFormatter={formatTimeTick}
            wrapperStyle={CHART_TOOLTIP_WRAPPER_STYLE}
            contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            cursor={{ stroke: 'var(--border)', strokeDasharray: CHART_GRID_DASH }}
          />
          {keys.length > 1 && (
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
          {keys.map((k, idx) => (
            <Line
              key={k}
              type='monotone'
              dataKey={k}
              stroke={DASHBOARD_SERIES_COLORS[idx % DASHBOARD_SERIES_COLORS.length]}
              strokeWidth={CHART_STROKE_WIDTH}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default LineChartRenderer;
