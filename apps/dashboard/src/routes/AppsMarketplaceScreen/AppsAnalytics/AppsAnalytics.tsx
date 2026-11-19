import './AppsAnalytics.css';
import { useState, type ReactElement } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { cn } from '@/utils/classNames';
import { SegmentedToggle } from '@/components/ui/SegmentedToggle';
import {
  getArtifactAppsAnalytics,
  type ArtifactAppsAnalytics,
  type ArtifactAppsAnalyticsDays,
} from '@/services/claw/artifactAppsService';
import type { Series } from './AppsAnalytics.types';
import { formatCount, formatPercent } from './AppsAnalytics.utils';
import { AnalyticsSkeleton } from './components/AnalyticsSkeleton';
import { DailyChartCard } from './components/DailyChartCard';
import { RecentErrorsCard } from './components/RecentErrorsCard';
import { StatTile } from './components/StatTile';
import { StatusCard } from './components/StatusCard';
import { TopAppsCard } from './components/TopAppsCard';

const RANGES: { value: `${ArtifactAppsAnalyticsDays}`; label: string }[] = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

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
 * storage records). Counts cover the whole workspace; per-app rows only show
 * apps the viewer can open, and errors only agent runs they started themselves.
 *
 * "Agent runs" are runs of an app's agent, started by anyone using the app.
 * They are not builds of the app.
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
      {data.truncated ? (
        <p className='rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground'>
          This workspace has more activity than one view reads, so these figures cover the most
          recent records only and may undercount.
        </p>
      ) : null}

      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'>
        <StatTile
          label='Live apps'
          value={formatCount(totals.apps)}
          note={`${formatCount(period.appsCreated)} of them created in ${range.days} days`}
        />
        <StatTile
          label='Published'
          value={formatCount(totals.published)}
          note={`of ${formatCount(totals.apps)} live`}
        />
        <StatTile
          label='Builders'
          value={formatCount(totals.builders)}
          note='people with a built, live app'
        />
        <StatTile
          label='Versions pushed'
          value={formatCount(period.versions)}
          note={`${formatCount(totals.versions)} all time`}
        />
        <StatTile
          label='Agent run failure rate'
          value={period.failureRate === null ? '—' : formatPercent(period.failureRate)}
          note={
            finished === 0
              ? 'No finished agent runs'
              : `${formatCount(runs.failed)} of ${formatCount(finished)} finished agent runs`
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
          title='Agent runs per day'
          subtitle={
            runs.total === 0
              ? 'Runs of each app’s agent, started by anyone using it, by outcome'
              : `${formatCount(runs.total)} runs${runs.inProgress ? `, ${formatCount(runs.inProgress)} still running` : ''}`
          }
          trackName='AppsAnalyticsAgentRunsView'
          daily={daily}
          series={RUN_SERIES}
          days={range.days}
          emptyLabel='No agent runs in this period.'
        />
      </div>

      <TopAppsCard apps={data.topApps} days={range.days} />
      <RecentErrorsCard errors={data.recentErrors} days={range.days} />
    </>
  );
};

export default AppsAnalytics;
