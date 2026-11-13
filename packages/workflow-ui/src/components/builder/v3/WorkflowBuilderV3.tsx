import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import type { AiBuilderClient } from '@xyne/workflow-sdk/ai-builder';
import { useWorkflowBuilder, type UseWorkflowBuilderReturn } from '../../../hooks/use-workflow-builder.js';
import { useStepMetadata } from '../../../hooks/use-step-metadata.js';
import { WorkflowCanvas } from './WorkflowCanvas.js';
import { SidePanel } from './SidePanel.js';
import { AiBuilderPanel } from './AiBuilderPanel.js';
import { StepPicker, type StepPickerContext } from './StepPicker.js';
import { TriggerPicker } from './TriggerPicker.js';
import { BuilderToolbar } from './BuilderToolbar.js';
import { SummaryButton } from './SummaryButton.js';
import { IssueBar } from './IssueBar.js';
import { SaveValidationDialog } from './SaveValidationDialog.js';
import { DeleteStepDialog } from './DeleteStepDialog.js';
import { groupIssues } from '../../../utils/issue-mapping.js';
import { useWorkflowClient } from '../../../hooks/use-workflow-client.js';
import { findStepsReferencing } from '@xyne/workflow-sdk/builder';
import type { ValidationResult } from '@xyne/workflow-sdk';
import { cn } from '../../shared/cn.js';

/** Whether the config panel is showing (step or trigger selected). */
function isPanelOpen(
  selectedStepId: string | null,
  isTriggerSelected: boolean,
  isVariablesSelected: boolean,
): boolean {
  return !!selectedStepId || isTriggerSelected || isVariablesSelected;
}

export interface WorkflowBuilderV3Props {
  /**
   * The saved workflow's id. Lets the trigger panel show a webhook trigger's URL;
   * a workflow that was never saved has none yet.
   */
  workflowId?: string | undefined;
  builder?: UseWorkflowBuilderReturn | undefined;
  initialConfig?: WorkflowConfig | undefined;
  /** Initial workflow summary (a record-level column, edited via the popover). */
  initialSummary?: string | null | undefined;
  onChange?: ((config: WorkflowConfig) => void) | undefined;
  /** Persists the workflow. Summary travels with config in one save call. */
  onSave?: ((config: WorkflowConfig, summary: string | null) => Promise<void>) | undefined;
  onTestRun?: ((config: WorkflowConfig) => void) | undefined;
  readOnly?: boolean | undefined;
  className?: string | undefined;
  /** If provided, the "Ask AI" button appears in the toolbar. */
  aiBuilderClient?: AiBuilderClient | undefined;
  /**
   * Fires whenever the selected step changes, `null` when the selection is cleared.
   *
   * Observation only — selection stays owned by the builder, because adding, deleting and
   * renaming a step all move it internally. The counterpart to `ExecutionViewer`'s
   * `onSelectStep`, so a host can mirror the builder's focus the same way it already can
   * for a run: deep-linking, analytics, or scoping its own side panels to the node in view.
   */
  onSelectStep?: ((stepId: string | null) => void) | undefined;
  /**
   * Fires when the builder gains or loses unsaved changes.
   *
   * Observation only, like {@link onSelectStep} — the edits stay the builder's.
   * A host needs this to answer a question only it can: whether it is safe to
   * replace what is on screen. Refreshing a clean builder is invisible and
   * correct; doing it while someone is mid-edit destroys their work, and the
   * host has no other way to tell the two apart.
   */
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
}

