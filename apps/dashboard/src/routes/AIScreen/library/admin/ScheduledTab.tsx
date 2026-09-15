import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bot, CheckTickCircle, DeleteDustbin01, UserDefault } from '@xyne/icons';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { Skeleton } from '@/components/ui/Skeleton';
import Tooltip from '@/components/ui/Tooltip';
import { listClawAuthAgents } from '@/services/claw/clawAuthAgentsService';
import { cancelScheduledJob, listAdminScheduledJobs } from '@/services/claw/clawAdminService';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { AdminOrgScope, AdminScheduledJob } from '@/services/claw/clawAdminTypes';
import { TabMessage } from './components/TabMessage';
import { AdminPager, AdminTable, OrgBadge } from './components/AdminTable';
import { FilterSelect } from './components/FilterSelect';
import { adminScheduledKey, auditAgentOptionsKey } from './hooks/adminQueryKeys';
import { orgLabel } from './orgLabel';
import { PersonPill } from '../shared/primitives/PersonPill';
import { AdminFooterPortal, AdminToolbarPortal } from './components/AdminToolbarSlot';
import { AdminSearchField } from './components/AdminSearchField';
import { HighlightMatch } from './components/HighlightMatch';

const PAGE_SIZE = 50;

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

const statusVariant = (status: string): 'success' | 'secondary' =>
  status === 'active' ? 'success' : 'secondary';

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : '—';

