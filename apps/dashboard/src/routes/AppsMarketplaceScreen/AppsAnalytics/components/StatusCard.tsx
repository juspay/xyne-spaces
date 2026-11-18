import { useState, type ReactElement } from 'react';
import { Table, type ColumnDef } from '@/components/ui/Table';
import type { ArtifactAppsAnalytics } from '@/services/claw/artifactAppsService';
import type { View } from '../AppsAnalytics.types';
import { compositionParts, formatCount, formatPercent } from '../AppsAnalytics.utils';
import { AnalyticsCard, Legend, ViewToggle } from './AnalyticsCard';

type PartRow = { key: string; label: string; count: number; share: number } & Record<
  string,
  unknown
>;

/**
 * Every app, split by state: one whole in four parts, so a tall segmented bar
 * (not a donut). Counts print inside blocks wide enough to hold them; the table
 * view and each block's accessible name carry the rest.
 */
export const StatusCard = ({
  composition,
  total,
}: {
  composition: ArtifactAppsAnalytics['composition'];
  total: number;
}): ReactElement => {
  const [view, setView] = useState<View>('chart');
  const parts = compositionParts(composition);
  const drawn = parts.filter(p => p.count > 0);
  const rows: PartRow[] = parts.map(p => ({
    key: p.key,
    label: p.label,
    count: p.count,
    share: p.count / total,
  }));
  const columns: ColumnDef<PartRow>[] = [
    { field: 'label', header: 'Status' },
    {
      field: 'count',
      header: 'Apps',
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
      renderCell: value => formatCount(Number(value)),
    },
    {
      field: 'share',
      header: 'Share',
      className: 'text-right tabular-nums text-muted-foreground',
      headerClassName: 'text-right',
      renderCell: value => formatPercent(Number(value)),
    },
  ];

  return (
    <AnalyticsCard
      title='Apps by status'
      subtitle={`${formatCount(total)} apps, including archived`}
      action={<ViewToggle view={view} onChange={setView} trackName='AppsAnalyticsStatusView' />}
    >
      {view === 'table' ? (
        <Table<PartRow> data={rows} columns={columns} idField='key' size='sm' hoverable={false} />
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
          <Legend items={parts} />
        </div>
      )}
    </AnalyticsCard>
  );
};
