/**
 * OriginTrace — the reviewer-facing "where did this value come from" UI.
 *
 * - `OriginChip`: quiet "⌄ source" affordance next to a value.
 * - `useOriginInspector`: holds which value is being inspected.
 * - `OriginPanel`: right-hand drawer that resolves the value's ref(s) and lets
 *   the reviewer trace upstream ("and above") recursively.
 *
 * The chip only *sets* state; the panel does the rendering — keeping the
 * resolver (origin-resolver.ts) presentation-agnostic.
 */
import { useState, useEffect, useMemo, type ReactNode } from 'react';
import type { Citation } from '@xyne/workflow-sdk/builder';
import { extractRefPath } from '@xyne/workflow-sdk/builder';
import type { Attachment } from '@xyne/workflow-sdk';
import { cn } from '../../shared/cn.js';
import { SidePanelShell } from '../SidePanelShell.js';
import { AttachmentList, FileTypeBadge } from '../../shared/AttachmentCard.js';
import { DocumentViewer } from '../../shared/DocumentViewer.js';
import { DocPreviewContext } from '../../shared/DocPreviewContext.js';
import { useWorkflowClient } from '../../../hooks/use-workflow-client.js';
import { JsonView } from '../../shared/JsonView.js';
import {
  resolveRef,
  getOriginRefs,
  type OriginResolverCtx,
  type ResolvedOrigin,
} from './origin-resolver.js';

// ─── Inspector state ───

export interface InspectedOrigin {
  /** The display label of the value being inspected (for the panel header). */
  label: string;
  /** Auto-derived ref(s) behind the value ("where it came from"). */
  autoRefs: string[];
  /** Author-attached citations for this field ("sources"). */
  citations: Citation[];
}

export function useOriginInspector() {
  const [inspected, setInspected] = useState<InspectedOrigin | null>(null);
  return {
    inspected,
    open: (label: string, autoRefs: string[], citations: Citation[] = []) =>
      setInspected({ label, autoRefs, citations }),
    close: () => setInspected(null),
  };
}

// ─── Chip ───

export function OriginChip({ onClick, active, className }: { onClick: () => void; active?: boolean | undefined; className?: string | undefined }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Where this value came from"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors',
        active
          ? 'border-[var(--wui-primary)] bg-[color-mix(in_srgb,var(--wui-primary)_14%,transparent)] text-[var(--wui-primary)]'
          : 'border-[var(--wui-border)] bg-[var(--wui-bg)] text-[var(--wui-fg-muted)] hover:border-[var(--wui-primary)] hover:text-[var(--wui-fg)]',
        className,
      )}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      Source
    </button>
  );
}

/**
 * Generic, value-driven chip. Shows the Source chip when the value has auto refs
 * OR the field has author citations. The single mechanism at every
 * reviewer-visible value — no field- or step-specific knowledge.
 */
export function OriginChipFor({
  raw,
  label,
  citations = [],
  onInspect,
  active,
  className,
}: {
  raw: unknown;
  label: string;
  citations?: Citation[] | undefined;
  onInspect?: ((label: string, autoRefs: string[], citations: Citation[]) => void) | undefined;
  active?: boolean | undefined;
  className?: string;
}) {
  if (!onInspect) return null;
  const autoRefs = getOriginRefs(raw);
  if (autoRefs.length === 0 && citations.length === 0) return null;
  return <OriginChip onClick={() => onInspect(label, autoRefs, citations)} active={active} className={className} />;
}

// ─── Panel (resizable, layout side-panel) ───

