import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StepExecutionState } from '../../utils/step-state.js';
import type { ActivityEvent } from '../../hooks/use-execution-viewer.js';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { StatusBadge, type StatusVariant } from '../shared/StatusBadge.js';
import { PauseInteractionPanel } from './PauseInteractionPanel.js';
import { SchemaAwareRenderer } from './SchemaAwareRenderer.js';
import { JsonTreeViewer } from './JsonTreeViewer.js';
import { SidePanelShell } from './SidePanelShell.js';
import { unwrapResponse, unwrapResponseSchema } from '../shared/citation.js';
import { cn } from '../shared/cn.js';

export interface StepDetailPanelProps {
  stepState: StepExecutionState;
  executionId: string;
  /** Per-step alias title (from the config snapshot), shown above the step id. */
  stepTitle?: string | undefined;
  /** Per-step alias description (from the config snapshot). */
  stepDescription?: string | undefined;
  onClose: () => void;
  onResumed?: (() => void) | undefined;
  /** Output schema for the step type — enables structured rendering of output data. */
  outputSchema?: Record<string, unknown> | undefined;
  /**
   * Called when the user clicks "Rerun from this step". Parent opens the
   * RerunDialog. When omitted, the rerun button is hidden.
   */
  onRerun?: ((stepId: string) => void) | undefined;
  /**
   * Whether the parent execution is in a terminal status (completed/failed/
   * cancelled). Only terminal executions can be rerun.
   */
  canRerun?: boolean | undefined;
  /** Controlled panel width — shared with the summary panel so it persists across swaps. */
  width?: number | undefined;
  onWidthChange?: ((width: number) => void) | undefined;
  className?: string | undefined;
  liveEvents?: ActivityEvent[] | undefined;
  /** The paused step's raw config (refs intact) — used to derive value origins. */
  rawConfig?: Record<string, unknown> | undefined;
  /** The paused step's author citations (overlay). */
  citations?: Record<string, import('@xyne/workflow-sdk/builder').Citation[]> | undefined;
  /** Open the origin inspector for a paused value. */
  onInspectOrigin?: ((label: string, autoRefs: string[], citations: import('@xyne/workflow-sdk/builder').Citation[]) => void) | undefined;
}

type TabId = 'input' | 'output' | 'error' | 'activity';

function mapStatus(s: string): StatusVariant {
  switch (s.toLowerCase()) {
    case 'running': return 'running';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'paused':
    case 'external_wait':
    case 'review_wait': return 'paused';
    case 'skipped': return 'skipped';
    case 'cancelled': return 'cancelled';
    default: return 'pending';
  }
}

// ─── Status icon for header ───

