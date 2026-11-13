import { useState, type ReactNode } from 'react';
import type { Action } from '@xyne/workflow-sdk';
import { useCapabilities } from '../../hooks/queries.js';
import { WorkflowBrowser, type FolderCrumb } from './WorkflowBrowser.js';
import { HomeDashboard } from '../home/HomeDashboard.js';
import { RunsView } from '../runs/RunsView.js';
import { ApprovalsView } from '../execution/ApprovalsView.js';
import { SubmittedView } from './SubmittedView.js';
import { CredentialVault } from '../credentials/CredentialVault.js';
import { useApprovalCount } from '../../hooks/use-approval-count.js';
import { cn } from '../shared/cn.js';

export type WorkflowHomeTab =
  | 'home'
  | 'workflows'
  | 'executions'
  | 'approvals'
  | 'submitted'
  | 'credentials';

type ToastHandler = (
  kind: 'success' | 'error',
  message: string,
  opts?: { action?: { label: string; onClick: () => void } },
) => void;

export interface WorkflowHomeProps {
  /** Folder breadcrumb for the Workflows tab (lifted so it survives navigation). */
  path: FolderCrumb[];
  onPathChange: (path: FolderCrumb[]) => void;
  onSelectWorkflow: (workflowId: string, path: FolderCrumb[]) => void;
  onViewRun: (executionId: string, workflowName: string) => void;
  /** Controlled approval selection (for URL sync) — threaded to the Approvals tab. */
  approvalId?: string | null | undefined;
  onApprovalSelect?: ((id: string | null) => void) | undefined;
  /** Signed-in user, threaded to the Home dashboard's greeting. */
  user?: { name: string } | undefined;
  onToast?: ToastHandler;
  /** Open a submitted workflow for review. */
  onReviewWorkflow: (workflowId: string) => void;
  /** Which tab opens first (uncontrolled). */
  defaultTab?: WorkflowHomeTab;
  /** Controlled active tab; with onTabChange the parent (router) owns it. May be
   *  one of the fixed WorkflowHome tabs. */
  tab?: WorkflowHomeTab | undefined;
  onTabChange?: (tab: WorkflowHomeTab) => void;
  /** When provided, fills the content area (below the tab bar) instead of the active tab. */
  detailView?: ReactNode | undefined;
  /** Called when a tab is clicked while a detailView is open, so the host can close it. */
  onLeaveDetail?: (() => void) | undefined;
  /**
   * Host actions rendered at the trailing end of the tab bar.
   *
   * The tab bar is this component's only persistent chrome, so an embedder with its own
   * product affordance — an assistant, a docs link, a settings entry — has nowhere to put
   * it but on top of ours. Given the slot, the package keeps ownership of the row's
   * layout and spacing and the host supplies only the content.
   */
  headerActions?: ReactNode | undefined;
  /**
   * Host content rendered at the leading end of the tab bar, before the tabs.
   *
   * The mirror of `headerActions`: an embedder that has dropped its own chrome
   * — a host with no sidebar, say — has nowhere left to put its brand lockup,
   * and this row is the only persistent chrome here. Rendered outside the
   * `tablist` element so the tab semantics stay clean.
   */
  headerLead?: ReactNode | undefined;
  className?: string;
}

const TABS: ReadonlyArray<{ key: WorkflowHomeTab; label: string }> = [
  { key: 'home', label: 'Home' },
  { key: 'workflows', label: 'Workflows' },
  { key: 'executions', label: 'Executions' },
  { key: 'approvals', label: 'Approvals' },
  // Distinct from Approvals on purpose: that one is a paused RUN waiting on
  // whoever its step names, this one is a workflow DEFINITION waiting on an
  // admin before it may go live. Different objects, different deciders — and
  // two tabs both called "approvals" would be a coin toss every time.
  { key: 'submitted', label: 'Submitted' },
  { key: 'credentials', label: 'Credentials' },
];

/**
 * Tabs that only appear for callers who can act on them.
 *
 * Submitted is a reviewer's queue, so it is hidden from everyone who cannot
 * decide. The right to approve is a fact about the caller rather than about any
 * one workflow, which is what root `capabilities()` answers — the same call that
 * already gates the top-level "New folder" button.
 */
const TAB_REQUIRES: Partial<Record<WorkflowHomeTab, Action>> = {
  submitted: 'workflow:approve',
};

