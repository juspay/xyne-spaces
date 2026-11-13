import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowConfig, WorkflowStepConfig } from '@xyne/workflow-sdk/builder';
import { useExecutionViewer } from '../../hooks/use-execution-viewer.js';
import { buildStepStatesFromRecords, type StepExecutionState } from '../../utils/step-state.js';
import { leafStepId } from '@xyne/workflow-sdk/common';
import { AiBuilderClient } from '@xyne/workflow-sdk/ai-builder';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { RunAiChat } from '../shared/RunAiChat.js';
import { useStepMetadata } from '../../hooks/use-step-metadata.js';
import { TriggerNode } from '../builder/v3/TriggerNode.js';
import { Connector } from '../builder/v3/Connector.js';
import { TerminalNode } from '../builder/v3/TerminalNode.js';
import { ExecutionTree } from './ExecutionTree.js';
import { ExecutionTabs } from './ExecutionTabs.js';
import { ExecutionHeader } from './ExecutionHeader.js';
import { StepDetailPanel } from './StepDetailPanel.js';
import { SummaryPanel } from './SummaryPanel.js';
import { RerunDialog } from './RerunDialog.js';
import { CitationOriginContext, CitationOpenContext } from '../shared/citation-context.js';
import { CitationSourcePanel, citationDocKey, type CitationSourceDoc } from './CitationSourcePanel.js';
import { DocPreviewContext } from '../shared/DocPreviewContext.js';
import { DocumentViewer } from '../shared/DocumentViewer.js';
import type { Attachment } from '@xyne/workflow-sdk';
import { LoadingSpinner } from '../shared/LoadingSpinner.js';
import { cn } from '../shared/cn.js';
import { canPerform } from '../../utils/permissions.js';
import { useOriginInspector, OriginPanel } from './origin/OriginTrace.js';
import { type OriginResolverCtx } from './origin/origin-resolver.js';

const TRIGGER_ID = '__trigger__';

export interface ExecutionViewerProps {
  executionId: string;
  workflowConfig?: WorkflowConfig | undefined;
  className?: string | undefined;
  classNames?: {
    root?: string | undefined;
    canvas?: string | undefined;
    header?: string | undefined;
    detailPanel?: string | undefined;
  } | undefined;
  onCancel?: ((executionId: string) => void) | undefined;
  /**
   * Called after a successful rerun with the newly-created execution ID.
   * Parent typically navigates to it. When omitted, the rerun feature is
   * still available but the user stays on the current execution.
   */
  onRerunSuccess?: ((newExecutionId: string) => void) | undefined;
  /** Back affordance shown in the header — returns to the list. */
  onBack?: (() => void) | undefined;
  /** Controlled view mode + selected node, for URL/query-param sync. When the
   *  change callbacks are provided the parent (router) owns these. */
  viewMode?: 'graph' | 'tabs' | undefined;
  onViewModeChange?: ((mode: 'graph' | 'tabs') => void) | undefined;
  selectedStepId?: string | null | undefined;
  onSelectStep?: ((stepId: string | null, replace?: boolean) => void) | undefined;
  /** Controlled full-screen document preview, addressed by the attachment's
   *  stored file name so it can live in the URL. Null means no dialog. */
  fullPreviewFileId?: string | null | undefined;
  /** Return false to decline — the panel then keeps the dialog local. */
  onFullPreviewChange?: ((fileId: string | null) => boolean | void) | undefined;
  /** 'dialog' shows the document over the run; 'page' shows the document and
   *  nothing else, for a link opened cold. */
  fullPreviewMode?: 'dialog' | 'page' | undefined;
}

