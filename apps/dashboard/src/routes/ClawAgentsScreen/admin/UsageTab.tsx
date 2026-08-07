import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { listAgentUsageStats } from '@/services/claw/clawAdminService';
import type { AdminDateRange, AdminOrgScope, AgentUsageStat } from '@/services/claw/clawAdminTypes';
import { TabMessage } from './components/TabMessage';
import { adminUsageKey } from './hooks/adminQueryKeys';
import { AdminTable, OrgBadge } from './components/AdminTable';
import { orgLabel } from './orgLabel';

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

  const {
    data: stats,
    isPending,
    isError,
  } = useQuery({
    queryKey: adminUsageKey(scope, range),
    queryFn: () => listAgentUsageStats(userId, range, scope),
  });

  const visible = orgId ? (stats ?? []).filter(stat => stat.orgId === orgId) : (stats ?? []);

  const totals = visible.reduce(
    (acc, stat) => ({
      runs: acc.runs + stat.runs,
      tokensIn: acc.tokensIn + stat.tokensIn,
      tokensOut: acc.tokensOut + stat.tokensOut,
    }),
    { runs: 0, tokensIn: 0, tokensOut: 0 },
  );

  return (
    <div className='flex flex-col gap-6 pt-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <p className='text-xs text-muted-foreground'>
          Run counts and token consumption per agent. Sorted by total tokens.
        </p>
        <Select
          value={String(range)}
          onValueChange={value => setRange(value === 'all' ? 'all' : (Number(value) as 7 | 30))}
        >
          <SelectTrigger
            className='w-40 focus-visible:border-ring focus-visible:ring-0'
            aria-label='Date range'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='7'>Last 7 days</SelectItem>
            <SelectItem value='30'>Last 30 days</SelectItem>
            <SelectItem value='all'>All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className='grid gap-3 sm:grid-cols-3'>
        <StatCard label='Total Runs' value={fmt(totals.runs)} />
        <StatCard label='Tokens In' value={fmt(totals.tokensIn)} />
        <StatCard label='Tokens Out' value={fmt(totals.tokensOut)} />
      </div>

      <section className='flex flex-col gap-2'>
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
              { label: 'Runs', align: 'right' as const },
              { label: 'Tokens In', align: 'right' as const },
              { label: 'Tokens Out', align: 'right' as const },
              { label: 'Cache Read', align: 'right' as const },
              { label: 'Cache Write', align: 'right' as const },
            ]}
          >
            {visible.map((stat: AgentUsageStat) => (
              <tr
                key={`${stat.orgId ?? 'org'}:${stat.agentSlug}`}
                className='border-b border-border hover:bg-muted/40'
              >
                <td className='whitespace-nowrap px-4 py-3 text-foreground'>{stat.agentSlug}</td>
                {showOrgLabels && (
                  <td className='whitespace-nowrap px-4 py-3'>
                    <OrgBadge orgName={orgLabel(stat.orgId, stat.orgName, orgNamesById)} />
                  </td>
                )}
                <td className='whitespace-nowrap px-4 py-3 text-right font-mono text-muted-foreground'>
                  {fmt(stat.runs)}
                </td>
                <td className='whitespace-nowrap px-4 py-3 text-right font-mono text-foreground'>
                  {fmt(stat.tokensIn)}
                </td>
                <td className='whitespace-nowrap px-4 py-3 text-right font-mono text-foreground'>
                  {fmt(stat.tokensOut)}
                </td>
                <td className='whitespace-nowrap px-4 py-3 text-right font-mono text-muted-foreground'>
                  {fmt(stat.tokensCacheRead)}
                </td>
                <td className='whitespace-nowrap px-4 py-3 text-right font-mono text-muted-foreground'>
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
