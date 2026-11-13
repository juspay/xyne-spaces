import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';

function useResizablePanel(defaultPct = 25, min = 15, max = 50) {
  const [pct, setPct] = useState(defaultPct);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newPct = ((ev.clientX - rect.left) / rect.width) * 100;
      setPct(Math.min(max, Math.max(min, newPct)));
    };
    const onUp = () => {
      dragging.current = false;
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [min, max]);

  return { pct, isDragging, containerRef, onMouseDown };
}
import type { ExecutionDetail, PendingApprovalSummary } from '@xyne/workflow-sdk/client';
import { promptLines } from '@xyne/workflow-sdk/types';
import type { PauseState, PauseAction } from '@xyne/workflow-sdk';
import { leafStepId } from '@xyne/workflow-sdk/common';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { useApprovalsList } from '../../hooks/use-approvals-list.js';
import { useApprovalCount } from '../../hooks/use-approval-count.js';
import { useDebouncedValue } from '../../hooks/use-debounced-value.js';
import { endOfToday, formatDue, formatRaisedAt } from '../../utils/home-format.js';
import { usePauseInteractionState } from './PauseInteractionPanel.js';
import { PauseFormRenderer } from './PauseFormRenderer.js';
import { cn } from '../shared/cn.js';
import { MarkdownView } from '../shared/MarkdownView.js';
import { SearchField } from '../browser/SearchField.js';
import { type Citation } from '@xyne/workflow-sdk/builder';
import { useOriginInspector, OriginChipFor, OriginPanel } from './origin/OriginTrace.js';
import { buildOriginCtx, buildStepConfigMap, getFieldCitations } from './origin/origin-resolver.js';
import { ReviewDisplay } from './ApprovalReviewDisplay.js';
import { RunAiChat } from '../shared/RunAiChat.js';
import { AiBuilderClient } from '@xyne/workflow-sdk/ai-builder';

// ─── helpers ─────────────────────────────────────────────────────────────────

