import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/Skeleton';
import { FilterSelect } from './components/FilterSelect';
import { listAgentUsageStats } from '@/services/claw/clawAdminService';
import type { AdminDateRange, AdminOrgScope, AgentUsageStat } from '@/services/claw/clawAdminTypes';
import { CalendarRange } from '@xyne/icons';
import { TabMessage } from './components/TabMessage';
import { adminUsageKey } from './hooks/adminQueryKeys';
import { AdminTable, OrgBadge } from './components/AdminTable';
import { orgLabel } from './orgLabel';
import { AdminToolbarPortal } from './components/AdminToolbarSlot';
import { AdminSearchField } from './components/AdminSearchField';
import { HighlightMatch } from './components/HighlightMatch';

const fmt = (n: number): string => n.toLocaleString();

function StatCard({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className='rounded-xl border border-border bg-background p-4'>
      <p className='text-xs uppercase tracking-wide text-muted-foreground'>{label}</p>
      <p className='mt-1 font-mono text-xl text-foreground'>{value}</p>
    </div>
  );
}

export function UsageTab({
  userId,
  scope,
  orgId,
  orgNamesById,
  showOrgLabels,
}: {
  userId: string;
  scope: AdminOrgScope;
  orgId: string | null;
  orgNamesById: Record<string, string>;
  showOrgLabels: boolean;
}): ReactElement {
  const [range, setRange] = useState<AdminDateRange>(30);
  const [query, setQuery] = useState('');

  const {
    data: stats,
    isPending,
    isError,
  } = useQuery({
    queryKey: adminUsageKey(scope, range),
    queryFn: () => listAgentUsageStats(userId, range, scope),
  });

  const scoped = orgId ? (stats ?? []).filter(stat => stat.orgId === orgId) : (stats ?? []);
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? scoped.filter(stat => stat.agentSlug.toLowerCase().includes(needle))
    : scoped;

  const totals = visible.reduce(
    (acc, stat) => ({
      runs: acc.runs + stat.runs,
      tokensIn: acc.tokensIn + stat.tokensIn,
      tokensOut: acc.tokensOut + stat.tokensOut,
    }),
    { runs: 0, tokensIn: 0, tokensOut: 0 },
  );

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-6'>
      <AdminToolbarPortal>
        <AdminSearchField
          value={query}
          onChange={setQuery}
          placeholder='Search agents'
          ariaLabel='Search agent usage'
          trackName='Admin: search usage'
          className='w-full'
        />
        <div className='flex flex-wrap items-center justify-end gap-2'>
          <FilterSelect
            ariaLabel='Date range'
            icon={<CalendarRange className='size-4 shrink-0 text-muted-foreground' aria-hidden />}
            value={range === 'all' ? '' : String(range)}
            onChange={value => setRange(value ? (Number(value) as 7 | 30) : 'all')}
            anchorLabel='Last 30 days'
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '', label: 'All time' },
            ]}
          />
        </div>
      </AdminToolbarPortal>

      <div className='grid gap-3 sm:grid-cols-3'>
        <StatCard label='Total Runs' value={fmt(totals.runs)} />
        <StatCard label='Tokens In' value={fmt(totals.tokensIn)} />
        <StatCard label='Tokens Out' value={fmt(totals.tokensOut)} />
      </div>

      <section className='flex min-h-0 flex-1 flex-col gap-2'>
        <h3 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
          Per-agent usage
        </h3>

        {isPending ? (
          <Skeleton className='h-32 w-full' />
        ) : isError ? (
          <TabMessage>Couldn’t load usage stats.</TabMessage>
        ) : visible.length === 0 ? (
          <TabMessage>No runs in this window.</TabMessage>
        ) : (
          <AdminTable
            headers={[
              { label: 'Agent' },
              ...(showOrgLabels ? [{ label: 'Org' }] : []),
              { label: 'Runs' },
              { label: 'Tokens In' },
              { label: 'Tokens Out' },
              { label: 'Cache Read' },
              { label: 'Cache Write' },
            ]}
          >
            {visible.map((stat: AgentUsageStat) => (
              <tr
                key={`${stat.orgId ?? 'org'}:${stat.agentSlug}`}
                className='border-b border-border hover:bg-muted/40'
              >
                <td className='whitespace-nowrap px-4 py-3 text-foreground'>
                  <HighlightMatch text={stat.agentSlug} query={query} />
                </td>
                {showOrgLabels && (
                  <td className='whitespace-nowrap px-4 py-3'>
                    <OrgBadge orgName={orgLabel(stat.orgId, stat.orgName, orgNamesById)} />
                  </td>
                )}
                <td className='whitespace-nowrap px-4 py-3 font-mono text-muted-foreground'>
                  {fmt(stat.runs)}
                </td>
                <td className='whitespace-nowrap px-4 py-3 font-mono text-foreground'>
                  {fmt(stat.tokensIn)}
                </td>
                <td className='whitespace-nowrap px-4 py-3 font-mono text-foreground'>
                  {fmt(stat.tokensOut)}
                </td>
                <td className='whitespace-nowrap px-4 py-3 font-mono text-muted-foreground'>
                  {fmt(stat.tokensCacheRead)}
                </td>
                <td className='whitespace-nowrap px-4 py-3 font-mono text-muted-foreground'>
                  {fmt(stat.tokensCacheWrite)}
                </td>
              </tr>
            ))}
          </AdminTable>
        )}
      </section>
    </div>
  );
}