function StatusIcon({ status }: { status: StatusVariant }) {
  const base = 'h-5 w-5 rounded-full flex items-center justify-center shrink-0';
  switch (status) {
    case 'completed':
      return (
        <span className={cn(base, 'bg-emerald-100 text-emerald-600')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        </span>
      );
    case 'failed':
      return (
        <span className={cn(base, 'bg-red-100 text-red-600')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </span>
      );
    case 'running':
      return (
        <span className={cn(base, 'bg-blue-100 text-blue-600 animate-pulse')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
        </span>
      );
    case 'paused':
      return (
        <span className={cn(base, 'bg-amber-100 text-amber-600')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
        </span>
      );
    default:
      return (
        <span className={cn(base, 'bg-slate-100 text-slate-400')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /></svg>
        </span>
      );
  }
}


// ─── Copy button ───

function CopyJsonButton({ data }: { data: unknown }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [data]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
        copied
          ? 'text-emerald-600 bg-emerald-50'
          : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100',
      )}
      title="Copy JSON"
    >
      {copied ? (
        <>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          Copied
        </>
      ) : (
        <>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          Copy
        </>
      )}
    </button>
  );
}

// ─── Main Panel ───

export function StepDetailPanel({
  stepState,
  executionId,
  stepTitle,
  stepDescription,
  onClose,
  onResumed,
  outputSchema,
  onRerun,
  canRerun,
  width,
  onWidthChange,
  className,
  liveEvents,
  rawConfig,
  citations,
  onInspectOrigin,
}: StepDetailPanelProps) {
  const client = useWorkflowClient();
  const statusVariant = mapStatus(stepState.status);
  const [historicalEvents, setHistoricalEvents] = useState<ActivityEvent[]>([]);
  const hasLive = !!liveEvents && liveEvents.length > 0;
  const activity: ActivityEvent[] = hasLive ? liveEvents! : historicalEvents;

  const defaultTab: TabId = stepState.error ? 'error' : (stepState.output ? 'output' : 'input');
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);
  const [viewMode, setViewMode] = useState<'auto' | 'json'>('auto');

  // A cited agent returns `response: {value, citation}` — show the value itself
  // and keep its citations aligned to it. Any other output passes straight through.
  const citedOutput = useMemo(() => unwrapResponse(stepState.output), [stepState.output]);

  useEffect(() => {
    if (hasLive) return;
    let cancelled = false;
    void client.executions
      .getStepEvents(executionId, stepState.stepName)
      .then((events) => {
        if (cancelled) return;
        setHistoricalEvents(
          events.map((e) => ({
            type: e.type,
            data: safeParse(e.data),
            createdAt: e.createdAt,
          })),
        );
      })
      .catch(() => { /* ignore — activity is best-effort */ });
    return () => { cancelled = true; };
  }, [hasLive, client, executionId, stepState.stepName]);

  const tabs: { id: TabId; label: string; hasData: boolean }[] = [
    { id: 'input', label: 'Input', hasData: !!stepState.input && Object.keys(stepState.input).length > 0 },
    { id: 'output', label: 'Output', hasData: !!stepState.output && Object.keys(stepState.output).length > 0 },
  ];
  if (stepState.error) {
    tabs.push({ id: 'error', label: 'Error', hasData: true });
  }
  if (activity.length > 0) {
    tabs.push({ id: 'activity', label: 'Activity', hasData: true });
  }

  const showPausePanel = stepState.status === 'paused' && stepState.pauseState;

  // Status-specific top accent color
  const accentBorder = {
    completed: 'border-t-emerald-400',
    running: 'border-t-blue-400',
    failed: 'border-t-red-400',
    paused: 'border-t-amber-400',
    // A step is never scheduled — only a run is — but the map is keyed by the
    // shared variant type, so it needs an entry.
    scheduled: 'border-t-amber-500',
    pending: 'border-t-slate-300',
    skipped: 'border-t-slate-300',
    cancelled: 'border-t-red-300',
  }[statusVariant];

  return (
    <SidePanelShell accentClassName={accentBorder} width={width} onWidthChange={onWidthChange} className={className}>
      {/* Header — pinned */}
      <div className="shrink-0 px-4 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <StatusIcon status={statusVariant} />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-slate-800 truncate leading-tight">
                {stepTitle || stepState.stepName}
              </div>
              {stepTitle && (
                <div className="text-[11px] text-slate-400 truncate leading-tight font-mono">
                  {stepState.stepName}
                </div>
              )}
              {stepDescription && (
                <div className="mt-0.5 text-[11px] text-slate-500 leading-snug">
                  {stepDescription}
                </div>
              )}
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">
                  {stepState.stepType}
                </span>
                <StatusBadge status={statusVariant} />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onRerun && canRerun && (
              <button
                onClick={() => onRerun(stepState.stepName)}
                title="Rerun from this step"
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors',
                  'text-indigo-600 hover:bg-indigo-50',
                )}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                  <path d="M21 3v5h-5" />
                </svg>
                Rerun
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable body — the pause panel, tabs, and tab content all share one
          scroll region so a tall wait/pause form (or large output) scrolls
          instead of overflowing the panel. The tabs stick to the top. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
      {/* Pause interaction panel */}
      {showPausePanel && (
        <div className="border-t border-slate-100 px-4 py-3">
          <PauseInteractionPanel
            executionId={executionId}
            pauseState={stepState.pauseState!}
            nodePath={stepState.nodePath}
            onResumed={onResumed}
            rawConfig={rawConfig}
            citations={citations}
            onInspectOrigin={onInspectOrigin}
          />
        </div>
      )}

      {/* Tabs — stick to the top while the body scrolls */}
      <div className="sticky top-0 z-10 flex border-t border-slate-100 bg-white px-2 gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'relative flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors',
              activeTab === tab.id
                ? 'text-indigo-600'
                : 'text-slate-400 hover:text-slate-600',
            )}
          >
            {tab.label}
            {tab.hasData && (
              <span className={cn(
                'h-1.5 w-1.5 rounded-full',
                activeTab === tab.id ? 'bg-indigo-400' : 'bg-slate-300',
              )} />
            )}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-indigo-500 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="border-t border-slate-100">
        {/* Toolbar */}
        {(activeTab === 'input' || activeTab === 'output') && (
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-1.5">
            <div className="flex items-center gap-1">
              {/* View mode toggle — only for output tab when schema is available */}
              {activeTab === 'output' && outputSchema && (
                <div className="flex items-center rounded border border-slate-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setViewMode('auto')}
                    className={cn(
                      'px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                      viewMode === 'auto' ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600',
                    )}
                  >
                    Fields
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('json')}
                    className={cn(
                      'px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                      viewMode === 'json' ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600',
                    )}
                  >
                    JSON
                  </button>
                </div>
              )}
            </div>
            <CopyJsonButton data={activeTab === 'input' ? stepState.input : stepState.output} />
          </div>
        )}

        <div className="p-4">
          {activeTab === 'input' && (
            <JsonTreeViewer data={stepState.input} placeholder="No input data available" />
          )}
          {activeTab === 'output' && (
            <>
              {outputSchema && viewMode === 'auto' && citedOutput.data && Object.keys(citedOutput.data).length > 0 ? (
                <SchemaAwareRenderer
                  data={citedOutput.data}
                  schema={unwrapResponseSchema(outputSchema, stepState.output)!}
                  citation={citedOutput.citation}
                />
              ) : (
                <JsonTreeViewer data={stepState.output} placeholder="No output data yet" />
              )}
            </>
          )}
          {activeTab === 'error' && stepState.error && (
            <div className="rounded-lg bg-red-50 border border-red-100 p-3">
              <div className="flex items-center gap-2 mb-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span className="text-[11px] font-semibold text-red-600 uppercase tracking-wider">Error</span>
              </div>
              <pre className="whitespace-pre-wrap font-mono text-[12px] text-red-700 leading-relaxed">
                {stepState.error}
              </pre>
            </div>
          )}
          {activeTab === 'activity' && (
            <ActivityTimeline events={activity} isRunning={stepState.status === 'running'} />
          )}
        </div>
      </div>
      </div>
    </SidePanelShell>
  );
}