function timeAgo(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${String(mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${String(hrs)}h ago`;
  return `${String(Math.floor(hrs / 24))}d ago`;
}

/** One open gate awaiting resolution — keeps its full node-path (to resume it). */
interface OpenGate {
  nodePath: string;
  configId: string;
  title: string;
  pauseState: PauseState;
  rawConfig: Record<string, unknown> | undefined;
  citations: Record<string, Citation[]> | undefined;
}

/**
 * All open leaf gates of an execution — steps parked at EXTERNAL_WAIT/REVIEW_WAIT
 * that carry a pauseState. Control-step markers (executorType 'conditional') are
 * excluded. Each gate retains its full node-path so resume can target it, plus
 * its resolved config (title/citations) via the leaf id.
 */
function extractOpenGates(execution: ExecutionDetail): OpenGate[] {
  const configMap = buildStepConfigMap(execution.config);
  const gates: OpenGate[] = [];
  for (const step of execution.steps) {
    if (step.status !== 'EXTERNAL_WAIT' && step.status !== 'REVIEW_WAIT') continue;
    if (step.executorType === 'conditional') continue;
    if (!step.data) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(step.data) as Record<string, unknown>;
    } catch {
      continue;
    }
    const pauseState = parsed['pauseState'] as PauseState | undefined;
    if (!pauseState) continue;
    const configId = leafStepId(step.stepName);
    const cfg = configMap.get(configId);
    gates.push({
      nodePath: step.stepName,
      configId,
      title: cfg?.title ?? configId,
      pauseState,
      rawConfig: cfg?.config as Record<string, unknown> | undefined,
      citations: cfg?.citations as Record<string, Citation[]> | undefined,
    });
  }
  return gates;
}

// ─── inline SVG icons ─────────────────────────────────────────────────────────

function IconClock({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function IconX({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function IconClose({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconExternalLink({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function IconSpinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function IconInbox({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

// ─── props ────────────────────────────────────────────────────────────────────

export interface ApprovalsViewProps {
  onCountChange?: (count: number) => void;
  onViewRun?: (executionId: string, workflowName: string) => void;
  /** Controlled selected approval id (for URL sync); with onSelect the parent owns it. */
  selectedId?: string | null | undefined;
  onSelect?: ((id: string | null) => void) | undefined;
  /** Which gate to open when `selectedId` becomes this run (e.g. the dashboard's Review). */
  initialGate?: { id: string; nodePath: string } | null | undefined;
  className?: string;
  onToast?: (
    kind: 'success' | 'error',
    message: string,
    opts?: { action?: { label: string; onClick: () => void } },
  ) => void;
}

// ─── root component ───────────────────────────────────────────────────────────

export function ApprovalsView({ onCountChange, onViewRun, selectedId: controlledSelectedId, onSelect, initialGate, className, onToast }: ApprovalsViewProps) {
  const client = useWorkflowClient();
  // selected holds the summary for the list highlight + the lazily-loaded detail
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const selectedId =
    controlledSelectedId !== undefined ? controlledSelectedId : internalSelectedId;
  const setSelectedId = useCallback(
    (id: string | null) => {
      onSelect?.(id);
      setInternalSelectedId(id);
    },
    [onSelect],
  );
  // A run parked at several gates (parallel branches) is several rows that all
  // share its execution id, so the id alone can't say which row is open. The
  // gate is tied to the id it was picked for: once the selection moves to
  // another run (close, back/forward, deep link) it lapses on its own.
  const [gatePick, setGatePick] = useState<{ id: string; nodePath: string } | null>(null);
  const pick = gatePick?.id === selectedId ? gatePick : initialGate;
  const selectedNodePath = selectedId && pick?.id === selectedId ? pick.nodePath : null;
  const setSelectedNodePath = useCallback(
    (nodePath: string) => {
      if (selectedId) setGatePick({ id: selectedId, nodePath });
    },
    [selectedId],
  );
  const isSelectedRow = (summary: PendingApprovalSummary) =>
    summary.id === selectedId &&
    (selectedNodePath === null || summary.pausedNodePath === selectedNodePath);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  // Default to newest-first.
  const [sortBy, setSortBy] = useState<'oldest' | 'newest'>('newest');
  /** Which deadline pill is showing. 'all' is the whole queue. */
  const [bucket, setBucket] = useState<'all' | 'overdue' | 'dueToday'>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedWorkflows, setSelectedWorkflows] = useState<string[]>([]);
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  // Expanded read view (panel widens + list collapses) lives at the root so it
  // survives navigating between approvals (the detail panel remounts mid-nav).
  const [expanded, setExpanded] = useState(false);
  const [originPanelWidth, setOriginPanelWidth] = useState(380);
  const [preExpandWidth, setPreExpandWidth] = useState(380);
  const toggleExpand = () => {
    if (expanded) { setOriginPanelWidth(preExpandWidth); setExpanded(false); return; }
    setPreExpandWidth(originPanelWidth);
    const w = typeof window !== 'undefined' ? window.innerWidth : 1400;
    setOriginPanelWidth(Math.min(Math.round(w * 0.58), w - 440));
    setExpanded(true);
  };

  // Render what was typed; query what settled.
  const debouncedQuery = useDebouncedValue(query.trim());

  // Filtering and sorting are server-side: this holds one page, so doing either
  // here would only apply it to that page.
  const activeFilters = {
    ...(selectedWorkflows.length > 0 ? { workflowIds: selectedWorkflows } : {}),
    ...(selectedStages.length > 0 ? { stages: selectedStages } : {}),
    ...(selectedTags.length > 0 ? { tags: selectedTags } : {}),
    ...(debouncedQuery ? { search: debouncedQuery } : {}),
  };

  // Fixed per mount. It is part of every bucketed cache key, so recomputing it
  // each render would make every render a new question and refetch forever.
  // The cost is a session open across midnight seeing the previous day's
  // boundary — far cheaper than a fetch loop.
  const dayEnd = useMemo(() => endOfToday(), []);

  // ONE list, narrowed by the chosen pill. Each pill is its own request, not a
  // slice of rows already held: a page is 25 deep, and a gate due this
  // afternoon was raised recently, which puts it at the END of the queue.
  const {
    approvals: filtered,
    facets,
    isLoading: loading,
    isRefreshing,
    isLoadingMore,
    hasMore,
    loadMore,
    remove: removeSummary,
  } = useApprovalsList({
    ...activeFilters,
    // Inside a deadline bucket, deadline order IS the useful order; the
    // raised-date toggle only governs the unbucketed queue.
    ...(bucket === 'all' ? { sort: sortBy } : { bucket, sort: 'due', dayEnd }),
  });

  // One count per pill, so each states its own size rather than the number of
  // rows that happen to be downloaded.
  const approvalCount = useApprovalCount();
  const overdueCount = useApprovalCount({ bucket: 'overdue', dayEnd });
  const dueTodayCount = useApprovalCount({ bucket: 'dueToday', dayEnd });
  // Ref'd because hosts pass an inline arrow.
  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;
  useEffect(() => {
    if (approvalCount === undefined) return;
    onCountChangeRef.current?.(approvalCount);
  }, [approvalCount]);

  // `action` drives the snackbar; `nodePath` says which gate was resolved, so a
  // run parked at parallel gates keeps its other rows. Absent: the whole run.
  const handleResumed = (action?: PauseAction, nodePath?: string) => {
    const id = selectedId;
    const execId = detail?.id;
    const name = detail?.name ?? detail?.workflowId ?? 'workflow';

    setSelectedId(null);
    setDetail(null);
    setExpanded(false);
    if (id) removeSummary(id, nodePath);
    if (!execId) return;

    const what = action?.label ?? 'Action';
    onToast?.(
      action?.abort ? 'error' : 'success',
      `${what} submitted — ${name}`,
      onViewRun
        ? { action: { label: 'View run', onClick: () => onViewRun(execId, name) } }
        : undefined,
    );
  };

  const { pct, isDragging, containerRef, onMouseDown } = useResizablePanel(25);

  // The list fills the page until an approval is open, then moves aside for the
  // detail panel. A deep link arrives already-selected, so the first paint must
  // NOT animate — otherwise opening a link plays a collapse of something the
  // reader never saw expanded.
  const firstPaint = useRef(true);
  useEffect(() => {
    firstPaint.current = false;
  }, []);
  const animateWidth = !firstPaint.current && !isDragging;

  const handleSelectRow = useCallback(
    (summary: PendingApprovalSummary) => {
      if (selectedId === summary.id && selectedNodePath === summary.pausedNodePath) {
        setSelectedId(null);
        return;
      }
      setGatePick({ id: summary.id, nodePath: summary.pausedNodePath });
      if (selectedId !== summary.id) setSelectedId(summary.id);
    },
    [selectedId, selectedNodePath, setSelectedId],
  );

  // Load the detail whenever the selection changes — click, deep-link, or back/forward.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    client.executions
      .get(selectedId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, client]);

  // Selected by id, labelled by name: two workflows may share a name.
  const workflowOptions = useMemo(
    () => (facets?.workflows ?? []).map((w) => ({ value: w.workflowId, label: w.name, count: w.count })),
    [facets],
  );
  const stageOptions = useMemo(
    () => (facets?.stages ?? []).map((st) => ({ value: st.name, count: st.count })),
    [facets],
  );
  const availableTags = facets?.tags ?? [];

  const activeFilterCount = selectedWorkflows.length + selectedStages.length + selectedTags.length;
  // A count answers "how big is this bucket", and knows nothing of the inbox's
  // filters — so while any filter is on it would contradict the rows beneath
  // it. Better no number than a wrong one.
  const countable = activeFilterCount === 0 && !debouncedQuery;

  const pills = [
    { key: 'all' as const, label: 'All', count: countable ? approvalCount : undefined },
    { key: 'overdue' as const, label: 'Overdue', count: countable ? overdueCount : undefined },
    { key: 'dueToday' as const, label: 'Due today', count: countable ? dueTodayCount : undefined },
  ];

  const currentTotal = pills.find((p) => p.key === bucket)?.count;

  // Scroll paging. A marker sits after the last row; when it enters the list's
  // viewport, the next page loads. An observer rather than a scroll listener
  // because it also covers the page that is too SHORT to scroll — a scroll
  // handler never fires there, and the reader would be stuck at 25 rows.
  //
  // Re-created whenever the row count changes: observing fires once with the
  // marker's current state, so if a freshly loaded page still does not fill
  // the list, the marker is still visible and the next page follows on its own.
  const listScrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = listScrollRef.current;
    const marker = sentinelRef.current;
    if (!root || !marker || !hasMore || isLoadingMore) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); },
      // Start fetching a little before the bottom so the reader rarely waits.
      { root, rootMargin: '0px 0px 200px 0px' },
    );
    io.observe(marker);
    return () => { io.disconnect(); };
  }, [filtered.length, hasMore, isLoadingMore, loadMore]);

  const clearAllFilters = () => { setSelectedWorkflows([]); setSelectedStages([]); setSelectedTags([]); };

  // First load only: returning early on a filter change would unmount the
  // search box and take the caret with it.
  if (loading) {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <IconSpinner className="h-5 w-5 text-[var(--wui-fg-muted)]" />
      </div>
    );
  }

  // Takes over the whole page, so it may ONLY mean "the inbox is empty" — never
  // "this pill is empty". An empty pill that hid the pill bar would strand the
  // reader on a blank page with nothing left to click.
  const inboxEmpty =
    bucket === 'all' &&
    filtered.length === 0 &&
    activeFilterCount === 0 &&
    !query.trim() &&
    !isRefreshing;
  if (inboxEmpty) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-2 text-sm text-[var(--wui-fg-muted)]', className)}>
        <IconCheck className="h-9 w-9 opacity-25" />
        <span>No pending approvals</span>
      </div>
    );
  }

  const showList = !expanded || (!detail && !detailLoading);
  const currentIdx = filtered.findIndex(isSelectedRow);
  const navigateApproval = (dir: 1 | -1) => {
    const next = filtered[currentIdx + dir];
    if (next) void handleSelectRow(next);
  };
  return (
    <div ref={containerRef} className={cn('flex h-full overflow-hidden', className)}>
      {showList && (<>
      {/* ── Left: scrollable list ── */}
      <div
        className={cn(
          'flex shrink-0 flex-col overflow-hidden border-r border-[var(--wui-border)] bg-[var(--wui-bg-muted)]',
          animateWidth && 'transition-[width] duration-300 ease-out motion-reduce:transition-none',
        )}
        style={{ width: selectedId ? `${pct}%` : '100%' }}
      >
        {/* Search — sticky at top, same height as right panel header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--wui-border)] px-3" style={{ minHeight: '53px' }}>
          <SearchField
            value={query}
            onChange={setQuery}
            className="flex-1"
            ariaLabel="Search approvals"
            placeholder="Search approvals…"
          />
          <button
            type="button"
            onClick={() => { setSortBy((s) => (s === 'oldest' ? 'newest' : 'oldest')); }}
            title={sortBy === 'oldest' ? 'Oldest waiting first — click for newest' : 'Newest first — click for oldest'}
            aria-label="Toggle sort order"
            className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--wui-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--wui-fg-muted)] transition hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)]"
          >
            <IconClock className="h-3 w-3 shrink-0" />
            {sortBy === 'oldest' ? 'Oldest' : 'Newest'}
          </button>
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => { setFilterOpen((o) => !o); }}
              aria-label="Filter approvals"
              title="Filter"
              className={cn(
                'relative flex h-7 w-7 items-center justify-center rounded-full border transition',
                activeFilterCount > 0
                  ? 'border-[var(--wui-primary)] bg-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)] text-[var(--wui-primary)]'
                  : 'border-[var(--wui-border)] text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)]',
              )}
            >
              <IconFilter className="h-3.5 w-3.5" />
              {activeFilterCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--wui-primary)] px-1 text-[9px] font-bold text-[var(--wui-primary-fg)]">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {filterOpen && (
              <FilterModal
                activeCount={activeFilterCount}
                onClear={clearAllFilters}
                onClose={() => { setFilterOpen(false); }}
                sections={[
                  {
                    key: 'workflow',
                    label: 'Workflow',
                    options: workflowOptions,
                    selected: selectedWorkflows,
                    onToggle: (v: string) => { setSelectedWorkflows((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v])); },
                  },
                  {
                    key: 'stage',
                    label: 'Waiting stage',
                    options: stageOptions,
                    selected: selectedStages,
                    onToggle: (v: string) => { setSelectedStages((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v])); },
                  },
                  ...(availableTags.length > 0
                    ? [{
                        key: 'team',
                        label: 'Team',
                        options: availableTags.map((t) => ({ value: t })),
                        selected: selectedTags,
                        onToggle: (v: string) => { setSelectedTags((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v])); },
                      }]
                    : []),
                ]}
              />
            )}
          </div>
        </div>

        {/* Deadline pills — one is always active; 'All' is the whole queue. */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--wui-border)] px-3 py-2">
          {pills.map((pill) => {
            const active = bucket === pill.key;
            return (
              <button
                key={pill.key}
                type="button"
                onClick={() => {
                  if (pill.key === bucket) return;
                  setBucket(pill.key);
                  // The open approval may not exist in the pill just chosen, so
                  // clear it — but ONLY when one is open. `setSelectedId` calls
                  // back into the host, which turns it into a route change, and
                  // navigating on every pill click churns the router for
                  // nothing.
                  if (selectedId) setSelectedId(null);
                }}
                aria-pressed={active}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors',
                  active
                    ? 'border-[var(--wui-primary)] bg-[var(--wui-primary)] text-[var(--wui-primary-fg)]'
                    : 'border-[var(--wui-border)] text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg)] hover:text-[var(--wui-fg)]',
                )}
              >
                {pill.label}
                {pill.count !== undefined && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[10px] font-semibold tabular-nums',
                      active
                        ? 'bg-[color-mix(in_srgb,var(--wui-primary-fg)_22%,transparent)]'
                        : 'bg-[var(--wui-bg-muted)]',
                    )}
                  >
                    {pill.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Scrollable list — scrollbar hidden, still scrolls */}
        <div
          ref={listScrollRef}
          aria-busy={isRefreshing}
          className={cn(
            'flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            // The rows shown are the previous filter's until the next page lands.
            isRefreshing && 'opacity-60 transition-opacity',
          )}
        >
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
              <IconCheck className="h-7 w-7 opacity-25" />
              {/* Names the pill, not the inbox: with Overdue empty and 24 gates
                  waiting, "no approvals" would be flatly untrue. */}
              <span className="text-[13px] text-[var(--wui-fg-muted)]">
                {bucket === 'overdue'
                  ? 'Nothing is overdue'
                  : bucket === 'dueToday'
                    ? 'Nothing is due today'
                    : 'No approvals match your filters'}
              </span>
              {bucket !== 'all' && approvalCount !== undefined && approvalCount > 0 && (
                <button
                  type="button"
                  onClick={() => { setBucket('all'); }}
                  className="text-[12px] font-medium text-[var(--wui-primary)] hover:text-[var(--wui-primary-hover)]"
                >
                  See all {approvalCount} waiting →
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-[var(--wui-border)]">
              {filtered.map((ex) => (
                <ApprovalRow
                  // NOT the id alone: a parallel branch parks several gates on
                  // one execution, and every one of them is a row here. React
                  // keyed on a duplicate leaves orphan DOM behind on each
                  // re-render — rows that pile up and nothing can remove.
                  key={`${ex.id}:${ex.pausedNodePath}`}
                  summary={ex}
                  selected={isSelectedRow(ex)}
                  // Full width until something is selected; once the list is a
                  // side column the same row has to fit a quarter of it.
                  variant={selectedId ? 'compact' : 'full'}
                  onClick={() => void handleSelectRow(ex)}
                />
              ))}
            </div>
          )}
          {/* Nothing to page through, and "Showing 0 of 0" under an empty
              state is noise with a gap above it. */}
          {filtered.length > 0 && (
            <>
              {/* Scroll paging: the next page loads when this reaches the
                  viewport — no button. See the observer above. */}
              <div ref={sentinelRef} aria-hidden className="h-px" />
              <div className="flex items-center justify-between px-3 py-3 text-xs text-[var(--wui-fg-muted)]">
                <span>
                  {currentTotal !== undefined
                    ? `Showing ${String(filtered.length)} of ${String(currentTotal)} approvals`
                    : `${String(filtered.length)} approvals`}
                </span>
                {isLoadingMore && (
                  <span className="flex items-center gap-1.5">
                    <IconSpinner className="h-3 w-3" />
                    Loading more…
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Right: detail panel, full height ── */}
      {/* ── Drag handle ── */}
      {selectedId && (
        <div
          onMouseDown={onMouseDown}
          className="group relative flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-border hover:bg-brand/40 transition-colors"
        >
          <div className="h-8 w-0.5 rounded-full bg-border group-hover:bg-brand transition-colors" />
        </div>
      )}
      </>)}

      <div className="flex flex-1 flex-col overflow-hidden bg-background">
        {detailLoading ? (
          <div className="flex h-full items-center justify-center">
            <IconSpinner className="h-5 w-5 text-[var(--wui-fg-muted)]" />
          </div>
        ) : detail ? (
          <ApprovalPanel
            execution={detail}
            selectedNodePath={selectedNodePath}
            onSelectGate={setSelectedNodePath}
            onClose={() => { setSelectedId(null); setDetail(null); setExpanded(false); }}
            onResumed={handleResumed}
            expanded={expanded}
            onToggleExpand={toggleExpand}
            originPanelWidth={originPanelWidth}
            onOriginWidthChange={setOriginPanelWidth}
            onNavigate={navigateApproval}
            canPrev={currentIdx > 0}
            canNext={currentIdx >= 0 && currentIdx < filtered.length - 1}
            {...(onViewRun ? { onViewRun } : {})}
            client={client}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-[var(--wui-fg-muted)]">
            <IconInbox className="h-8 w-8 opacity-25" />
            <span>Select a workflow to review</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── list row ─────────────────────────────────────────────────────────────────

function IconFilter({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

type FilterSection = {
  key: string;
  label: string;
  /**
   * `value` is what the filter sends to the server; `label` is what the reader
   * sees, when the two differ — workflows are filtered by id and shown by name,
   * because two workflows may share a name.
   *
   * `count` is optional: it comes from the server's facet aggregate, and not
   * every facet has one. Rendering nothing beats rendering a number derived
   * from the rows that happen to be loaded.
   */
  options: Array<{ value: string; label?: string; count?: number }>;
  selected: string[];
  onToggle: (value: string) => void;
};

const FILTER_OPTION_CAP = 50;

function FilterModal({ sections, activeCount, onClear, onClose }: {
  sections: FilterSection[];
  activeCount: number;
  onClear: () => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState<string>(sections[0]?.key ?? '');
  const [query, setQuery] = useState('');
  const section = sections.find((s) => s.key === active) ?? sections[0];

  if (typeof document === 'undefined' || !section) return null;

  const q = query.trim().toLowerCase();
  const added = section.options.filter((o) => section.selected.includes(o.value));
  const pool = section.options.filter((o) => !section.selected.includes(o.value));
  const results = (q ? pool.filter((o) => o.value.toLowerCase().includes(q)) : pool)
    .sort((a, b) => a.value.localeCompare(b.value));
  const shown = results.slice(0, FILTER_OPTION_CAP);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="presentation"
      onMouseDown={onClose}
    >
      <div aria-hidden className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        className="relative z-10 flex h-[72vh] max-h-[660px] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--wui-border)] bg-[var(--wui-bg)] shadow-2xl"
        onMouseDown={(e) => { e.stopPropagation(); }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--wui-border)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-[var(--wui-fg)]">Filters</h2>
            {activeCount > 0 && (
              <span className="rounded-full bg-[var(--wui-primary)] px-2 py-0.5 text-[11px] font-bold text-[var(--wui-primary-fg)]">{activeCount}</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-md text-[var(--wui-fg-muted)] transition hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)]"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        {/* Body: category sidebar + detail panel */}
        <div className="flex min-h-0 flex-1">
          <div className="w-44 shrink-0 space-y-0.5 overflow-y-auto border-r border-[var(--wui-border)] bg-[var(--wui-bg-muted)] p-2">
            {sections.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => { setActive(s.key); setQuery(''); }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition',
                  s.key === active
                    ? 'bg-[var(--wui-bg)] font-semibold text-[var(--wui-fg)] shadow-sm'
                    : 'text-[var(--wui-fg-muted)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_5%,transparent)] hover:text-[var(--wui-fg)]',
                )}
              >
                <span className="truncate">{s.label}</span>
                {s.selected.length > 0 && (
                  <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-[var(--wui-primary)] px-1 text-[10px] font-bold text-[var(--wui-primary-fg)]">{s.selected.length}</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-[var(--wui-border)] p-3">
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => { setQuery(e.target.value); }}
                placeholder={`Search ${section.label.toLowerCase()}…`}
                className="w-full rounded-lg border border-[var(--wui-border)] bg-[var(--wui-bg-muted)] px-3 py-2 text-[13px] text-[var(--wui-fg)] outline-none transition placeholder:text-[var(--wui-fg-muted)] focus:border-[var(--wui-primary)]"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
              {added.length > 0 && (
                <div className="mb-3">
                  <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--wui-fg-muted)]">Added · {added.length}</div>
                  <div className="space-y-0.5">
                    {added.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => { section.onToggle(opt.value); }}
                        className="group flex w-full items-center gap-2 rounded-md bg-[color-mix(in_srgb,var(--wui-primary)_10%,transparent)] px-2 py-1.5 text-left transition hover:bg-[color-mix(in_srgb,var(--wui-primary)_16%,transparent)]"
                      >
                        <IconCheck className="h-3.5 w-3.5 shrink-0 text-[var(--wui-primary)]" />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--wui-fg)]" title={opt.value}>{opt.value}</span>
                        <IconX className="h-3 w-3 shrink-0 text-[var(--wui-fg-muted)] group-hover:text-[var(--wui-fg)]" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--wui-fg-muted)]">
                {q ? 'Results' : 'Suggestions'}
              </div>
              {shown.length === 0 ? (
                <p className="px-1 py-2 text-[12.5px] text-[var(--wui-fg-muted)]">{q ? 'No matches' : 'Nothing to add'}</p>
              ) : (
                <div className="space-y-0.5">
                  {shown.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { section.onToggle(opt.value); }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-[var(--wui-bg-muted)]"
                    >
                      <span className="h-4 w-4 shrink-0 rounded-[4px] border border-[var(--wui-border-strong)]" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--wui-fg)]" title={opt.label ?? opt.value}>{opt.label ?? opt.value}</span>
                      {opt.count !== undefined && (
                        <span className="shrink-0 text-[11px] tabular-nums text-[var(--wui-fg-muted)]">{opt.count}</span>
                      )}
                    </button>
                  ))}
                  {results.length > FILTER_OPTION_CAP && (
                    <p className="px-1 py-1.5 text-[11px] text-[var(--wui-fg-muted)]">{results.length - FILTER_OPTION_CAP} more — refine your search</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-[var(--wui-border)] px-5 py-3">
          <button
            type="button"
            onClick={onClear}
            disabled={activeCount === 0}
            className="text-[13px] font-medium text-[var(--wui-fg-muted)] transition hover:text-[var(--wui-fg)] disabled:opacity-40"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[var(--wui-primary)] px-5 py-1.5 text-[13px] font-semibold text-[var(--wui-primary-fg)] transition hover:bg-[var(--wui-primary-hover)]"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.querySelector('[data-workflow-ui]') ?? document.body,
  );
}

function ApprovalRow({
  summary,
  selected,
  variant,
  onClick,
}: {
  summary: PendingApprovalSummary;
  selected: boolean;
  /** `full` spans the page; `compact` fits the side column. */
  variant: 'full' | 'compact';
  onClick: () => void;
}) {
  const workflowName = summary.workflowName ?? summary.workflowId;
  // The run is what a reviewer acts on, so it leads; the workflow is context.
  // Falls back to the workflow for a row from a store without run names.
  const runName = summary.runName ?? workflowName;
  const overdue = summary.dueAt !== undefined && new Date(summary.dueAt).getTime() < Date.now();

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 text-left transition-colors duration-100',
        variant === 'full' ? 'px-5 py-3.5' : 'px-4 py-3',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--wui-status-paused)]',
        selected
          ? 'bg-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)] shadow-[inset_3px_0_0_0_var(--wui-primary)]'
          : 'hover:bg-[color-mix(in_srgb,var(--wui-fg)_5%,transparent)]',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <p
            className={cn(
              'min-w-0 truncate font-semibold text-[var(--wui-fg)]',
              variant === 'full' ? 'text-[13.5px]' : 'text-[13px]',
            )}
            title={runName}
          >
            {runName}
          </p>
          {/* At full width the deadline has its own column on the right; the
              side column has no room for one, so it shows the raised time. */}
          {variant === 'compact' && (
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-[var(--wui-fg-muted)]">
              <IconClock className="h-3 w-3 shrink-0" />
              {timeAgo(summary.createdAt)}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-3">
          {summary.pausedStepName && (
            <span className="min-w-0 truncate text-[11px] text-[var(--wui-fg-muted)]" title={summary.pausedStepName}>
              Waiting at: <span className="font-medium text-[var(--wui-fg)]">{summary.pausedStepName}</span>
            </span>
          )}
          {/* Right after the step, so the line reads as one sentence about
              where this run is — not a label stranded at the far edge. */}
          <span
            className="min-w-0 truncate text-[11px] text-[var(--wui-fg-muted)]"
            title={workflowName}
          >
            Workflow: <span className="font-medium text-[var(--wui-fg)]">{workflowName}</span>
          </span>
        </div>
      </div>

      {variant === 'full' && (
        <div className="flex w-[170px] shrink-0 flex-col items-end gap-1">
          {/* A real deadline is coloured by urgency. "No deadline" is the
              ABSENCE of one — stated plainly, never dressed as a countdown. */}
          <span
            className={cn(
              'whitespace-nowrap text-[12px] font-medium tabular-nums leading-none',
              summary.dueAt === undefined
                ? 'text-[var(--wui-fg-subtle)]'
                : overdue
                  ? 'text-[var(--wui-status-failed)]'
                  : 'text-[var(--wui-status-paused)]',
            )}
          >
            {summary.dueAt ? formatDue(summary.dueAt) : 'No deadline'}
          </span>
          <span className="whitespace-nowrap text-[11px] tabular-nums leading-none text-[var(--wui-fg-subtle)]">
            raised {formatRaisedAt(summary.createdAt)}
          </span>
        </div>
      )}
    </button>
  );
}

// ─── detail panel ─────────────────────────────────────────────────────────────

function ApprovalPanel({
  execution,
  selectedNodePath,
  onSelectGate,
  onClose,
  onResumed,
  onViewRun,
  expanded,
  onToggleExpand,
  originPanelWidth,
  onOriginWidthChange,
  onNavigate,
  canPrev,
  canNext,
  client,
}: {
  execution: ExecutionDetail;
  /** The gate whose row was clicked; null falls back to the first open gate. */
  selectedNodePath: string | null;
  onSelectGate: (nodePath: string) => void;
  onClose: () => void;
  /** `action` for the snackbar; `nodePath` = the one gate resolved, absent = the whole run. */
  onResumed: (action?: PauseAction, nodePath?: string) => void;
  onViewRun?: (executionId: string, workflowName: string) => void;
  expanded?: boolean | undefined;
  onToggleExpand?: (() => void) | undefined;
  originPanelWidth?: number | undefined;
  onOriginWidthChange?: ((w: number) => void) | undefined;
  onNavigate?: ((dir: 1 | -1) => void) | undefined;
  canPrev?: boolean | undefined;
  canNext?: boolean | undefined;
  client: ReturnType<typeof useWorkflowClient>;
}) {
  const gates = useMemo(() => extractOpenGates(execution), [execution]);
  // The gate currently being resolved (defaults to the first open one).
  const selected = gates.find((g) => g.nodePath === selectedNodePath) ?? gates[0];
  const inspector = useOriginInspector();
  // No onJump in the approvals view (no canvas to navigate); recursion still works.
  const originCtx = useMemo(() => buildOriginCtx(execution), [execution]);
  const [aiOpen, setAiOpen] = useState(false);
  const aiClient = useMemo(
    () => new AiBuilderClient({ baseUrl: client.baseUrl }),
    [client.baseUrl],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Full-width top bar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5" style={{ minHeight: '53px' }}>
        <p className="truncate text-[15px] font-semibold text-[var(--wui-fg)]" title={execution.name ?? execution.workflowId}>
          {execution.name ?? execution.workflowId}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {onViewRun && (
            <button
              type="button"
              onClick={() => { onClose(); onViewRun(execution.id, execution.name ?? execution.workflowId); }}
              className="flex items-center gap-1.5 rounded-full border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-3 py-1 text-[11.5px] font-medium text-[var(--wui-fg-muted)] transition hover:bg-[var(--wui-border)] hover:text-[var(--wui-fg)]"
            >
              <IconExternalLink className="h-3 w-3" />
              View run
            </button>
          )}
          <button
            type="button"
            onClick={() => setAiOpen((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-medium transition',
              aiOpen
                ? 'border-[var(--wui-primary)] bg-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)] text-[var(--wui-primary)] hover:bg-[color-mix(in_srgb,var(--wui-primary)_18%,transparent)]'
                : 'border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] text-[var(--wui-fg-muted)] hover:bg-[var(--wui-border)] hover:text-[var(--wui-fg)]',
            )}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Ask AI
          </button>
          {onNavigate && (
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => onNavigate(-1)}
                disabled={!canPrev}
                aria-label="Previous approval"
                title="Previous approval"
                className="grid h-7 w-7 place-items-center rounded-[var(--wui-radius-sm)] text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
              </button>
              <button
                type="button"
                onClick={() => onNavigate(1)}
                disabled={!canNext}
                aria-label="Next approval"
                title="Next approval"
                className="grid h-7 w-7 place-items-center rounded-[var(--wui-radius-sm)] text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
            </div>
          )}
          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
              title={expanded ? 'Collapse' : 'Expand for a wider read'}
              className="grid h-7 w-7 place-items-center rounded-[var(--wui-radius-sm)] text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]"
            >
              {expanded ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-[var(--wui-radius-sm)] text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)] transition-colors"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Gate selector — only when more than one gate is open at once
          (e.g. concurrent WAITs in a PARALLEL). Each tab resolves to its own
          node-path so resume targets exactly that gate. */}
      {gates.length > 1 && selected && (
        <GateSelector
          gates={gates}
          selectedNodePath={selected.nodePath}
          onSelect={onSelectGate}
        />
      )}

      {/* Content row: PausePanel main col + AI side panel are flex-row siblings */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {selected ? (
          <PausePanel
            key={selected.nodePath}
            executionId={execution.id}
            nodePath={selected.nodePath}
            pauseState={selected.pauseState}
            onResumed={(action) => { onResumed(action, selected.nodePath); }}
            rawConfig={selected.rawConfig}
            citations={selected.citations}
            onInspect={inspector.open}
            activeOriginLabel={inspector.inspected?.label}
            aiOpen={aiOpen}
            aiClient={aiClient}
            onAiClose={() => setAiOpen(false)}
          />
        ) : (
          <FallbackPanel
            executionId={execution.id}
            onResumed={(action) => { onResumed(action); }}
            client={client}
          />
        )}
      <OriginPanel
        inspected={inspector.inspected}
        ctx={originCtx}
        onClose={inspector.close}
        width={originPanelWidth ?? 380}
        onWidthChange={onOriginWidthChange}
        expanded={expanded}
      />
      </div>
    </div>
  );
}

// Content + actions split for pauseState case — scrollable content, sticky footer actions.
function PausePanel({
  executionId,
  pauseState,
  nodePath,
  onResumed,
  rawConfig,
  citations,
  onInspect,
  activeOriginLabel,
  aiOpen,
  aiClient,
  onAiClose,
}: {
  executionId: string;
  pauseState: PauseState;
  nodePath?: string | undefined;
  onResumed: (action?: PauseAction) => void;
  rawConfig?: Record<string, unknown> | undefined;
  citations?: Record<string, Citation[]> | undefined;
  onInspect?: (label: string, autoRefs: string[], citations: Citation[]) => void;
  activeOriginLabel?: string | undefined;
  aiOpen: boolean;
  aiClient: AiBuilderClient;
  onAiClose: () => void;
}) {
  const { actions, isSubmitting, error, formValues, setFormValues, formErrors, handleAction } =
    usePauseInteractionState(executionId, pauseState, onResumed, nodePath);

  const scrollRef = useRef<HTMLDivElement>(null);
  const firstInvalid = pauseState.form?.fields.find((f) => formErrors[f.name])?.name;
  useEffect(() => {
    if (!firstInvalid) return;
    scrollRef.current
      ?.querySelector(`[data-field="${firstInvalid}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [firstInvalid, formErrors]);

  const rawDisplayValue = (i: number): unknown =>
    (rawConfig?.['display'] as Array<{ value?: unknown }> | undefined)?.[i]?.value;
  const rawFormField = (i: number): unknown =>
    (rawConfig?.['form'] as { fields?: unknown[] } | undefined)?.fields?.[i];
  const fieldCitations = (fieldPath: string): Citation[] =>
    getFieldCitations(rawConfig, citations, fieldPath);

  const formCount = pauseState.form?.fields.length ?? 0;
  const hasForm = formCount > 0;

  return (
    <>
      {/* Details/fields column — flexes; AI + source are fixed-width siblings */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden min-h-0">
      {/* Scrollable content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        {pauseState.reason && (
          <div className="flex items-start justify-between gap-2">
            <MarkdownView className="min-w-0 flex-1 text-[13.5px] font-medium text-[var(--wui-fg)]">{pauseState.reason}</MarkdownView>
            <OriginChipFor raw={rawConfig?.['reason']} citations={fieldCitations('reason')} label="Reason" onInspect={onInspect} active={activeOriginLabel === 'Reason'} />
          </div>
        )}
        {promptLines(pauseState).length > 0 && (
          <div className="flex items-start justify-between gap-2">
            {/* Said one after another, so shown one under another. */}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {promptLines(pauseState).map((line, at) => (
                <MarkdownView key={at} className="text-[13px] text-[var(--wui-fg-muted)]">{line}</MarkdownView>
              ))}
            </div>
            <OriginChipFor raw={rawConfig?.['prompt']} citations={fieldCitations('prompt')} label="Prompt" onInspect={onInspect} active={activeOriginLabel === 'Prompt'} />
          </div>
        )}
        {pauseState.display && pauseState.display.length > 0 && (
          <ReviewDisplay
            rows={pauseState.display}
            renderOriginChip={(i) => (
              <OriginChipFor
                raw={rawDisplayValue(i)}
                citations={fieldCitations(`display.${String(i)}`)}
                label={pauseState.display?.[i]?.label ?? ''}
                onInspect={onInspect}
                active={activeOriginLabel === (pauseState.display?.[i]?.label ?? '')}
              />
            )}
          />
        )}
        {pauseState.form && (
          <PauseFormRenderer
            form={pauseState.form}
            values={formValues}
            onChange={setFormValues}
            disabled={isSubmitting}
            errors={formErrors}
            renderFieldChip={(field, i) => (
              <OriginChipFor raw={rawFormField(i)} citations={fieldCitations(`form.fields.${String(i)}`)} label={field.label} onInspect={onInspect} active={activeOriginLabel === field.label} />
            )}
          />
        )}
        {error && (
          <p className="text-[12px] text-[var(--wui-status-failed)]">{error.message}</p>
        )}
      </div>

      {/* Pinned footer — actions stay visible (not scrollable), small + right-aligned */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--wui-border)] px-5 py-3">
        {actions.map((action) => (
          <PanelActionButton
            key={action.key}
            action={action}
            onClick={() => handleAction(action)}
            disabled={isSubmitting}
          />
        ))}
      </div>
      </div>{/* end main content column */}

      {/* AI side panel — the shared RunAiChat (also used by the execution
          viewer). The form props enable the "apply suggestions" banner here. */}
      <RunAiChat
        isOpen={aiOpen}
        aiClient={aiClient}
        executionId={executionId}
        onClose={onAiClose}
        formValues={formValues}
        setFormValues={setFormValues}
        hasForm={hasForm}
      />
    </>
  );
}

/**
 * Tab bar shown when an execution has more than one gate open at once
 * (e.g. concurrent WAITs in a PARALLEL branch). Selects which gate the panel
 * below resolves; each carries its own node-path so resume targets it precisely.
 */
function GateSelector({
  gates,
  selectedNodePath,
  onSelect,
}: {
  gates: OpenGate[];
  selectedNodePath: string | undefined;
  onSelect: (nodePath: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-4 py-2">
      <span className="mr-1 shrink-0 text-[11px] font-medium text-[var(--wui-fg-muted)]">
        {gates.length} pending approvals:
      </span>
      {gates.map((g) => {
        const active = g.nodePath === selectedNodePath;
        return (
          <button
            key={g.nodePath}
            type="button"
            onClick={() => onSelect(g.nodePath)}
            title={g.nodePath}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors',
              active
                ? 'border-[var(--wui-status-paused)] bg-[var(--wui-status-paused)]/10 text-[var(--wui-fg)]'
                : 'border-[var(--wui-border)] text-[var(--wui-fg-muted)] hover:bg-[var(--wui-border)] hover:text-[var(--wui-fg)]',
            )}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--wui-status-paused)]" />
            {g.title}
          </button>
        );
      })}
    </div>
  );
}

