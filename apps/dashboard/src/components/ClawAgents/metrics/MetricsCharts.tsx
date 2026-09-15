import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('common');
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
      <MetricsCard
        title={t('metricsCharts.runsByDayTitle')}
        description={t('metricsCharts.runsByDayDescription')}
      >
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
            <Bar
              dataKey='Completed'
              name={t('metricsCharts.completedLabel')}
              stackId='runs'
              fill='#22c55e'
            />
            <Bar
              dataKey='Failed'
              name={t('metricsCharts.failedLabel')}
              stackId='runs'
              fill='#ef4444'
            />
            <Bar
              dataKey='Cancelled'
              name={t('metricsCharts.cancelledLabel')}
              stackId='runs'
              fill='#94a3b8'
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </MetricsCard>

      <div className='grid gap-5 lg:grid-cols-2'>
        <MetricsCard
          title={t('metricsCharts.typicalRunTimeOverTimeTitle')}
          description={t('metricsCharts.typicalRunTimeOverTimeDescription')}
        >
          <DurationLineChart
            data={p50}
            dataKey={t('metricsCharts.typicalRunP50Label')}
            color='#3b82f6'
          />
        </MetricsCard>
        <MetricsCard
          title={t('metricsCharts.slowTailOverTimeTitle')}
          description={t('metricsCharts.slowTailOverTimeDescription')}
        >
          <DurationLineChart
            data={p95}
            dataKey={t('metricsCharts.slowTailP95Label')}
            color='#ef4444'
          />
        </MetricsCard>
      </div>

      <MetricsCard
        title={t('metricsCharts.llmTimeVsToolTimeTitle')}
        description={t('metricsCharts.llmTimeVsToolTimeDescription')}
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
            <Bar
              dataKey='avgLlmTime'
              name={t('metricsCharts.avgLlmTimeLabel')}
              stackId='time'
              fill='#6366f1'
            />
            <Bar
              dataKey='avgToolTime'
              name={t('metricsCharts.avgToolTimeLabel')}
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
