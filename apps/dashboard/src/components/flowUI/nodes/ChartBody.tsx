import React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartProps } from '@xyne/shared';
import { ChartTooltip } from '../../DynamicDashboard/ComponentGrid/renderers/ChartTooltip';
import { CHART_GRID_DASH } from '../../DynamicDashboard/ComponentGrid/renderers/constants';

const CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 } as const;
const Y_AXIS_WIDTH = 32;

const AXIS_TEXT_COLOR = 'hsl(var(--muted-foreground))';
const GRID_STROKE_COLOR = 'hsl(var(--border))';
const CURSOR_FILL_COLOR = 'hsl(var(--accent))';
const TICK_STYLE = {
  fill: AXIS_TEXT_COLOR,
  fontSize: 11,
  fontFamily: '"Geist Mono", monospace',
} as const;

const SERIES_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];
const seriesColor = (index: number): string =>
  SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0]!;

const VALUE_LABEL_STYLE = { fill: AXIS_TEXT_COLOR, fontSize: 11 } as const;
const LEGEND_STYLE = { fontSize: 11, color: AXIS_TEXT_COLOR } as const;

function compactValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
}

function pivotSeries(rows: ReadonlyArray<{ x: string; y: number; series?: string | undefined }>): {
  data: Array<Record<string, string | number>>;
  names: string[];
} {
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
}

const axisProps = { tick: TICK_STYLE, tickLine: false, axisLine: false } as const;
const gridProps = {
  strokeDasharray: CHART_GRID_DASH,
  stroke: GRID_STROKE_COLOR,
  vertical: false,
} as const;

const ChartBody: React.FC<{ props: ChartProps; height: number }> = ({ props, height }) => {
  if (props.type === 'line' || props.type === 'area') {
    const { data, names } = pivotSeries(props.series);
    const multi = names.length > 1;
    return (
      <ResponsiveContainer width='100%' height={height}>
        {props.type === 'line' ? (
          <LineChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey='x' {...axisProps} />
            <YAxis {...axisProps} width={Y_AXIS_WIDTH} tickFormatter={compactValue} />
            <Tooltip content={<ChartTooltip />} />
            {multi && <Legend wrapperStyle={LEGEND_STYLE} />}
            {names.map((name, index) => (
              <Line
                key={name}
                type='monotone'
                dataKey={name}
                stroke={seriesColor(index)}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        ) : (
          <AreaChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey='x' {...axisProps} />
            <YAxis {...axisProps} width={Y_AXIS_WIDTH} tickFormatter={compactValue} />
            <Tooltip content={<ChartTooltip />} />
            {multi && <Legend wrapperStyle={LEGEND_STYLE} />}
            {names.map((name, index) => (
              <Area
                key={name}
                type='monotone'
                dataKey={name}
                stroke={seriesColor(index)}
                fill={seriesColor(index)}
                fillOpacity={0.2}
                strokeWidth={2}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        )}
      </ResponsiveContainer>
    );
  }

  if (props.type === 'pie' || props.type === 'donut') {
    return (
      <ResponsiveContainer width='100%' height={height}>
        <PieChart>
          <Tooltip content={<ChartTooltip />} />
          <Legend wrapperStyle={LEGEND_STYLE} />
          <Pie
            data={props.points}
            dataKey='value'
            nameKey='label'
            innerRadius={props.type === 'donut' ? '55%' : 0}
            outerRadius='80%'
            isAnimationActive={false}
          >
            {props.points.map((point, index) => (
              <Cell
                key={point.label}
                fill={seriesColor(index)}
                stroke='hsl(var(--card))'
                strokeWidth={2}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width='100%' height={height}>
      <BarChart data={props.points} margin={CHART_MARGIN}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey='label' {...axisProps} />
        <YAxis hide />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: CURSOR_FILL_COLOR, opacity: 0.4 }} />
        <Bar
          dataKey='value'
          fill={seriesColor(0)}
          radius={[4, 4, 0, 0]}
          maxBarSize={48}
          isAnimationActive={false}
        >
          <LabelList
            dataKey='value'
            position='top'
            formatter={compactValue}
            style={VALUE_LABEL_STYLE}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

export default ChartBody;
