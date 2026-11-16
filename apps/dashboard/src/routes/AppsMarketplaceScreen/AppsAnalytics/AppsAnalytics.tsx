import './AppsAnalytics.css';
import { useState, type ReactElement, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
import { cn } from '@/utils/classNames';
import { SegmentedToggle } from '@/components/ui/SegmentedToggle';
import { AppIcon } from '@/components/AppIcon/AppIcon';
import {
  getArtifactAppsAnalytics,
  type ArtifactAppsAnalytics,
  type ArtifactAppsAnalyticsDay,
  type ArtifactAppsAnalyticsDays,
} from '@/services/claw/artifactAppsService';
import {
  compositionParts,
  formatCount,
  formatDay,
  formatPercent,
  formatRelative,
  tickInterval,
} from './AppsAnalytics.utils';

const RANGES: { value: `${ArtifactAppsAnalyticsDays}`; label: string }[] = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

/** Plot plus x-axis band, so the axis labels never fall outside the card. */
const CHART_HEIGHT = 220;

type Series = { key: keyof ArtifactAppsAnalyticsDay; label: string; color: string };

const VERSION_SERIES: Series[] = [
  { key: 'versions', label: 'Versions', color: 'var(--viz-series-1)' },
];
// Run outcomes are states, so they take the status colours, each with its label.
const RUN_SERIES: Series[] = [
  { key: 'runsCompleted', label: 'Completed', color: 'var(--viz-status-good)' },
  { key: 'runsFailed', label: 'Failed', color: 'var(--viz-status-critical)' },
  { key: 'runsCancelled', label: 'Cancelled', color: 'var(--viz-neutral)' },
];

/**
 * Apps Marketplace → Analytics: how the workspace builds and uses apps, from
 * the data claw-auth already keeps (apps, versions, restores, agent runs,
 * storage records). Every count covers the whole workspace; per-app rows only
 * ever show apps the viewer can open, and build errors only their own apps'.
 */
const AppsAnalytics = (): ReactElement => {
  const [days, setDays] = useState<ArtifactAppsAnalyticsDays>(30);
  const query = useQuery({
    queryKey: ['artifact-apps', 'analytics', days],
    queryFn: () => getArtifactAppsAnalytics(days),
    // A range change keeps the last render on screen, dimmed, instead of a skeleton flash.
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  return (
    <div className='apps-analytics flex flex-col gap-5'>
      {/* One filter row, above everything it scopes. */}
      <div className='flex items-center gap-3'>
        <SegmentedToggle
          options={RANGES}
          value={`${days}`}
          onChange={value => setDays(Number(value) as ArtifactAppsAnalyticsDays)}
          trackCategory='Apps'
          trackPrefix='AppsAnalyticsRange'
        />
        <span className='text-xs text-muted-foreground'>Days are in IST.</span>
      </div>

      {query.isLoading ? (
        <AnalyticsSkeleton />
      ) : query.isError || !data ? (
        <div className='flex flex-col items-center gap-3 py-16 text-center'>
          <p className='text-sm text-muted-foreground'>Couldn&apos;t load analytics.</p>
          <button
            type='button'
            onClick={() => void query.refetch()}
            className='rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted'
            data-track-category='Apps'
            data-track-name='AppsAnalyticsRetry'
          >
            Try again
          </button>
        </div>
      ) : (
        <div
          className={cn(
            'flex flex-col gap-5 transition-opacity',
            query.isPlaceholderData && 'opacity-60',
          )}
        >
          <AnalyticsBody data={data} />
        </div>
      )}
    </div>
  );
};

const AnalyticsBody = ({ data }: { data: ArtifactAppsAnalytics }): ReactElement => {
  const { totals, period, composition, daily, range } = data;
  const runs = period.agentRuns;
  const finished = runs.completed + runs.failed;
  const allApps = Object.values(composition).reduce((sum, n) => sum + n, 0);

  if (allApps === 0) {
    return (
      <div className='flex flex-col items-center gap-2 py-16 text-center'>
        <span className='text-3xl' aria-hidden='true'>
          📊
        </span>
        <p className='text-sm font-medium text-foreground'>No apps in this workspace yet</p>
        <p className='text-sm text-muted-foreground'>
          Analytics appear once someone creates an app.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'>
        <StatTile
          label='Live apps'
          value={formatCount(totals.apps)}
          note={`${formatCount(period.appsCreated)} new in ${range.days} days`}
        />
        <StatTile
          label='Published'
          value={formatCount(totals.published)}
          note={`of ${formatCount(totals.apps)} live`}
        />
        <StatTile
          label='Builders'
          value={formatCount(totals.builders)}
          note='people with a live app'
        />
        <StatTile
          label='Versions pushed'
          value={formatCount(period.versions)}
          note={`${formatCount(totals.versions)} all time`}
        />
        <StatTile
          label='Build failure rate'
          value={period.failureRate === null ? '—' : formatPercent(period.failureRate)}
          note={
            finished === 0
              ? 'No finished builds'
              : `${formatCount(runs.failed)} of ${formatCount(finished)} finished builds`
          }
        />
        <StatTile
          label='Archived'
          value={formatCount(composition.archived)}
          note={`${formatCount(period.archived)} in ${range.days} days`}
        />
      </div>

      <StatusCard composition={composition} total={allApps} />

      <div className='grid grid-cols-1 gap-5 lg:grid-cols-2'>
        <DailyChartCard
          title='Versions pushed per day'
          subtitle={`${formatCount(period.versions)} in ${range.days} days`}
          trackName='AppsAnalyticsVersionsView'
          daily={daily}
          series={VERSION_SERIES}
          days={range.days}
        />
        <DailyChartCard
          title='App builds per day'
          subtitle={
            runs.total === 0
              ? 'Runs of an app’s agent, by outcome'
              : `${formatCount(runs.total)} runs${runs.inProgress ? `, ${formatCount(runs.inProgress)} still running` : ''}`
          }
          trackName='AppsAnalyticsBuildsView'
          daily={daily}
          series={RUN_SERIES}
          days={range.days}
          emptyLabel='No app builds in this period.'
        />
      </div>

      <TopAppsCard apps={data.topApps} days={range.days} />
      <RecentErrorsCard errors={data.recentErrors} days={range.days} />
    </>
  );
};

/** label · value · note. Proportional figures: tabular-nums would space a big number loosely. */
const StatTile = ({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}): ReactElement => (
  <div className='flex flex-col gap-1 rounded-2xl border border-border bg-background p-4'>
    <span className='text-xs text-muted-foreground'>{label}</span>
    <span className='text-2xl font-semibold leading-8 text-foreground'>{value}</span>
    <span className='truncate text-xs text-muted-foreground'>{note}</span>
  </div>
);

const Card = ({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}): ReactElement => (
  <section className='flex flex-col gap-4 rounded-2xl border border-border bg-background p-5'>
    <header className='flex items-start justify-between gap-3'>
      <div className='flex min-w-0 flex-col gap-0.5'>
        <h3 className='text-sm font-medium text-foreground'>{title}</h3>
        {subtitle ? <p className='text-xs text-muted-foreground'>{subtitle}</p> : null}
      </div>
      {action}
    </header>
    {children}
  </section>
);

type View = 'chart' | 'table';
const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: 'chart', label: 'Chart' },
  { value: 'table', label: 'Table' },
];

const ViewToggle = ({
  view,
  onChange,
  trackName,
}: {
  view: View;
  onChange: (view: View) => void;
  trackName: string;
}): ReactElement => (
  <SegmentedToggle
    options={VIEW_OPTIONS}
    value={view}
    onChange={onChange}
    trackCategory='Apps'
    trackPrefix={trackName}
  />
);

/** Legend for two or more series: a swatch shaped like the mark (a rect, for bars) and its name. */
const Legend = ({ series }: { series: Series[] }): ReactElement => (
  <ul className='flex flex-wrap items-center gap-x-4 gap-y-1'>
    {series.map(s => (
      <li key={s.key} className='flex items-center gap-1.5 text-xs text-muted-foreground'>
        <span
          className='size-2.5 rounded-[2px]'
          style={{ background: s.color }}
          aria-hidden='true'
        />
        {s.label}
      </li>
    ))}
  </ul>
);

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

const DailyChartCard = ({
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
  const rows = daily.map(d => ({ ...d, label: formatDay(d.date) }));
  const sumOf = (d: ArtifactAppsAnalyticsDay): number =>
    series.reduce((sum, s) => sum + Number(d[s.key]), 0);
  const active = rows.filter(d => sumOf(d) > 0);
  const stacked = series.length > 1;

  return (
    <Card
      title={title}
      subtitle={subtitle}
      action={<ViewToggle view={view} onChange={setView} trackName={trackName} />}
    >
      {active.length === 0 ? (
        <p className='py-10 text-center text-sm text-muted-foreground'>
          {emptyLabel ?? 'No activity in this period.'}
        </p>
      ) : view === 'table' ? (
        <DailyTable rows={[...active].reverse()} series={series} />
      ) : (
        <div className='flex flex-col gap-3'>
          {stacked ? <Legend series={series} /> : null}
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
    </Card>
  );
};

/** The table twin of a daily chart: every day with activity, newest first. */
const DailyTable = ({
  rows,
  series,
}: {
  rows: (ArtifactAppsAnalyticsDay & { label: string })[];
  series: Series[];
}): ReactElement => (
  <div className='max-h-64 overflow-y-auto'>
    <table className='w-full text-sm'>
      <thead>
        <tr className='text-left text-xs text-muted-foreground'>
          <th className='pb-2 font-normal'>Day (IST)</th>
          {series.map(s => (
            <th key={s.key} className='pb-2 text-right font-normal'>
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.date} className='border-t border-border'>
            <td className='py-1.5 text-foreground'>{row.label}</td>
            {series.map(s => (
              <td key={s.key} className='py-1.5 text-right tabular-nums text-foreground'>
                {formatCount(Number(row[s.key]))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    <p className='pt-2 text-xs text-muted-foreground'>Days with no activity are not listed.</p>
  </div>
);

/**
 * Every app, split by state: one whole in four parts, so a tall segmented bar
 * (not a donut). Counts print inside blocks wide enough to hold them; the table
 * view and each block's accessible name carry the rest.
 */
const StatusCard = ({
  composition,
  total,
}: {
  composition: ArtifactAppsAnalytics['composition'];
  total: number;
}): ReactElement => {
  const [view, setView] = useState<View>('chart');
  const parts = compositionParts(composition);
  const drawn = parts.filter(p => p.count > 0);

  return (
    <Card
      title='Apps by status'
      subtitle={`${formatCount(total)} apps, including archived`}
      action={<ViewToggle view={view} onChange={setView} trackName='AppsAnalyticsStatusView' />}
    >
      {view === 'table' ? (
        <table className='w-full text-sm'>
          <thead>
            <tr className='text-left text-xs text-muted-foreground'>
              <th className='pb-2 font-normal'>Status</th>
              <th className='pb-2 text-right font-normal'>Apps</th>
              <th className='pb-2 text-right font-normal'>Share</th>
            </tr>
          </thead>
          <tbody>
            {parts.map(p => (
              <tr key={p.key} className='border-t border-border'>
                <td className='py-1.5 text-foreground'>{p.label}</td>
                <td className='py-1.5 text-right tabular-nums text-foreground'>
                  {formatCount(p.count)}
                </td>
                <td className='py-1.5 text-right tabular-nums text-muted-foreground'>
                  {formatPercent(p.count / total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className='flex flex-col gap-3'>
          <div
            role='img'
            aria-label={parts.map(p => `${p.label} ${p.count}`).join(', ')}
            className='flex h-7 w-full gap-[2px]'
          >
            {drawn.map(p => {
              const share = p.count / total;
              return (
                <div
                  key={p.key}
                  title={`${p.label}: ${formatCount(p.count)} (${formatPercent(share)})`}
                  className='flex h-full min-w-[3px] items-center rounded px-2'
                  style={{ width: `${share * 100}%`, background: p.color }}
                >
                  {/* Only where it fits with room to spare; otherwise the table has it. */}
                  {share >= 0.08 ? (
                    <span className='text-xs font-medium tabular-nums' style={{ color: p.ink }}>
                      {formatCount(p.count)}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <ul className='flex flex-wrap items-center gap-x-4 gap-y-1'>
            {parts.map(p => (
              <li key={p.key} className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                <span
                  className='size-2.5 rounded-[2px]'
                  style={{ background: p.color }}
                  aria-hidden='true'
                />
                {p.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
};

const TopAppsCard = ({
  apps,
  days,
}: {
  apps: ArtifactAppsAnalytics['topApps'];
  days: number;
}): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);

  return (
    <Card
      title='Most active apps'
      subtitle={`By versions and builds in the last ${days} days. Apps you can open only.`}
    >
      {apps.length === 0 ? (
        <p className='py-6 text-center text-sm text-muted-foreground'>No apps you can open yet.</p>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[640px] text-sm'>
            <thead>
              <tr className='text-left text-xs text-muted-foreground'>
                <th className='pb-2 font-normal'>App</th>
                <th className='pb-2 font-normal'>Owner</th>
                <th className='pb-2 text-right font-normal'>Versions</th>
                <th className='pb-2 text-right font-normal'>Builds</th>
                <th className='pb-2 text-right font-normal'>Failed</th>
                <th className='pb-2 text-right font-normal'>Stored records</th>
              </tr>
            </thead>
            <tbody>
              {apps.map(a => (
                <tr key={a.id} className='border-t border-border'>
                  <td className='py-2 pr-3'>
                    <Link
                      to={prefixWs(`/ai/library/app/${a.id}`)}
                      className='flex min-w-0 items-center gap-2 text-foreground hover:underline'
                    >
                      {a.icon ? <AppIcon name={a.icon} size={14} aria-hidden='true' /> : null}
                      <span className='truncate'>{a.title}</span>
                      {a.visibility === 'WORKSPACE' ? null : (
                        <span className='shrink-0 rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground'>
                          Private
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className='py-2 pr-3 text-muted-foreground'>
                    {a.isMine ? 'You' : (a.ownerName ?? '—')}
                  </td>
                  <td className='py-2 text-right tabular-nums text-foreground'>
                    {formatCount(a.versions)}
                  </td>
                  <td className='py-2 text-right tabular-nums text-foreground'>
                    {formatCount(a.agentRuns)}
                  </td>
                  <td className='py-2 text-right tabular-nums text-foreground'>
                    {formatCount(a.failedRuns)}
                  </td>
                  <td className='py-2 text-right tabular-nums text-foreground'>
                    {formatCount(a.storageRecords)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

const RecentErrorsCard = ({
  errors,
  days,
}: {
  errors: ArtifactAppsAnalytics['recentErrors'];
  days: number;
}): ReactElement => {
  const now = Date.now();
  return (
    <Card
      title='Recent build errors on your apps'
      subtitle='Only the first line of each error. Other people’s apps are never shown here.'
    >
      {errors.length === 0 ? (
        <p className='py-6 text-center text-sm text-muted-foreground'>
          No failed builds on your apps in the last {days} days.
        </p>
      ) : (
        <ul className='flex flex-col'>
          {errors.map((e, i) => (
            <li
              key={`${e.appId}-${e.at}-${i}`}
              className='flex flex-col gap-1 border-t border-border py-2.5 first:border-t-0 first:pt-0'
            >
              <div className='flex items-center gap-2 text-xs'>
                <span className='font-medium text-foreground'>{e.appTitle}</span>
                <span className='rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground'>
                  {e.source === 'dispatch' ? 'Could not start' : 'Failed while running'}
                </span>
                <span className='text-muted-foreground'>{formatRelative(e.at, now)}</span>
              </div>
              <p className='truncate font-mono text-xs text-muted-foreground' title={e.message}>
                {e.message}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

const AnalyticsSkeleton = (): ReactElement => (
  <div className='flex flex-col gap-5' aria-hidden='true'>
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className='h-[92px] animate-pulse rounded-2xl bg-muted' />
      ))}
    </div>
    <div className='h-[120px] animate-pulse rounded-2xl bg-muted' />
    <div className='grid grid-cols-1 gap-5 lg:grid-cols-2'>
      <div className='h-[300px] animate-pulse rounded-2xl bg-muted' />
      <div className='h-[300px] animate-pulse rounded-2xl bg-muted' />
    </div>
  </div>
);

export default AppsAnalytics;