export function ScheduledTab({
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
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('');
  const [agentSlug, setAgentSlug] = useState('');
  const [jobUserId, setJobUserId] = useState('');
  const [query, setQuery] = useState('');
  const [cancelTarget, setCancelTarget] = useState<AdminScheduledJob | null>(null);

  const { data: agents } = useQuery({
    queryKey: auditAgentOptionsKey(userId),
    queryFn: () => listClawAuthAgents(userId),
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
  });

  const { data, isPending, isError } = useQuery({
    queryKey: adminScheduledKey(scope, { status, agentSlug, jobUserId, offset }),
    queryFn: () =>
      listAdminScheduledJobs(userId, {
        scope,
        limit: PAGE_SIZE,
        offset,
        ...(status ? { status } : {}),
        ...(agentSlug ? { agentSlug } : {}),
        ...(jobUserId ? { jobUserId } : {}),
      }),
  });

  const agentOptions = useMemo(
    () => [
      { value: '', label: 'All agents' },
      ...(agents ?? []).map(agent => ({ value: agent.slug, label: agent.name })),
    ],
    [agents],
  );

  const userOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const job of data?.rows ?? []) {
      if (job.userId && !seen.has(job.userId)) {
        seen.set(job.userId, job.user?.email ?? job.userId);
      }
    }
    return [
      { value: '', label: 'All users' },
      ...Array.from(seen, ([value, label]) => ({ value, label })),
    ];
  }, [data]);

  const cancelJob = useMutation({
    mutationFn: (jobId: string) => cancelScheduledJob(userId, jobId),
    onSuccess: () => {
      toast.success('Scheduled job cancelled');
      setCancelTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['claw-admin-scheduled'] });
    },
    onError: error => toast.error(clawErrorText(error, 'Could not cancel the job')),
  });

  const resetTo = (apply: () => void): void => {
    setOffset(0);
    apply();
  };

  const filterBar = (
    <AdminToolbarPortal>
      <AdminSearchField
        value={query}
        onChange={setQuery}
        placeholder='Search scheduled jobs'
        ariaLabel='Search scheduled jobs'
        trackName='Admin: search scheduled jobs'
        className='w-full'
      />
      <div className='flex flex-wrap items-center justify-end gap-2'>
        <FilterSelect
          ariaLabel='Agent filter'
          icon={<Bot className='size-4 shrink-0 text-muted-foreground' aria-hidden />}
          value={agentSlug}
          onChange={value => resetTo(() => setAgentSlug(value))}
          options={agentOptions}
        />
        <FilterSelect
          ariaLabel='User filter'
          icon={<UserDefault className='size-4 shrink-0 text-muted-foreground' aria-hidden />}
          value={jobUserId}
          onChange={value => resetTo(() => setJobUserId(value))}
          options={userOptions}
        />
        <FilterSelect
          ariaLabel='Status filter'
          icon={<CheckTickCircle className='size-4 shrink-0 text-muted-foreground' aria-hidden />}
          value={status}
          onChange={value => resetTo(() => setStatus(value))}
          options={STATUS_OPTIONS}
        />
      </div>
    </AdminToolbarPortal>
  );

  if (isPending) {
    return (
      <div className='flex min-h-0 flex-1 flex-col gap-6'>
        {filterBar}
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  if (isError) {
    return (
      <div className='flex min-h-0 flex-1 flex-col gap-6'>
        {filterBar}
        <TabMessage>Couldn’t load scheduled jobs.</TabMessage>
      </div>
    );
  }

  const { rows, total } = data;

  const scoped = orgId ? rows.filter(job => job.orgId === orgId) : rows;
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? scoped.filter(job =>
        `${job.agentSlug} ${job.label ?? ''} ${job.user?.name ?? ''} ${job.user?.email ?? ''}`
          .toLowerCase()
          .includes(needle),
      )
    : scoped;

  if (visible.length === 0) {
    return (
      <div className='flex min-h-0 flex-1 flex-col gap-6'>
        {filterBar}
        <TabMessage>No scheduled jobs.</TabMessage>
      </div>
    );
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-6'>
      {filterBar}

      <AdminTable
        headers={[
          { label: 'User', width: 'max-w-[14rem]' },
          ...(showOrgLabels ? [{ label: 'Org' }] : []),
          { label: 'Agent', width: 'max-w-[14rem]' },
          { label: 'Type' },
          { label: 'Schedule', width: 'max-w-[18rem]' },
          { label: 'Next run' },
          { label: 'Last run' },
          { label: 'Runs' },
          { label: 'Status' },
          { label: '', align: 'right' as const, width: 'w-14' },
        ]}
      >
        {visible.map((job: AdminScheduledJob) => (
          <tr key={job.id} className='border-b border-border hover:bg-muted/40'>
            <td className='max-w-[14rem] px-4 py-3 align-top leading-5 text-muted-foreground'>
              <PersonPill
                userId={job.userId}
                name={job.user?.name || job.user?.email || job.userId}
                className='block truncate text-xs'
              />
            </td>
            {showOrgLabels && (
              <td className='px-4 py-3 align-top leading-5'>
                <OrgBadge orgName={orgLabel(job.orgId, job.orgName, orgNamesById)} />
              </td>
            )}
            <td className='max-w-[14rem] px-4 py-3 align-top leading-5'>
              <Badge variant='secondary' className='-ml-2 max-w-full truncate font-mono'>
                <HighlightMatch text={job.agentSlug} query={query} />
              </Badge>
            </td>
            <td className='px-4 py-3 align-top leading-5'>
              <Badge variant='secondary' className='-ml-2'>
                {job.type}
              </Badge>
            </td>
            <td className='max-w-[18rem] px-4 py-3 align-top text-xs leading-5 text-muted-foreground'>
              <div className='flex flex-col gap-1'>
                {job.label && (
                  <span className='break-words text-foreground'>
                    <HighlightMatch text={job.label} query={query} />
                  </span>
                )}
                {job.type === 'cron' && job.cronExpression && (
                  <span className='break-words font-mono'>{job.cronExpression}</span>
                )}
              </div>
            </td>
            <td className='px-4 py-3 align-top text-xs leading-5 text-muted-foreground'>
              {formatDate(job.nextRunAt)}
            </td>
            <td className='px-4 py-3 align-top text-xs leading-5 text-muted-foreground'>
              {formatDate(job.lastRunAt)}
            </td>
            <td className='px-4 py-3 align-top font-mono text-xs leading-5 text-muted-foreground'>
              {job.runCount}
              {job.maxRuns !== null && job.maxRuns !== undefined ? ` / ${job.maxRuns}` : ''}
            </td>
            <td className='px-4 py-3 align-top leading-5'>
              <Badge variant={statusVariant(job.status)} className='-ml-2'>
                {job.status}
              </Badge>
            </td>
            <td className='px-4 py-3 text-right align-top leading-5'>
              <Tooltip content='Cancel scheduled job' side='top'>
                <span className='inline-flex'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    disabled={job.status !== 'active' || cancelJob.isPending}
                    onClick={() => setCancelTarget(job)}
                    className='-my-2 text-muted-foreground hover:text-destructive'
                    aria-label='Cancel scheduled job'
                    data-track-category='Claw Admin'
                    data-track-name='Cancel scheduled job'
                  >
                    <DeleteDustbin01 className='size-3.5 text-current' />
                  </Button>
                </span>
              </Tooltip>
            </td>
          </tr>
        ))}
      </AdminTable>

      {orgId && (
        <p className='text-xs text-muted-foreground'>
          Showing {visible.length} of {rows.length} jobs on this page for the selected org. Paging
          still walks every org.
        </p>
      )}

      <AdminFooterPortal>
        <AdminPager
          offset={offset}
          count={rows.length}
          total={total}
          onPrev={() => setOffset(current => Math.max(0, current - PAGE_SIZE))}
          onNext={() => setOffset(current => current + PAGE_SIZE)}
        />
      </AdminFooterPortal>

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={open => {
          if (!open) setCancelTarget(null);
        }}
        title='Cancel scheduled job?'
        description={
          cancelTarget
            ? `${cancelTarget.agentSlug} — ${cancelTarget.task}. This removes the job; it cannot be resumed.`
            : undefined
        }
        confirmLabel='Cancel job'
        danger
        loading={cancelJob.isPending}
        onConfirm={() => {
          if (cancelTarget) cancelJob.mutate(cancelTarget.id);
        }}
      />
    </div>
  );
}
