import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { WorkflowBuilderV3 } from '../builder/v3/WorkflowBuilderV3.js';
import { useWorkflowDetail } from '../../hooks/queries.js';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { usePendingWorkflows } from '../../hooks/use-pending-workflows.js';
import { canPerform, friendlyMutationError } from '../../utils/permissions.js';
import { cn } from '../shared/cn.js';

export interface WorkflowReviewViewProps {
  workflowId: string;
  onBack: () => void;
  onDecided: () => void;
  onToast?: ((kind: 'success' | 'error', message: string) => void) | undefined;
  headerActions?: ReactNode | undefined;
  headerLead?: ReactNode | undefined;
  className?: string | undefined;
}

/**
 * Reviewing one submitted workflow.
 *
 * The builder, read-only — a reviewer should see the thing in the form its
 * author built it in, not a summary of it. `readOnly` is forced here rather
 * than derived from `workflow:update`, because an admin almost certainly holds
 * that action: reviewing is a mode you are in, not a right you lack. It also
 * has to be: editing a workflow in review sends it back to DRAFT, so a checker
 * who nudged a field would silently withdraw the very thing they were asked to
 * decide on.
 *
 * Run and Test are deliberately absent. A manual run does what activating
 * would, and the runtime refuses it while a workflow waits — offering the
 * button would only produce an error.
 */
export function WorkflowReviewView({
  workflowId,
  onBack,
  onDecided,
  onToast,
  headerActions,
  headerLead,
  className,
}: WorkflowReviewViewProps) {
  const client = useWorkflowClient();
  const detail = useWorkflowDetail(workflowId);
  const [busy, setBusy] = useState(false);

  // From the workflow itself, not by searching the paged queue for it.
  const status = detail.data?.status;
  const settled = status !== undefined && status !== 'PENDING_APPROVAL';

  // Only for `gatedBy`, the explanation. Absent when the workflow sits beyond
  // the loaded pages, in which case the explanation is simply omitted.
  const { items: pending, remove: removePending } = usePendingWorkflows();
  const row = useMemo(
    () => pending.find((r) => r.workflowId === workflowId),
    [pending, workflowId],
  );

  const decide = useCallback(
    async (decision: 'approve' | 'reject') => {
      setBusy(true);
      try {
        await client.workflows[decision](workflowId);
        // Without this the cached record reads PENDING_APPROVAL for its
        // `staleTime`, so the queue still lists it and the buttons still show.
        removePending(workflowId);
        onToast?.(
          'success',
          decision === 'approve' ? 'Approved and activated.' : 'Rejected.',
        );
        onDecided();
      } catch (err) {
        onToast?.('error', friendlyMutationError(err));
      } finally {
        setBusy(false);
      }
    },
    [client, workflowId, onDecided, onToast, removePending],
  );

  const mine = canPerform(detail.data?.permittedActions, 'workflow:approve');

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-[var(--wui-bg)]', className)}>
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--wui-border)] px-4 py-2.5">
        {headerLead ? (
          <div className="flex shrink-0 items-center pr-1">{headerLead}</div>
        ) : null}

        <button
          type="button"
          onClick={onBack}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-[var(--wui-fg-muted)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_6%,transparent)]"
        >
          ← Submitted
        </button>

        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-[var(--wui-fg)]">
            {detail.data?.name ?? workflowId}
          </div>
          {row && row.gatedBy.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              <span className="text-[11px] text-[var(--wui-fg-muted)]">Needs review for</span>
              {row.gatedBy.map((type: string) => (
                <span
                  key={type}
                  className="rounded bg-[var(--wui-bg-muted)] px-1.5 py-0.5 text-[11px] text-[var(--wui-fg-muted)]"
                >
                  {type}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {settled ? (
            <span className="text-[12px] text-[var(--wui-fg-muted)]">
              No longer waiting for review.
            </span>
          ) : status === undefined ? null : mine ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void decide('reject')}
                className="rounded-md px-3 py-1.5 text-[12px] font-medium text-[var(--wui-fg)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_8%,transparent)] disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void decide('approve')}
                className="rounded-md bg-[var(--wui-primary)] px-3 py-1.5 text-[12px] font-semibold text-[var(--wui-primary-fg)] hover:opacity-90 disabled:opacity-50"
              >
                Approve
              </button>
            </>
          ) : (
            <span className="text-[12px] text-[var(--wui-fg-muted)]">Awaiting review</span>
          )}
        </div>

        {headerActions ? (
          <div className="flex shrink-0 items-center gap-1 pl-1">{headerActions}</div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        {detail.data?.config ? (
          <WorkflowBuilderV3
            workflowId={workflowId}
            initialConfig={detail.data.config}
            {...(detail.data.summary !== undefined
              ? { initialSummary: detail.data.summary }
              : {})}
            readOnly
            className="h-full"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-[var(--wui-fg-muted)]">
            {detail.isLoading ? 'Loading…' : 'This workflow has no configuration to show.'}
          </div>
        )}
      </div>
    </div>
  );
}
