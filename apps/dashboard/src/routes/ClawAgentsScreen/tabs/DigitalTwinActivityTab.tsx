import { useMemo, useRef, useState, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { SearchDefault } from '@xyne/icons';
import type { AgentRunStatusFilter } from '@/hooks/useClawAgentRuns';
import { Pill } from '@/routes/AIScreen/library/shared/primitives/Pill';
import { BehaviourSelect } from '@/routes/AIScreen/library/agents/detail/behaviour/BehaviourRows';
import {
  DetailListCard,
  type DetailListItem,
} from '@/routes/AIScreen/library/shared/primitives/DetailListCard';
import {
  DetailCard,
  DetailEmpty,
  DetailSection,
} from '@/routes/AIScreen/library/shared/primitives/DetailPrimitives';
import {
  DIGITAL_TWIN_ACTIVITY_RUNS,
  DIGITAL_TWIN_ACTIVITY_SCHEDULES,
  DIGITAL_TWIN_ACTIVITY_WORKFLOWS,
} from '@/services/claw/digitalTwinActivityDemo';

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

const DigitalTwinActivityTab = (): ReactElement => {
  const [scheduleQuery, setScheduleQuery] = useState('');
  const [scheduleSearchOpen, setScheduleSearchOpen] = useState(false);
  const [runQuery, setRunQuery] = useState('');
  const [runSearchOpen, setRunSearchOpen] = useState(false);
  const [runStatus, setRunStatus] = useState<AgentRunStatusFilter>('all');
  const scheduleSearchRef = useRef<HTMLInputElement>(null);
  const runSearchRef = useRef<HTMLInputElement>(null);

  const scheduleItems = useMemo<DetailListItem[]>(() => {
    const q = scheduleQuery.trim().toLowerCase();
    return DIGITAL_TWIN_ACTIVITY_SCHEDULES.filter(
      schedule => !q || schedule.name.toLowerCase().includes(q),
    ).map(schedule => ({
      key: schedule.id,
      name: schedule.name,
      description: schedule.cadence,
      badge: (
        <Pill tone={schedule.status === 'active' ? 'success' : 'neutral'}>{schedule.status}</Pill>
      ),
      meta: `${schedule.runsCount} runs`,
    }));
  }, [scheduleQuery]);

  const workflowItems = useMemo<DetailListItem[]>(
    () =>
      DIGITAL_TWIN_ACTIVITY_WORKFLOWS.map(workflow => ({
        key: workflow.id,
        name: workflow.name,
        description: `${workflow.steps} step${workflow.steps === 1 ? '' : 's'}`,
        badge: (
          <Pill tone={workflow.published ? 'success' : 'neutral'}>
            {workflow.published ? 'Published' : 'Draft'}
          </Pill>
        ),
      })),
    [],
  );

  const runItems = useMemo(() => {
    const q = runQuery.trim().toLowerCase();
    return DIGITAL_TWIN_ACTIVITY_RUNS.filter(run => {
      if (runStatus !== 'all' && run.status !== runStatus) return false;
      return (
        !q ||
        run.task.toLowerCase().includes(q) ||
        run.userName.toLowerCase().includes(q) ||
        run.triggerSource.toLowerCase().includes(q)
      );
    });
  }, [runQuery, runStatus]);

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
          'Digital Twin activity: toggle schedule search',
        )}
        trailingAlign='end'
      >
        <DetailListCard
          items={scheduleItems}
          loading={false}
          emptyLabel='No schedules matched that search.'
          canEdit={false}
          removeLabel={item => `Remove ${item.name}`}
          onRemove={() => undefined}
        >
          {scheduleSearchOpen && (
            <div className='border-b border-border p-3'>
              <input
                ref={scheduleSearchRef}
                value={scheduleQuery}
                onChange={event => setScheduleQuery(event.target.value)}
                placeholder='Filter schedules'
                aria-label='Filter schedules'
                data-track-category='Claw Agents'
                data-track-name='Digital Twin activity: filter schedules'
                className='h-9 w-full rounded-[10px] border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
              />
            </div>
          )}
        </DetailListCard>
      </DetailSection>

      <DetailSection label='Workflows' info='Multi-agent chains that include this agent'>
        <DetailListCard
          items={workflowItems}
          loading={false}
          emptyLabel='No workflows use this agent.'
          canEdit={false}
          removeLabel={item => `Remove ${item.name}`}
          onRemove={() => undefined}
        />
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
              'Digital Twin activity: toggle run search',
            )}
            <BehaviourSelect
              value={runStatus}
              options={STATUS_OPTIONS}
              editable
              label='Filter runs by status'
              trackName='Digital Twin activity: filter runs'
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
                onChange={event => setRunQuery(event.target.value)}
                placeholder='Filter runs'
                aria-label='Filter runs'
                data-track-category='Claw Agents'
                data-track-name='Digital Twin activity: filter runs input'
                className='h-9 w-full rounded-[10px] border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
              />
            </div>
          )}

          {runItems.length === 0 ? (
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
                      {run.task}
                    </span>
                    <Pill tone={RUN_TONE[run.status] ?? 'neutral'}>{run.status}</Pill>
                  </span>
                  <span className='truncate text-sm leading-5 text-foreground/60'>
                    {[run.userName, run.triggerSource, relativeTime(run.startedAt)]
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
    </div>
  );
};

export default DigitalTwinActivityTab;
