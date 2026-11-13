import { useMemo, useState } from 'react';
import { useRunsList } from '../../hooks/use-runs-list.js';
import { RunsTable } from './RunsTable.js';
import { LoadingSpinner } from '../shared/LoadingSpinner.js';
import { SectionToolbar, ToolbarSelect } from '../shared/Toolbar.js';
import { SearchField } from '../browser/SearchField.js';
import { LoadMore } from '../shared/LoadMore.js';
import { cn } from '../shared/cn.js';

export interface RunsViewProps {
  workflowId?: string | undefined;
  onSelectExecution: (executionId: string) => void;
  className?: string | undefined;
  classNames?: {
    root?: string | undefined;
    filters?: string | undefined;
    table?: string | undefined;
  } | undefined;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'EXTERNAL_WAIT', label: 'Paused' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'SKIPPED', label: 'Skipped' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function RunsView({
  workflowId,
  onSelectExecution,
  className,
  classNames,
}: RunsViewProps) {
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');

  const runsOpts: { workflowId?: string; status?: string } = {};
  if (workflowId) runsOpts.workflowId = workflowId;
  if (statusFilter) runsOpts.status = statusFilter;

  const { executions, isLoading, isLoadingMore, error, hasMore, loadMore } = useRunsList(runsOpts);

  // Each execution carries its workflow name (joined server-side), so no separate
  // workflow fetch / id→name map is needed — that approach capped at 500 workflows
  // and missed deleted ones, showing raw ids.
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? executions.filter(
            (e) =>
              e.id.toLowerCase().includes(q) ||
              (e.name ?? '').toLowerCase().includes(q) ||
              (e.workflowId ?? '').toLowerCase().includes(q) ||
              (e.workflowName ?? '').toLowerCase().includes(q),
          )
        : executions,
    [executions, q],
  );

  return (
    <div className={cn('flex h-full flex-col bg-[var(--wui-bg)]', classNames?.root, className)}>
      <SectionToolbar
        className={classNames?.filters}
        right={
          <>
            <ToolbarSelect
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </ToolbarSelect>
            <SearchField
              value={query}
              onChange={setQuery}
              className="w-56"
              ariaLabel="Search executions"
              placeholder="Search by run or ID"
            />
          </>
        }
      />

      {/* Only the very first load (no data yet) may replace the list. Background
          auto-refreshes keep the table mounted so the user's scroll is preserved. */}
      {isLoading && executions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      ) : error && executions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--wui-status-failed)]">
          Failed to load executions
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-5 py-5">
          <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col">
            <RunsTable
              executions={filtered}
              onSelectExecution={onSelectExecution}
              onReachEnd={loadMore}
              className={cn('min-h-0 flex-1', classNames?.table)}
            />

            {/* The table drives loading via onReachEnd, so the footer is passive
                (autoLoad off) — it just shows progress while a page is fetching. */}
            <LoadMore
              className="shrink-0"
              autoLoad={false}
              hasMore={hasMore}
              isLoading={isLoadingMore}
              onClick={loadMore}
              shown={filtered.length}
              noun="executions"
            />
          </div>
        </div>
      )}
    </div>
  );
}
