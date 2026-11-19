import { useState, type ReactElement } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { Table, type ColumnDef } from '@/components/ui/Table';
import type { ArtifactAppsAnalyticsDay } from '@/services/claw/artifactAppsService';
import type { Series, View } from '../AppsAnalytics.types';
import { formatCount, formatDay, tickInterval } from '../AppsAnalytics.utils';
import { AnalyticsCard, Legend, ViewToggle } from './AnalyticsCard';

/** Plot plus x-axis band, so the axis labels never fall outside the card. */
const CHART_HEIGHT = 220;

type DayRow = ArtifactAppsAnalyticsDay & { label: string } & Record<string, unknown>;

/** Hover readout: the date, then every series at that day. Values lead, names follow. */
const DailyTooltip = ({
  active,
  payload,
  label,
  series,
}: TooltipProps<number, string> & { series: Series[] }): ReactElement | null => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as ArtifactAppsAnalyticsDay | undefined;
  if (!row) return null;
  return (
    <div className='flex min-w-36 flex-col gap-1.5 rounded-lg border border-border bg-popover px-3 py-2 shadow-md'>
      <span className='text-xs text-muted-foreground'>{label}</span>
      {series.map(s => (
        <div key={s.key} className='flex items-center gap-2'>
          {/* A short line key, not a box: at tooltip size a box is ink doing a label's job. */}
          <span
            className='h-0.5 w-3 rounded-full'
            style={{ background: s.color }}
            aria-hidden='true'
          />
          <span className='text-sm font-semibold tabular-nums text-foreground'>
            {formatCount(Number(row[s.key]))}
          </span>
          <span className='text-xs text-muted-foreground'>{s.label}</span>
        </div>
      ))}
    </div>
  );
};

/** One daily column chart (stacked when it has several series), with its table twin. */
export const DailyChartCard = ({
  title,
  subtitle,
  trackName,
  daily,
  series,
  days,
  emptyLabel,
}: {
  title: string;
  subtitle: string;
  trackName: string;
  daily: ArtifactAppsAnalyticsDay[];
  series: Series[];
  days: number;
  emptyLabel?: string;
}): ReactElement => {
  const [view, setView] = useState<View>('chart');
  const rows: DayRow[] = daily.map(d => ({ ...d, label: formatDay(d.date) }));
  const active = rows.filter(d => series.some(s => Number(d[s.key]) > 0));
  const stacked = series.length > 1;

  // The table twin: every day with activity, newest first.
  const columns: ColumnDef<DayRow>[] = [
    { field: 'label', header: 'Day (IST)' },
    ...series.map(
      (s): ColumnDef<DayRow> => ({
        field: s.key,
        header: s.label,
        className: 'text-right tabular-nums',
        headerClassName: 'text-right',
        renderCell: value => formatCount(Number(value)),
      }),
    ),
  ];

  return (
    <AnalyticsCard
      title={title}
      subtitle={subtitle}
      action={<ViewToggle view={view} onChange={setView} trackName={trackName} />}
    >
      {active.length === 0 ? (
        <p className='py-10 text-center text-sm text-muted-foreground'>
          {emptyLabel ?? 'No activity in this period.'}
        </p>
      ) : view === 'table' ? (
        <Table<DayRow>
          data={[...active].reverse()}
          columns={columns}
          idField='date'
          size='sm'
          hoverable={false}
          maxHeight={256}
          footer={
            <p className='pt-2 text-xs text-muted-foreground'>
              Days with no activity are not listed.
            </p>
          }
        />
      ) : (
        <div className='flex flex-col gap-3'>
          {stacked ? <Legend items={series} /> : null}
          <ResponsiveContainer width='100%' height={CHART_HEIGHT}>
            <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
              {/* Hairline, solid, recessive: dashed grids read as thresholds. */}
              <CartesianGrid vertical={false} stroke='var(--viz-grid)' />
              <XAxis
                dataKey='label'
                interval={tickInterval(days)}
                tickLine={false}
                axisLine={{ stroke: 'var(--viz-grid)' }}
                tick={{ fontSize: 11, fill: 'var(--viz-axis)' }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={36}
                tick={{ fontSize: 11, fill: 'var(--viz-axis)' }}
              />
              <Tooltip
                cursor={{ fill: 'var(--viz-grid)', opacity: 0.6 }}
                content={<DailyTooltip series={series} />}
              />
              {series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  maxBarSize={24}
                  isAnimationActive={false}
                  {...(stacked
                    ? {
                        stackId: 'outcome',
                        // The 2px surface-coloured gap between stacked segments.
                        stroke: 'var(--viz-surface)',
                        strokeWidth: 2,
                        radius: i === series.length - 1 ? [4, 4, 0, 0] : 0,
                      }
                    : { radius: [4, 4, 0, 0] })}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </AnalyticsCard>
  );
};