export function OriginPanel({
  inspected,
  ctx,
  onClose,
  width,
  onWidthChange,
  expanded,
  className,
}: {
  inspected: InspectedOrigin | null;
  ctx: OriginResolverCtx;
  onClose: () => void;
  width?: number | undefined;
  onWidthChange?: ((width: number) => void) | undefined;
  expanded?: boolean | undefined;
  className?: string | undefined;
}) {
  const client = useWorkflowClient();
  // Tab set scoped to the inspected field: the origin trace + one tab per
  // attached document. Switching fields rebuilds the set (resets to origin).
  const docs = useMemo(() => (inspected ? collectDocs(inspected, ctx) : []), [inspected, ctx]);
  // The inspected field's live value — used to auto-highlight the cited
  // passage when a document tab that carries a page number is opened.
  const fieldValue = useMemo(() => {
    for (const ref of inspected?.autoRefs ?? []) {
      const v = resolveRef(ref, ctx).value;
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return undefined;
  }, [inspected, ctx]);
  // Document tabs are opened on demand — clicking a preview/eye on an
  // attachment adds a tab; nothing is pre-opened. Keyed by the attachment ref.
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'origin' | string>('origin');
  useEffect(() => { setActiveTab('origin'); setOpenTabs([]); }, [inspected]);

  if (!inspected) return null;
  const { citations } = inspected;
  const activeDoc = activeTab === 'origin' ? undefined : docs.find((d) => d.handle === activeTab);
  const openDocTab = (att: Attachment) => {
    const d = docs.find((x) => x.handle === att.handle);
    if (!d) return;
    setOpenTabs((t) => (t.includes(d.handle) ? t : [...t, d.handle]));
    setActiveTab(d.handle);
  };
  const closeDocTab = (data: string) => {
    setOpenTabs((t) => t.filter((x) => x !== data));
    setActiveTab((cur) => (cur === data ? 'origin' : cur));
  };
  return (
    <SidePanelShell
      accentClassName="border-t-0"
      width={width}
      onWidthChange={onWidthChange}
      minWidth={expanded ? 360 : undefined}
      maxWidth={expanded ? Math.max(640, (typeof window !== 'undefined' ? window.innerWidth : 1400) - 440) : undefined}
      className={className}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--wui-border)] px-4" style={{ minHeight: '53px' }}>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--wui-fg-muted)]">Value origin</p>
          <p className="truncate text-[13px] font-semibold text-[var(--wui-fg)]" title={inspected.label}>{inspected.label}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--wui-radius-sm)] text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)]"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Tabs — the source/origin tab is always present; a document tab joins
          it only once the user opens that attachment (nothing pre-opened). */}
      <div className="flex shrink-0 border-b border-[var(--wui-border)] bg-[var(--wui-bg-muted)]">
        <OriginTab
          active={activeTab === 'origin'}
          onClick={() => setActiveTab('origin')}
          title={`${inspected.label}: source`}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>}
        >{`${inspected.label}: source`}</OriginTab>
        {openTabs.map((data) => {
          const d = docs.find((x) => x.handle === data);
          if (!d) return null;
          return (
            <OriginTab
              key={data}
              active={activeTab === data}
              onClick={() => setActiveTab(data)}
              title={d.name}
              icon={<FileTypeBadge name={d.name} size="sm" />}
              onCloseTab={() => closeDocTab(data)}
            >{d.name}</OriginTab>
          );
        })}
      </div>

      {/* Body — a document tab, else the origin trace. When the author's
          citation carried a page number, the viewer lands on that page and
          pre-highlights the inspected value so the reviewer sees the exact
          passage the field came from. */}
      {activeDoc ? (
        <div className="min-h-0 flex-1 overflow-auto bg-[var(--wui-bg-subtle)]">
          <DocumentViewer
            url={client.uploads.url(activeDoc)}
            mimeType={activeDoc.mimeType}
            name={activeDoc.name}
            anchor={{
              ...(activeDoc.page !== undefined
                ? { locator: { at: 'page', page: activeDoc.page } as const }
                : {}),
              ...(activeDoc.page !== undefined && fieldValue !== undefined
                ? { quote: fieldValue }
                : {}),
            }}
          />
        </div>
      ) : (
       <DocPreviewContext.Provider value={docs.length > 0 ? openDocTab : null}>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* The auto-derived "Where it came from" trace was deliberately
            removed from the reviewer UI — only author-attached sources are
            shown. (The auto refs still power doc collection + highlight.) */}

        {/* Author-attached sources */}
        {citations.length > 0 && (
          <section className="space-y-2">
            <SectionHeader>
              Supporting sources
              <span className="ml-1.5 rounded-full bg-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)] px-1.5 py-px text-[9px] font-semibold text-[var(--wui-primary)]">added by author</span>
            </SectionHeader>
            <p className="text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">
              Reference material attached to help you verify this value:
            </p>
            {citations.map((c, i) => (
              <CitationNode key={`${c.ref}-${String(i)}`} citation={c} ctx={ctx} onClose={onClose} />
            ))}
          </section>
        )}

        {citations.length === 0 && (
          <p className="text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">
            No supporting sources are attached to this value.
          </p>
        )}
        </div>
       </DocPreviewContext.Provider>
      )}
    </SidePanelShell>
  );
}

