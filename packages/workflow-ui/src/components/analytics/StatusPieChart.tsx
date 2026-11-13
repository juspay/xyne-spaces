import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'var(--wui-status-completed)',
  FAILED:    'var(--wui-status-failed)',
  RUNNING:   'var(--wui-status-running)',
  CANCELLED: 'var(--wui-status-pending)',
  PENDING:   'var(--wui-fg-muted)',
  SKIPPED:   'var(--wui-fg-muted)',
  EXTERNAL_WAIT: 'var(--wui-cat-integration)',
};

const STATUS_LABELS: Record<string, string> = {
  COMPLETED:     'Completed',
  FAILED:        'Failed',
  RUNNING:       'Running',
  CANCELLED:     'Cancelled',
  PENDING:       'Pending',
  SKIPPED:       'Skipped',
  EXTERNAL_WAIT: 'Paused',
};

export interface StatusPieChartProps {
  byStatus: Record<string, number>;
  height?: number;
  className?: string;
}

export function StatusPieChart({ byStatus, height = 200, className }: StatusPieChartProps) {
  const data = Object.entries(byStatus)
    .filter(([, v]) => v > 0)
    .map(([status, value]) => ({
      name: STATUS_LABELS[status] ?? status,
      value,
      color: STATUS_COLORS[status] ?? 'var(--wui-fg-muted)',
    }))
    .sort((a, b) => b.value - a.value);

  if (data.length === 0) {
    return (
      <div className={className} style={{ height }}>
        <div className="flex h-full items-center justify-center text-xs text-[var(--wui-fg-muted)]">
          No runs in this period
        </div>
      </div>
    );
  }

  return (
    <div className={className} aria-label="Status distribution" style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="45%"
            innerRadius="45%"
            outerRadius="70%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [value, name]}
            contentStyle={{
              fontSize: 12,
              background: 'var(--wui-bg)',
              border: '1px solid var(--wui-border)',
              borderRadius: 6,
            }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: 'var(--wui-fg-muted)' }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
