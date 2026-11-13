import { useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { WorkflowStepConfig, StepGroup } from '@xyne/workflow-sdk/builder';
import type { StepMeta } from '../../hooks/use-step-metadata.js';
import type { StepExecutionState } from '../../utils/step-state.js';
import type { ExecutionDetail } from '@xyne/workflow-sdk/client';
import {
  type Status, type Descriptor, type Row, type Section,
  rollup, resolveLevel, buildRows, membersOfGroup, stepRow,
} from './journey-model.js';
import { StatusBadge, type StatusVariant } from '../shared/StatusBadge.js';
import { DisplayValue, isAttachment, isAttachmentArray } from '../shared/AttachmentCard.js';
import { MarkdownView } from '../shared/MarkdownView.js';
import { CitationMarks } from '../shared/CitationArrow.js';
import { isCitationRefArray, citeAt, unwrapResponse } from '../shared/citation.js';
import { cn } from '../shared/cn.js';
import { renderLayout } from '../../layout-engine/index.js';
import { walkStepConfigs } from '../../utils/branch-detection.js';

/**
 * Tabs view — a code-editor read of an execution: the sidebar navigates the run
 * (drill into groups/constructs/iterations, breadcrumb to climb) exactly like the
 * Journey, but opening a step opens it as a **tab** in the editor strip (VSCode
 * style — several open at once, switch and close). Each open node's detail is one
 * easy-to-read flow built from its input + output; when a node carries an authored
 * layout it renders that (added next), otherwise this basic sectioned fallback.
 */
export interface ExecutionTabsProps {
  steps: WorkflowStepConfig[];
  stepMeta: Map<string, StepMeta>;
  stepStates: Map<string, StepExecutionState>;
  executionSteps?: ExecutionDetail['steps'] | undefined;
  groups?: StepGroup[] | undefined;
  /** Whitelist mode: when true, the root sidebar shows ONLY pinned groups; every
   *  non-pinned group and ungrouped step is dropped (still reachable via search). */
  onlyPinned?: boolean | undefined;
  selectedStepId: string | null;
  onStepClick: (stepId: string, replace?: boolean) => void;
  selectedStepState?: StepExecutionState | undefined;
  selectedStepTitle?: string | undefined;
  selectedStepDescription?: string | undefined;
  triggerLabel: string;
  triggerIconName?: string | undefined;
  triggerCompleted: boolean;
  isTriggerSelected: boolean;
  onTriggerClick: (replace?: boolean) => void;
  triggerData?: unknown;
  /** Node-carried JSX layout for the trigger (from the workflow config). */
  triggerLayout?: string | undefined;
}

const TRIGGER_ID = '__trigger__';

const DOT: Record<Status, string> = {
  completed: 'bg-emerald-500',
  running: 'bg-blue-500',
  paused: 'bg-amber-500',
  failed: 'bg-red-500',
  skipped: 'bg-[var(--wui-fg-muted)]',
  pending: 'bg-[var(--wui-border)]',
};

/** camelCase / snake_case → Title Case. */
function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !isAttachment(v) && !isAttachmentArray(v);
}

function schemaTitleOf(schema: unknown, key: string): string | undefined {
  const props = (schema as { properties?: Record<string, { title?: string }> } | undefined)?.properties;
  return props?.[key]?.title;
}

/** The trigger's payload arrives as an object or a JSON string; normalize to an object. */
function normalizeTriggerData(td: unknown): Record<string, unknown> {
  if (typeof td === 'string') { try { return JSON.parse(td) as Record<string, unknown>; } catch { return {}; } }
  return td && typeof td === 'object' ? (td as Record<string, unknown>) : {};
}

// ─── Row → sidebar / tab presentation ───

interface RowInfo { label: string; status: Status; drillable: boolean; id: string; descriptor?: Descriptor }

function rowInfo(row: Row, st: Map<string, StepExecutionState>, stepMeta: Map<string, StepMeta>): RowInfo {
  if (row.kind === 'leaf') {
    const label = row.step.title || row.meta?.name || row.step.type;
    return { label, status: (st.get(row.step.id)?.status as Status) ?? 'pending', drillable: false, id: row.step.id };
  }
  if (row.kind === 'construct') {
    const label = row.step.title || row.meta?.name || row.step.type;
    return {
      label,
      status: (st.get(row.step.id)?.status as Status) ?? rollup([row.step], st, stepMeta),
      drillable: true,
      id: row.step.id,
      descriptor: { kind: 'construct', id: row.step.id, label },
    };
  }
  if (row.kind === 'group') {
    return {
      label: row.group.title,
      status: rollup(row.members, st, stepMeta),
      drillable: true,
      id: row.group.id,
      descriptor: { kind: 'group', id: row.group.id, label: row.group.title },
    };
  }
  return {
    label: row.view.label,
    status: rollup(row.view.bodySteps, row.view.states, stepMeta),
    drillable: true,
    id: `it-${String(row.view.index)}`,
    descriptor: { kind: 'iterationItem', id: row.view.ctrlId, index: row.view.index, label: row.view.label },
  };
}

