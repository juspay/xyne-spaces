import { useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/utils/classNames';
import { Skeleton } from '@/components/ui/Skeleton';
import { listClawAuthAgents } from '@/services/claw/clawAuthAgentsService';
import { listAuditLogs } from '@/services/claw/clawAdminService';
import {
  AUDIT_EVENT_TYPES,
  AUDIT_TONE_CLASS,
  auditDescription,
  auditEventLabel,
  auditEventTone,
  type AdminOrgScope,
  type AuditLogEntry,
} from '@/services/claw/clawAdminTypes';
import { TabMessage } from './components/TabMessage';
import { AdminPager, AdminTable, OrgBadge } from './components/AdminTable';
import { FilterSelect } from './components/FilterSelect';
import { adminAuditKey, auditAgentOptionsKey } from './hooks/adminQueryKeys';
import { orgLabel } from './orgLabel';

const PAGE_SIZE = 50;

type RangeFilter = 'all' | '7' | '30';

const RANGE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
] as const;

const startDateFor = (range: RangeFilter): string | undefined =>
  range === 'all'
    ? undefined
    : new Date(Date.now() - Number(range) * 24 * 60 * 60 * 1000).toISOString();

export function AuditTab({
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
  const [offset, setOffset] = useState(0);
  const [eventType, setEventType] = useState('');
  const [agentId, setAgentId] = useState('');
  const [range, setRange] = useState<RangeFilter>('all');

  const { data: agents } = useQuery({
    queryKey: auditAgentOptionsKey(userId),
    queryFn: () => listClawAuthAgents(userId),
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
  });

  const startDate = startDateFor(range);

  const { data, isPending, isError } = useQuery({
    queryKey: adminAuditKey(scope, { eventType, agentId, range, offset }),
    queryFn: () =>
      listAuditLogs(userId, {
        scope,
        limit: PAGE_SIZE,
        offset,
        ...(eventType ? { eventType } : {}),
        ...(agentId ? { targetId: agentId } : {}),
        ...(startDate ? { startDate } : {}),
      }),
  });

  const agentOptions = useMemo(
    () => [
      { value: '', label: 'All agents' },
      ...(agents ?? []).map(agent => ({ value: agent.id, label: agent.name })),
    ],
    [agents],
  );

  const resetTo = (apply: () => void): void => {
    setOffset(0);
    apply();
  };

  const filterBar = (
    <div className='flex flex-wrap items-center justify-end gap-2'>
      <FilterSelect
        ariaLabel='Event filter'
        className='w-52'
        value={eventType}
        onChange={value => resetTo(() => setEventType(value))}
        options={[
          { value: '', label: 'All events' },
          ...AUDIT_EVENT_TYPES.map(type => ({ value: type, label: auditEventLabel(type) })),
        ]}
      />
      <FilterSelect
        ariaLabel='Agent filter'
        value={agentId}
        onChange={value => resetTo(() => setAgentId(value))}
        options={agentOptions}
      />
      <FilterSelect
        ariaLabel='Time range filter'
        className='w-40'
        value={range === 'all' ? '' : range}
        onChange={value => resetTo(() => setRange((value || 'all') as RangeFilter))}
        options={RANGE_OPTIONS.map(option => ({
          value: option.value === 'all' ? '' : option.value,
          label: option.label,
        }))}
      />
    </div>
  );

  if (isPending) {
    return (
      <div className='flex flex-col gap-3 pt-4'>
        {filterBar}
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  if (isError) {
    return (
      <div className='flex flex-col gap-3 pt-4'>
        {filterBar}
        <TabMessage>Couldn’t load audit logs.</TabMessage>
      </div>
    );
  }

  const { rows, total } = data;
  const visible = orgId ? rows.filter(entry => entry.orgId === orgId) : rows;

  if (visible.length === 0) {
    return (
      <div className='flex flex-col gap-3 pt-4'>
        {filterBar}
        <TabMessage>No audit logs match these filters.</TabMessage>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-3 pt-4'>
      {filterBar}

      <AdminTable
        headers={[
          { label: 'Time' },
          { label: 'Event' },
          ...(showOrgLabels ? [{ label: 'Org' }] : []),
          { label: 'Description' },
        ]}
      >
        {visible.map((entry: AuditLogEntry) => (
          <tr key={entry.id} className='border-b border-border hover:bg-muted/40'>
            <td className='whitespace-nowrap px-4 py-3 text-xs text-muted-foreground'>
              {new Date(entry.createdAt).toLocaleString()}
            </td>
            <td className='px-4 py-3'>
              <Badge
                variant='secondary'
                className={cn(
                  'border-transparent font-medium',
                  AUDIT_TONE_CLASS[auditEventTone(entry.eventType)],
                )}
              >
                {entry.eventType}
              </Badge>
            </td>
            {showOrgLabels && (
              <td className='px-4 py-3'>
                <OrgBadge orgName={orgLabel(entry.orgId, entry.orgName, orgNamesById)} />
              </td>
            )}
            <td className='px-4 py-3 text-muted-foreground'>
              {auditDescription(entry.description)}
            </td>
          </tr>
        ))}
      </AdminTable>

      {orgId && (
        <p className='text-xs text-muted-foreground'>
          Showing {visible.length} of {rows.length} entries on this page for the selected org.
          Paging still walks every org.
        </p>
      )}

      <AdminPager
        offset={offset}
        count={rows.length}
        total={total}
        onPrev={() => setOffset(current => Math.max(0, current - PAGE_SIZE))}
        onNext={() => setOffset(current => current + PAGE_SIZE)}
      />
    </div>
  );
}
