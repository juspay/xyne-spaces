import type { PieChartData } from '@xyne/shared';
import { ReactElement } from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  CHART_LEGEND_HEIGHT,
  CHART_LEGEND_ICON_SIZE,
  CHART_LEGEND_STYLE,
  CHART_PIE_INNER_RADIUS,
  CHART_PIE_OUTER_RADIUS,
  CHART_TOOLTIP_WRAPPER_STYLE,
  DASHBOARD_SERIES_COLORS,
} from './constants';
import { ChartTooltip } from './ChartTooltip';
import { NoRows } from './NoRows';
import { coerceLabelValueRows, type UnitPosition } from './utils';

interface PieChartRendererProps {
  data: PieChartData;
  unit?: string;
  unitPosition?: UnitPosition;
}

const PieChartRenderer = ({ data, unit, unitPosition }: PieChartRendererProps): ReactElement => {
  const slices = coerceLabelValueRows(data);

  if (slices.length === 0) {
    return <NoRows />;
  }

  return (
    <div className='h-full w-full p-2'>
      <ResponsiveContainer width='100%' height='100%'>
        <PieChart>
          <Pie
            data={slices}
            dataKey='value'
            nameKey='label'
            innerRadius={CHART_PIE_INNER_RADIUS}
            outerRadius={CHART_PIE_OUTER_RADIUS}
            paddingAngle={1}
            stroke='var(--background)'
            strokeWidth={2}
            isAnimationActive={false}
          >
            {slices.map((s, idx) => (
              <Cell
                key={`${idx}-${s.label}`}
                fill={DASHBOARD_SERIES_COLORS[idx % DASHBOARD_SERIES_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            content={<ChartTooltip hideLabel unit={unit} unitPosition={unitPosition} />}
            wrapperStyle={CHART_TOOLTIP_WRAPPER_STYLE}
          />
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
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PieChartRenderer;