/** The pinned groups lifted to the Run level, each resolved to a single-leaf row (when the
 *  group has exactly one leaf member) or a drillable group folder. Shared by the sidebar's
 *  hoisted rendering and the whitelist auto-open so both agree on what "the pinned rows" are. */
type PinnedRootRow =
  | { kind: 'leaf'; g: StepGroup; member: WorkflowStepConfig }
  | { kind: 'group'; g: StepGroup; members: WorkflowStepConfig[] };
export function pinnedRootRows(
  groups: StepGroup[] | undefined,
  pinnedIds: Set<string>,
  rootSteps: WorkflowStepConfig[],
  stepMeta: Map<string, StepMeta>,
  states: Map<string, StepExecutionState>,
): PinnedRootRow[] {
  return (groups ?? [])
    .filter((g) => pinnedIds.has(g.id))
    .map((g) => ({ g, members: membersOfGroup(rootSteps, g.id, stepMeta, states) }))
    .filter((p) => p.members.length > 0)
    .map(({ g, members }): PinnedRootRow => {
      const only = members.length === 1 ? members[0]! : undefined;
      return only && stepRow(only, stepMeta).kind === 'leaf'
        ? { kind: 'leaf', g, member: only }
        : { kind: 'group', g, members };
    });
}

/** The first openable (non-drillable) node at the current level, in sidebar order —
 *  what "open the first node by default" resolves to on entering the view or after
 *  drilling into a construct/group. Null when a level has no leaf yet (still loading). */
export function firstLeafOfLevel(
  sections: Section[],
  groups: StepGroup[] | undefined,
  stepMeta: Map<string, StepMeta>,
  insideGroupId: string | undefined,
  stepStates: Map<string, StepExecutionState>,
  hoistedIds: Set<string>,
  onlyPinnedRoot?: boolean,
): { id: string; label: string } | null {
  // Whitelist mode at the root: the normal (non-pinned) sections are hidden, so the
  // default open must come from a pinned group's own leaf — never a hidden node. Open it
  // even while pending (the sole visible node) so it fills in live as the run completes.
  if (onlyPinnedRoot) {
    const rootSteps = sections.flatMap((s) => s.steps);
    for (const row of pinnedRootRows(groups, hoistedIds, rootSteps, stepMeta, stepStates)) {
      if (row.kind === 'leaf') return { id: row.member.id, label: row.g.title };
    }
    return null; // only multi-member pinned groups (drillable) — let the user drill in
  }
  for (const sec of sections) {
    const st = sec.states ?? stepStates;
    const prefix = sec.selectionPrefix ?? '';
    const rows: Row[] = sec.iterations
      ? sec.iterations.map((view) => ({ kind: 'iteration', view }))
      : buildRows(sec.steps, groups, stepMeta, insideGroupId, st, hoistedIds);
    for (const row of rows) {
      const info = rowInfo(row, st, stepMeta);
      if (!info.drillable) return { id: prefix + info.id, label: info.label };
    }
  }
  return null;
}

const CHEVRON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);
const CLOSE = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);
const PANEL_LEFT = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /></svg>
);

// Node sidebar resize bounds (px).
const SIDEBAR_MIN_W = 220;
const SIDEBAR_MAX_W = 520;

// ─── Sidebar (navigation — mirrors the Journey's drill model) ───

function SidebarRow({ label, status, drillable, active, onClick }: {
  label: ReactNode; status: Status; drillable?: boolean; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
        active
          ? 'bg-[color-mix(in_srgb,var(--wui-primary)_14%,transparent)] font-medium text-[var(--wui-fg)]'
          : 'text-[var(--wui-fg)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_5%,transparent)]',
      )}
    >
      <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[status])} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {drillable && <span className="shrink-0 text-[var(--wui-fg-muted)] group-hover:text-[var(--wui-fg)]">{CHEVRON}</span>}
    </button>
  );
}

