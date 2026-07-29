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
  CHART_ACTIVE_DOT_RADIUS,
  CHART_GRID_DASH,
  CHART_GRID_STROKE_COLOR,
  CHART_LEGEND_HEIGHT,
  CHART_LEGEND_ICON_SIZE,
  CHART_LEGEND_STYLE,
  CHART_MARGIN,
  CHART_STROKE_WIDTH,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_WRAPPER_STYLE,
  CHART_XAXIS_MIN_TICK_GAP,
  CHART_YAXIS_WIDTH,
} from './constants';
import { ChartTooltip } from './ChartTooltip';
import { NoRows } from './NoRows';
import {
  defaultLegendLabel,
  fitYDomain,
  formatKpiValue,
  formatTimeTick,
  reshapeSeriesRows,
  seriesColor,
  type UnitPosition,
} from './utils';

interface LineChartRendererProps {
  data: LineChartData;
  title?: string;
  unit?: string;
  unitPosition?: UnitPosition;
}

const LineChartRenderer = ({
  data,
  title,
  unit,
  unitPosition,
}: LineChartRendererProps): ReactElement => {
  const defaultSeries = defaultLegendLabel(title);
  const yTick = (v: number): string => formatKpiValue(v, unit, unitPosition);
  const { chartRows, keys } = reshapeSeriesRows(data, defaultSeries);

  const yDomain = fitYDomain(chartRows, keys);

  if (chartRows.length === 0) {
    return <NoRows />;
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
            tickFormatter={yTick}
            axisLine={false}
            tickLine={false}
            width={CHART_YAXIS_WIDTH}
            domain={yDomain}
            padding={{ top: 10, bottom: 10 }}
          />
          <Tooltip
            content={
              <ChartTooltip
                labelFormatter={formatTimeTick}
                unit={unit}
                unitPosition={unitPosition}
              />
            }
            wrapperStyle={CHART_TOOLTIP_WRAPPER_STYLE}
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
              stroke={seriesColor(idx)}
              strokeWidth={CHART_STROKE_WIDTH}
              dot={false}
              activeDot={{ r: CHART_ACTIVE_DOT_RADIUS }}
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
