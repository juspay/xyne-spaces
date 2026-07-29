import { ReactElement } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { GlobalMetricsDayBucket } from '@/services/claw/clawMetricsTypes';
import { MetricsCard } from './MetricsCard';
import { formatMs } from './formatters';

const CHART_HEIGHT = 240;
const tick = { fontSize: 11, fill: 'currentColor', opacity: 0.65 };

const DurationLineChart = ({
  data,
  dataKey,
  color,
}: {
  data: Array<{ day: string; value: number | null }>;
  dataKey: string;
  color: string;
}): ReactElement => (
  <ResponsiveContainer width='100%' height={CHART_HEIGHT}>
    <LineChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
      <CartesianGrid strokeDasharray='3 3' opacity={0.1} vertical={false} />
      <XAxis dataKey='day' tick={tick} tickLine={false} />
      <YAxis
        tick={tick}
        tickLine={false}
        width={56}
        tickFormatter={value => formatMs(Number(value))}
      />
      <Tooltip formatter={value => formatMs(Number(value))} />
      <Line
        type='monotone'
        dataKey='value'
        name={dataKey}
        stroke={color}
        strokeWidth={2.5}
        dot={{ r: 3, fill: color }}
        activeDot={{ r: 5 }}
        connectNulls
        isAnimationActive={false}
      />
    </LineChart>
  </ResponsiveContainer>
);

export const MetricsCharts = ({ perDay }: { perDay: GlobalMetricsDayBucket[] }): ReactElement => {
  const outcomes = perDay.map(day => ({
    day: day.day.slice(5),
    Completed: day.completed,
    Failed: day.failed,
    Cancelled: day.cancelled,
  }));
  const p50 = perDay.map(day => ({ day: day.day.slice(5), value: day.p50TotalMs }));
  const p95 = perDay.map(day => ({ day: day.day.slice(5), value: day.p95TotalMs }));
  const split = perDay.map(day => ({
    day: day.day.slice(5),
    avgLlmTime: day.avgLlmMs ?? 0,
    avgToolTime: day.avgToolMs ?? 0,
  }));

  return (
    <>
      <MetricsCard title='Runs by day' description='Daily runs stacked by outcome.'>
        <ResponsiveContainer width='100%' height={CHART_HEIGHT}>
          <BarChart data={outcomes} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray='3 3' opacity={0.1} vertical={false} />
            <XAxis dataKey='day' tick={tick} tickLine={false} />
            <YAxis tick={tick} tickLine={false} width={40} allowDecimals={false} />
            <Tooltip />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
              verticalAlign='top'
              align='left'
            />
            <Bar dataKey='Completed' stackId='runs' fill='#22c55e' />
            <Bar dataKey='Failed' stackId='runs' fill='#ef4444' />
            <Bar dataKey='Cancelled' stackId='runs' fill='#94a3b8' radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </MetricsCard>

      <div className='grid gap-5 lg:grid-cols-2'>
        <MetricsCard
          title='Typical run time over time'
          description='p50 — half of runs completed faster than this each day.'
        >
          <DurationLineChart data={p50} dataKey='Typical run (p50)' color='#3b82f6' />
        </MetricsCard>
        <MetricsCard title='Slow tail over time' description='p95 — the slowest 5% each day.'>
          <DurationLineChart data={p95} dataKey='Slow tail (p95)' color='#ef4444' />
        </MetricsCard>
      </div>

      <MetricsCard
        title='LLM time vs tool time'
        description='A growing tool segment indicates connector or tool latency; a growing LLM segment indicates model latency.'
      >
        <ResponsiveContainer width='100%' height={CHART_HEIGHT}>
          <BarChart data={split} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray='3 3' opacity={0.1} vertical={false} />
            <XAxis dataKey='day' tick={tick} tickLine={false} />
            <YAxis
              tick={tick}
              tickLine={false}
              width={56}
              tickFormatter={value => formatMs(Number(value))}
            />
            <Tooltip formatter={value => formatMs(Number(value))} />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
              verticalAlign='top'
              align='left'
            />
            <Bar dataKey='avgLlmTime' name='Avg LLM time' stackId='time' fill='#6366f1' />
            <Bar
              dataKey='avgToolTime'
              name='Avg Tool time'
              stackId='time'
              fill='#f59e0b'
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </MetricsCard>
    </>
  );
};