function OriginTab({ active, onClick, title, icon, children, onCloseTab }: { active: boolean; onClick: () => void; title?: string | undefined; icon?: ReactNode; children: ReactNode; onCloseTab?: (() => void) | undefined }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'relative flex min-w-0 flex-1 items-center gap-1.5 border-r border-[var(--wui-border)] px-3 py-2 text-[12px] transition-colors last:border-r-0',
        active
          ? 'bg-[var(--wui-bg)] font-medium text-[var(--wui-fg)]'
          : 'text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]',
      )}
    >
      {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-[var(--wui-primary)]" />}
      {icon && <span className="shrink-0 opacity-90">{icon}</span>}
      <span className="min-w-0 truncate">{children}</span>
      {onCloseTab && (
        // span, not <button> — buttons can't nest. stopPropagation so closing
        // doesn't also activate the tab underneath.
        <span
          role="button"
          tabIndex={0}
          aria-label="Close document tab"
          onClick={(e) => { e.stopPropagation(); onCloseTab(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onCloseTab(); } }}
          className="ml-auto grid h-4 w-4 shrink-0 place-items-center rounded text-[var(--wui-fg-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--wui-fg)_10%,transparent)] hover:text-[var(--wui-fg)]"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </span>
      )}
    </button>
  );
}

/** A document tab entry: the attachment plus, when the author's citation
 *  carried a `pageNumber`, the page the inspected value came from. */
type DocEntry = Attachment & { page?: number | undefined };

/** Resolve a citation's `pageNumber` (a literal like "2" or a "{{ref}}") to a
 *  usable 1-indexed page, or undefined when absent/unresolvable. */
function resolveCitationPage(c: Citation, ctx: OriginResolverCtx): number | undefined {
  if (!c.pageNumber) return undefined;
  const refPath = extractRefPath(c.pageNumber);
  const raw = refPath ? resolveRef(refPath, ctx).value : c.pageNumber;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

/** All distinct documents attached to the inspected field (origin refs + citations). */
function collectDocs(inspected: InspectedOrigin, ctx: OriginResolverCtx): DocEntry[] {
  const out: DocEntry[] = [];
  const seen = new Map<string, DocEntry>();
  const add = (o: ResolvedOrigin, page?: number) => {
    for (const a of o.attachments ?? []) {
      const existing = seen.get(a.handle);
      if (existing) {
        // A citation's page metadata enriches a doc already found via autoRefs.
        if (page !== undefined && existing.page === undefined) existing.page = page;
        continue;
      }
      const entry: DocEntry = page !== undefined ? { ...a, page } : { ...a };
      seen.set(a.handle, entry);
      out.push(entry);
    }
  };
  for (const ref of inspected.autoRefs) add(resolveRef(ref, ctx));
  for (const c of inspected.citations)
    add(resolveRef(extractRefPath(c.ref) ?? c.ref, ctx), resolveCitationPage(c, ctx));
  return out;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="flex items-center text-[10px] font-bold uppercase tracking-wider text-[var(--wui-fg-muted)]">
      {children}
    </h3>
  );
}