function Sidebar({
  sections, insideGroupId, atRoot, stepMeta, stepStates, groups, hoistedIds, onlyPinned,
  onDrill, onOpenLeaf, selectedId, allNodes, onOpenNode,
  triggerLabel, triggerCompleted, isTriggerSelected, onOpenTrigger,
}: {
  sections: Section[];
  insideGroupId: string | undefined;
  atRoot: boolean;
  stepMeta: Map<string, StepMeta>;
  stepStates: Map<string, StepExecutionState>;
  groups: StepGroup[] | undefined;
  hoistedIds: Set<string>;
  onlyPinned?: boolean | undefined;
  onDrill: (d: Descriptor) => void;
  onOpenLeaf: (id: string, label: string) => void;
  selectedId: string | null;
  allNodes: PaletteNode[];
  onOpenNode: (n: PaletteNode) => void;
  triggerLabel: string;
  triggerCompleted: boolean;
  isTriggerSelected: boolean;
  onOpenTrigger: () => void;
}) {
  // A search box over *every* node (whole tree, ignoring the current drill level);
  // clearing it falls back to the normal current-path rows below.
  const [search, setSearch] = useState('');
  const q = search.trim();
  const matches = useMemo(() => {
    if (!q) return null;
    return allNodes
      .map((n) => { const m = fuzzyMatch(q, n.label); return m ? { n, indices: m.indices, score: m.score } : null; })
      .filter((r): r is { n: PaletteNode; indices: number[]; score: number } => r !== null)
      .sort((a, b) => b.score - a.score);
  }, [allNodes, q]);
  // `hoistedIds` (from the parent) are the config-`pinned` groups lifted to the Run level:
  // rendered in-order after the normal steps, and dropped from the nested tree via buildRows
  // so they aren't duplicated. Parent makes it path-aware, so a group's own drill still shows.
  const rootSteps = sections.flatMap((s) => s.steps);
  // Pinned groups lifted to the Run level. A single-leaf pinned group adds no value as a
  // folder — surface its one member directly under the group's (section) label, mirroring
  // buildRows' flattening for nested single-member groups (which skips hoisted ones).
  const hoistedRows = atRoot ? pinnedRootRows(groups, hoistedIds, rootSteps, stepMeta, stepStates) : [];
  // Whitelist mode: at the root, only the pinned groups (above) are shown — every non-pinned
  // section is dropped. They stay reachable through the "Search all nodes" box.
  const hideSections = atRoot && !!onlyPinned;
  return (
    <div className="flex h-full w-full flex-col bg-[var(--wui-bg-subtle)]">
      {/* Search over every node; empty box falls back to the current-path drill. */}
      <div className="shrink-0 p-2 pb-1">
        <div className="flex items-center gap-2 rounded-md border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2.5">
          <span className="shrink-0 text-[var(--wui-fg-muted)]">{SEARCH_ICON}</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search all nodes…"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[12.5px] text-[var(--wui-fg)] outline-none placeholder:text-[var(--wui-fg-muted)]"
          />
          {q && (
            <button type="button" onClick={() => { setSearch(''); }} aria-label="Clear search" className="grid h-4 w-4 shrink-0 place-items-center rounded text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]">{CLOSE}</button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2 pt-1">
        {matches ? (
          matches.length === 0 ? (
            <div className="px-2.5 py-3 text-[12px] italic text-[var(--wui-fg-muted)]">No matching nodes</div>
          ) : (
            matches.map(({ n, indices }) => (
              <SidebarRow
                key={n.id}
                label={<Highlighted text={n.label} indices={indices} />}
                status={n.status}
                active={n.id === TRIGGER_ID ? isTriggerSelected : (!isTriggerSelected && selectedId === n.id)}
                onClick={() => { onOpenNode(n); }}
              />
            ))
          )
        ) : (
          <>
        {atRoot && (
          <SidebarRow
            label={triggerLabel}
            status={triggerCompleted ? 'completed' : 'pending'}
            active={isTriggerSelected}
            onClick={() => onOpenTrigger()}
          />
        )}
        {!hideSections && sections.map((sec, si) => {
          const st = sec.states ?? stepStates;
          const prefix = sec.selectionPrefix ?? '';
          const rows: Row[] = sec.iterations ? sec.iterations.map((view) => ({ kind: 'iteration', view })) : buildRows(sec.steps, groups, stepMeta, insideGroupId, st, hoistedIds);
          return (
            <div key={si} className="flex flex-col">
              {sec.label && (
                <div className="mt-2 flex items-center gap-2 px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--wui-fg-muted)]">
                  <span className="truncate">{sec.label}</span>
                  <span className="h-px flex-1 bg-[var(--wui-border)]" />
                </div>
              )}
              {rows.map((row, i) => {
                const info = rowInfo(row, st, stepMeta);
                return (
                  <SidebarRow
                    key={`${info.id}-${String(i)}`}
                    label={info.label}
                    status={info.status}
                    drillable={info.drillable}
                    active={!info.drillable && !isTriggerSelected && selectedId === prefix + info.id}
                    onClick={() => (info.drillable && info.descriptor ? onDrill(info.descriptor) : onOpenLeaf(prefix + info.id, info.label))}
                  />
                );
              })}
              {rows.length === 0 && (
                <div className="px-2.5 py-2 text-[12px] italic text-[var(--wui-fg-muted)]">No steps</div>
              )}
            </div>
          );
        })}
        {hoistedRows.map((h) =>
          h.kind === 'leaf' ? (
            <SidebarRow
              key={`hoist-${h.g.id}`}
              label={h.g.title}
              status={(stepStates.get(h.member.id)?.status as Status) ?? 'pending'}
              active={!isTriggerSelected && selectedId === h.member.id}
              onClick={() => onOpenLeaf(h.member.id, h.g.title)}
            />
          ) : (
            <SidebarRow
              key={`hoist-${h.g.id}`}
              label={h.g.title}
              status={rollup(h.members, stepStates, stepMeta)}
              drillable
              onClick={() => onDrill({ kind: 'group', id: h.g.id, label: h.g.title })}
            />
          ),
        )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Editor tab strip (open nodes — VSCode style) ───

interface OpenTab { id: string; label: string }

function EditorTabStrip({ tabs, activeId, onActivate, onClose }: {
  tabs: OpenTab[]; activeId: string | null; onActivate: (id: string) => void; onClose: (id: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLDivElement>(null);
  // Opening/activating a tab should bring it into view (it may be off-screen to the
  // right when many are open). Scroll only the strip, not the page.
  useEffect(() => {
    const s = scrollerRef.current;
    const t = activeTabRef.current;
    if (!s || !t) return;
    const sr = s.getBoundingClientRect();
    const tr = t.getBoundingClientRect();
    if (tr.left < sr.left) s.scrollBy({ left: tr.left - sr.left - 8, behavior: 'smooth' });
    else if (tr.right > sr.right) s.scrollBy({ left: tr.right - sr.right + 8, behavior: 'smooth' });
  }, [activeId, tabs.length]);
  if (tabs.length === 0) return null;
  return (
    <div ref={scrollerRef} className="flex shrink-0 items-stretch overflow-x-auto border-b border-[var(--wui-border)] bg-[color-mix(in_srgb,var(--wui-fg)_2.5%,transparent)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            ref={active ? activeTabRef : undefined}
            className={cn(
              'group flex min-w-0 max-w-[220px] shrink-0 cursor-pointer items-center gap-2 border-r border-[var(--wui-border)] px-3 py-2 text-[12.5px] transition-colors',
              active
                ? 'bg-[var(--wui-bg)] font-medium text-[var(--wui-fg)]'
                : 'text-[var(--wui-fg-muted)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_4%,transparent)] hover:text-[var(--wui-fg)]',
            )}
            onClick={() => onActivate(t.id)}
          >
            <span className={cn('h-1.5 w-full max-w-[6px] shrink-0 rounded-full', active ? 'bg-[var(--wui-primary)]' : 'bg-transparent')} />
            <span className="min-w-0 flex-1 truncate">{t.label}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
              className={cn('shrink-0 rounded p-0.5 text-[var(--wui-fg-muted)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_10%,transparent)] hover:text-[var(--wui-fg)]', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
              aria-label="Close tab"
            >
              {CLOSE}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Command palette (Cmd/Ctrl+P — quick-open a node) ───

interface PaletteNode { id: string; label: string; type: string; status: Status }

/** Subsequence fuzzy match: every query char must appear in order. Returns the
 *  matched indices (for highlighting) and a score favouring contiguous, early,
 *  word-boundary hits — enough to rank node names without pulling in a library. */
function fuzzyMatch(query: string, text: string): { score: number; indices: number[] } | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0, score = 0, prev = -2;
  const indices: number[] = [];
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    indices.push(ti);
    score += ti === prev + 1 ? 3 : 1;                        // contiguous run
    if (ti === 0 || /[\s_\-/]/.test(t[ti - 1]!)) score += 2; // word start
    prev = ti; qi++;
  }
  if (qi < q.length) return null;
  return { score: score - (indices[0] ?? 0) / 4, indices };
}

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const hit = new Set(indices);
  return <>{[...text].map((ch, i) => (hit.has(i) ? <span key={i} className="font-semibold text-[var(--wui-primary)]">{ch}</span> : <span key={i}>{ch}</span>))}</>;
}

const SEARCH_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
);

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-1.5 py-0.5 font-sans text-[10.5px] leading-none text-[var(--wui-fg-muted)]">{children}</kbd>;
}

/** VSCode-style quick-open: fuzzy-search every node and open the chosen one as a
 *  tab. Rendered inside the (relative) tabs root, so it inherits the theme scope. */
function NodePalette({ nodes, container, onPick, onClose }: {
  nodes: PaletteNode[]; container: HTMLElement | null; onPick: (n: PaletteNode) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return nodes.map((n) => ({ n, indices: [] as number[] }));
    return nodes
      .map((n) => { const m = fuzzyMatch(q, n.label); return m ? { n, indices: m.indices, score: m.score } : null; })
      .filter((r): r is { n: PaletteNode; indices: number[]; score: number } => r !== null)
      .sort((a, b) => b.score - a.score);
  }, [nodes, query]);

  useEffect(() => { setSel(0); }, [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[sel]; if (r) onPick(r.n); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return createPortal(
    // Portals mount on document.body, outside the [data-workflow-ui] scope, so
    // re-assert it here — tokens and styles are scoped to that attribute.
    <div
      data-workflow-ui="true"
      className="fixed inset-0 z-[100] flex justify-center bg-black/50 px-4 pt-[11vh] backdrop-blur-sm animate-fade-in"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search nodes"
        className="flex h-fit max-h-[74%] w-[560px] max-w-full flex-col overflow-hidden rounded-xl border border-[var(--wui-border)] bg-[var(--wui-surface)] shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-[var(--wui-border)] px-3.5">
          <span className="shrink-0 text-[var(--wui-fg-muted)]">{SEARCH_ICON}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search nodes to open…"
            className="min-w-0 flex-1 bg-transparent py-3 text-[14px] text-[var(--wui-fg)] outline-none placeholder:text-[var(--wui-fg-muted)]"
          />
          <span className="shrink-0 tabular-nums text-[11px] text-[var(--wui-fg-muted)]">{results.length}</span>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-auto p-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-[var(--wui-fg-muted)]">No matching nodes</div>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.n.id}-${String(i)}`}
                data-idx={i}
                type="button"
                onMouseMove={() => setSel(i)}
                onClick={() => onPick(r.n)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                  i === sel ? 'bg-[color-mix(in_srgb,var(--wui-primary)_14%,transparent)]' : 'hover:bg-[color-mix(in_srgb,var(--wui-fg)_5%,transparent)]',
                )}
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[r.n.status])} />
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--wui-fg)]"><Highlighted text={r.n.label} indices={r.indices} /></span>
                <span className="shrink-0 text-[11px] text-[var(--wui-fg-muted)]">{humanize(r.n.type)}</span>
              </button>
            ))
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3.5 border-t border-[var(--wui-border)] px-3.5 py-2 text-[11px] text-[var(--wui-fg-muted)]">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
          <span className="flex items-center gap-1"><Kbd>esc</Kbd> close</span>
        </div>
      </div>
    </div>,
    container ?? document.body,
  );
}

// ─── Detail — basic sectioned fallback (authored layouts land here next) ───

/** `cite` is the citation branch holding this section's entries, keyed by entry name. */
interface DetailSection { key: string; title: string; entries: [string, unknown][]; cite?: unknown }

function deriveSections(state: StepExecutionState, meta: StepMeta | undefined): DetailSection[] {
  // A cited agent's output is `response: {value, citation}` — unwrap it, or this
  // fallback would render the wrapper itself as a "Response" section.
  const { data, citation } = unwrapResponse(state.output);
  const objectSections: DetailSection[] = [];
  const scalars: [string, unknown][] = [];
  for (const [k, v] of Object.entries(data)) {
    if (isPlainObject(v)) objectSections.push({ key: `o:${k}`, title: schemaTitleOf(meta?.outputSchema, k) ?? humanize(k), entries: Object.entries(v), cite: citeAt(citation, k) });
    else scalars.push([k, v]);
  }
  const sections: DetailSection[] = [];
  if (scalars.length) sections.push({ key: 'result', title: objectSections.length ? 'Summary' : 'Result', entries: scalars, cite: citation });
  sections.push(...objectSections);
  const inEntries = Object.entries(state.input ?? {});
  if (inEntries.length) sections.push({ key: 'input', title: 'Input', entries: inEntries });
  return sections;
}

function ValueCell({ value, cite }: { value: unknown; cite?: unknown }): ReactNode {
  const leaf = isCitationRefArray(cite) ? cite : undefined;
  const mark = (node: ReactNode): ReactNode =>
    leaf ? <span className="inline-flex items-baseline gap-1">{node}<CitationMarks refs={leaf} /></span> : node;

  if (value === null || value === undefined || value === '') return mark(<span className="text-[var(--wui-fg-muted)]">—</span>);
  if (typeof value === 'boolean') return mark(<span className="font-medium text-[var(--wui-fg)]">{value ? 'Yes' : 'No'}</span>);
  if (typeof value === 'number') return mark(<span className="font-medium tabular-nums text-[var(--wui-fg)]">{value.toLocaleString()}</span>);
  if (isAttachment(value) || isAttachmentArray(value)) return mark(<DisplayValue value={value} />);
  if (Array.isArray(value)) {
    if (value.length === 0) return mark(<span className="text-[var(--wui-fg-muted)]">None</span>);
    if (value.every((v) => !isPlainObject(v) && !Array.isArray(v))) {
      return mark(
        <div className="flex flex-wrap gap-1.5">
          {value.map((v, i) => (
            <span key={i} className="rounded-md bg-[color-mix(in_srgb,var(--wui-fg)_6%,transparent)] px-2 py-0.5 text-[12px] text-[var(--wui-fg)]">{String(v)}</span>
          ))}
        </div>,
      );
    }
    return (
      <div className="flex flex-col gap-2">
        {value.map((v, i) => (
          <div key={i} className="rounded-lg border border-[var(--wui-border)] p-3">
            {isPlainObject(v) ? <MiniGrid entries={Object.entries(v)} cite={citeAt(cite, i)} /> : <ValueCell value={v} cite={citeAt(cite, i)} />}
          </div>
        ))}
      </div>
    );
  }
  if (isPlainObject(value)) {
    return (
      <div className="rounded-lg border border-[var(--wui-border)] p-3">
        <MiniGrid entries={Object.entries(value)} cite={cite} />
      </div>
    );
  }
  const str = String(value);
  if (str.length > 100 || str.includes('\n')) return mark(<MarkdownView className="text-[13px] text-[var(--wui-fg)]">{str}</MarkdownView>);
  return mark(<span className="text-[var(--wui-fg)]">{str}</span>);
}

function MiniGrid({ entries, cite }: { entries: [string, unknown][]; cite?: unknown }) {
  return (
    <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--wui-fg-muted)]">{humanize(k)}</span>
          <div className="min-w-0 text-[13px]"><ValueCell value={v} cite={citeAt(cite, k)} /></div>
        </div>
      ))}
    </div>
  );
}

