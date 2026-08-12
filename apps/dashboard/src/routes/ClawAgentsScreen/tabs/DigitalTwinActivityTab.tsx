import { ReactElement, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronDown,
  Loader2,
  RefreshCw,
  XCircle,
} from '@/components/ClawAgents/digitalTwin/icons';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  useClawDigitalTwinPipelineEvent,
  useClawDigitalTwinPipelineEvents,
  useClawDigitalTwinStatus,
} from '@/hooks/useClawDigitalTwin';
import type { PipelineEventSummary } from '@/services/claw/digitalTwinTypes';
import {
  activitySourceLabel,
  activitySummary,
  activityTypeLabel,
  recordTypeLabel,
} from '@/components/ClawAgents/digitalTwin/activityLanguage';
import { fmtDate, fmtRelative } from '@/components/ClawAgents/digitalTwin/format';

const RUN_TYPES = [
  ['all', 'All work'],
  ['backfill', 'History import'],
  ['daily', 'Daily learning'],
  ['upload', 'File import'],
  ['twin-approval', 'Twin reply'],
  ['synthesize', 'Profile refresh'],
  ['gate', 'Reply decision'],
] as const;

const STATUSES = [
  ['all', 'Any status'],
  ['running', 'Running'],
  ['retry', 'Retrying'],
  ['ok', 'Completed'],
  ['empty', 'No changes'],
  ['error', 'Error'],
] as const;

const SOURCES = [
  ['all', 'All sources'],
  ['messages', 'Messages'],
  ['calls', 'Calls'],
  ['canvases', 'Canvases'],
] as const;

const durationLabel = (milliseconds: number): string => {
  if (!milliseconds) return '—';
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
};

const statusMeta = (status: string): { label: string; icon: typeof Clock; className: string } => {
  if (status === 'ok') {
    return {
      label: 'Completed',
      icon: CheckCircle2,
      className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    };
  }
  if (status === 'error') {
    return {
      label: 'Error',
      icon: XCircle,
      className: 'border-destructive/25 bg-destructive/10 text-destructive',
    };
  }
  if (status === 'running' || status === 'retry') {
    return {
      label: status === 'retry' ? 'Retrying' : 'Running',
      icon: Loader2,
      className: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    };
  }
  return {
    label: 'No changes',
    icon: Clock,
    className: 'border-border bg-muted text-muted-foreground',
  };
};

const EventRow = ({
  event,
  selected,
  onSelect,
}: {
  event: PipelineEventSummary;
  selected: boolean;
  onSelect: () => void;
}): ReactElement => {
  const meta = statusMeta(event.status);
  const StatusIcon = meta.icon;
  return (
    <button
      type='button'
      onClick={onSelect}
      aria-pressed={selected}
      data-track-category='Claw Agents'
      data-track-name='Digital Twin open activity event'
      className={
        selected
          ? 'w-full border-b border-l-2 border-b-border border-l-primary bg-accent px-4 py-4 text-left'
          : 'w-full border-b border-l-2 border-b-border border-l-transparent px-4 py-4 text-left transition-colors hover:bg-accent/60'
      }
    >
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <p className='text-sm font-medium text-foreground'>{activityTypeLabel(event.runType)}</p>
          <p className='mt-1 text-xs text-muted-foreground'>
            {event.sourceKind ? `${activitySourceLabel(event.sourceKind)} · ` : ''}
            {fmtRelative(event.createdAt)}
          </p>
        </div>
        <Badge variant='outline' className={meta.className}>
          <StatusIcon
            className={
              event.status === 'running' || event.status === 'retry'
                ? 'size-3 animate-spin'
                : 'size-3'
            }
          />
          {meta.label}
        </Badge>
      </div>
      <p className='mt-3 text-xs leading-5 text-muted-foreground'>{activitySummary(event)}</p>
    </button>
  );
};

