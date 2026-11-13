import type { PendingApprovalSummary } from '@xyne/workflow-sdk/client';
import { cn } from '../shared/cn.js';
import {
  formatDue,
  formatRaisedAt,
  type ApprovalTone,
} from '../../utils/home-format.js';

const TONE_ACCENT: Record<ApprovalTone, string> = {
  danger: 'before:bg-[var(--wui-status-failed)]',
  warning: 'before:bg-[var(--wui-status-paused)]',
  neutral: 'before:bg-[var(--wui-border-strong)]',
};

export interface ApprovalRowProps {
  approval: PendingApprovalSummary;
  tone: ApprovalTone;
  onReview: (approvalId: string, nodePath: string) => void;
}

/**
 * One pending gate.
 *
 *   ▌ retail-loan-doc-verification    1h 30m before due   [ Review ]
 *   ▌ credit_head_approval                  26 Aug 2026
 *
 * Three columns: what is waiting, its deadline (or "No deadline"), and the
 * action. The timing column is a fixed width so the Review buttons form a
 * straight edge however long the names beside them are.
 */
export function ApprovalRow({ approval, tone, onReview }: ApprovalRowProps) {
  const workflowName = approval.workflowName ?? approval.workflowId;

  return (
    <li
      className={cn(
        'relative flex items-center gap-4 border-b border-[var(--wui-border)] py-3 pl-5 pr-4 transition-colors last:border-b-0 hover:bg-[var(--wui-bg-subtle)]',
        // Inset accent bar rather than a border: a full-bleed edge reads as a
        // table rule, not as a status marker.
        'before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-r-full before:content-[""]',
        TONE_ACCENT[tone],
      )}
    >
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[13.5px] font-medium leading-snug text-[var(--wui-fg)]"
          title={workflowName}
        >
          {workflowName}
        </p>
        <p
          className="mt-1 truncate font-mono text-[11.5px] leading-none text-[var(--wui-fg-muted)]"
          title={approval.pausedStepName}
        >
          {approval.pausedStepName || 'approval'}
        </p>
      </div>

      <div className="flex w-[150px] shrink-0 flex-col items-end gap-1">
        {/* A real deadline is coloured by urgency. "No deadline" is the absence
            of one, so it is stated plainly and de-emphasised — never coloured,
            and never dressed up as a countdown. */}
        <span
          className={cn(
            'whitespace-nowrap text-[12px] font-medium tabular-nums leading-none',
            approval.dueAt
              ? tone === 'danger'
                ? 'text-[var(--wui-status-failed)]'
                : 'text-[var(--wui-status-paused)]'
              : 'text-[var(--wui-fg-subtle)]',
          )}
        >
          {approval.dueAt ? formatDue(approval.dueAt) : 'No deadline'}
        </span>
        <span
          className="whitespace-nowrap text-[11px] tabular-nums leading-none text-[var(--wui-fg-subtle)]"
          title={`Raised ${new Date(approval.createdAt).toLocaleString()}`}
        >
          raised {formatRaisedAt(approval.createdAt)}
        </span>
      </div>

      <button
        type="button"
        onClick={() => { onReview(approval.id, approval.pausedNodePath); }}
        className="shrink-0 rounded-md border border-[var(--wui-border)] bg-[var(--wui-bg)] px-3 py-1.5 text-[12px] font-medium text-[var(--wui-fg-muted)] transition-all hover:border-[var(--wui-primary)] hover:bg-[var(--wui-primary)] hover:text-[var(--wui-primary-fg)]"
      >
        Review
      </button>
    </li>
  );
}
