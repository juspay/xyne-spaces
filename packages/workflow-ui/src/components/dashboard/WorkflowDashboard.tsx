import type React from 'react';
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import type { AiBuilderClient } from '@xyne/workflow-sdk/ai-builder';
import { WorkflowBuilderV3 as WorkflowBuilder } from '../builder/v3/WorkflowBuilderV3.js';
import { ConversationalFlowEditor } from '../conversational-flow/ConversationalFlowEditor.js';
import { ConversationalFlowTest } from '../conversational-flow/test/ConversationalFlowTest.js';
import { CONVERSATIONAL_FLOW_KIND } from '@xyne/workflow-sdk/conversational-flow';
import { RunsView } from '../runs/RunsView.js';
import { ExecutionViewer } from '../execution/ExecutionViewer.js';
import { TriggerFormModal } from './TriggerFormModal.js';
import { useOptionalSlot } from '../provider/slot-resolution.js';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { wfKeys } from '../../hooks/queries.js';
import { cn } from '../shared/cn.js';
import type { Action } from '@xyne/workflow-sdk';
import type { ShareSlotProps } from '../../types/slots.js';
// From the `/types` subpath, not the package root: the root barrel reaches the
// step implementations, and one of them imports `node:dns` for its SSRF guard —
// which a bundler then tries to resolve in the browser. Type-only imports erase,
// so they may come from the root; a VALUE import must not.
import { WorkflowStatus } from '@xyne/workflow-sdk/types';
import { canPerform } from '../../utils/permissions.js';
import { LifecycleControl } from './LifecycleControl.js';
import { NameDialog } from '../browser/NameDialog.js';

type View = 'builder' | 'runs' | 'test';

function parseMeta(raw: string | null | undefined): Record<string, unknown> {
  try { return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}; }
  catch { return {}; }
}

export interface WorkflowDashboardProps {
  defaultView?: View | undefined;
  /**
   * Controlled tab; with onViewChange the parent (router) owns it. For a conversational
   * flow, `builder` is its map (Build) and `test` chats with it; other workflows
   * have no `test`.
   */
  view?: View | undefined;
  onViewChange?: ((view: View) => void) | undefined;
  /** When set, opening a run navigates (host router) instead of an inline viewer,
   *  so the URL/history carries the run. */
  onViewRun?: ((executionId: string) => void) | undefined;
  workflowId?: string | undefined;
  workflowConfig?: WorkflowConfig | undefined;
  /**
   * The workflow's `metadata.kind`. `'conversational_flow'` always offers the Conversational flow
   * tab; without it the tab appears whenever the config reads as a conversation.
   */
  kind?: string | undefined;
  /** Initial workflow summary (record column). Edited in the builder, saved via onSave. */
  summary?: string | null | undefined;
  onSave?: ((config: WorkflowConfig, summary: string | null) => Promise<void>) | undefined;
  onTestRun?: ((config: WorkflowConfig) => void) | undefined;
  className?: string | undefined;
  classNames?: {
    root?: string | undefined;
    tabs?: string | undefined;
    content?: string | undefined;
  } | undefined;
  /** If provided, shows the "Ask AI" button in the builder toolbar. */
  aiBuilderClient?: AiBuilderClient | undefined;
  /**
   * The caller's permitted actions on this workflow (from `client.workflows.get`
   * → `record.permittedActions`). Gates the builder (read-only without
   * `workflow:update`) and the Run button (`workflow:run`). Omit to allow all
   * (e.g. when no authorizer is configured).
   */
  permittedActions?: readonly Action[] | undefined;
  /** The workflow's current status — what the Activate/Deactivate control reads. */
  status?: string | undefined;
  /**
   * Fires after the lifecycle control changed the workflow, with a line saying
   * what happened. Activating can end live OR in review, so the message comes
   * from the call rather than from anything the UI guessed beforehand.
   */
  onStatusChange?: ((status: string, message: string) => void) | undefined;
  /** The workflow's display name — the default for the clone dialog. */
  workflowName?: string | undefined;
  /**
   * Fires after "Clone" created a copy, with the new workflow's id. The host
   * navigates to it (it owns routing). Omit to hide the Clone action.
   */
  onCloned?: ((workflowId: string) => void) | undefined;
  /** Fires when the builder's selected step changes. See WorkflowBuilder. */
  onSelectStep?: ((stepId: string | null) => void) | undefined;
  /** Forwarded to the builder — see {@link WorkflowBuilderV3Props.onDirtyChange}. */
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
}

