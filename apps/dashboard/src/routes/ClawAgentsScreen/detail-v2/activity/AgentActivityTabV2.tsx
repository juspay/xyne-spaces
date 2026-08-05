import { useMemo, useRef, useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock, Loader2, Workflow } from 'lucide-react';
import { PlusDefault, SearchDefault } from '@xyne/icons';
import { useAuth } from '@/hooks/useAuth';
import { useClawAgentRuns, type AgentRunStatusFilter } from '@/hooks/useClawAgentRuns';
import { useClawScheduledJobMutations, useClawScheduledJobs } from '@/hooks/useClawScheduledJobs';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { Pill } from '../../create-v2/shared/Pill';
import { BehaviourSelect } from '../behaviour/BehaviourRows';
import { DetailListCard, type DetailListItem } from '../DetailListCard';
import { DetailCard, DetailEmpty, DetailEmptyState, DetailSection } from '../DetailPrimitives';
import { useAgentChainWorkflows } from './chainWorkflowsService';
import { createScheduledJob, type NewScheduledJob } from './createScheduledJob';
import { CreateScheduleDialog } from './CreateScheduleDialog';

const ICON_BUTTON =
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40';

const STATUS_OPTIONS: ReadonlyArray<{ value: AgentRunStatusFilter; label: string }> = [
  { value: 'all', label: 'All runs' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const RUN_TONE: Record<string, 'success' | 'neutral' | 'danger'> = {
  completed: 'success',
  running: 'neutral',
  failed: 'danger',
  cancelled: 'neutral',
};

function relativeTime(value: string | null): string {
  if (!value) return '';
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return '';
  const minutes = Math.floor((Date.now() - parsed) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 14 ? `${days}d ago` : new Date(parsed).toLocaleDateString();
}

function scheduleCadence(cron: string | null, nextRunAt: string | null): string {
  if (cron) return `Repeats · ${cron}`;
  if (!nextRunAt) return 'One-off';
  const parsed = new Date(nextRunAt);
  return Number.isNaN(parsed.getTime()) ? 'One-off' : `Runs once · ${parsed.toLocaleString()}`;
}

export function AgentActivityTabV2({
  agent,
  canEdit,
}: {
  agent: Agent;
  canEdit: boolean;
}): ReactElement {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [scheduleQuery, setScheduleQuery] = useState('');
  const [scheduleSearchOpen, setScheduleSearchOpen] = useState(false);
  const [runQuery, setRunQuery] = useState('');
  const [runSearchOpen, setRunSearchOpen] = useState(false);
  const [runStatus, setRunStatus] = useState<AgentRunStatusFilter>('all');
  const scheduleSearchRef = useRef<HTMLInputElement>(null);
  const runSearchRef = useRef<HTMLInputElement>(null);

  const jobs = useClawScheduledJobs(agent.slug);
  const jobMutations = useClawScheduledJobMutations(agent.slug);
  const workflows = useAgentChainWorkflows(agent.slug);
  const runs = useClawAgentRuns(agent.slug, { status: runStatus, allUsers: true });

  const scheduleItems = useMemo<DetailListItem[]>(() => {
    const q = scheduleQuery.trim().toLowerCase();
    return (jobs.data ?? [])
      .map(job => ({
        key: job.id,
        name: job.label || job.task,
        description: scheduleCadence(job.cronExpression, job.nextRunAt),
        badge: <Pill tone={job.status === 'active' ? 'success' : 'neutral'}>{job.status}</Pill>,
        ...(job.runsCount || job.runCount ? { meta: `${job.runsCount ?? job.runCount} runs` } : {}),
      }))
      .filter(item => !q || item.name.toLowerCase().includes(q));
  }, [jobs.data, scheduleQuery]);

  const workflowItems = useMemo<DetailListItem[]>(
    () =>
      (workflows.data ?? []).map(workflow => ({
        key: workflow.id,
        name: workflow.name,
        description: `${(workflow.definition?.nodes ?? []).length} step${
          (workflow.definition?.nodes ?? []).length === 1 ? '' : 's'
        }`,
        badge: (
          <Pill tone={workflow.isPublished ? 'success' : 'neutral'}>
            {workflow.isPublished ? 'Published' : 'Draft'}
          </Pill>
        ),
      })),
    [workflows.data],
  );

  const runItems = useMemo(() => {
    const q = runQuery.trim().toLowerCase();
    return (runs.data ?? []).filter(
      run =>
        !q || run.task.toLowerCase().includes(q) || (run.userName ?? '').toLowerCase().includes(q),
    );
  }, [runs.data, runQuery]);

  const createSchedule = async (job: NewScheduledJob): Promise<void> => {
    if (!user?.id || creating) return;
    setCreating(true);
    try {
      await createScheduledJob(user.id, job);
      void queryClient.invalidateQueries({
        queryKey: ['claw-scheduled-jobs', agent.slug, user.id],
      });
      toast.success('Schedule created');
      setScheduleOpen(false);
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not create that schedule'));
    } finally {
      setCreating(false);
    }
  };

  const removeSchedule = (id: string, name: string): void => {
    jobMutations.remove.mutate(id, {
      onSuccess: () => toast.success(`${name} removed`),
      onError: err => toast.error(clawErrorText(err, 'Could not remove that schedule')),
    });
  };

  const toggle = (
    open: boolean,
    setOpen: (next: boolean) => void,
    setQuery: (next: string) => void,
    ref: React.RefObject<HTMLInputElement | null>,
  ): void => {
    if (open) {
      setQuery('');
      setOpen(false);
      return;
    }
    setOpen(true);
    setTimeout(() => ref.current?.focus(), 0);
  };

  const searchButton = (
    open: boolean,
    onClick: () => void,
    label: string,
    trackName: string,
  ): ReactElement => (
    <button
      type='button'
      onClick={onClick}
      aria-label={label}
      aria-expanded={open}
      data-track-category='Claw Agents'
      data-track-name={trackName}
      className={ICON_BUTTON}
    >
      <SearchDefault className='size-4' aria-hidden />
    </button>
  );

  return (
    <div className='flex w-full flex-col gap-8'>
      <DetailSection
        label='Schedules'
        info='Runs this agent starts on its own'
        trailing={searchButton(
          scheduleSearchOpen,
          () =>
            toggle(scheduleSearchOpen, setScheduleSearchOpen, setScheduleQuery, scheduleSearchRef),
          'Search schedules',
          'Agent detail v2: toggle schedule search',
        )}
        trailingAlign='end'
      >
        {jobs.isLoading || scheduleItems.length > 0 || scheduleQuery.trim() ? (
          <DetailListCard
            items={scheduleItems}
            loading={jobs.isLoading}
            emptyLabel='No schedules matched that search.'
            canEdit={canEdit && !jobMutations.remove.isPending}
            removeLabel={item => `Remove ${item.name}`}
            onRemove={item => removeSchedule(item.key, item.name)}
          >
            {scheduleSearchOpen && (
              <div className='border-b border-border p-3'>
                <input
                  ref={scheduleSearchRef}
                  value={scheduleQuery}
                  onChange={e => setScheduleQuery(e.target.value)}
                  placeholder='Filter schedules'
                  aria-label='Filter schedules'
                  data-track-category='Claw Agents'
                  data-track-name='Agent detail v2: filter schedules'
                  className='h-9 w-full rounded-[10px] border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
                />
              </div>
            )}
          </DetailListCard>
        ) : (
          <DetailCard>
            <DetailEmptyState
              icon={<CalendarClock className='size-6' aria-hidden />}
              title='No Schedules'
              description='This agent only runs when someone asks it to'
              action={
                canEdit ? (
                  <button
                    type='button'
                    onClick={() => setScheduleOpen(true)}
                    data-track-category='Claw Agents'
                    data-track-name='Agent detail v2: open create schedule'
                    className='flex items-center gap-1.5 rounded-md bg-muted px-2 py-1.5 text-sm leading-5 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground'
                  >
                    <PlusDefault className='size-4' aria-hidden />
                    Create Schedule
                  </button>
                ) : undefined
              }
            />
          </DetailCard>
        )}
      </DetailSection>

      <DetailSection label='Workflows' info='Multi-agent chains that include this agent'>
        {workflows.isLoading || workflowItems.length > 0 ? (
          <DetailListCard
            items={workflowItems}
            loading={workflows.isLoading}
            emptyLabel='No workflows use this agent.'
            canEdit={false}
            removeLabel={item => `Remove ${item.name}`}
            onRemove={() => undefined}
          />
        ) : (
          <DetailCard>
            <DetailEmptyState
              icon={<Workflow className='size-6' aria-hidden />}
              title='No workflow yet'
              description='Start by creating workflow to show them here'
            />
          </DetailCard>
        )}
      </DetailSection>

      <DetailSection
        label='Recent runs'
        info='Every time this agent has been asked to do something'
        trailing={
          <span className='flex items-center gap-1'>
            {searchButton(
              runSearchOpen,
              () => toggle(runSearchOpen, setRunSearchOpen, setRunQuery, runSearchRef),
              'Search runs',
              'Agent detail v2: toggle run search',
            )}
            <BehaviourSelect
              value={runStatus}
              options={STATUS_OPTIONS}
              editable
              label='Filter runs by status'
              trackName='Agent detail v2: filter runs'
              onChange={next => setRunStatus(next as AgentRunStatusFilter)}
            />
          </span>
        }
        trailingAlign='end'
      >
        <DetailCard>
          {runSearchOpen && (
            <div className='border-b border-border p-3'>
              <input
                ref={runSearchRef}
                value={runQuery}
                onChange={e => setRunQuery(e.target.value)}
                placeholder='Filter runs'
                aria-label='Filter runs'
                data-track-category='Claw Agents'
                data-track-name='Agent detail v2: filter runs input'
                className='h-9 w-full rounded-[10px] border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
              />
            </div>
          )}

          {runs.isLoading ? (
            <DetailEmpty>Loading runs…</DetailEmpty>
          ) : runItems.length === 0 ? (
            <DetailEmpty>
              {runQuery.trim() || runStatus !== 'all'
                ? 'No runs matched those filters.'
                : 'This agent hasn’t run yet.'}
            </DetailEmpty>
          ) : (
            runItems.slice(0, 20).map(run => (
              <div
                key={run.id}
                className='flex w-full items-center gap-3 border-b border-border p-4 last:border-b-0'
              >
                <div className='flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden'>
                  <span className='flex min-w-0 items-center gap-1.5'>
                    <span className='truncate text-sm font-medium leading-[22px] text-foreground'>
                      {run.task || 'Untitled run'}
                    </span>
                    <Pill tone={RUN_TONE[run.status] ?? 'neutral'}>{run.status}</Pill>
                  </span>
                  <span className='truncate text-sm leading-5 text-foreground/60'>
                    {[run.userName || run.userEmail, run.triggerSource, relativeTime(run.startedAt)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                {run.status === 'running' && (
                  <Loader2
                    className='size-3.5 shrink-0 animate-spin text-muted-foreground'
                    aria-hidden
                  />
                )}
              </div>
            ))
          )}

          {runItems.length > 20 && (
            <p className='flex w-full items-center border-t border-border bg-muted/40 px-4 py-3 text-sm leading-5 text-muted-foreground'>
              Showing the 20 most recent of {runItems.length}.
            </p>
          )}
        </DetailCard>
      </DetailSection>

      <CreateScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        agentSlug={agent.slug}
        saving={creating}
        onCreate={job => void createSchedule(job)}
      />
    </div>
  );
}