/** A single author citation: resolves its ref and renders it like an origin (or a file). */
function CitationNode({ citation, ctx, onClose }: { citation: Citation; ctx: OriginResolverCtx; onClose: () => void }) {
  // citation.ref is the full "{{...}}" form; resolveRef wants the bare path.
  const origin = resolveRef(extractRefPath(citation.ref) ?? citation.ref, ctx);
  return (
    <div className="overflow-hidden rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)]">
      <div className="border-l-2 border-[var(--wui-primary)] p-2.5">
        {citation.label && (
          <div className="mb-0.5 text-[12.5px] font-semibold text-[var(--wui-fg)]">{citation.label}</div>
        )}
        {citation.description && (
          <p className="mb-1.5 text-[11px] leading-snug text-[var(--wui-fg-muted)]">{citation.description}</p>
        )}
        <OriginBody origin={origin} ctx={ctx} onClose={onClose} />
      </div>
    </div>
  );
}

/** Inner card content of an author-citation node. */
function OriginBody({ origin, ctx, onClose }: { origin: ResolvedOrigin; ctx: OriginResolverCtx; onClose: () => void }) {
  const [showAll, setShowAll] = useState(false);
  // The full source object behind this value (a step's whole output, or the request).
  const fullData = origin.stepId
    ? ctx.stepOutput(origin.stepId)
    : origin.kind === 'trigger'
      ? ctx.triggerData
      : undefined;
  const fullLabel = origin.kind === 'trigger' ? 'request' : 'output';
  const hasFull =
    fullData !== undefined &&
    fullData !== null &&
    typeof fullData === 'object' &&
    Object.keys(fullData as Record<string, unknown>).length > 0;

  return (
    <>
      {/* Group */}
      {origin.group && (
        <div className="mb-1.5 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-[var(--wui-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--wui-fg-muted)] ring-1 ring-inset ring-[var(--wui-border)]" title={origin.group.description ?? origin.group.title}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
          </svg>
          {origin.group.title}
        </div>
      )}

      {/* Step title + (optional) jump */}
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-[13px] font-semibold text-[var(--wui-fg)]" title={origin.label}>
          {origin.label}
        </span>
        {origin.stepId && ctx.onJump && (
          <button
            type="button"
            onClick={() => { ctx.onJump?.(origin.stepId!); onClose(); }}
            className="shrink-0 rounded-full border border-[var(--wui-border)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--wui-fg-muted)] transition hover:bg-[var(--wui-bg)] hover:text-[var(--wui-fg)]"
          >
            View step
          </button>
        )}
      </div>

      {/* What the step does */}
      {origin.stepDescription && (
        <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--wui-fg-muted)]">{origin.stepDescription}</p>
      )}

      {/* The value it produced — an attachment card when it's a file, else the value */}
      <div className="mt-2.5">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--wui-fg-muted)]">Value</div>
        {origin.attachments && origin.attachments.length > 0 ? (
          <AttachmentList attachments={origin.attachments} />
        ) : origin.value !== null && typeof origin.value === 'object' ? (
          <div className="max-h-60 overflow-auto rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2.5 py-2">
            <JsonView data={origin.value} />
          </div>
        ) : (
          <div className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2.5 py-2 text-[13px] text-[var(--wui-fg)]">
            {formatValue(origin.value)}
          </div>
        )}
      </div>

      {/* Optional: see everything this step produced */}
      {hasFull && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowAll((o) => !o)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--wui-fg-muted)] transition-colors hover:text-[var(--wui-fg)]"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" className={cn('transition-transform', showAll && 'rotate-90')}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {showAll ? `Hide full ${fullLabel}` : `View full ${fullLabel}`}
          </button>
          {showAll && (
            <div className="mt-1.5 max-h-72 overflow-auto rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2.5 py-2">
              <JsonView data={fullData} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function formatValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value.length ? value : '(empty)';
  if (Array.isArray(value)) return value.map((v) => formatValue(v)).join(', ');
  if (typeof value === 'object') {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }
  return String(value);
}