export function ExecutionViewer({
  executionId,
  workflowConfig,
  className,
  classNames,
  onCancel,
  onRerunSuccess,
  onBack,
  viewMode: controlledViewMode,
  onViewModeChange,
  selectedStepId: controlledSelectedStepId,
  onSelectStep,
  fullPreviewFileId = null,
  onFullPreviewChange,
  fullPreviewMode = 'dialog',
}: ExecutionViewerProps) {
  const viewer = useExecutionViewer({ executionId });
  const client = useWorkflowClient();
  const aiClient = useMemo(() => new AiBuilderClient({ baseUrl: client.baseUrl }), [client.baseUrl]);
  const [aiOpen, setAiOpen] = useState(false);
  const [internalSelectedStepId, setInternalSelectedStepId] = useState<string | null>(null);
  const selectedStepId =
    controlledSelectedStepId !== undefined ? controlledSelectedStepId : internalSelectedStepId;
  const setSelectedStepId = useCallback(
    (id: string | null, replace = false) => {
      onSelectStep?.(id, replace);
      setInternalSelectedStepId(id);
    },
    [onSelectStep],
  );
  const [internalViewMode, setInternalViewMode] = useState<'graph' | 'tabs'>('tabs');
  const viewMode = controlledViewMode ?? internalViewMode;
  const setViewMode = useCallback(
    (mode: 'graph' | 'tabs') => {
      onViewModeChange?.(mode);
      setInternalViewMode(mode);
    },
    [onViewModeChange],
  );
  const [rerunStepId, setRerunStepId] = useState<string | null>(null);
  // Summary side panel — open by default, dismissible, reopened from the header.
  const [showSummary, setShowSummary] = useState(true);
  // Shared width for the right-hand panel so a resize persists across step/summary swaps.
  const [panelWidth, setPanelWidth] = useState(360);
  // Independent width for the value-origin panel (resizable, persists while open).
  const [originPanelWidth, setOriginPanelWidth] = useState(380);

  const effectiveConfig = workflowConfig ?? viewer.execution?.config;

  const emptyConfig: WorkflowConfig = { trigger: { type: 'MANUAL', config: {} }, steps: [] };
  const { stepMeta, triggerMeta } = useStepMetadata(effectiveConfig ?? emptyConfig);

  // ─── Zoom + drag-to-pan ───
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef<{ startX: number; startY: number; scrollX: number; scrollY: number; pointerId: number; captured: boolean } | null>(null);
  const didDragRef = useRef(false);

  // Pinch-to-zoom
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom((z) => Math.min(2, Math.max(0.3, z + -e.deltaY * 0.005)));
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Drag-to-pan — pointer capture is deferred until drag threshold
  // so that clicks on child nodes (StepNode, etc.) still work normally.
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = canvasRef.current;
    if (!el) return;

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollX: el.scrollLeft,
      scrollY: el.scrollTop,
      pointerId: e.pointerId,
      captured: false,
    };
    didDragRef.current = false;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    const el = canvasRef.current;
    if (!drag || !el) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!didDragRef.current && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      didDragRef.current = true;
      if (!drag.captured) {
        el.setPointerCapture(drag.pointerId);
        drag.captured = true;
        el.style.cursor = 'grabbing';
      }
    }

    if (didDragRef.current) {
      el.scrollLeft = drag.scrollX - dx;
      el.scrollTop = drag.scrollY - dy;
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    const el = canvasRef.current;
    const drag = dragRef.current;
    if (el && drag?.captured) {
      el.style.cursor = '';
      el.releasePointerCapture(drag.pointerId);
    }
    dragRef.current = null;
  }, []);

  const handleCanvasClick = useCallback(() => {
    if (didDragRef.current) return;
    setSelectedStepId(null);
  }, []);

  const handleTriggerClick = useCallback((replace?: unknown) => {
    setSelectedStepId(TRIGGER_ID, replace === true);
  }, [setSelectedStepId]);

  // Build a flat map of step id → config for synthetic state creation
  const stepConfigMap = useMemo(() => {
    const map = new Map<string, WorkflowStepConfig>();
    if (!effectiveConfig) return map;
    const collect = (steps: WorkflowStepConfig[]) => {
      for (const s of steps) {
        map.set(s.id, s);
        if (s.config && typeof s.config === 'object') {
          const cfg = s.config as Record<string, unknown>;
          if (cfg['branches'] && typeof cfg['branches'] === 'object') {
            for (const branch of Object.values(cfg['branches'] as Record<string, unknown>)) {
              if (Array.isArray(branch)) collect(branch as WorkflowStepConfig[]);
            }
          }
          if (Array.isArray(cfg['body'])) collect(cfg['body'] as WorkflowStepConfig[]);
        }
      }
    };
    collect(effectiveConfig.steps);
    return map;
  }, [effectiveConfig]);

  // ─── Value-origin inspector (citations) ───
  const originInspector = useOriginInspector();
  // A runtime citation's source, shown beside the run rather than over it.
  // Multiple sources stay open in tabs; a document opens once — re-opening it just
  // re-activates (and re-lands) its tab. De-dup by the underlying attachment.
  const [openDocs, setOpenDocs] = useState<CitationSourceDoc[]>([]);
  const [activeDocKey, setActiveDocKey] = useState<string | null>(null);
  const [citationPanelWidth, setCitationPanelWidth] = useState(460);
  const openCitationDoc = useCallback((doc: CitationSourceDoc) => {
    const key = citationDocKey(doc);
    setOpenDocs((prev) => {
      const idx = prev.findIndex((d) => citationDocKey(d) === key);
      if (idx < 0) return [...prev, doc];
      const next = prev.slice();
      next[idx] = doc; // refresh the anchor so the existing tab lands on the new citation
      return next;
    });
    setActiveDocKey(key);
  }, []);
  const closeCitationTab = useCallback((key: string) => {
    const idx = openDocs.findIndex((d) => citationDocKey(d) === key);
    const next = openDocs.filter((d) => citationDocKey(d) !== key);
    setOpenDocs(next);
    if (activeDocKey === key) {
      const nb = next[Math.min(idx, next.length - 1)];
      setActiveDocKey(nb ? citationDocKey(nb) : null);
    }
  }, [openDocs, activeDocKey]);
  const closeCitationPanel = useCallback(() => { setOpenDocs([]); setActiveDocKey(null); }, []);
  // An attachment's "eye"/preview opens beside the run in the same source panel,
  // via DocPreviewContext — so it renders at full height instead of the modal
  // (whose content-sized height collapsed pdf.js to a blank body).
  const openDocPreview = useCallback(
    (attachment: Attachment) => { openCitationDoc({ kind: 'doc', attachment }); },
    [openCitationDoc],
  );

  // ─── URL-addressed full preview ───
  // The last URL segment names a stored attachment. Resolve it against every
  // step's output so a pasted link opens the same dialog the expand button
  // does, over the same run — rather than a separate bare page.
  const previewAttachment = useMemo(() => {
    if (!fullPreviewFileId) return undefined;
    const named = (a: Attachment | undefined): boolean =>
      !!a?.handle && a.handle.slice(a.handle.lastIndexOf('/') + 1) === fullPreviewFileId;

    for (const state of viewer.stepStates.values()) {
      const output = state.output as { attachments?: Attachment[] } | undefined;
      const hit = output?.attachments?.find(named);
      if (hit) return hit;
    }
    // A file the run was STARTED with lives in the trigger payload, not in any
    // step's output — an uploaded document is addressable too, so look there
    // as well. Trigger fields are author-defined, so scan their values rather
    // than assuming a key name.
    for (const value of Object.values(viewer.triggerData ?? {})) {
      const candidates = Array.isArray(value) ? value : [value];
      const hit = (candidates as Attachment[]).find(named);
      if (hit) return hit;
    }
    return undefined;
  }, [fullPreviewFileId, viewer.stepStates, viewer.triggerData]);

  // Runs again when the steps arrive: on a cold load the id is known long
  // before the outputs it refers to. Keyed by the ref string rather than the
  // object, because a live run rebuilds stepStates on every poll — re-opening
  // on each rebuild would fight whichever tab the user had selected.
  const previewRef = previewAttachment?.handle;
  useEffect(() => {
    if (previewAttachment) openDocPreview(previewAttachment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewRef]);

  const fileIdOf = (doc: CitationSourceDoc | null): string | null => {
    if (!doc || doc.kind !== 'doc') return null;
    const ref = doc.attachment.handle;
    return ref.slice(ref.lastIndexOf('/') + 1);
  };
  const originCtx: OriginResolverCtx = useMemo(() => {
    const groupsById = new Map((effectiveConfig?.groups ?? []).map((g) => [g.id, g] as const));
    const groupFor = (id: string) => {
      const gid = stepConfigMap.get(id)?.groupId;
      const g = gid ? groupsById.get(gid) : undefined;
      return g ? { title: g.title, description: g.description } : undefined;
    };
    const varsData: Record<string, unknown> = {};
    for (const v of (effectiveConfig?.variables ?? []) as Array<{ key?: string; value?: unknown }>) {
      if (typeof v.key === 'string') varsData[v.key] = v.value;
    }
    return {
      stepTitle: (id) => stepConfigMap.get(id)?.title,
      stepDescription: (id) => stepConfigMap.get(id)?.description,
      stepGroup: groupFor,
      stepOutput: (id) => viewer.stepStates.get(id)?.output,
      stepRawConfig: (id) => stepConfigMap.get(id)?.config,
      triggerData: viewer.triggerData,
      varsData,
      onJump: setSelectedStepId,
    };
  }, [stepConfigMap, effectiveConfig, viewer.stepStates, viewer.triggerData]);

  // A MAP iteration step is selected by its node-path (`owners_map:item#0/validate`);
  // top-level/loop/branch steps select by bare id. `selectedLeafId` is the config
  // step id either way, for config/title/schema lookups (which are keyed by bare id).
  const isNodePathSelection = !!selectedStepId && selectedStepId !== TRIGGER_ID && selectedStepId.includes('/');
  const selectedLeafId =
    selectedStepId && selectedStepId !== TRIGGER_ID ? leafStepId(selectedStepId) : selectedStepId;

  // Raw config (refs intact) of the selected step — origins are derived from it.
  const selectedRawConfig = useMemo(
    () =>
      selectedLeafId
        ? (stepConfigMap.get(selectedLeafId)?.config as Record<string, unknown> | undefined)
        : undefined,
    [selectedLeafId, stepConfigMap],
  );
  // The selected step's author citations (overlay).
  const selectedCitations = useMemo(
    () => (selectedLeafId ? stepConfigMap.get(selectedLeafId)?.citations : undefined),
    [selectedLeafId, stepConfigMap],
  );

  // Resolve selected step state — handle trigger, existing steps, and synthetic pending
  const selectedStepState: StepExecutionState | undefined = useMemo(() => {
    if (!selectedStepId) return undefined;

    // Trigger node selected — build a synthetic state with trigger data
    if (selectedStepId === TRIGGER_ID) {
      const triggerType = effectiveConfig?.trigger.type ?? 'Unknown';
      const tInfo = triggerMeta.find((t) => t.type === triggerType);
      const state: StepExecutionState = {
        stepName: tInfo?.name ?? triggerType,
        stepType: 'Trigger',
        status: viewer.stepStates.size > 0 ? 'completed' as const : 'pending' as const,
      };
      if (viewer.triggerData) {
        state.input = viewer.triggerData;
        state.output = viewer.triggerData;
      }
      return state;
    }

    // MAP iteration step (node-path id) — resolve THAT specific record so each
    // lane shows its own data, not the aggregated bare-id state.
    if (isNodePathSelection) {
      const leaf = leafStepId(selectedStepId);
      const rec = viewer.execution?.steps?.find((s) => s.stepName === selectedStepId);
      const built = rec ? buildStepStatesFromRecords([rec]).get(leaf) : undefined;
      if (built) return built; // carries this record's status/output/pauseState + nodePath
      const cfg = stepConfigMap.get(leaf);
      const m = stepMeta.get(cfg?.type ?? '');
      return { stepName: leaf, stepType: m?.name ?? cfg?.type ?? 'Unknown', status: 'pending' as const, nodePath: selectedStepId };
    }

    const existing = viewer.stepStates.get(selectedStepId);
    if (existing) return existing;

    const config = stepConfigMap.get(selectedStepId);
    const meta = stepMeta.get(config?.type ?? '');
    return {
      stepName: selectedStepId,
      stepType: meta?.name ?? config?.type ?? 'Unknown',
      status: 'pending' as const,
    };
  }, [selectedStepId, isNodePathSelection, viewer.stepStates, viewer.execution, viewer.triggerData, stepConfigMap, stepMeta, effectiveConfig, triggerMeta]);

  // Resolve the label + original input for the step being rerun.
  // Must run before any early return so hook order is stable across renders.
  const rerunStepLabel = useMemo(() => {
    if (!rerunStepId) return undefined;
    const cfg = stepConfigMap.get(rerunStepId);
    if (!cfg) return undefined;
    return stepMeta.get(cfg.type)?.name ?? cfg.type;
  }, [rerunStepId, stepConfigMap, stepMeta]);

  const rerunOriginalInput = useMemo(() => {
    if (!rerunStepId) return undefined;
    return viewer.stepStates.get(rerunStepId)?.input;
  }, [rerunStepId, viewer.stepStates]);

  if ((viewer.isLoading && !viewer.execution) || !effectiveConfig) {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // A shared document link opened cold shows the document and nothing else —
  // no run header, no step list, no panels. The expand button inside the run
  // keeps the dialog instead; the caller picks by passing `fullPreviewMode`.
  if (fullPreviewMode === 'page' && fullPreviewFileId) {
    if (!previewAttachment) {
      return (
        <div className={cn('flex h-full items-center justify-center', className)}>
          <span className="text-[13px] text-[var(--wui-fg-muted)]">
            {viewer.stepStates.size > 0
              ? 'That document is not part of this run.'
              : 'Loading\u2026'}
          </span>
        </div>
      );
    }
    return (
      <div className={cn('h-full w-full', className)}>
        <DocumentViewer
          url={client.uploads.url(previewAttachment)}
          mimeType={previewAttachment.mimeType}
          name={previewAttachment.name}
        />
      </div>
    );
  }

  const triggerInfo = triggerMeta.find((t) => t.type === effectiveConfig.trigger.type);
  const triggerCompleted = viewer.stepStates.size > 0;
  const isTriggerSelected = selectedStepId === TRIGGER_ID;
  const permitted = viewer.execution?.permittedActions;
  const canRerun =
    (viewer.status === 'completed' ||
      viewer.status === 'failed' ||
      viewer.status === 'cancelled') &&
    canPerform(permitted, 'execution:rerun');

  const summary = viewer.execution?.summary ?? null;
  const stepPanelOpen = !!selectedStepId && !!selectedStepState;
  const summaryPanelOpen = !stepPanelOpen && showSummary && !!summary;

  const handleToggleSummary = () => {
    if (selectedStepId) {
      setSelectedStepId(null);
      setShowSummary(true);
    } else {
      setShowSummary((s) => !s);
    }
  };

  return (
    // One provider for the whole viewer: it already holds the config + step
    // outputs a citation needs, and mounting it here lights up every surface
    // below (split view, tabs view, markdown) without threading a resolver prop
    // through renderers that are otherwise data-only.
    <CitationOriginContext.Provider value={originCtx}>
    <CitationOpenContext.Provider value={openCitationDoc}>
    <DocPreviewContext.Provider value={openDocPreview}>
    <div className={cn('flex h-full flex-col', classNames?.root, className)}>
      {/* A run in flight with no live stream will not advance on its own —
          say so rather than rendering it as if it were live. */}
      {!viewer.isLive && (viewer.status === 'running' || viewer.status === 'pending') && (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--wui-border)] bg-[var(--wui-bg-muted)] px-4 py-1.5 text-[12px] text-[var(--wui-fg-muted)]"
        >
          <span>Live updates unavailable — this view is a snapshot.</span>
          <button
            type="button"
            onClick={viewer.refetch}
            className="rounded-md border border-[var(--wui-border)] px-2 py-0.5 font-medium hover:bg-[var(--wui-bg)]"
          >
            Refresh
          </button>
        </div>
      )}
      <ExecutionHeader
        executionId={executionId}
        status={viewer.status}
        name={viewer.execution?.name}
        hasSummary={!!summary}
        summaryOpen={summaryPanelOpen}
        onToggleSummary={handleToggleSummary}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        className={classNames?.header}
        onCancel={onCancel && canPerform(permitted, 'execution:cancel') ? () => onCancel(executionId) : undefined}
        onBack={onBack}
        aiOpen={aiOpen}
        onToggleAi={() => setAiOpen((v) => !v)}
      />

      <div className="relative flex flex-1 overflow-hidden">
        {viewMode === 'tabs' ? (
          <div className="flex min-w-0 flex-1 overflow-hidden">
            <ExecutionTabs
              key={executionId}
              steps={effectiveConfig.steps}
              stepMeta={stepMeta}
              stepStates={viewer.stepStates}
              executionSteps={viewer.execution?.steps}
              groups={effectiveConfig.groups}
              onlyPinned={effectiveConfig.display?.onlyPinned}
              selectedStepId={selectedStepId}
              onStepClick={setSelectedStepId}
              selectedStepState={selectedStepState}
              selectedStepTitle={selectedLeafId ? stepConfigMap.get(selectedLeafId)?.title : undefined}
              selectedStepDescription={selectedLeafId ? stepConfigMap.get(selectedLeafId)?.description : undefined}
              triggerLabel={triggerInfo?.name ?? effectiveConfig.trigger.type}
              triggerIconName={triggerInfo?.icon}
              triggerCompleted={triggerCompleted}
              isTriggerSelected={isTriggerSelected}
              onTriggerClick={handleTriggerClick}
              triggerData={viewer.triggerData}
              triggerLayout={(effectiveConfig.trigger.config as { layout?: string } | undefined)?.layout}
            />
          </div>
        ) : (
        <div
          ref={canvasRef}
          className={cn(
            'relative flex-1 overflow-auto cursor-grab select-none',
            classNames?.canvas,
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCanvasClick();
          }}
        >
          <div
            className="min-h-full min-w-full p-12"
            style={{
              backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) handleCanvasClick();
            }}
          >
            <div
              className="mx-auto flex flex-col items-center origin-top transition-transform duration-150"
              style={{ transform: `scale(${zoom})` }}
            >
              {/* Trigger — clickable */}
              <div className="relative">
                <TriggerNode
                  label={triggerInfo?.name ?? effectiveConfig.trigger.type}
                  icon={triggerInfo?.icon}
                  isSelected={isTriggerSelected}
                  isConfigured
                  onClick={handleTriggerClick}
                />
                {triggerCompleted && (
                  <span className="absolute -bottom-1 left-3 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-white">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
              </div>

              <Connector />

              {effectiveConfig.steps.length > 0 && (
                <>
                  <ExecutionTree
                    steps={effectiveConfig.steps}
                    stepMeta={stepMeta}
                    stepStates={viewer.stepStates}
                    selectedStepId={selectedStepId}
                    onStepClick={setSelectedStepId}
                    groups={effectiveConfig.groups}
                    stepEvents={viewer.stepEvents}
                    executionSteps={viewer.execution?.steps}
                  />
                  <Connector />
                </>
              )}

              <TerminalNode />
            </div>
          </div>
        </div>
        )}

        {/* Right panel (graph mode only) — step detail when a step is selected, else the summary */}
        {viewMode === 'graph' && (stepPanelOpen ? (
          <StepDetailPanel
            stepState={selectedStepState!}
            executionId={executionId}
            stepTitle={stepConfigMap.get(selectedLeafId!)?.title}
            stepDescription={stepConfigMap.get(selectedLeafId!)?.description}
            onClose={() => setSelectedStepId(null)}
            onResumed={viewer.refetch}
            outputSchema={(() => {
              const config = stepConfigMap.get(selectedLeafId!);
              if (!config) return undefined;
              return stepMeta.get(config.type)?.outputSchema;
            })()}
            onRerun={
              // Re-running a single MAP iteration isn't supported — gate rerun off
              // for node-path selections.
              selectedStepId !== TRIGGER_ID && !isNodePathSelection && stepConfigMap.has(selectedLeafId!)
                ? (stepId) => setRerunStepId(stepId)
                : undefined
            }
            canRerun={canRerun}
            width={panelWidth}
            onWidthChange={setPanelWidth}
            className={classNames?.detailPanel}
            liveEvents={viewer.stepEvents.get(selectedStepState!.stepName)}
            rawConfig={selectedRawConfig}
            citations={selectedCitations}
            onInspectOrigin={originInspector.open}
          />
        ) : summaryPanelOpen ? (
          <SummaryPanel
            name={viewer.execution?.name}
            summary={summary!}
            onClose={() => setShowSummary(false)}
            width={panelWidth}
            onWidthChange={setPanelWidth}
            className={classNames?.detailPanel}
          />
        ) : null)}

        {/* Value-origin panel — a resizable column that pushes the rest over (graph mode) */}
        {viewMode === 'graph' && (
          <OriginPanel
            inspected={originInspector.inspected}
            ctx={originCtx}
            onClose={originInspector.close}
            width={originPanelWidth}
            onWidthChange={setOriginPanelWidth}
          />
        )}

        {/* Cited source — same resizable-column shape, in every view mode: a
            citation is checked by reading the value and its evidence together. */}
        <CitationSourcePanel
          docs={openDocs}
          activeKey={activeDocKey}
          onSelect={setActiveDocKey}
          onCloseTab={closeCitationTab}
          onCloseAll={closeCitationPanel}
          width={citationPanelWidth}
          onWidthChange={setCitationPanelWidth}
          // Controlled only when the host routes it; without the callback the
          // panel keeps its own state and behaves exactly as before.
          {...(onFullPreviewChange
            ? {
                full: Boolean(previewAttachment),
                onFullChange: (next: boolean, doc: CitationSourceDoc | null) => {
                  const fileId = next ? fileIdOf(doc) : null;
                  // A citation has no attachment to address. Decline it, and
                  // the panel opens the dialog itself — the URL just does not
                  // follow along.
                  if (next && !fileId) return false;
                  return onFullPreviewChange(fileId) !== false;
                },
              }
            : {})}
        />

        {/* Ask AI — shared RunAiChat, outermost right sibling so it works in
            both journey and graph modes. Always mounted; width/opacity animate
            off `isOpen`. Chat-only here (no form-fill sink). */}
        <RunAiChat
          isOpen={aiOpen}
          executionId={executionId}
          aiClient={aiClient}
          onClose={() => setAiOpen(false)}
          emptyStateDescription="Ask about this run — what happened, where the data came from, or why it paused."
          placeholder="Ask about this run…"
          suggestions={[
            'Summarise what this run has done.',
            'Where did this data come from?',
            'Why did it pause or fail?',
          ]}
        />
      </div>

      {/* Rerun dialog */}
      {rerunStepId && (
        <RerunDialog
          executionId={executionId}
          fromStepId={rerunStepId}
          fromStepLabel={rerunStepLabel}
          originalInput={rerunOriginalInput}
          onClose={() => setRerunStepId(null)}
          onSuccess={(newId) => {
            onRerunSuccess?.(newId);
          }}
        />
      )}
    </div>
    </DocPreviewContext.Provider>
    </CitationOpenContext.Provider>
    </CitationOriginContext.Provider>
  );
}