export function WorkflowBuilderV3({
  workflowId,
  builder: externalBuilder,
  initialConfig,
  initialSummary,
  onChange,
  onSave,
  readOnly = false,
  className,
  aiBuilderClient,
  onSelectStep,
  onDirtyChange,
}: WorkflowBuilderV3Props) {
  const opts: Parameters<typeof useWorkflowBuilder>[0] = { autoValidate: true };
  if (initialConfig) opts.initialConfig = initialConfig;
  if (onChange) opts.onChange = onChange;
  const internalBuilder = useWorkflowBuilder(opts);
  const builder = externalBuilder ?? internalBuilder;

  // Held in a ref so an inline arrow from the caller does not re-fire the effect on every
  // render — the host is told when the SELECTION changed, not when it re-rendered.
  const onSelectStepRef = useRef(onSelectStep);
  onSelectStepRef.current = onSelectStep;
  useEffect(() => {
    onSelectStepRef.current?.(builder.selectedStepId);
  }, [builder.selectedStepId]);

  // Same ref treatment, same reason: the host hears about dirtiness changing,
  // not about the builder re-rendering.
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyChangeRef.current?.(builder.isDirty);
  }, [builder.isDirty]);

  // ─── Validation issue surfacing (Part C) ───
  const grouped = useMemo(() => groupIssues(builder.validation), [builder.validation]);
  const issueTargets = useMemo(() => {
    const t: string[] = [];
    if (grouped.trigger.length > 0) t.push('__trigger__');
    t.push(...grouped.orderedStepIds);
    return t;
  }, [grouped]);
  const [issueCursor, setIssueCursor] = useState(0);
  const safeCursor = issueTargets.length ? Math.min(issueCursor, issueTargets.length - 1) : 0;

  const jumpToIssueTarget = useCallback((target: string) => {
    if (target === '__trigger__') {
      builder.selectTrigger();
      return;
    }
    builder.selectStep(target);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-step-id="${CSS.escape(target)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [builder]);

  const cycleIssue = useCallback((dir: 1 | -1) => {
    if (issueTargets.length === 0) return;
    const next = (safeCursor + dir + issueTargets.length) % issueTargets.length;
    setIssueCursor(next);
    jumpToIssueTarget(issueTargets[next]!);
  }, [safeCursor, issueTargets, jumpToIssueTarget]);

  // Workflow summary (record-level column). Seeded from the prop; edited via
  // the popover. `baselineSummary` is the last-persisted value, used for dirty
  // detection alongside the builder's config dirtiness.
  const [summary, setSummary] = useState(initialSummary ?? '');
  const [baselineSummary, setBaselineSummary] = useState(initialSummary ?? '');
  useEffect(() => {
    setSummary(initialSummary ?? '');
    setBaselineSummary(initialSummary ?? '');
  }, [initialSummary]);
  const summaryDirty = summary !== baselineSummary;

  // Save state. `justSaved` stays until the next edit, so the user always sees
  // whether their current changes are persisted.
  const client = useWorkflowClient();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  // Holds the validation result while the pre-save confirm dialog is open.
  const [pendingValidation, setPendingValidation] = useState<ValidationResult | null>(null);

  // The actual persist — used directly when valid, or via "Save anyway".
  const doSave = useCallback(async () => {
    if (!onSave || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(builder.config, summary.trim() ? summary : null);
      setBaselineSummary(summary);
      setJustSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [onSave, saving, builder.config, summary]);

  const handleSave = useCallback(async () => {
    if (!onSave || saving) return;
    // Validate fresh; on issues, confirm via the dialog before persisting.
    try {
      const result = await client.workflows.validate(builder.config);
      if (!result.valid) {
        setPendingValidation(result);
        return;
      }
    } catch {
      // A validation-endpoint failure must not block saving a draft.
    }
    await doSave();
  }, [onSave, saving, client, builder.config, doSave]);

  // Any edit after a save clears the "Saved" badge (back to an unsaved state).
  useEffect(() => {
    setJustSaved(false);
  }, [builder.config, summary]);

  const { stepMeta, triggerMeta } = useStepMetadata(builder.config);

  // AI panel state
  const [showAiPanel, setShowAiPanel] = useState(false);

  // Picker state
  const [showStepPicker, setShowStepPicker] = useState(false);
  const [stepPickerContext, setStepPickerContext] = useState<StepPickerContext>({});
  const [showTriggerPicker, setShowTriggerPicker] = useState(false);

  const handleTriggerClick = useCallback(() => {
    if (readOnly) return;
    if (!builder.isTriggerConfigured) {
      setShowTriggerPicker(true);
    } else {
      builder.selectTrigger();
    }
  }, [builder, readOnly]);

  const handleStepClick = useCallback((stepId: string) => {
    if (readOnly) return;
    builder.selectStep(stepId);
  }, [builder, readOnly]);

  const handleAddStep = useCallback((afterStepId?: string, inBranch?: { stepId: string; branchKey: string }) => {
    if (readOnly || !builder.isTriggerConfigured) return;
    setStepPickerContext({ afterStepId, inBranch });
    setShowStepPicker(true);
  }, [readOnly, builder.isTriggerConfigured]);

  /**
   * "Above this step" resolved to the placement the picker already understands,
   * so inserting above goes down the same path as every other insert.
   */
  const handleAddStepAbove = useCallback((stepId: string) => {
    if (readOnly || !builder.isTriggerConfigured) return;
    const place = builder.placeAbove(stepId);
    if (!place) return;
    setStepPickerContext(place);
    setShowStepPicker(true);
  }, [readOnly, builder]);

  const handleStepPickerSelect = useCallback((type: string, context: StepPickerContext) => {
    builder.addStep(type, context.afterStepId, context.inBranch);
  }, [builder]);

  const handleTriggerPickerSelect = useCallback((type: string) => {
    builder.setTrigger(type);
    builder.selectTrigger();
  }, [builder]);

  const handleCanvasClick = useCallback(() => {
    builder.clearSelection();
  }, [builder]);

  const selectedStep = useMemo(
    () => builder.selectedStepId ? builder.getStep(builder.selectedStepId) : null,
    [builder, builder.selectedStepId],
  );

  const stepLabel = useCallback((stepId: string) => {
    const s = builder.getStep(stepId);
    const meta = s ? stepMeta.get(s.type) : undefined;
    return s?.title || meta?.name || s?.type || stepId;
  }, [builder, stepMeta]);

  // Guarded delete: warn first if other steps reference this one (Part D).
  const [pendingDelete, setPendingDelete] = useState<{ stepId: string; labels: string[] } | null>(null);
  const requestDeleteStep = useCallback((stepId: string) => {
    const referrers = findStepsReferencing(builder.config, stepId);
    if (referrers.length > 0) {
      setPendingDelete({ stepId, labels: referrers.map(stepLabel) });
    } else {
      builder.removeStep(stepId);
    }
  }, [builder, stepLabel]);

  // Zoom state for canvas. The ref is on the scrolling element inside WorkflowCanvas —
  // not on the clipping wrapper below — because zoom has to re-anchor the viewport, and
  // only the scroller owns scrollLeft/scrollTop.
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const prevZoomRef = useRef(zoom);
  const recenterPendingRef = useRef(false);

  const centerCanvas = useCallback(() => {
    const el = canvasScrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
    el.scrollTop = 0;
  }, []);

  useLayoutEffect(() => {
    const el = canvasScrollRef.current;
    const prev = prevZoomRef.current;
    prevZoomRef.current = zoom;
    if (!el) return;

    if (recenterPendingRef.current) {
      recenterPendingRef.current = false;
      zoomAnchorRef.current = null;
      centerCanvas();
      return;
    }
    if (prev === zoom) return;

    const k = zoom / prev;
    const anchor = zoomAnchorRef.current ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    el.scrollLeft = (el.scrollLeft + anchor.x) * k - anchor.x;
    el.scrollTop = (el.scrollTop + anchor.y) * k - anchor.y;
    zoomAnchorRef.current = null;
  }, [zoom, centerCanvas]);

  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.15, 2)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.15, 0.3)), []);
  const handleFitView = useCallback(() => {
    zoomAnchorRef.current = null;
    if (zoom === 1) {
      centerCanvas();
      return;
    }
    recenterPendingRef.current = true;
    setZoom(1);
  }, [zoom, centerCanvas]);

  // Pinch-to-zoom: intercept Ctrl+wheel (trackpad pinch) to adjust canvas zoom
  useEffect(() => {
    const el = canvasScrollRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        zoomAnchorRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        setZoom((z) => {
          const delta = -e.deltaY * 0.005;
          return Math.min(2, Math.max(0.3, z + delta));
        });
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const isMeta = e.metaKey || e.ctrlKey;

      // Save: Cmd+S
      if (isMeta && e.key === 's') {
        e.preventDefault();
        if (onSave) void handleSave();
        return;
      }
      // Undo: Cmd+Z
      if (isMeta && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        builder.undo();
        return;
      }
      // Redo: Cmd+Shift+Z or Cmd+Y
      if ((isMeta && e.shiftKey && e.key === 'z') || (isMeta && e.key === 'y')) {
        e.preventDefault();
        builder.redo();
        return;
      }
      // Delete selected step: Delete or Backspace
      if ((e.key === 'Delete' || e.key === 'Backspace') && builder.selectedStepId) {
        e.preventDefault();
        requestDeleteStep(builder.selectedStepId);
        return;
      }
      // Escape: clear selection
      if (e.key === 'Escape') {
        builder.clearSelection();
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [builder, onSave, handleSave, requestDeleteStep]);

  return (
    <div className={cn('flex h-full w-full', className)} data-workflow-ui>
      {/* Canvas area — 55% when panel open, 100% when closed */}
      <div
        className="relative min-w-0 overflow-hidden bg-slate-50 transition-[flex] duration-200"
        style={{
          flex: isPanelOpen(builder.selectedStepId, builder.isTriggerSelected, builder.isVariablesSelected)
            ? '0 0 55%'
            : '1 1 100%',
        }}
      >
        <WorkflowCanvas
          scrollRef={canvasScrollRef}
          zoom={zoom}
          config={builder.config}
          stepMeta={stepMeta}
          triggerMeta={triggerMeta}
          selectedStepId={builder.selectedStepId}
          isTriggerSelected={builder.isTriggerSelected}
          isTriggerConfigured={builder.isTriggerConfigured}
          readOnly={readOnly}
          onTriggerClick={handleTriggerClick}
          onStepClick={handleStepClick}
          onAddStep={handleAddStep}
          onCanvasClick={handleCanvasClick}
          onDeleteStep={(id) => requestDeleteStep(id)}
          onDuplicateStep={(id) => builder.duplicateStep(id)}
          onToggleStepDisabled={(id) => builder.toggleStepDisabled(id)}
          onAddBranch={(stepId, container, name) => builder.addBranch(stepId, container, name)}
          onRenameBranch={(stepId, container, oldName, newName) => builder.renameBranch(stepId, container, oldName, newName)}
          onUpdateGroup={(groupId, patch) => {
            const current = builder.config.groups?.find((g) => g.id === groupId);
            if (current) builder.upsertGroup({ ...current, ...patch });
          }}
          issuesByStep={grouped.byStep}
          triggerHasIssues={grouped.trigger.length > 0}
        />

        {/* Validation issue summary bar */}
        {!readOnly && grouped.total > 0 && (
          <div className="absolute left-3 top-3 z-10">
            <IssueBar
              total={grouped.total}
              position={safeCursor + 1}
              targetCount={issueTargets.length}
              onPrev={() => cycleIssue(-1)}
              onNext={() => cycleIssue(1)}
            />
          </div>
        )}

        {/* Floating toolbar */}
        {!readOnly && (
          <BuilderToolbar
            canUndo={builder.canUndo}
            canRedo={builder.canRedo}
            onUndo={builder.undo}
            onRedo={builder.redo}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onFitView={handleFitView}
            onOpenVariables={() => builder.selectVariables()}
            variablesActive={builder.isVariablesSelected}
            variablesCount={builder.config.variables?.filter((v) => v.key.trim()).length ?? 0}
            {...(aiBuilderClient
              ? { showAiPanel, onToggleAiPanel: () => setShowAiPanel((v) => !v) }
              : {})}
          />
        )}

        {/* Save button — only when the host wired an onSave handler */}
        {!readOnly && onSave && (
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
            {saveError && (
              <span className="max-w-xs truncate rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-600" title={saveError}>
                {saveError}
              </span>
            )}
            {(builder.isDirty || summaryDirty) && !justSaved && (
              <span className="text-[11px] font-medium text-amber-600" title="Unsaved changes">● Unsaved</span>
            )}
            <SummaryButton value={summary} onChange={setSummary} />
            <button
              type="button"
              data-testid="builder-save"
              onClick={() => void handleSave()}
              disabled={saving}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-colors',
                justSaved ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-indigo-500 hover:bg-indigo-600',
                saving && 'opacity-50 cursor-not-allowed',
              )}
            >
              {justSaved ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>
                </svg>
              )}
              {saving ? 'Saving…' : justSaved ? 'Saved' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {/* Side panel */}
      <SidePanel
        selectedStep={selectedStep}
        isTriggerSelected={builder.isTriggerSelected}
        isVariablesSelected={builder.isVariablesSelected}
        variables={builder.config.variables ?? []}
        onUpdateVariables={(next) => builder.updateVariables(next)}
        config={builder.config}
        stepMeta={stepMeta}
        triggerMeta={triggerMeta}
        triggerType={builder.config.trigger.type}
        triggerConfig={(builder.config.trigger.config ?? {}) as Record<string, unknown>}
        triggerFilter={builder.config.trigger.filter}
        triggerStart={builder.config.trigger.start}
        workflowId={workflowId}
        readOnly={readOnly}
        issues={builder.selectedStepId ? grouped.byStep.get(builder.selectedStepId) : undefined}
        triggerIssues={builder.isTriggerSelected ? grouped.trigger : undefined}
        onUpdateStepConfig={(id, config) => builder.updateStepConfig(id, config)}
        onUpdateStepMeta={(id, meta) => builder.updateStepMeta(id, meta)}
        onUpsertGroup={(group) => builder.upsertGroup(group)}
        onAddStepCitation={(id, fieldPath, citation) => builder.addStepCitation(id, fieldPath, citation)}
        onRemoveStepCitation={(id, citationPath, index) => builder.removeStepCitation(id, citationPath, index)}
        onDeleteStep={(id) => requestDeleteStep(id)}
        onDuplicateStep={(id) => builder.duplicateStep(id)}
        onAddStepAbove={handleAddStepAbove}
        onToggleStepDisabled={(id) => builder.toggleStepDisabled(id)}
        onUpdateTriggerConfig={(config) => builder.updateTriggerConfig(config)}
        onUpdateRunNaming={(runNaming) => builder.updateRunNaming(runNaming)}
        onUpdateTriggerFilter={(filter) => builder.updateTriggerFilter(filter)}
        onUpdateTriggerStart={(start) => builder.updateTriggerStart(start)}
        onRequestChangeTrigger={() => setShowTriggerPicker(true)}
        onClose={() => builder.clearSelection()}
      />

      {/* AI builder panel */}
      {aiBuilderClient && (
        <AiBuilderPanel
          isOpen={showAiPanel}
          currentConfig={builder.config}
          client={aiBuilderClient}
          onApplyConfig={(config) => builder.applyConfig(config)}
          {...(onSave ? { onSave: (config: WorkflowConfig) => onSave(config, null) } : {})}
          onClose={() => setShowAiPanel(false)}
        />
      )}

      {/* Picker modals */}
      <StepPicker
        open={showStepPicker}
        context={stepPickerContext}
        onSelect={handleStepPickerSelect}
        onClose={() => setShowStepPicker(false)}
      />
      <TriggerPicker
        open={showTriggerPicker}
        onSelect={handleTriggerPickerSelect}
        onClose={() => setShowTriggerPicker(false)}
      />

      {/* Pre-save validation confirm */}
      {pendingValidation && (
        <SaveValidationDialog
          result={pendingValidation}
          stepLabel={stepLabel}
          onJump={(target) => { setPendingValidation(null); jumpToIssueTarget(target); }}
          onCancel={() => setPendingValidation(null)}
          onSaveAnyway={() => { setPendingValidation(null); void doSave(); }}
        />
      )}

      {/* Delete-a-referenced-step warning */}
      {pendingDelete && (
        <DeleteStepDialog
          stepLabel={stepLabel(pendingDelete.stepId)}
          referencingLabels={pendingDelete.labels}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            builder.removeStep(pendingDelete.stepId);
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}
