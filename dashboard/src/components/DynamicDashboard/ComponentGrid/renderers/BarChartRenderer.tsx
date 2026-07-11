import type { BarChartData } from '@xyne/shared';
import { ReactElement } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  CHART_GRID_DASH,
  CHART_GRID_STROKE_COLOR,
  CHART_MARGIN,
  CHART_MAX_BAR_SIZE_PX,
  CHART_MIN_BAR_SLOT_PX,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_WRAPPER_STYLE,
  CHART_XAXIS_MIN_TICK_GAP,
  CHART_YAXIS_WIDTH,
  DASHBOARD_SERIES_COLORS,
} from './constants';
import { ChartTooltip } from './ChartTooltip';
import { NoRows } from './NoRows';
import {
  coerceLabelValueRows,
  defaultLegendLabel,
  formatKpiValue,
  type UnitPosition,
} from './utils';

interface BarChartRendererProps {
  data: BarChartData;
  title?: string;
  unit?: string;
  unitPosition?: UnitPosition;
}

const BarChartRenderer = ({
  data,
  title,
  unit,
  unitPosition,
}: BarChartRendererProps): ReactElement => {
  const seriesKey = defaultLegendLabel(title);
  const yTick = (v: number): string => formatKpiValue(v, unit, unitPosition);
  const rows = coerceLabelValueRows(data)
    .sort((a, b) => b.value - a.value)
    .map(r => ({ label: r.label, [seriesKey]: r.value }));

  if (rows.length === 0) {
    return <NoRows />;
  }

  const minContentWidth = rows.length * CHART_MIN_BAR_SLOT_PX + CHART_YAXIS_WIDTH;

  return (
    <div className='h-full w-full overflow-x-auto overflow-y-hidden p-2'>
      <div className='h-full' style={{ minWidth: minContentWidth }}>
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
              tickFormatter={yTick}
              axisLine={false}
              tickLine={false}
              width={CHART_YAXIS_WIDTH}
            />
            <Tooltip
              content={<ChartTooltip unit={unit} unitPosition={unitPosition} />}
              wrapperStyle={CHART_TOOLTIP_WRAPPER_STYLE}
              cursor={{ fill: 'var(--accent)', opacity: 0.4 }}
            />
            <Bar
              dataKey={seriesKey}
              fill={DASHBOARD_SERIES_COLORS[0]}
              radius={[4, 4, 0, 0]}
              maxBarSize={CHART_MAX_BAR_SIZE_PX}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default BarChartRenderer;
