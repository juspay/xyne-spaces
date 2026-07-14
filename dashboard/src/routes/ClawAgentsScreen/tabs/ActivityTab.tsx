import { ReactElement, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleDashed, MinusCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { useClawAgentRuns, type AgentRunStatusFilter } from '@/hooks/useClawAgentRuns';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { AgentPermissions } from '@/services/claw/agentPermissions';
import { ClawApiError } from '@/services/claw/clawRequest';
import type {
  AgentRun,
  AgentRunStatus,
  AgentRunTriggerSource,
} from '@/services/claw/clawRunsTypes';
import { formatRelativeTime } from '@/utils/dateUtils';
import { DetailSection, EmptyPanel, formatDateTime, InfoRow } from './detailTabUtils';

interface ActivityTabProps {
  agent: Agent;
  permissions: AgentPermissions;
}

const STATUS_OPTIONS: Array<{ value: AgentRunStatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const triggerLabel = (source: AgentRunTriggerSource): string => {
  if (source === 'spaces') return 'Spaces';
  if (source === 'scheduled') return 'Scheduled';
  if (source === 'chat') return 'Chat';
  return 'API';
};

const runOwnerLabel = (run: AgentRun): string =>
  run.userName || run.userEmail || `user ${run.userId.slice(0, 8)}`;

const formatDuration = (milliseconds: number | null): string | null => {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return null;
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
};

const runDuration = (run: AgentRun): string | null => {
  if (run.status === 'running') return 'Running…';
  if (run.totalMs !== null) return formatDuration(run.totalMs);
  if (!run.completedAt) return null;
  const milliseconds = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
  return formatDuration(milliseconds);
};

const StatusIcon = ({ status }: { status: AgentRunStatus }): ReactElement => {
  if (status === 'running') {
    return <CircleDashed className='size-5 animate-spin text-blue-500' aria-label='Running' />;
  }
  if (status === 'completed') {
    return <CheckCircle2 className='size-5 text-emerald-500' aria-label='Completed' />;
  }
  if (status === 'failed') {
    return <XCircle className='size-5 text-destructive' aria-label='Failed' />;
  }
  return <MinusCircle className='size-5 text-muted-foreground' aria-label='Cancelled' />;
};

const RunRow = ({ run, showOwner }: { run: AgentRun; showOwner: boolean }): ReactElement => {
  const tokens =
    run.tokensIn !== null || run.tokensOut !== null
      ? `${run.tokensIn ?? 0} → ${run.tokensOut ?? 0} tokens`
      : null;
  const metadata = [
    showOwner ? runOwnerLabel(run) : null,
    triggerLabel(run.triggerSource),
    formatRelativeTime(new Date(run.startedAt)),
    runDuration(run),
    tokens,
  ].filter((item): item is string => Boolean(item));

  return (
    <div className='flex items-start gap-3 rounded-lg border border-border px-4 py-3'>
      <div className='mt-0.5 shrink-0'>
        <StatusIcon status={run.status} />
      </div>
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-medium text-foreground' title={run.task}>
          {run.task || 'Untitled run'}
        </p>
        <div className='mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground'>
          {metadata.map((item, index) => (
            <span key={`${item}-${index}`} className='inline-flex items-center gap-1.5'>
              {index > 0 && <span aria-hidden='true'>·</span>}
              {item}
            </span>
          ))}
        </div>
        {run.status === 'failed' && run.error && (
          <p className='mt-2 line-clamp-2 text-xs text-destructive'>{run.error}</p>
        )}
        {run.status === 'running' && run.currentToolLabel && (
          <p className='mt-2 text-xs text-muted-foreground'>{run.currentToolLabel}</p>
        )}
      </div>
    </div>
  );
};

const RunRowsSkeleton = (): ReactElement => (
  <div className='flex flex-col gap-2'>
    {Array.from({ length: 4 }).map((_, index) => (
      <div
        key={index}
        className='flex items-center gap-3 rounded-lg border border-border px-4 py-3'
      >
        <Skeleton className='size-5 shrink-0 rounded-full' />
        <div className='flex min-w-0 flex-1 flex-col gap-2'>
          <Skeleton className='h-4 w-3/5' />
          <Skeleton className='h-3 w-2/5' />
        </div>
      </div>
    ))}
  </div>
);

const ActivityTab = ({ agent, permissions }: ActivityTabProps): ReactElement => {
  const toolCount = agent.tools?.length ?? 0;
  const skillCount = agent.skills?.length ?? 0;
  const grantCount = agent.collections?.length ?? 0;
  const shareCount = agent.shares?.length ?? 0;
  const [status, setStatus] = useState<AgentRunStatusFilter>('all');
  const [allUsers, setAllUsers] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState('');

  useEffect(() => {
    if (permissions.canEdit) return;
    setAllUsers(false);
    setOwnerFilter('');
  }, [permissions.canEdit]);

  useEffect(() => {
    if (allUsers) return;
    setOwnerFilter('');
  }, [allUsers]);

  const {
    data: runs = [],
    isLoading,
    error,
  } = useClawAgentRuns(agent.slug, {
    status,
    allUsers: permissions.canEdit && allUsers,
  });

  const ownerOptions = useMemo(() => {
    const owners = new Map<string, string>();
    runs.forEach(run => owners.set(run.userId, runOwnerLabel(run)));
    return [...owners.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [runs]);

  useEffect(() => {
    if (ownerFilter && !ownerOptions.some(owner => owner.id === ownerFilter)) {
      setOwnerFilter('');
    }
  }, [ownerFilter, ownerOptions]);

  const visibleRuns = ownerFilter ? runs.filter(run => run.userId === ownerFilter) : runs;
  const errorMessage =
    error instanceof ClawApiError && error.status === 403
      ? 'You don’t have permission to do that'
      : error?.message;

  return (
    <div className='flex max-w-3xl flex-col gap-6'>
      <div className='grid gap-6 lg:grid-cols-2'>
        <DetailSection title='Lifecycle'>
          <div className='divide-y divide-border rounded-lg border border-border px-4 py-1'>
            <InfoRow label='Created' value={formatDateTime(agent.createdAt)} />
            <InfoRow label='Last updated' value={formatDateTime(agent.updatedAt)} />
            <InfoRow
              label='Runtime'
              value={
                <Badge variant={agent.enabled ? 'success' : 'outline'}>
                  {agent.enabled ? 'Enabled' : 'Paused'}
                </Badge>
              }
            />
            <InfoRow
              label='Prompt version'
              value={
                agent.activePromptVersion !== null && agent.activePromptVersion !== undefined
                  ? `v${agent.activePromptVersion}`
                  : 'No version recorded'
              }
            />
          </div>
        </DetailSection>

        <DetailSection title='Configuration summary'>
          <div className='grid grid-cols-2 gap-3'>
            <SummaryTile label='Tools' value={toolCount} />
            <SummaryTile label='Skills' value={skillCount} />
            <SummaryTile label='KB grants' value={grantCount} />
            <SummaryTile label='People' value={shareCount + (agent.ownerUserId ? 1 : 0)} />
          </div>
        </DetailSection>
      </div>

      <DetailSection
        title='Run history'
        description='Recent executions of this agent, newest first.'
      >
        <div className='flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 p-3'>
          <label htmlFor='claw-run-status' className='text-xs font-medium text-muted-foreground'>
            Status
          </label>
          <select
            id='claw-run-status'
            value={status}
            onChange={event => setStatus(event.target.value as AgentRunStatusFilter)}
            data-track-category='Claw Agents'
            data-track-name='Filter agent runs by status'
            className='h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground'
          >
            {STATUS_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {permissions.canEdit && (
            <div className='ml-auto flex items-center gap-2'>
              <span className='text-xs text-muted-foreground'>All users’ runs</span>
              <Switch
                checked={allUsers}
                onCheckedChange={setAllUsers}
                aria-label='Show all users’ runs'
              />
            </div>
          )}

          {permissions.canEdit && allUsers && (
            <select
              value={ownerFilter}
              onChange={event => setOwnerFilter(event.target.value)}
              data-track-category='Claw Agents'
              data-track-name='Filter agent runs by owner'
              aria-label='Filter runs by owner'
              className='h-8 min-w-44 rounded-md border border-border bg-background px-2 text-xs text-foreground'
            >
              <option value=''>All users ({ownerOptions.length})</option>
              {ownerOptions.map(owner => (
                <option key={owner.id} value={owner.id}>
                  {owner.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {isLoading ? (
          <RunRowsSkeleton />
        ) : errorMessage ? (
          <div className='rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive'>
            Failed to load runs: {errorMessage}
          </div>
        ) : runs.length === 0 ? (
          <EmptyPanel
            title={allUsers ? 'No runs from any user yet' : 'No runs yet'}
            description={
              status === 'all'
                ? 'Runs will appear here after this agent processes a task.'
                : 'No runs match the selected status.'
            }
          />
        ) : visibleRuns.length === 0 ? (
          <EmptyPanel
            title='No matching runs'
            description='Choose another user to see runs in the current status.'
          />
        ) : (
          <div className='flex flex-col gap-2'>
            {visibleRuns.map(run => (
              <RunRow key={run.sessionId} run={run} showOwner={allUsers} />
            ))}
          </div>
        )}
      </DetailSection>
    </div>
  );
};

const SummaryTile = ({ label, value }: { label: string; value: number }): ReactElement => (
  <div className='rounded-lg border border-border px-3 py-3'>
    <p className='text-2xl font-semibold tabular-nums text-foreground'>{value}</p>
    <p className='mt-1 text-xs text-muted-foreground'>{label}</p>
  </div>
);

export default ActivityTab;
