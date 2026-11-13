/**
 * The cited sources, opened beside the data rather than over it.
 *
 * Checking a citation means comparing a value against its evidence, so the two
 * have to be on screen together — a modal would cover the thing you're verifying.
 * A resizable column that pushes the run view over, with a VSCode-style tab strip
 * so several documents stay open at once. Each document appears once: re-opening
 * one already open just re-activates its tab (and re-lands it on the new page).
 * Every open document's viewer stays mounted (hidden when inactive) so switching
 * tabs preserves each one's scroll and zoom.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SidePanelShell } from './SidePanelShell.js';
import { DocumentViewer } from '../shared/DocumentViewer.js';
import { StepOutputView } from './StepOutputView.js';
import { FileTypeBadge } from '../shared/AttachmentCard.js';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { useCitationOrigin } from '../shared/citation-context.js';
import type { ResolvedCitation } from './origin/citation-resolver.js';
import { resolveRef } from './origin/origin-resolver.js';
import { cn } from '../shared/cn.js';

/**
 * What a tab can show. Deliberately the RESOLVED citation itself rather than a
 * parallel type: a citation resolves to exactly two openable things — a document
 * or a step's output — and the panel opens whichever it is. Keeping one type
 * means a new source kind can't be added to the resolver without the panel
 * failing to compile.
 */
export type CitationSourceDoc = Extract<ResolvedCitation, { kind: 'doc' | 'value' }>;

/** The page this tab points at, when the document has pages — for the tab title. */
function pageOf(d: CitationSourceDoc): number | undefined {
  return d.kind === 'doc' && d.anchor?.locator?.at === 'page' ? d.anchor.locator.page : undefined;
}

/** Tab display name — the file, or the step that produced the data. */
function titleOf(d: CitationSourceDoc): string {
  return d.kind === 'doc' ? d.attachment.name : d.label;
}

/** One tab per underlying source — keyed by the document (not the page) so a
 *  second citation into the same file re-uses its tab instead of opening a copy;
 *  and by step+path for data, so two fields of one step stay distinguishable. */
export const citationDocKey = (d: CitationSourceDoc): string =>
  d.kind === 'doc'
    ? String(d.attachment.handle ?? d.attachment.name)
    // Keyed by the FULL ref, not step id + path: under MAP/LOOP the same step id
    // exists once per iteration, and `items.0` vs `items.1` live only in the ref.
    // Keying on the id would collapse two iterations into one tab.
    : `step:${d.ref}`;