function KeyValueGrid({ entries, cite }: { entries: [string, unknown][]; cite?: unknown }) {
  if (entries.length === 0) return <div className="px-1 py-3 text-[13px] italic text-[var(--wui-fg-muted)]">No fields</div>;
  return (
    <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex min-w-0 gap-4">
          <span className="w-40 shrink-0 pt-0.5 text-right text-[12px] font-medium text-[var(--wui-fg-muted)]">{humanize(k)}</span>
          <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed"><ValueCell value={v} cite={citeAt(cite, k)} /></div>
        </div>
      ))}
    </div>
  );
}

function NodeDetail({ state, meta, title, description, template }: {
  state: StepExecutionState; meta: StepMeta | undefined; title: string; description?: string | undefined; template: string | null;
}) {
  const status = (state.status as Status) ?? 'pending';
  const rendered = useMemo(
    () => (template ? renderLayout(template, { input: state.input ?? {}, output: state.output ?? {}, status: state.status, error: state.error }) : null),
    [template, state],
  );
  const fallback = useMemo(() => deriveSections(state, meta), [state, meta]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={cn('h-2.5 w-2.5 rounded-full', DOT[status])} />
          <h2 className="text-[16px] font-semibold text-[var(--wui-fg)]">{title}</h2>
          <StatusBadge status={status as StatusVariant} className="ml-0.5" />
        </div>
        {description && <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-[var(--wui-fg-muted)]">{description}</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        {rendered ? (
          rendered.ok ? (
            <div className="flex flex-col gap-8">{rendered.node}</div>
          ) : (
            <div className="rounded-lg border border-red-300 bg-[color-mix(in_srgb,#ef4444_8%,transparent)] p-3 text-[13px] text-red-700">
              Layout error: {rendered.error}
            </div>
          )
        ) : fallback.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[var(--wui-fg-muted)]">No data for this step.</div>
        ) : (
          <div className="flex flex-col gap-8">
            {fallback.map((s) => (
              <section key={s.key}>
                <div className="mb-3 flex items-center gap-3">
                  <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--wui-fg-muted)]">{s.title}</h3>
                  <span className="h-px flex-1 bg-[var(--wui-border)]" />
                </div>
                <KeyValueGrid entries={s.entries} cite={s.cite} />
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── The view ───

export function ExecutionTabs({
  steps, stepMeta, stepStates, executionSteps, groups, onlyPinned, selectedStepId, onStepClick,
  selectedStepState, selectedStepTitle, selectedStepDescription,
  triggerLabel, triggerCompleted, isTriggerSelected, onTriggerClick, triggerData, triggerLayout,
}: ExecutionTabsProps) {
  const [path, setPath] = useState<Descriptor[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const autoOpened = useRef<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const sidebarDragRef = useRef<{ startX: number; startW: number } | null>(null);

  const { sections, crumbs, insideGroupId } = useMemo(
    () => resolveLevel(steps, stepMeta, path, executionSteps, stepStates),
    [steps, stepMeta, path, executionSteps, stepStates],
  );
  // Config-`pinned` groups hoisted to the Run level. Once we've drilled INTO one, drop it
  // from the skip-set so its own nested content (which shares the group id) still shows.
  const hoistedIds = useMemo(() => {
    const pinned = new Set(
      (groups ?? []).filter((g) => (g as StepGroup & { pinned?: boolean }).pinned).map((g) => g.id),
    );
    for (const d of path) if (d.kind === 'group') pinned.delete(d.id);
    return pinned;
  }, [groups, path]);
  const activeId = isTriggerSelected ? TRIGGER_ID : selectedStepId;

  const openLeaf = (id: string, label: string, replace = false) => {
    setOpenTabs((tabs) => (tabs.some((t) => t.id === id) ? tabs : [...tabs, { id, label }]));
    onStepClick(id, replace);
  };
  const openTrigger = (replace = false) => {
    setOpenTabs((tabs) => (tabs.some((t) => t.id === TRIGGER_ID) ? tabs : [...tabs, { id: TRIGGER_ID, label: triggerLabel }]));
    onTriggerClick(replace);
  };
  const activateTab = (id: string) => { if (id === TRIGGER_ID) onTriggerClick(); else onStepClick(id); };
  const closeTab = (id: string) => {
    setOpenTabs((tabs) => {
      const idx = tabs.findIndex((t) => t.id === id);
      const next = tabs.filter((t) => t.id !== id);
      if (id === activeId && next.length > 0) {
        const neighbour = next[Math.min(idx, next.length - 1)]!;
        activateTab(neighbour.id);
      }
      return next;
    });
  };

  const openNode = (n: PaletteNode) => {
    if (n.id === TRIGGER_ID) openTrigger();
    else openLeaf(n.id, n.label);
  };

  // Every openable node, flattened for the Cmd/Ctrl+P palette: the trigger plus
  // every step config (nested branch/loop bodies included, via walkStepConfigs).
  const paletteNodes = useMemo<PaletteNode[]>(() => {
    const out: PaletteNode[] = [{
      id: TRIGGER_ID, label: triggerLabel, type: 'trigger',
      status: triggerCompleted ? 'completed' : 'pending',
    }];
    const seen = new Set<string>([TRIGGER_ID]);
    walkStepConfigs(steps, (s) => {
      if (seen.has(s.id)) return;
      seen.add(s.id);
      out.push({
        id: s.id,
        label: s.title || stepMeta.get(s.type)?.name || humanize(s.id),
        type: s.type,
        status: (stepStates.get(s.id)?.status as Status) ?? 'pending',
      });
    });
    return out;
  }, [steps, stepMeta, stepStates, triggerLabel, triggerCompleted]);

  // Cmd/Ctrl+P toggles the node palette; Cmd/Ctrl+B toggles the sidebar. Capture-phase
  // + preventDefault so they beat the browser's print / focus-bookmarks shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setPaletteOpen((o) => !o); }
      else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setSidebarCollapsed((c) => !c); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); };
  }, []);

  // Drag the sidebar's right edge to resize, clamped to [min, max].
  const handleSidebarResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    sidebarDragRef.current = { startX: e.clientX, startW: sidebarWidth };
    const move = (ev: MouseEvent) => {
      if (!sidebarDragRef.current) return;
      const dx = ev.clientX - sidebarDragRef.current.startX;
      setSidebarWidth(Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, sidebarDragRef.current.startW + dx)));
    };
    const up = () => {
      sidebarDragRef.current = null;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // Open the first node by default — on entering the view, and again each time we
  // drill into a construct/group (so opening a node with children lands on its first
  // child). Keyed by path so climbing back doesn't re-open a level we already opened.
  useEffect(() => {
    const key = path.map((d) => `${d.kind}:${d.id}`).join('>');
    if (autoOpened.current.has(key)) return;
    // At the root, respect a parent-provided (deep-link/URL) selection over the
    // default first node so a shared link opens on the right node.
    if (path.length === 0 && selectedStepId) {
      autoOpened.current.add(key);
      if (selectedStepId === TRIGGER_ID) openTrigger(true);
      else openLeaf(selectedStepId, paletteNodes.find((n) => n.id === selectedStepId)?.label ?? selectedStepId, true);
      return;
    }
    const first = firstLeafOfLevel(sections, groups, stepMeta, insideGroupId, stepStates, hoistedIds, path.length === 0 && !!onlyPinned);
    if (!first) return; // states still loading, or no leaf at this level — retry next render
    autoOpened.current.add(key);
    openLeaf(first.id, first.label, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, sections, groups, stepMeta, insideGroupId, stepStates, hoistedIds, onlyPinned, selectedStepId]);

  // An externally-driven selection (URL back/forward, deep-link) opens the node's
  // detail; make sure its tab exists in the strip too.
  useEffect(() => {
    if (isTriggerSelected) {
      setOpenTabs((tabs) => (tabs.some((t) => t.id === TRIGGER_ID) ? tabs : [...tabs, { id: TRIGGER_ID, label: triggerLabel }]));
    } else if (selectedStepId) {
      const id = selectedStepId;
      setOpenTabs((tabs) => (tabs.some((t) => t.id === id) ? tabs : [...tabs, { id, label: paletteNodes.find((n) => n.id === id)?.label ?? id }]));
    }
  }, [selectedStepId, isTriggerSelected, triggerLabel, paletteNodes]);

  const detailMeta = selectedStepState ? stepMeta.get(selectedStepState.stepType) : undefined;
  // A step carries its own JSX layout on `step.config.layout`; null → sectioned fallback.
  const stepTemplate = useMemo(() => {
    if (!selectedStepState) return null;
    // Resolve the step's config anywhere in the tree — nested branch / loop / case
    // bodies included — so nested steps carry their own layout, not just top-level ones.
    let cfg: WorkflowStepConfig | undefined;
    walkStepConfigs(steps, (s) => { if (!cfg && s.id === selectedStepState.stepName) cfg = s; });
    const l = (cfg?.config as { layout?: unknown } | undefined)?.layout;
    return typeof l === 'string' && l.trim() ? l : null;
  }, [selectedStepState, steps]);
  const triggerState = useMemo<StepExecutionState>(() => ({
    stepName: triggerLabel,
    stepType: 'trigger',
    status: (triggerCompleted ? 'completed' : 'pending') as StepExecutionState['status'],
    input: normalizeTriggerData(triggerData),
  }), [triggerLabel, triggerCompleted, triggerData]);

  return (
    <div ref={rootRef} className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-[var(--wui-bg)]">
      {/* Breadcrumb — full-width bar above both panes (matches the Journey) */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--wui-border)] px-3 py-2.5 text-[12px]">
        <button
          type="button"
          onClick={() => { setSidebarCollapsed((c) => !c); }}
          title={sidebarCollapsed ? 'Show nodes (⌘B)' : 'Hide nodes (⌘B)'}
          aria-label={sidebarCollapsed ? 'Show node sidebar' : 'Hide node sidebar'}
          aria-pressed={!sidebarCollapsed}
          className={cn(
            'mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors',
            sidebarCollapsed
              ? 'text-[var(--wui-fg-muted)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_6%,transparent)] hover:text-[var(--wui-fg)]'
              : 'bg-[color-mix(in_srgb,var(--wui-primary)_13%,transparent)] text-[var(--wui-primary)]',
          )}
        >
          {PANEL_LEFT}
        </button>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-[var(--wui-fg-muted)]">/</span>}
              <button
                type="button"
                disabled={last}
                onClick={() => setPath((p) => p.slice(0, i))}
                className={cn(
                  'rounded px-1 py-0.5 transition-colors',
                  last ? 'font-semibold text-[var(--wui-fg)]' : 'text-[var(--wui-fg-muted)] hover:text-[var(--wui-primary)]',
                )}
              >
                {c.label}
              </button>
            </span>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!sidebarCollapsed && (
          <div className="relative flex shrink-0 border-r border-[var(--wui-border)]" style={{ width: sidebarWidth }}>
            <Sidebar
          sections={sections}
          insideGroupId={insideGroupId}
          atRoot={path.length === 0}
          stepMeta={stepMeta}
          stepStates={stepStates}
          groups={groups}
          hoistedIds={hoistedIds}
          onlyPinned={onlyPinned}
          onDrill={(d) => setPath((p) => [...p, d])}
          onOpenLeaf={openLeaf}
          selectedId={selectedStepId}
          allNodes={paletteNodes}
          onOpenNode={openNode}
          triggerLabel={triggerLabel}
          triggerCompleted={triggerCompleted}
          isTriggerSelected={isTriggerSelected}
          onOpenTrigger={openTrigger}
            />
            <div
              onMouseDown={handleSidebarResize}
              title="Drag to resize"
              className="absolute right-0 top-0 bottom-0 z-10 w-1 cursor-col-resize transition-colors hover:bg-[color-mix(in_srgb,var(--wui-primary)_40%,transparent)] active:bg-[color-mix(in_srgb,var(--wui-primary)_55%,transparent)]"
            />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <EditorTabStrip tabs={openTabs} activeId={activeId} onActivate={activateTab} onClose={closeTab} />
          <div className="min-h-0 flex-1">
            {isTriggerSelected ? (
              <NodeDetail state={triggerState} meta={undefined} title={triggerLabel} template={triggerLayout ?? null} />
            ) : selectedStepState ? (
              <NodeDetail
                state={selectedStepState}
                meta={detailMeta}
                title={selectedStepTitle ?? selectedStepState.stepName}
                description={selectedStepDescription}
                template={stepTemplate}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-[var(--wui-fg-muted)]">
                <p className="text-[13px]">Open a step from the sidebar.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {paletteOpen && (
        <NodePalette
          nodes={paletteNodes}
          container={(rootRef.current?.closest('[data-workflow-ui]') as HTMLElement | null) ?? null}
          onPick={(n) => { openNode(n); setPaletteOpen(false); }}
          onClose={() => { setPaletteOpen(false); }}
        />
      )}
    </div>
  );
}
