import { useEffect, useState } from 'react';
import { useRunsList } from '../../hooks/use-runs-list.js';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { RunsTable } from '../runs/RunsTable.js';
import { LoadingSpinner } from '../shared/LoadingSpinner.js';
import { cn } from '../shared/cn.js';

export interface WorkflowRunsPanelProps {
  workflowId: string;
  onSelectExecution: (executionId: string) => void;
  className?: string;
}

type UIStatus = '' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';

const STATUS_OPTIONS: Array<{ value: UIStatus; label: string }> = [
  { value: '', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
];

function mapStatusToApi(ui: UIStatus): string | undefined {
  if (!ui) return undefined;
  if (ui === 'paused') return 'EXTERNAL_WAIT';
  return ui.toUpperCase();
}

interface StepData {
  error?: string;
}

function parseError(data: string | null): string | undefined {
  if (!data) return undefined;
  try {
    return (JSON.parse(data) as StepData).error;
  } catch {
    return undefined;
  }
}

export function WorkflowRunsPanel({ workflowId, onSelectExecution, className }: WorkflowRunsPanelProps) {
  const client = useWorkflowClient();
  const [uiStatus, setUiStatus] = useState<UIStatus>('');
  const [errorByExecutionId, setErrorByExecutionId] = useState<Record<string, string>>({});

  const apiStatus = mapStatusToApi(uiStatus);
  const { executions, isLoading, error, hasMore, loadMore } = useRunsList({
    workflowId,
    ...(apiStatus ? { status: apiStatus } : {}),
  });

  // Lazily fetch error details for FAILED executions only
  useEffect(() => {
    const failedIds = executions
      .filter((e) => e.status === 'FAILED')
      .map((e) => e.id)
      .filter((id) => !(id in errorByExecutionId));

    if (failedIds.length === 0) return;

    let cancelled = false;

    void Promise.all(
      failedIds.map((id) =>
        client.executions.get(id).then((detail) => {
          if (cancelled) return;
          const failedStep = detail.steps.find((s) => s.status === 'FAILED');
          const err = failedStep ? parseError(failedStep.data) : undefined;
          if (err) {
            setErrorByExecutionId((prev) => ({ ...prev, [id]: err }));
          } else {
            // Mark as fetched even with no error so we don't re-fetch
            setErrorByExecutionId((prev) => ({ ...prev, [id]: '' }));
          }
        }).catch(() => {
          if (!cancelled) {
            setErrorByExecutionId((prev) => ({ ...prev, [id]: '' }));
          }
        }),
      ),
    );

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, executions]);

  // Filter out placeholder empty-string entries for display
  const displayErrors = Object.fromEntries(
    Object.entries(errorByExecutionId).filter(([, v]) => v !== ''),
  );

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center" aria-label="Loading">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-[var(--wui-status-failed)]">
        Failed to load runs
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Status filter */}
      <div className="flex items-center gap-1.5">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setUiStatus(opt.value)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
              uiStatus === opt.value
                ? 'border-[var(--wui-primary)] bg-[var(--wui-primary)]/10 text-[var(--wui-primary)]'
                : 'border-[var(--wui-border)] text-[var(--wui-fg-muted)] hover:border-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <RunsTable
        executions={executions}
        onSelectExecution={onSelectExecution}
        {...(Object.keys(displayErrors).length > 0 ? { errorByExecutionId: displayErrors } : {})}
      />

      {hasMore && (
        <button
          onClick={loadMore}
          className="self-center rounded-md border border-[var(--wui-border)] px-3 py-1.5 text-xs font-medium text-[var(--wui-fg-muted)] transition-colors hover:text-[var(--wui-fg)]"
        >
          Load more
        </button>
      )}
    </div>
  );
}