export interface CitationSourcePanelProps {
  docs: CitationSourceDoc[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onCloseTab: (key: string) => void;
  onCloseAll: () => void;
  width?: number | undefined;
  onWidthChange?: ((width: number) => void) | undefined;
  className?: string | undefined;
  /** Controlled full preview. Supply both to let a router own the dialog (so
   *  it can live in the URL); omit them and the panel keeps its own state. */
  full?: boolean | undefined;
  /** Return true to claim the change (the owner put it in the URL); return
   *  false or nothing to let the panel handle it locally. */
  onFullChange?: ((full: boolean, doc: CitationSourceDoc | null) => boolean | void) | undefined;
}

const CloseIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ExpandIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

export function CitationSourcePanel({
  docs,
  activeKey,
  onSelect,
  onCloseTab,
  onCloseAll,
  width,
  onWidthChange,
  className,
  full: controlledFull,
  onFullChange,
}: CitationSourcePanelProps) {
  const client = useWorkflowClient();
  // The provider is mounted above this panel in the run view, so a step tab can
  // fetch the producing step's recorded output without threading it through props.
  const originCtx = useCitationOrigin();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLDivElement>(null);
  const [internalFull, setInternalFull] = useState(false);
  const full = internalFull || controlledFull === true;
  // Resolved before the empty-docs return below: `setFull` closes over it, and
  // the Escape handler keeps the closure from the render that opened the
  // dialog — which may be one where `docs` was still empty.
  const active = docs.find((d) => citationDocKey(d) === activeKey) ?? docs[0]!;
  // One entry point for both modes: tell the owner when controlled, otherwise
  // keep the local state, so the owner can map the dialog to the document it
  // is showing.
  const setFull = (next: boolean): void => {
    // Closing always clears the local flag, whoever owns the dialog: a citation
    // opened locally must still close when its own button is pressed.
    if (!next) {
      setInternalFull(false);
      onFullChange?.(false, active ?? null);
      return;
    }
    // Opening is delegated only when the owner says it took it — it can address
    // an attachment in the URL. A citation has no attachment, so it falls back
    // to local state rather than silently doing nothing.
    const handled = onFullChange?.(true, active ?? null) === true;
    if (!handled) setInternalFull(true);
  };

  // Opening/activating a document should bring its tab into view — it may sit
  // off-screen to the right when many are open. Scroll only the strip, not the page.
  useEffect(() => {
    const s = scrollerRef.current;
    const t = activeTabRef.current;
    if (!s || !t) return;
    const sr = s.getBoundingClientRect();
    const tr = t.getBoundingClientRect();
    if (tr.left < sr.left) s.scrollBy({ left: tr.left - sr.left - 8, behavior: 'smooth' });
    else if (tr.right > sr.right) s.scrollBy({ left: tr.right - sr.right + 8, behavior: 'smooth' });
  }, [activeKey]);

  // Full-screen preview closes on Escape.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [full]);

  if (docs.length === 0) return null;

  // One viewer-render path shared by the side panel and the full-screen overlay.
  const renderDoc = (d: CitationSourceDoc) =>
    d.kind === 'doc' ? (
      <DocumentViewer
        key={`${String(d.attachment.handle)}#${JSON.stringify(d.anchor ?? {})}`}
        url={client.uploads.url(d.attachment)}
        mimeType={d.attachment.mimeType}
        name={d.attachment.name}
        anchor={d.anchor}
      />
    ) : (
      <StepOutputView
        // Resolved from the ref prefix rather than `stepOutput(stepId)`: under
        // MAP/LOOP a bare id names N iterations, and only the ref says which one.
        output={
          d.stepOutputRef !== undefined && originCtx
            ? resolveRef(d.stepOutputRef, originCtx).value
            : d.value
        }
        path={d.path}
        label={(d.stepId !== undefined ? originCtx?.stepTitle(d.stepId) : undefined) ?? d.label}
        stepId={d.stepId}
        description={d.stepId !== undefined ? originCtx?.stepDescription(d.stepId) : undefined}
      />
    );

  return (
    <SidePanelShell
      accentClassName="border-t-0"
      width={width}
      onWidthChange={onWidthChange}
      className={className}
    >
      {/* Tab strip */}
      <div className="flex shrink-0 items-stretch border-b border-[var(--wui-border)]" style={{ minHeight: '44px' }}>
        <div ref={scrollerRef} className="flex min-w-0 flex-1 items-stretch overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {docs.map((d) => {
            const key = citationDocKey(d);
            const isActive = d === active;
            return (
              <div
                key={key}
                ref={isActive ? activeTabRef : undefined}
                onClick={() => { onSelect(key); }}
                title={`${titleOf(d)}${pageOf(d) !== undefined ? ` · page ${String(pageOf(d))}` : ''}`}
                className={cn(
                  'group flex min-w-0 max-w-[190px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-[var(--wui-border)] px-3 text-[12px] transition-colors',
                  isActive
                    ? 'bg-[var(--wui-bg)] font-medium text-[var(--wui-fg)]'
                    : 'text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)]',
                )}
              >
                {d.kind === 'doc' ? (
                  <FileTypeBadge name={d.attachment.name} size="sm" />
                ) : (
                  // Data, not a file — say so in the tab so the reader knows what
                  // opens before clicking.
                  <span
                    aria-hidden="true"
                    className="shrink-0 rounded bg-[var(--wui-bg-muted)] px-1 font-mono text-[9px] leading-[14px] text-[var(--wui-fg-muted)]"
                  >
                    {'{}'}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{titleOf(d)}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onCloseTab(key); }}
                  aria-label={`Close ${titleOf(d)}`}
                  className={cn(
                    'grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--wui-fg-muted)] transition hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)]',
                    isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  )}
                >
                  <CloseIcon />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => { setFull(true); }}
          aria-label="Open full preview"
          title="Full preview"
          className="grid w-10 shrink-0 place-items-center border-l border-[var(--wui-border)] text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]"
        >
          <ExpandIcon size={15} />
        </button>
        <button
          type="button"
          onClick={onCloseAll}
          aria-label="Close panel"
          className="grid w-10 shrink-0 place-items-center border-l border-[var(--wui-border)] text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]"
        >
          <CloseIcon size={15} />
        </button>
      </div>

      {/* Viewers — every open document stays mounted; only the active one shows,
          so switching tabs keeps each one's scroll/zoom. */}
      <div className="min-h-0 flex-1 overflow-hidden bg-[var(--wui-bg-subtle)]">
        {docs.map((d) => (
          <div key={citationDocKey(d)} className={cn('h-full', d === active ? 'block' : 'hidden')}>
            {renderDoc(d)}
          </div>
        ))}
      </div>

      {full &&
        createPortal(
          // Modal dialog — dimmed/blurred backdrop with a centered floating panel.
          // Click-away or Esc closes; clicks inside the panel don't.
          // Portals mount on document.body, outside the [data-workflow-ui] scope,
          // so re-assert it here — tokens and styles are scoped to that attribute.
          <div
            data-workflow-ui="true"
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm sm:p-8"
            onClick={() => { setFull(false); }}
          >
            <div
              role="dialog"
              aria-modal="true"
              onClick={(e) => { e.stopPropagation(); }}
              className="flex h-full max-h-[92vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-xl border border-[var(--wui-border)] bg-[var(--wui-bg)] shadow-2xl"
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-[var(--wui-border)] px-4" style={{ minHeight: '48px' }}>
                {active.kind === 'doc' ? (
                  <FileTypeBadge name={active.attachment.name} size="sm" />
                ) : (
                  <span aria-hidden="true" className="shrink-0 rounded bg-[var(--wui-bg-muted)] px-1 font-mono text-[9px] leading-[14px] text-[var(--wui-fg-muted)]">{'{}'}</span>
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--wui-fg)]">{titleOf(active)}</span>
                <button
                  type="button"
                  onClick={() => { setFull(false); }}
                  aria-label="Close full preview"
                  title="Close (Esc)"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]"
                >
                  <CloseIcon size={15} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden bg-[var(--wui-bg-subtle)]">
                <div className="h-full">{renderDoc(active)}</div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </SidePanelShell>
  );
}
