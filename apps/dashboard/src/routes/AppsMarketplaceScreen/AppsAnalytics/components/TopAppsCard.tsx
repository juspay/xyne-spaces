import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Table, type ColumnDef } from '@/components/ui/Table';
import { AppIcon } from '@/components/AppIcon/AppIcon';
import type { ArtifactAppsAnalytics } from '@/services/claw/artifactAppsService';
import { formatCount } from '../AppsAnalytics.utils';
import { AnalyticsCard } from './AnalyticsCard';

type TopApp = ArtifactAppsAnalytics['topApps'][number];
type TopAppRow = TopApp & Record<string, unknown>;

const count = (value: unknown): string => formatCount(Number(value));
const numeric = { className: 'text-right tabular-nums', headerClassName: 'text-right' };

/** The most active apps the viewer can open, by versions pushed and agent runs. */
export const TopAppsCard = ({ apps, days }: { apps: TopApp[]; days: number }): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);

  const columns: ColumnDef<TopAppRow>[] = [
    {
      field: 'title',
      header: 'App',
      renderCell: (_value, a) => (
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
      ),
    },
    {
      field: 'ownerName',
      header: 'Owner',
      className: 'text-muted-foreground',
      renderCell: (_value, a) => (a.isMine ? 'You' : (a.ownerName ?? '—')),
    },
    { field: 'versions', header: 'Versions', renderCell: count, ...numeric },
    { field: 'agentRuns', header: 'Agent runs', renderCell: count, ...numeric },
    { field: 'failedRuns', header: 'Failed runs', renderCell: count, ...numeric },
    { field: 'storageRecords', header: 'Stored records', renderCell: count, ...numeric },
  ];

  return (
    <AnalyticsCard
      title='Most active apps'
      subtitle={`By versions and agent runs in the last ${days} days. Only apps you can open, with activity.`}
    >
      {apps.length === 0 ? (
        <p className='py-6 text-center text-sm text-muted-foreground'>
          No activity on apps you can open in the last {days} days.
        </p>
      ) : (
        <Table<TopAppRow>
          data={apps as TopAppRow[]}
          columns={columns}
          idField='id'
          size='sm'
          tableClassName='min-w-[640px]'
          className='overflow-x-auto'
        />
      )}
    </AnalyticsCard>
  );
};
