import { ReactElement, useState } from 'react';
import { History, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  useClawScheduledJobMutations,
  useClawScheduledJobRuns,
  useClawScheduledJobs,
} from '@/hooks/useClawScheduledJobs';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { AgentPermissions } from '@/services/claw/agentPermissions';
import type { ScheduledJob } from '@/services/claw/clawScheduledJobsService';
import { DetailSection, EmptyPanel, formatDateTime, InfoRow } from './detailTabUtils';

interface ScheduleTabProps {
  agent: Agent;
  permissions: AgentPermissions;
}

const statusVariant = (status: string): 'success' | 'secondary' | 'outline' | 'destructive' => {
  if (status === 'active') return 'success';
  if (status === 'cancelled' || status === 'failed') return 'destructive';
  if (status === 'completed') return 'secondary';
  return 'outline';
};

const EditableJob = ({
  job,
  canEdit,
  onUpdate,
  onDelete,
  busy,
}: {
  job: ScheduledJob;
  canEdit: boolean;
  onUpdate: (patch: { replyMode?: 'thread' | 'channel'; label?: string | null }) => void;
  onDelete: () => void;
  busy: boolean;
}): ReactElement => {
  const [label, setLabel] = useState(job.label ?? '');
  return (
    <div className='rounded-lg border border-border p-4'>
      <div className='flex items-start justify-between gap-4'>
        <div className='min-w-0 flex-1'>
          {canEdit ? (
            <Input
              value={label}
              onChange={event => setLabel(event.target.value)}
              onBlur={() => {
                if (label !== (job.label ?? '')) onUpdate({ label: label.trim() || null });
              }}
              aria-label='Scheduled job label'
              className='h-8'
            />
          ) : (
            <p className='truncate text-sm font-medium text-foreground'>{job.label || job.task}</p>
          )}
          {job.label && (
            <p className='mt-1 line-clamp-2 text-xs text-muted-foreground'>{job.task}</p>
          )}
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
          {canEdit && job.status === 'active' && (
            <Button
              type='button'
              variant='ghost'
              size='iconSm'
              disabled={busy}
              onClick={onDelete}
              data-track-category='Claw Agents'
              data-track-name='DELETE_SCHEDULED_JOB'
              aria-label='Delete scheduled job'
              className='text-muted-foreground hover:text-destructive'
            >
              <Trash2 className='size-4' />
            </Button>
          )}
        </div>
      </div>
      <div className='mt-3 divide-y divide-border border-t border-border pt-1'>
        <InfoRow label='Schedule' value={job.type === 'cron' ? job.cronExpression : 'One time'} />
        <InfoRow label='Next run' value={formatDateTime(job.nextRunAt)} />
        <InfoRow
          label='Runs'
          value={
            job.maxRuns
              ? `${job.runCount ?? job.runsCount ?? 0} of ${job.maxRuns}`
              : String(job.runCount ?? job.runsCount ?? 0)
          }
        />
        <InfoRow
          label='Reply mode'
          value={
            canEdit ? (
              <select
                value={job.replyMode ?? 'thread'}
                disabled={busy}
                data-track-category='Claw Agents'
                data-track-name='Update scheduled job reply mode'
                onChange={event =>
                  onUpdate({ replyMode: event.target.value as 'thread' | 'channel' })
                }
                className='rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground'
              >
                <option value='thread'>Reply in thread</option>
                <option value='channel'>Post to channel</option>
              </select>
            ) : job.replyMode === 'channel' ? (
              'Post to channel'
            ) : (
              'Reply in thread'
            )
          }
        />
        <InfoRow label='Created' value={formatDateTime(job.createdAt)} />
      </div>
    </div>
  );
};

const ScheduleTab = ({ agent, permissions }: ScheduleTabProps): ReactElement => {
  const { data: jobs, isLoading } = useClawScheduledJobs(agent.slug);
  const { data: runs = [], isLoading: runsLoading } = useClawScheduledJobRuns(agent.slug);
  const { update, remove } = useClawScheduledJobMutations(agent.slug);

  const updateJob = async (
    job: ScheduledJob,
    patch: { replyMode?: 'thread' | 'channel'; label?: string | null },
  ): Promise<void> => {
    try {
      await update.mutateAsync({ id: job.id, patch });
      toast.success('Scheduled job updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update scheduled job');
    }
  };

  const deleteJob = async (job: ScheduledJob): Promise<void> => {
    if (!window.confirm(`Delete the scheduled job “${job.label || job.task}”?`)) return;
    try {
      await remove.mutateAsync(job.id);
      toast.success('Scheduled job deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete scheduled job');
    }
  };

  return (
    <div className='flex max-w-2xl flex-col gap-6'>
      <DetailSection
        title='Scheduled jobs'
        description='Recurring and one-off tasks that run this agent automatically.'
      >
        {isLoading ? (
          <div className='flex flex-col gap-2 rounded-lg border border-border p-4'>
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-4 w-4/5' />
            <Skeleton className='h-4 w-2/3' />
          </div>
        ) : !jobs?.length ? (
          <EmptyPanel
            title='No scheduled jobs'
            description='This agent does not have any automatic runs configured.'
          />
        ) : (
          <div className='flex flex-col gap-3'>
            {jobs.map(job => (
              <EditableJob
                key={job.id}
                job={job}
                canEdit={permissions.canEdit}
                busy={update.isPending || remove.isPending}
                onUpdate={patch => void updateJob(job, patch)}
                onDelete={() => void deleteJob(job)}
              />
            ))}
          </div>
        )}
      </DetailSection>

      <DetailSection
        title='Run history'
        description='Recent executions started by these schedules.'
      >
        {runsLoading ? (
          <Skeleton className='h-20 w-full' />
        ) : runs.length === 0 ? (
          <EmptyPanel
            title='No scheduled runs'
            description='Completed and failed scheduled runs will appear here.'
          />
        ) : (
          <div className='divide-y divide-border overflow-hidden rounded-lg border border-border'>
            {runs.map(run => (
              <div key={run.id} className='flex items-start gap-3 px-3 py-3'>
                <History className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-sm font-medium text-foreground'>
                    {run.scheduledJob?.label || run.scheduledJob?.task || 'Scheduled run'}
                  </p>
                  <p className='text-xs text-muted-foreground'>{formatDateTime(run.startedAt)}</p>
                  {run.error && <p className='mt-1 text-xs text-destructive'>{run.error}</p>}
                </div>
                <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </DetailSection>
    </div>
  );
};

export default ScheduleTab;