// Fallback when there is no pauseState (plain approve / reject via API).
function FallbackPanel({
  executionId,
  onResumed,
  client,
}: {
  executionId: string;
  onResumed: (action?: PauseAction) => void;
  client: ReturnType<typeof useWorkflowClient>;
}) {
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);

  const doApprove = async () => {
    setActing('approve');
    try { await client.executions.resume(executionId); onResumed({ key: 'approve', label: 'Approve' }); }
    catch { /* ignore */ }
    finally { setActing(null); }
  };

  const doReject = async () => {
    setActing('reject');
    try { await client.executions.cancel(executionId); onResumed({ key: 'reject', label: 'Reject' }); }
    catch { /* ignore */ }
    finally { setActing(null); }
  };

  return (
    <div className="shrink-0 border-t border-[var(--wui-border)] px-5 py-3.5">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={acting !== null}
          onClick={() => void doApprove()}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-[var(--wui-radius-sm)] border py-2',
            'border-[var(--wui-status-completed)]/30 bg-[var(--wui-status-completed)]/5',
            'text-[12px] font-medium text-[var(--wui-status-completed)] transition hover:bg-[var(--wui-status-completed)]/10',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {acting === 'approve' ? <IconSpinner className="h-3.5 w-3.5" /> : <IconCheck className="h-3.5 w-3.5" />}
          Approve
        </button>
        <button
          type="button"
          disabled={acting !== null}
          onClick={() => void doReject()}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-[var(--wui-radius-sm)] border py-2',
            'border-[var(--wui-status-failed)]/30 bg-[var(--wui-status-failed)]/5',
            'text-[12px] font-medium text-[var(--wui-status-failed)] transition hover:bg-[var(--wui-status-failed)]/10',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <IconX className="h-3.5 w-3.5" />
          Reject
        </button>
      </div>
    </div>
  );
}

