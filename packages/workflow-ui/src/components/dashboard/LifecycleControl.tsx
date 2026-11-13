import { useCallback, useState } from 'react';
import type { ActivationOutcome } from '@xyne/workflow-sdk';
// From the `/types` subpath, not the package root: the root barrel reaches the
// step implementations, and one of them imports `node:dns` for its SSRF guard —
// which a bundler then tries to resolve in the browser. Type-only imports erase,
// so they may come from the root; a VALUE import must not.
import { WorkflowStatus } from '@xyne/workflow-sdk/types';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { canPerform } from '../../utils/permissions.js';
import type { Action } from '@xyne/workflow-sdk';
import { friendlyMutationError } from '../../utils/permissions.js';
import { cn } from '../shared/cn.js';

export interface LifecycleControlProps {
  workflowId: string;
  status: string;
  permittedActions?: readonly Action[] | undefined;
  /** Told what the workflow became, so the caller can refetch and say so. */
  onChanged: (status: string, message: string) => void;
}

/**
 * Turning a workflow on and off.
 *
 * Activating has two possible endings — live, or waiting on a reviewer — and
 * which one you get is the deployment's policy, not the author's choice. So
 * this button never promises: it says "Activate", and reports back whatever
 * the call answered. Nothing here predicts the outcome, so nothing here can
 * disagree with it.
 */
export function LifecycleControl({
  workflowId,
  status,
  permittedActions,
  onChanged,
}: LifecycleControlProps) {
  const client = useWorkflowClient();
  const [busy, setBusy] = useState(false);

  const live = status === WorkflowStatus.ACTIVE;
  const waiting = status === WorkflowStatus.PENDING_APPROVAL;

  const run = useCallback(
    async (fn: () => Promise<{ status: string; message: string }>) => {
      setBusy(true);
      try {
        const { status: next, message } = await fn();
        onChanged(next, message);
      } catch (err) {
        onChanged(status, friendlyMutationError(err));
      } finally {
        setBusy(false);
      }
    },
    [onChanged, status],
  );

  const activate = useCallback(
    () =>
      run(async () => {
        const outcome: ActivationOutcome = await client.workflows.activate(workflowId);
        return {
          status: outcome.status,
          message:
            outcome.status === WorkflowStatus.PENDING_APPROVAL
              ? sentForReview(outcome.gatedBy)
              : 'Workflow activated.',
        };
      }),
    [client, workflowId, run],
  );

  const deactivate = useCallback(
    () =>
      run(async () => {
        await client.workflows.deactivate(workflowId);
        return { status: WorkflowStatus.DISABLED, message: 'Workflow deactivated.' };
      }),
    [client, workflowId, run],
  );

  // A workflow in review is not the author's to move: withdrawing it is an
  // edit, and approving it is someone else's decision.
  if (waiting) {
    return (
      <span className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium text-[var(--wui-fg-muted)]">
        Waiting for review
      </span>
    );
  }

  if (!canPerform(permittedActions, 'workflow:activate')) return null;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void (live ? deactivate() : activate())}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50',
        live
          ? 'text-[var(--wui-fg)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_6%,transparent)]'
          : 'bg-[var(--wui-primary)] font-semibold text-[var(--wui-primary-fg)] hover:opacity-90',
      )}
    >
      {busy ? '…' : live ? 'Deactivate' : 'Activate'}
    </button>
  );
}

/** Says what happened and why, naming the components that asked for review. */
function sentForReview(gatedBy: readonly string[]): string {
  if (gatedBy.length === 0) return 'Sent for review.';
  return `Sent for review — ${gatedBy.join(', ')} needs approval.`;
}
