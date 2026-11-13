import { useCallback, useState } from 'react';
import type { PendingWorkflowSummary } from '@xyne/workflow-sdk';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { usePendingWorkflows } from '../../hooks/use-pending-workflows.js';
import { canPerform, friendlyMutationError } from '../../utils/permissions.js';
import { cn } from '../shared/cn.js';

type ToastHandler = (
  kind: 'success' | 'error',
  message: string,
  opts?: { action?: { label: string; onClick: () => void } },
) => void;

export interface SubmittedViewProps {
  /** Open one for review. */
  onSelect: (workflowId: string) => void;
  onToast?: ToastHandler;
  className?: string | undefined;
}


/**
 * Workflows waiting on a reviewer.
 *
 * One list for both sides: a reviewer acts on it, and the author who submitted
 * a workflow watches their own sit here. Which of the two you are is decided
 * per row by `permittedActions` — the same UI gating the rest of the package
 * uses, with the runtime still enforcing on the call.
 *
 * Loads once and refreshes when asked. Deciding on a row removes it locally
 * rather than refetching, because the answer is already known and a round trip
 * would only make the row linger.
 */
export function SubmittedView({ onSelect, onToast, className }: SubmittedViewProps) {
  const client = useWorkflowClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const {
    items,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    refresh,
    remove,
  } = usePendingWorkflows();
  const loading = isLoading || isLoadingMore;

  const decide = useCallback(
    async (row: PendingWorkflowSummary, decision: 'approve' | 'reject') => {
      setBusyId(row.workflowId);
      try {
        await client.workflows[decision](row.workflowId);
        remove(row.workflowId);
        onToast?.(
          'success',
          decision === 'approve'
            ? `${row.name ?? row.workflowId} approved and activated.`
            : `${row.name ?? row.workflowId} rejected.`,
        );
      } catch (err) {
        onToast?.('error', friendlyMutationError(err));
      } finally {
        setBusyId(null);
      }
    },
    [client, onToast],
  );

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="flex shrink-0 items-center justify-between px-4 py-2">
        <span className="text-[12px] text-[var(--wui-fg-muted)]">
          {items.length === 0 ? '' : `${String(items.length)} waiting`}
        </span>
        <button
          type="button"
          disabled={loading}
          onClick={refresh}
          className="rounded-md px-2.5 py-1 text-[12px] font-medium text-[var(--wui-fg-muted)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_6%,transparent)] disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && items.length === 0 ? (
          <Centered>Loading…</Centered>
        ) : items.length === 0 ? (
          <Centered>Nothing is waiting for review.</Centered>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 bg-[var(--wui-bg)]">
              <tr className="border-b border-[var(--wui-border)] text-left text-[11px] uppercase tracking-wide text-[var(--wui-fg-muted)]">
                <th className="px-4 py-2 font-medium">Workflow</th>
                <th className="px-4 py-2 font-medium">Needs review for</th>
                <th className="px-4 py-2 font-medium">Waiting</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const mine = canPerform(row.permittedActions, 'workflow:approve');
                return (
                  <tr
                    key={row.workflowId}
                    onClick={() => { onSelect(row.workflowId); }}
                    className="cursor-pointer border-b border-[var(--wui-border)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_4%,transparent)]"
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[var(--wui-fg)]">
                        {row.name ?? row.workflowId}
                      </div>
                      <div className="text-[11px] text-[var(--wui-fg-muted)]">
                        {row.triggerType}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {row.gatedBy.map((type: string) => (
                          <span
                            key={type}
                            className="rounded bg-[var(--wui-bg-muted)] px-1.5 py-0.5 text-[11px] text-[var(--wui-fg-muted)]"
                          >
                            {type}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--wui-fg-muted)]">
                      {waitingFor(row.submittedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {mine ? (
                        <div
                          className="flex justify-end gap-1.5"
                          onClick={(e) => { e.stopPropagation(); }}
                        >
                          <button
                            type="button"
                            disabled={busyId === row.workflowId}
                            onClick={() => void decide(row, 'reject')}
                            className="rounded-md px-2.5 py-1 text-[12px] font-medium text-[var(--wui-fg)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_8%,transparent)] disabled:opacity-50"
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            disabled={busyId === row.workflowId}
                            onClick={() => void decide(row, 'approve')}
                            className="rounded-md bg-[var(--wui-primary)] px-2.5 py-1 text-[12px] font-semibold text-[var(--wui-primary-fg)] hover:opacity-90 disabled:opacity-50"
                          >
                            Approve
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-[var(--wui-fg-muted)]">
                          Awaiting review
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {hasMore && (
          <div className="flex justify-center p-3">
            <button
              type="button"
              disabled={isLoadingMore}
              onClick={loadMore}
              className="rounded-md px-3 py-1.5 text-[12px] font-medium text-[var(--wui-fg-muted)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_6%,transparent)] disabled:opacity-50"
            >
              {isLoadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-[13px] text-[var(--wui-fg-muted)]">
      {children}
    </div>
  );
}

/** How long this has been sitting there — the thing a reviewer triages on. */
function waitingFor(since: Date | string): string {
  const mins = Math.floor((Date.now() - new Date(since).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${String(mins)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${String(hours)}h`;
  return `${String(Math.floor(hours / 24))}d`;
}
