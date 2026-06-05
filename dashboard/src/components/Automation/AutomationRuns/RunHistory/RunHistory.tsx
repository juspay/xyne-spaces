import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Hourglass, Loader2, XCircle } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../ui/Select/Select';
import { Skeleton } from '../../../ui/Skeleton';
import { Button } from '../../../ui/Button/Button';
import { fetchAutomationRuns } from '../../../../api/automationsApi';
import type { AutomationRun, AutomationRunStatus } from '../../Automation.types';
import type { RunHistoryProps } from './RunHistory.types';

const PAGE_SIZE = 50;
const SKELETON_ROWS = 6;

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'EXTERNAL_WAIT', label: 'Waiting on agent' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'SKIPPED', label: 'Skipped' },
] as const;
type StatusFilterValue = (typeof STATUS_OPTIONS)[number]['value'];

const STATUS_CLASSES: Record<AutomationRunStatus, string> = {
  SCHEDULED:
    'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400 dark:border-amber-500/40',
  RUNNING:
    'bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400 dark:border-blue-500/40',
  EXTERNAL_WAIT:
    'bg-purple-500/10 text-purple-700 border-purple-500/30 dark:text-purple-400 dark:border-purple-500/40',
  COMPLETED:
    'bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400 dark:border-green-500/40',
  FAILED: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400 dark:border-red-500/40',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
  SKIPPED: 'bg-muted text-muted-foreground border-border',
};

const DATE_PRESETS = [
  { value: 'all', label: 'All time' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
] as const;
type DatePreset = (typeof DATE_PRESETS)[number]['value'];

function datePresetToRange(preset: DatePreset): { from: number | null; to: number | null } {
  if (preset === 'all') return { from: null, to: null };
  const now = Date.now();
  const HOURS = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 } as const;
  return { from: now - HOURS[preset] * 60 * 60 * 1000, to: null };
}

export function RunHistory({
  automationId,
  onOpenRun,
  onBack,
}: RunHistoryProps): React.ReactElement {
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, refetch } =
    useInfiniteQuery({
      queryKey: ['automation-runs', automationId],
      queryFn: ({ pageParam }) =>
        fetchAutomationRuns(automationId, { limit: PAGE_SIZE, cursor: pageParam ?? null }),
      initialPageParam: null as string | null,
      getNextPageParam: lastPage => lastPage.nextCursor,
      refetchOnWindowFocus: true,
    });

  const allRows = useMemo<AutomationRun[]>(() => {
    return data?.pages.flatMap(p => p.runs) ?? [];
  }, [data]);

  // Client-side filtering on the already-fetched pages. Cheap for typical
  // page volumes; if needed later we'll push these to the REST endpoint.
  const filtered = useMemo<AutomationRun[]>(() => {
    const { from, to } = datePresetToRange(datePreset);
    return allRows.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (from !== null && from !== undefined && new Date(r.startedAt).getTime() < from)
        return false;
      if (to !== null && to !== undefined && new Date(r.startedAt).getTime() > to) return false;
      return true;
    });
  }, [allRows, statusFilter, datePreset]);

  const hasActiveFilters = statusFilter !== 'all' || datePreset !== 'all';
  const rowsEmpty = !isLoading && filtered.length === 0;

  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <div className='flex items-center gap-3 border-b border-border px-6 py-4'>
        <button
          type='button'
          onClick={onBack}
          aria-label='Back'
          data-track-category='automation-runs'
          data-track-name='run-history-back'
          className='flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40'
        >
          <ArrowLeft className='size-4' />
        </button>
        <h1 className='text-base font-semibold text-foreground'>Run history</h1>
        {hasActiveFilters && (
          <button
            type='button'
            onClick={() => {
              setStatusFilter('all');
              setDatePreset('all');
            }}
            data-track-category='automation-runs'
            data-track-name='run-history-clear-filters'
            className='ml-auto text-[11px] text-muted-foreground hover:text-foreground hover:underline'
          >
            Clear filters
          </button>
        )}
      </div>

      <div className='flex items-center gap-2 border-b border-border px-6 py-2.5'>
        <div className='w-[160px]'>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilterValue)}>
            <SelectTrigger className='h-8 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='w-[160px]'>
          <Select value={datePreset} onValueChange={v => setDatePreset(v as DatePreset)}>
            <SelectTrigger className='h-8 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_PRESETS.map(p => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div role='list' aria-label='Automation runs' className='flex-1 overflow-y-auto'>
        {isError ? (
          <div className='py-16 text-center text-sm text-red-600'>
            Failed to load runs.
            <button
              type='button'
              data-track-category='automation-runs'
              data-track-name='run-history-retry'
              onClick={() => {
                void refetch();
              }}
              className='ml-2 underline hover:no-underline'
            >
              Retry
            </button>
          </div>
        ) : isLoading ? (
          <div className='flex flex-col'>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <div key={i} className='flex items-center gap-3 border-b border-border px-6 py-3'>
                <Skeleton className='h-4 w-4 rounded-full flex-shrink-0' />
                <Skeleton className='h-3.5 w-40' />
                <Skeleton className='h-3.5 w-14 ml-2' />
                <div className='flex-1' />
                <Skeleton className='h-3 w-32' />
              </div>
            ))}
          </div>
        ) : rowsEmpty ? (
          <div className='py-16 text-center text-sm text-muted-foreground'>
            {hasActiveFilters
              ? 'No runs match the current filters.'
              : 'No runs yet. Activate the automation and trigger it to see runs here.'}
          </div>
        ) : (
          <>
            {filtered.map(run => (
              <RunRow key={run.id} run={run} onClick={() => onOpenRun(run)} />
            ))}
            {hasNextPage && (
              <div className='flex justify-center py-4'>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={isFetchingNextPage}
                  onClick={() => {
                    void fetchNextPage();
                  }}
                >
                  {isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RunRow({ run, onClick }: { run: AutomationRun; onClick: () => void }): React.ReactElement {
  const isComplete = run.status === 'COMPLETED' || run.status === 'FAILED';
  const duration =
    isComplete && run.completedAt
      ? humanDuration(new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())
      : null;

  return (
    <button
      type='button'
      onClick={onClick}
      data-track-category='automation-runs'
      data-track-name='run-history-row-open'
      className='flex h-16 w-full items-center gap-3 border-b border-border px-6 text-left hover:bg-accent/30'
    >
      <div className='flex size-9 items-center justify-center'>
        {run.status === 'COMPLETED' ? (
          <CheckCircle2 className='size-4 text-green-600' />
        ) : run.status === 'FAILED' ? (
          <XCircle className='size-4 text-red-600' />
        ) : run.status === 'EXTERNAL_WAIT' ? (
          <Hourglass className='size-4 text-purple-600' />
        ) : (
          <Loader2 className='size-4 animate-spin text-blue-600' />
        )}
      </div>
      <div className='flex flex-1 flex-col gap-0.5'>
        <div className='flex items-center gap-2'>
          <span className='font-mono text-xs text-foreground'>{run.id}</span>
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-medium',
              STATUS_CLASSES[run.status],
            )}
          >
            {run.status}
          </span>
        </div>
        {run.error && <span className='text-xs text-red-600 line-clamp-1'>{run.error}</span>}
      </div>
      <div className='flex flex-col items-end gap-0.5 text-xs text-muted-foreground'>
        <span>Started {new Date(run.startedAt).toLocaleString()}</span>
        {duration && <span>Took {duration}</span>}
      </div>
    </button>
  );
}

function humanDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}