/**
 * Top-level workflow surface: a fixed four-tab shell over workflows, runs,
 * approvals, and credentials. Workflow UI owns every fixed tab; hosts may
 * customize product-specific credential metadata through the display slot.
 */
export function WorkflowHome({
  path,
  onPathChange,
  onSelectWorkflow,
  onViewRun,
  approvalId,
  onApprovalSelect,
  onToast,
  onReviewWorkflow,
  user,
  defaultTab = 'home',
  tab: controlledTab,
  onTabChange,
  detailView,
  onLeaveDetail,
  headerActions,
  headerLead,
  className,
}: WorkflowHomeProps) {
  const [internalTab, setInternalTab] = useState<WorkflowHomeTab>(defaultTab);
  const tab = controlledTab ?? internalTab;
  const selectTab = (key: WorkflowHomeTab) => {
    if (detailView) onLeaveDetail?.();
    onTabChange?.(key);
    setInternalTab(key);
  };
  // undefined ⇒ not answered yet, or no authorizer: show everything and let the
  // backend refuse, the same optimistic default `canPerform` uses.
  const rootCaps = useCapabilities();

  const tabs = TABS.filter(({ key }) => {
    const needed = TAB_REQUIRES[key];
    return needed === undefined || rootCaps === undefined || rootCaps.includes(needed);
  });

  const polledCount = useApprovalCount();
  const [liveCount, setLiveCount] = useState<number | null>(null);
  // The gate the dashboard's Review was clicked on — the URL carries only the run.
  const [reviewGate, setReviewGate] = useState<{ id: string; nodePath: string } | null>(null);
  const approvalCount = liveCount ?? polledCount;

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-[var(--wui-bg)]', className)}>
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--wui-border)] px-4">
        {headerLead ? (
          <div className="flex shrink-0 items-center pr-3">{headerLead}</div>
        ) : null}

        <div
          role="tablist"
          aria-label="Workflow sections"
          className="flex items-center gap-1"
        >
          {tabs.map(({ key, label }) => {
            const active = tab === key;
            // `undefined` means not known yet — render nothing rather than a zero.
            const showBadge = key === 'approvals' && approvalCount !== undefined && approvalCount > 0;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => { selectTab(key); }}
                className={cn(
                  'relative -mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-[13px] font-medium transition-colors',
                  active
                    ? 'border-[var(--wui-primary)] text-[var(--wui-fg)]'
                    : 'border-transparent text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
                )}
              >
                {label}
                {showBadge && (
                  <span
                    className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--wui-primary)] px-1.5 text-[11px] font-semibold leading-none text-[var(--wui-primary-fg)]"
                    aria-label={`${approvalCount} pending`}
                  >
                    {approvalCount !== undefined && approvalCount > 99 ? '99+' : approvalCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {headerActions ? (
          <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">{headerActions}</div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        {detailView ?? (
          <>
            {tab === 'home' && (
              <HomeDashboard
                className="h-full"
                {...(user ? { user } : {})}
                onReviewApproval={(id, nodePath) => {
                  setReviewGate({ id, nodePath });
                  selectTab('approvals');
                  onApprovalSelect?.(id);
                }}
                onViewApprovals={() => { selectTab('approvals'); }}
                onRunWorkflow={() => { selectTab('workflows'); }}
              />
            )}
            {tab === 'workflows' && (
              <WorkflowBrowser
                className="h-full"
                hideApprovals
                path={path}
                onPathChange={onPathChange}
                onSelectWorkflow={onSelectWorkflow}
                onViewRun={onViewRun}
                {...(onToast ? { onToast } : {})}
              />
            )}
            {tab === 'executions' && (
              <RunsView
                className="h-full"
                onSelectExecution={(id) => onViewRun(id, 'Execution')}
              />
            )}
            {tab === 'approvals' && (
              <ApprovalsView
                className="h-full"
                onViewRun={onViewRun}
                onCountChange={setLiveCount}
                selectedId={approvalId}
                initialGate={reviewGate}
                {...(onApprovalSelect ? { onSelect: onApprovalSelect } : {})}
                {...(onToast ? { onToast } : {})}
              />
            )}
            {tab === 'submitted' && (
              <SubmittedView
                className="h-full"
                onSelect={onReviewWorkflow}
                {...(onToast ? { onToast } : {})}
              />
            )}
            {tab === 'credentials' && (
              <div className="h-full overflow-auto">
                <CredentialVault {...(onToast ? { onToast } : {})} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
