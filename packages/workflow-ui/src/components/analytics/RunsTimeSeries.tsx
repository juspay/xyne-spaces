import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import type { AnalyticsData } from '../../hooks/use-analytics.js';

type DayBucket = AnalyticsData['runsByDay'][number];

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'var(--wui-status-completed)',
  FAILED:    'var(--wui-status-failed)',
  RUNNING:   'var(--wui-status-running)',
  CANCELLED: 'var(--wui-status-pending)',
};

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: 'Completed',
  FAILED:    'Failed',
  RUNNING:   'Running',
  CANCELLED: 'Cancelled',
};

const STATUS_ORDER = ['COMPLETED', 'FAILED', 'RUNNING', 'CANCELLED'] as const;

export interface RunsTimeSeriesProps {
  data: DayBucket[];
  height?: number;
  className?: string;
}

function formatDateLabel(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function RunsTimeSeries({ data, height = 200, className }: RunsTimeSeriesProps) {
  return (
    <div className={className} aria-label="Runs per day" style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--wui-border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDateLabel}
            tick={{ fontSize: 10, fill: 'var(--wui-fg-muted)' }}
            axisLine={{ stroke: 'var(--wui-border)' }}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: 'var(--wui-fg-muted)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            labelFormatter={(label) => formatDateLabel(String(label))}
            formatter={(value, name) => [value, STATUS_LABELS[String(name)] ?? String(name)]}
            contentStyle={{
              fontSize: 12,
              background: 'var(--wui-bg)',
              border: '1px solid var(--wui-border)',
              borderRadius: 6,
            }}
          />
          <Legend
            formatter={(value: string) => STATUS_LABELS[value] ?? value}
            wrapperStyle={{ fontSize: 11, color: 'var(--wui-fg-muted)' }}
          />
          {STATUS_ORDER.map((status) => (
            <Line
              key={status}
              type="monotone"
              dataKey={status}
              stroke={STATUS_COLORS[status] ?? 'var(--wui-fg-muted)'}
              name={status}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