function PanelActionButton({ action, onClick, disabled }: { action: PauseAction; onClick: () => void; disabled: boolean }) {
  const style = action.style ?? 'default';
  // Approve / Reject get semantic colours (green / red) regardless of the
  // configured style; other actions fall back to the generic style palette.
  const isApprove = action.key === 'approve';
  const isReject = action.key === 'reject';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-[var(--wui-radius-sm)] px-4 py-1.5 text-[12.5px] font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        isApprove && 'bg-[var(--wui-primary)] text-[var(--wui-primary-fg)] hover:bg-[var(--wui-primary-hover)]',
        isReject && 'border border-[var(--wui-status-failed)] bg-[color-mix(in_srgb,var(--wui-status-failed)_10%,transparent)] text-[var(--wui-status-failed)] hover:bg-[color-mix(in_srgb,var(--wui-status-failed)_18%,transparent)]',
        !isApprove && !isReject && style === 'primary' && 'bg-[var(--wui-primary)] text-[var(--wui-primary-fg)] hover:bg-[var(--wui-primary-hover)]',
        !isApprove && !isReject && style === 'danger' && 'border border-[var(--wui-status-failed)] text-[var(--wui-status-failed)] hover:bg-[color-mix(in_srgb,var(--wui-status-failed)_10%,transparent)]',
        !isApprove && !isReject && style === 'default' && 'border border-[var(--wui-border)] text-[var(--wui-fg)] hover:bg-[var(--wui-bg-subtle)]',
      )}
    >
      {action.label}
    </button>
  );
}

