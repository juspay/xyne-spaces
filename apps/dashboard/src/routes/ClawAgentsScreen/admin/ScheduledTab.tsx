import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DeleteDustbin01 } from '@xyne/icons';
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
    <div className='flex flex-wrap items-center justify-end gap-2'>
      <FilterSelect
        ariaLabel='Agent filter'
        value={agentSlug}
        onChange={value => resetTo(() => setAgentSlug(value))}
        options={agentOptions}
      />
      <FilterSelect
        ariaLabel='User filter'
        value={jobUserId}
        onChange={value => resetTo(() => setJobUserId(value))}
        options={userOptions}
      />
      <FilterSelect
        ariaLabel='Status filter'
        className='w-40'
        value={status}
        onChange={value => resetTo(() => setStatus(value))}
        options={STATUS_OPTIONS}
      />
    </div>
  );

  if (isPending) {
    return (
      <div className='flex flex-col gap-6 pt-4'>
        {filterBar}
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  if (isError) {
    return (
      <div className='flex flex-col gap-6 pt-4'>
        {filterBar}
        <TabMessage>Couldn’t load scheduled jobs.</TabMessage>
      </div>
    );
  }

  const { rows, total } = data;

  const visible = orgId ? rows.filter(job => job.orgId === orgId) : rows;

  if (visible.length === 0) {
    return (
      <div className='flex flex-col gap-6 pt-4'>
        {filterBar}
        <TabMessage>No scheduled jobs.</TabMessage>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-6 pt-4'>
      {filterBar}

      <AdminTable
        headers={[
          { label: 'User' },
          ...(showOrgLabels ? [{ label: 'Org' }] : []),
          { label: 'Agent' },
          { label: 'Type' },
          { label: 'Schedule' },
          { label: 'Next / Last run' },
          { label: 'Runs' },
          { label: 'Status' },
          { label: '' },
        ]}
      >
        {visible.map((job: AdminScheduledJob) => (
          <tr key={job.id} className='border-b border-border hover:bg-muted/40'>
            <td className='whitespace-nowrap px-4 py-3 text-muted-foreground'>
              <div title={job.user?.email ?? job.userId}>{job.user?.email ?? job.userId}</div>
              {job.user?.name && (
                <div className='text-xs text-muted-foreground'>{job.user.name}</div>
              )}
            </td>
            {showOrgLabels && (
              <td className='whitespace-nowrap px-4 py-3'>
                <OrgBadge orgName={orgLabel(job.orgId, job.orgName, orgNamesById)} />
              </td>
            )}
            <td className='whitespace-nowrap px-4 py-3 text-foreground'>{job.agentSlug}</td>
            <td className='whitespace-nowrap px-4 py-3'>
              <Badge variant='secondary'>{job.type}</Badge>
            </td>
            <td className='whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground'>
              <div className='flex flex-col gap-1'>
                <span>{job.type === 'cron' ? (job.cronExpression ?? '—') : '—'}</span>
                {job.label && (
                  <div className='font-sans text-xs text-muted-foreground'>{job.label}</div>
                )}
              </div>
            </td>
            <td className='whitespace-nowrap px-4 py-3 text-xs text-muted-foreground'>
              <div>next: {formatDate(job.nextRunAt)}</div>
              <div>last: {formatDate(job.lastRunAt)}</div>
            </td>
            <td className='whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground'>
              {job.runCount}
              {job.maxRuns !== null && job.maxRuns !== undefined ? ` / ${job.maxRuns}` : ''}
            </td>
            <td className='whitespace-nowrap px-4 py-3'>
              <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
            </td>
            <td className='whitespace-nowrap px-4 py-3 text-right'>
              <Tooltip content='Cancel scheduled job' side='top'>
                <span className='inline-flex'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    disabled={job.status !== 'active' || cancelJob.isPending}
                    onClick={() => setCancelTarget(job)}
                    className='text-muted-foreground hover:text-destructive'
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

      <AdminPager
        offset={offset}
        count={rows.length}
        total={total}
        onPrev={() => setOffset(current => Math.max(0, current - PAGE_SIZE))}
        onNext={() => setOffset(current => current + PAGE_SIZE)}
      />

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