// ─── Activity timeline ───

function ActivityTimeline({ events, isRunning }: { events: ActivityEvent[]; isRunning: boolean }) {
  // `progress` events are token-by-token streaming deltas — skip them so the
  // timeline shows meaningful steps (thinking / tool calls / messages) only.
  const rows = events.filter((e) => e.type !== 'progress');
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-[12px] text-slate-400">
          {isRunning ? 'Waiting for activity…' : 'No activity recorded'}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {rows.map((e, i) => (
        <ActivityRow key={i} event={e} />
      ))}
      {isRunning && (
        <div className="flex items-center gap-2 pl-1 pt-1 text-[11px] text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
          working…
        </div>
      )}
    </div>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const data = event.data as Record<string, unknown> | undefined;
  const meta = ACTIVITY_KINDS[event.type] ?? { icon: '•', label: event.type, color: 'text-slate-500' };

  // tool_call: show the tool name + args/result.
  if (event.type === 'tool_call') {
    const tool = typeof data?.['tool'] === 'string' ? data['tool'] : 'tool';
    const phase = data?.['phase'];
    const detail = phase === 'end' ? data?.['result'] : data?.['args'];
    return (
      <div className="rounded-md border border-slate-100 bg-slate-50/50 px-2.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px]">🔧</span>
          <span className="text-[12px] font-medium text-slate-700">{tool}</span>
          {typeof phase === 'string' && (
            <span className="text-[10px] text-slate-400 uppercase tracking-wide">{phase}</span>
          )}
        </div>
        {detail !== undefined && (
          <div className="mt-1 pl-5">
            <JsonTreeViewer data={detail} placeholder="" />
          </div>
        )}
      </div>
    );
  }

  // thinking / progress / substep / log — show text content if present.
  const text =
    typeof data?.['content'] === 'string' ? data['content'] :
    typeof data?.['message'] === 'string' ? data['message'] : '';
  return (
    <div className="flex items-start gap-1.5 px-1 py-0.5">
      <span className="text-[12px] leading-5">{meta.icon}</span>
      <div className="min-w-0">
        <span className={cn('text-[10px] font-semibold uppercase tracking-wide', meta.color)}>{meta.label}</span>
        {text && <div className="text-[12px] text-slate-600 whitespace-pre-wrap leading-snug">{text}</div>}
      </div>
    </div>
  );
}

const ACTIVITY_KINDS: Record<string, { icon: string; label: string; color: string }> = {
  thinking: { icon: '💭', label: 'thinking', color: 'text-indigo-400' },
  progress: { icon: '✏️', label: 'progress', color: 'text-slate-400' },
  substep: { icon: '💬', label: 'message', color: 'text-slate-400' },
  log: { icon: '📋', label: 'log', color: 'text-slate-400' },
  error: { icon: '⚠️', label: 'error', color: 'text-red-400' },
};

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