const DigitalTwinActivityTab = (): ReactElement => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: twinStatus } = useClawDigitalTwinStatus();
  const [runType, setRunType] = useState('all');
  const [status, setStatus] = useState('all');
  const [sourceKind, setSourceKind] = useState('all');
  const selectedId = searchParams.get('event');
  const live = !!(twinStatus?.backfill?.overall.running || twinStatus?.memoryDeleteInProgress);
  const eventsQuery = useClawDigitalTwinPipelineEvents(
    {
      limit: 50,
      ...(runType !== 'all' ? { runType } : {}),
      ...(status !== 'all' ? { status } : {}),
      ...(sourceKind !== 'all' ? { sourceKind } : {}),
    },
    live,
  );
  const detailQuery = useClawDigitalTwinPipelineEvent(selectedId);
  const events = useMemo(
    () => eventsQuery.data?.pages.flatMap(page => page.events) ?? [],
    [eventsQuery.data],
  );
  const updatingLive =
    live || events.some(event => event.status === 'running' || event.status === 'retry');

  useEffect((): void => {
    if (!selectedId && events[0]) setSearchParams({ event: events[0].id }, { replace: true });
  }, [events, selectedId, setSearchParams]);

  return (
    <div className='flex flex-col gap-5'>
      <div className='grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end'>
        <div>
          <h2 className='text-lg font-semibold text-foreground'>Recent activity</h2>
          <p className='mt-1 max-w-[70ch] text-sm text-muted-foreground'>
            See what your Twin checked, what it suggested, and whether the work finished.
          </p>
        </div>
        {updatingLive && (
          <Badge
            variant='outline'
            className='border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
            aria-live='polite'
          >
            <Loader2 className='size-3 animate-spin' /> Updating live
          </Badge>
        )}
      </div>

      <details className='rounded-xl border border-border bg-card'>
        <summary className='flex min-h-10 cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground'>
          Filter activity
          <ChevronDown className='ml-auto size-4' />
        </summary>
        <div className='grid gap-3 border-t border-border bg-muted/20 p-3 sm:grid-cols-3'>
          <div>
            <span
              id='digital-twin-activity-work-type-label'
              className='mb-1.5 block text-xs font-medium text-foreground'
            >
              Work type
            </span>
            <Select
              value={runType}
              onValueChange={value => {
                setRunType(value);
                setSearchParams({}, { replace: true });
              }}
            >
              <SelectTrigger
                className='w-full'
                aria-labelledby='digital-twin-activity-work-type-label'
                data-track-category='Claw Agents'
                data-track-name='Digital Twin filter activity work type'
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RUN_TYPES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <span
              id='digital-twin-activity-status-label'
              className='mb-1.5 block text-xs font-medium text-foreground'
            >
              Status
            </span>
            <Select
              value={status}
              onValueChange={value => {
                setStatus(value);
                setSearchParams({}, { replace: true });
              }}
            >
              <SelectTrigger
                className='w-full'
                aria-labelledby='digital-twin-activity-status-label'
                data-track-category='Claw Agents'
                data-track-name='Digital Twin filter activity status'
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <span
              id='digital-twin-activity-source-label'
              className='mb-1.5 block text-xs font-medium text-foreground'
            >
              Source
            </span>
            <Select
              value={sourceKind}
              onValueChange={value => {
                setSourceKind(value);
                setSearchParams({}, { replace: true });
              }}
            >
              <SelectTrigger
                className='w-full'
                aria-labelledby='digital-twin-activity-source-label'
                data-track-category='Claw Agents'
                data-track-name='Digital Twin filter activity source'
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </details>

      {eventsQuery.isError && (
        <div role='alert' className='rounded-xl border border-destructive/30 bg-destructive/5 p-4'>
          <p className='text-sm font-semibold text-destructive'>Activity did not load.</p>
          <p className='mt-1 text-sm text-muted-foreground'>{eventsQuery.error.message}</p>
          <Button
            variant='outline'
            size='sm'
            className='mt-3'
            onClick={() => void eventsQuery.refetch()}
          >
            <RefreshCw className='size-4' />
            Try again
          </Button>
        </div>
      )}

      {eventsQuery.isLoading ? (
        <div className='grid min-h-[560px] gap-0 overflow-hidden rounded-xl border border-border lg:grid-cols-[390px_minmax(0,1fr)]'>
          <Skeleton className='h-full' />
          <Skeleton className='h-full' />
        </div>
      ) : !eventsQuery.isError && events.length === 0 ? (
        <div className='flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-8 py-12 text-center'>
          <Activity className='size-7 text-muted-foreground' />
          <h3 className='mt-4 text-base font-semibold text-foreground'>
            No activity matches these filters
          </h3>
          <p className='mt-1 max-w-[58ch] text-sm text-muted-foreground'>
            Activity appears after history imports, file uploads, daily learning, profile refreshes,
            or reply decisions.
          </p>
        </div>
      ) : (
        !eventsQuery.isError && (
          <div className='dt-responsive-split grid min-h-[620px] grid-cols-[390px_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card'>
            <section className='border-r border-border bg-muted/20' aria-label='Learning events'>
              {events.map(event => (
                <EventRow
                  key={event.id}
                  event={event}
                  selected={event.id === selectedId}
                  onSelect={() => setSearchParams({ event: event.id })}
                />
              ))}
              {eventsQuery.hasNextPage && (
                <div className='p-4'>
                  <Button
                    variant='outline'
                    size='sm'
                    className='w-full'
                    loading={eventsQuery.isFetchingNextPage}
                    onClick={() => void eventsQuery.fetchNextPage()}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin load older activity'
                  >
                    Load older activity
                  </Button>
                </div>
              )}
            </section>

            <section className='min-w-0 px-6 py-5' aria-label='Activity detail'>
              {detailQuery.isLoading && (
                <div className='flex flex-col gap-4'>
                  <Skeleton className='h-8 w-56' />
                  <Skeleton className='h-28 w-full' />
                  <Skeleton className='h-72 w-full' />
                </div>
              )}
              {detailQuery.isError && (
                <div
                  role='alert'
                  className='rounded-xl border border-destructive/30 bg-destructive/5 p-4'
                >
                  <p className='text-sm font-semibold text-destructive'>This event did not load.</p>
                  <p className='mt-1 text-sm text-muted-foreground'>{detailQuery.error.message}</p>
                  <Button
                    variant='outline'
                    size='sm'
                    className='mt-3'
                    onClick={() => void detailQuery.refetch()}
                  >
                    Try again
                  </Button>
                </div>
              )}
              {detailQuery.data && (
                <div className='flex flex-col gap-7'>
                  <div>
                    <div className='flex flex-wrap items-center gap-3'>
                      <h3 className='text-lg font-semibold text-foreground'>
                        {activityTypeLabel(detailQuery.data.runType)}
                      </h3>
                      {((): ReactElement => {
                        const meta = statusMeta(detailQuery.data.status);
                        const StatusIcon = meta.icon;
                        return (
                          <Badge variant='outline' className={meta.className}>
                            <StatusIcon className='size-3' />
                            {meta.label}
                          </Badge>
                        );
                      })()}
                    </div>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      {fmtDate(detailQuery.data.createdAt)}
                    </p>
                    <p className='mt-4 max-w-[70ch] text-sm leading-6 text-foreground'>
                      {activitySummary(detailQuery.data)}
                    </p>
                    {detailQuery.data.error && (
                      <p className='mt-4 flex gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
                        <AlertTriangle className='mt-0.5 size-4 shrink-0' />
                        {detailQuery.data.error}
                      </p>
                    )}
                  </div>

                  <section>
                    <h4 className='text-sm font-semibold text-foreground'>What it looked at</h4>
                    {detailQuery.data.records?.length ? (
                      <div className='mt-3 flex flex-col'>
                        {detailQuery.data.records.map(record => (
                          <article
                            key={record.id}
                            className='border-b border-border py-4 last:border-b-0'
                          >
                            <div className='flex flex-wrap items-center gap-2 text-sm'>
                              <span className='font-medium text-foreground'>
                                {recordTypeLabel(record.type)}
                              </span>
                              {record.channelName && (
                                <span className='text-muted-foreground'>#{record.channelName}</span>
                              )}
                              <time className='ml-auto text-muted-foreground' dateTime={record.ts}>
                                {fmtDate(record.ts)}
                              </time>
                            </div>
                            <p className='mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground'>
                              {record.textPreview}
                            </p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className='mt-2 text-sm text-muted-foreground'>
                        No source previews were retained.
                      </p>
                    )}
                  </section>

                  <details className='border-t border-border pt-2'>
                    <summary className='flex min-h-9 cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'>
                      Technical details for support
                      <ChevronDown className='ml-auto size-4' />
                    </summary>
                    <dl className='dt-technical-details mt-2 text-sm'>
                      <div>
                        <dt>Duration</dt>
                        <dd>{durationLabel(detailQuery.data.durationMs)}</dd>
                      </div>
                      <div>
                        <dt>Records checked</dt>
                        <dd>{detailQuery.data.recordCount.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Suggestions</dt>
                        <dd>{detailQuery.data.emittedCount.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Accepted</dt>
                        <dd>
                          {(
                            detailQuery.data.approvedCount ?? detailQuery.data.autoApproved
                          ).toLocaleString()}
                        </dd>
                      </div>
                    </dl>
                    {detailQuery.data.trace && (
                      <details className='mt-4 rounded-lg border border-border bg-muted/20'>
                        <summary className='min-h-9 cursor-pointer px-4 py-2 text-xs font-medium text-muted-foreground'>
                          Show raw support record
                        </summary>
                        <pre className='max-h-[420px] overflow-auto border-t border-border p-4 text-xs leading-5 text-muted-foreground'>
                          {JSON.stringify(detailQuery.data.trace, null, 2)}
                        </pre>
                      </details>
                    )}
                  </details>
                </div>
              )}
            </section>
          </div>
        )
      )}
    </div>
  );
};

export default DigitalTwinActivityTab;
