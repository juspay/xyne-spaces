import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { wfKeys } from '../../hooks/queries.js';
import { LoadingSpinner } from '../shared/LoadingSpinner.js';

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

export interface TopErrorsPanelProps {
  since: string;
  folderId?: string;
  onSelectRun?: (executionId: string, workflowId: string) => void;
  onLoad?: (hasErrors: boolean) => void;
}

export function TopErrorsPanel({ since, folderId, onSelectRun, onLoad }: TopErrorsPanelProps) {
  const client = useWorkflowClient();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const { data, isPending, isError } = useQuery({
    queryKey: wfKeys.topErrors(since, folderId),
    queryFn: ({ signal }) =>
      client.analytics.topErrors(
        { since, limit: 5, ...(folderId !== undefined ? { folderId } : {}) },
        { signal },
      ),
    staleTime: 5 * 60_000,
  });
  const groups = data?.topErrors ?? [];

  // The open row belonged to the previous folder or range.
  useEffect(() => { setExpandedIndex(null); }, [since, folderId]);

  // Ref'd because hosts pass an inline arrow.
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const settled = !isPending;
  useEffect(() => {
    if (!settled) return;
    onLoadRef.current?.(!isError && groups.length > 0);
  }, [settled, isError, groups.length]);

  const isLoading = isPending;

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <LoadingSpinner size="sm" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex h-16 items-center justify-center text-xs text-[var(--wui-fg-muted)]">
        No errors in this period
      </div>
    );
  }

  const maxCount = groups[0]?.count ?? 1;

  return (
    <div className="flex flex-col gap-2">
      {groups.map((g, i) => {
        const isExpanded = expandedIndex === i;
        return (
          <div key={i} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setExpandedIndex(isExpanded ? null : i)}
              className="flex w-full items-center gap-2 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--wui-fg)]" title={g.message}>
                {truncate(g.message, 60)}
              </span>
              <span className="shrink-0 rounded-full bg-[var(--wui-status-failed)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--wui-status-failed)]">
                ×{g.count}
              </span>
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={`shrink-0 text-[var(--wui-fg-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--wui-bg-subtle)]">
              <div
                className="h-full rounded-full bg-[var(--wui-status-failed)]/60"
                style={{ width: `${Math.round((g.count / maxCount) * 100)}%` }}
              />
            </div>
            {isExpanded && (
              <div className="mt-1 flex max-h-[120px] flex-wrap gap-1 overflow-y-auto">
                {g.runs.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => onSelectRun?.(run.id, run.workflowId)}
                    className="rounded-md border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--wui-fg-muted)] transition-colors hover:border-[var(--wui-primary)] hover:text-[var(--wui-primary)]"
                  >
                    {run.id.slice(0, 8)}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