export function WorkflowDashboard({
  defaultView = 'runs',
  view: controlledView,
  onViewChange,
  onViewRun,
  workflowId,
  workflowConfig,
  kind,
  summary,
  onSave,
  onTestRun,
  className,
  classNames,
  aiBuilderClient,
  permittedActions,
  status,
  onStatusChange,
  workflowName,
  onCloned,
  onSelectStep,
  onDirtyChange,
}: WorkflowDashboardProps) {
  const canEdit = canPerform(permittedActions, 'workflow:update');
  // Not while it waits: the runtime refuses a manual run on a workflow in
  // review, so the button could only produce an error.
  const canRun =
    canPerform(permittedActions, 'workflow:run') && status !== WorkflowStatus.PENDING_APPROVAL;
  // The host owns the share UI (identity/roles/transport) via the slot; we only
  // gate + render it. No slot registered → no Share affordance.
  const ShareSlot = useOptionalSlot<ShareSlotProps>('shareResource');
  const canShare = canPerform(permittedActions, 'workflow:share') && !!ShareSlot;
  const canActivate = canPerform(permittedActions, 'workflow:activate');
  const client = useWorkflowClient();
  const queryClient = useQueryClient();
  const [internalView, setInternalView] = useState<View>(defaultView);
  const activeView = controlledView ?? internalView;
  const setActiveView = useCallback(
    (v: View) => {
      onViewChange?.(v);
      setInternalView(v);
    },
    [onViewChange],
  );
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [showTriggerForm, setShowTriggerForm] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [runKey, setRunKey] = useState(0);
  // A conversational flow gets its own editor; the step builder is never shown for it.
  const conversational = kind === CONVERSATIONAL_FLOW_KIND;
  const [conversationDirty, setConversationDirty] = useState(false);

  const triggerCfg = workflowConfig?.trigger?.config as Record<string, unknown> | undefined;
  const triggerInputSchema = triggerCfg?.['inputSchema'] as Record<string, unknown> | undefined;
  const runNaming = workflowConfig?.settings?.runNaming;

  const handleRun = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!workflowId) return;
      const result = await client.workflows.trigger(workflowId, payload);
      setShowTriggerForm(false);
      if (onViewRun) {
        onViewRun(result.executionId);
        return;
      }
      setActiveView('runs');
      setRunKey((k) => k + 1);
      setSelectedExecutionId(result.executionId);
    },
    [client, workflowId, onViewRun],
  );

  const handleRunClick = useCallback(() => {
    if (!workflowId) return;
    // A workflow that asks for a run identifier needs the form even with no
    // other inputs — that is where the name is typed.
    if (triggerInputSchema || runNaming?.mode === 'user') {
      setShowTriggerForm(true);
    } else {
      void handleRun({});
    }
  }, [workflowId, triggerInputSchema, runNaming, handleRun]);

  const [cloneOpen, setCloneOpen] = useState(false);
  const canClone = canEdit && !!onCloned;

  // Copy this workflow into its own folder under a new name; the config and kind
  // carry over unchanged. Errors propagate so the dialog shows them inline.
  const submitClone = useCallback(
    async (newName: string) => {
      if (!workflowId) return;
      const record = await client.workflows.get(workflowId);
      const config = JSON.parse(record.config ?? '{}') as WorkflowConfig;
      const meta = parseMeta(record.metadata);
      const created = await client.workflows.create({
        name: newName,
        config,
        folderId: record.folderId,
        metadata: { ...meta, name: newName },
        ...(record.summary != null ? { summary: record.summary } : {}),
        ...(record.attributes ? { attributes: record.attributes } : {}),
      });
      // The list/counts for the copy's folder are now stale — invalidate so the
      // browser shows it on return without a full page reload. Match by prefix
      // (…, 'workflow-list') so it hits the list whatever page size it uses:
      // wfKeys.workflowList(folderId) appends a `null` limit that would NOT
      // prefix-match the real key's `50`.
      void queryClient.invalidateQueries({ queryKey: [...wfKeys.all, 'workflow-list'] });
      void queryClient.invalidateQueries({ queryKey: wfKeys.workflowCounts() });
      setCloneOpen(false);
      onCloned?.(created.id);
    },
    [client, queryClient, workflowId, onCloned],
  );

  // If viewing an execution, show the execution viewer full-screen
  if (selectedExecutionId) {
    return (
      <div className={cn('flex h-full flex-col', classNames?.root, className)} data-workflow-ui="">
        <div className="flex items-center border-b border-[var(--wui-border)] bg-[var(--wui-bg)] px-4 py-2.5">
          <button
            onClick={() => setSelectedExecutionId(null)}
            className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--wui-primary)] transition-colors hover:opacity-80"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Back to {activeView === 'runs' ? 'Runs' : 'Dashboard'}
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <ExecutionViewer
            executionId={selectedExecutionId}
            workflowConfig={workflowConfig}
          />

        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col', classNames?.root, className)} data-workflow-ui="">
      {/* Tab bar */}
      <div
        className={cn(
          'flex items-center gap-1 border-b border-[var(--wui-border)] bg-[var(--wui-bg)] px-4',
          classNames?.tabs,
        )}
      >
        {conversational ? (
          <>
            <TabButton
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="6" height="6" x="3" y="9" rx="1.5"/><rect width="6" height="6" x="15" y="3" rx="1.5"/><rect width="6" height="6" x="15" y="15" rx="1.5"/><path d="M9 12h3m0 0V6h3m-3 6v6h3"/>
                </svg>
              }
              label="Build"
              active={activeView === 'builder'}
              onClick={() => setActiveView('builder')}
            />
            <TabButton
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
                </svg>
              }
              label="Test"
              active={activeView === 'test'}
              onClick={() => setActiveView('test')}
            />
          </>
        ) : null}
        <TabButton
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>
            </svg>
          }
          label="Runs"
          active={activeView === 'runs'}
          onClick={() => setActiveView('runs')}
        />
        {!conversational && (
          <TabButton
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>
              </svg>
            }
            label="Builder"
            active={activeView === 'builder'}
            onClick={() => setActiveView('builder')}
          />
        )}

        {/* Actions */}
        {workflowId && (canClone || canShare || canRun || canActivate) && (
          <div className="ml-auto flex items-center gap-2">
            {canClone && (
              <button
                onClick={() => setCloneOpen(true)}
                title="Make a copy of this workflow"
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                  'text-[var(--wui-fg)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_6%,transparent)]',
                )}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                </svg>
                Clone
              </button>
            )}
            {canShare && (
              <button
                onClick={() => setShareOpen(true)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                  'text-[var(--wui-fg)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_6%,transparent)]',
                )}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>
                </svg>
                Share
              </button>
            )}
            {canRun && (
              <button
                onClick={handleRunClick}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors',
                  'bg-[var(--wui-primary)] text-[var(--wui-primary-fg)] hover:opacity-90',
                )}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Run
              </button>
            )}
            {canActivate && status !== undefined && (
              <LifecycleControl
                workflowId={workflowId}
                status={status}
                permittedActions={permittedActions}
                onChanged={(next, message) => onStatusChange?.(next, message)}
              />
            )}
          </div>
        )}
      </div>

      {workflowId && shareOpen && ShareSlot && (
        <ShareSlot
          resourceType="workflow"
          resourceId={workflowId}
          onClose={() => setShareOpen(false)}
        />
      )}

      <NameDialog
        open={cloneOpen}
        title="Clone workflow"
        description="Makes a copy in the same folder. The copy keeps every step and setting; only the name changes."
        label="New workflow name"
        placeholder="e.g. My workflow copy"
        submitLabel="Clone workflow"
        initialValue={workflowName ? `${workflowName} copy` : ''}
        onSubmit={submitClone}
        onClose={() => setCloneOpen(false)}
      />

      {/* Content */}
      <div className={cn('flex-1 overflow-hidden', classNames?.content)}>
        {conversational && activeView === 'builder' && (
          <ConversationalFlowEditor
            workflowId={workflowId}
            initialConfig={workflowConfig}
            onSave={onSave ? (config) => onSave(config, null) : undefined}
            onDirtyChange={(d) => {
              setConversationDirty(d);
              onDirtyChange?.(d);
            }}
            readOnly={!canEdit}
          />
        )}
        {conversational && activeView === 'test' && (
          <ConversationalFlowTest workflowId={workflowId} config={workflowConfig} unsaved={conversationDirty} />
        )}
        {!conversational && activeView === 'builder' && (
          <WorkflowBuilder
            workflowId={workflowId}
            initialConfig={workflowConfig}
            initialSummary={summary}
            onSave={onSave}
            onTestRun={onTestRun}
            aiBuilderClient={aiBuilderClient}
            readOnly={!canEdit}
            onSelectStep={onSelectStep}
            onDirtyChange={onDirtyChange}
          />
        )}
        {activeView === 'runs' && (
          <RunsView key={runKey} workflowId={workflowId} onSelectExecution={onViewRun ?? setSelectedExecutionId} />
        )}
      </div>

      {/* Trigger form modal */}
      {showTriggerForm && (
        <TriggerFormModal
          inputSchema={triggerInputSchema}
          workflowName={workflowName}
          runNaming={runNaming}
          onSubmit={handleRun}
          onClose={() => setShowTriggerForm(false)}
        />
      )}
    </div>
  );
}

function TabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3.5 py-3 text-[13px] font-semibold transition-all duration-100',
        active
          ? 'border-b-2 border-[var(--wui-primary)] text-[var(--wui-primary)]'
          : 'border-b-2 border-transparent text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
