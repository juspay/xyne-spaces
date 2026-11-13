/**
 * The reader-facing citation affordance.
 *
 * A value's sources collapse to ONE marker — a compact ↗ carrying the source
 * count — and hovering it opens a popover that lists each source (document, page
 * and the cited passage), with same-document passages grouped into one row.
 * This keeps a dense report readable instead of stamping ↗¹ ↗² ↗³ after every
 * field, while the count still signals how well-backed the value is. A single
 * source stays a bare ↗ that opens on click.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn.js';
import type { CitationRef } from './citation.js';
import { AttachmentPreviewModal } from './AttachmentCard.js';
import { useCitationOrigin, useCitationOpener } from './citation-context.js';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import {
  resolveCitationRef,
  citationPage,
  citationCell,
  type ResolvedCitation,
} from '../execution/origin/citation-resolver.js';

/** Where the cited passages sit — page numbers for documents, cell addresses for
 *  sheets. One list so a group label reads the same either way. */
function whereOf(items: { resolved?: ResolvedCitation | undefined }[]): string[] {
  const out: string[] = [];
  for (const i of items) {
    if (!i.resolved) continue;
    const cell = citationCell(i.resolved);
    const page = citationPage(i.resolved);
    const w = cell ?? (page !== undefined ? `p.${String(page)}` : undefined);
    if (w !== undefined && !out.includes(w)) out.push(w);
  }
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** A human label for a source — document name, link title/host, or a bare ref. */
function labelOf(resolved: ResolvedCitation | undefined, ref: CitationRef): string {
  if (!resolved) return ref.kind === 'ref' ? `Source ${ref.ref}` : 'Source';
  if (resolved.kind === 'url') return resolved.title ?? hostOf(resolved.url);
  if (resolved.kind === 'derived') {
    return resolved.label ?? (resolved.expression ? `Computed: ${resolved.expression}` : 'Computed');
  }
  if (resolved.kind === 'value') return resolved.label;
  return resolved.attachment.name;
}

/**
 * WHAT a derived input is — the cited text or value itself.
 *
 * This is the operand the reader needs: `(#1 + #2 - #3)` says nothing unless #1
 * reads "Net Profit = 58.3". Falls back to the source's name only when there is
 * genuinely no cited text, so a row is never blank.
 */
function inputTerm(input: ResolvedCitation): string {
  switch (input.kind) {
    case 'doc':
      return input.anchor?.quote ?? input.attachment.name;
    case 'url':
      return input.quote ?? input.title ?? hostOf(input.url);
    case 'value':
      return typeof input.value === 'object' && input.value !== null
        ? input.label
        : String(input.value);
    case 'derived':
      return input.label ?? input.expression ?? 'Computed value';
  }
}

/** WHERE the input came from — shown under the term, quieter. */
function inputSource(input: ResolvedCitation): string {
  switch (input.kind) {
    case 'doc': {
      const cell = citationCell(input);
      if (cell !== undefined) return `${input.attachment.name} · ${cell}`;
      const page = citationPage(input);
      return `${input.attachment.name}${page !== undefined ? ` · p.${String(page)}` : ''}`;
    }
    case 'url':
      return input.title ?? hostOf(input.url);
    case 'value':
      return input.label;
    case 'derived':
      return 'computed';
  }
}

/** {} — marks a value read from a step's OUTPUT rather than from a document. */
function DataGlyph(): ReactNode {
  return (
    <span aria-hidden="true" className="font-mono text-[9px] leading-none">
      {'{}'}
    </span>
  );
}

/** ƒ — marks a value that was *computed*, not read from a source. */
function FunctionGlyph({ size = 11 }: { size?: number }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className="inline-block text-center font-serif italic leading-none"
      style={{ width: size, fontSize: size + 2 }}
    >
      ƒ
    </span>
  );
}

function ArrowGlyph({ className, size = 11 }: { className?: string; size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

/** Open a resolved citation (side-panel where hosted, external link, or a modal
 *  fallback). Shared by the single arrow and the grouped popover rows. */
function useCitationOpen(): { open: (r: ResolvedCitation) => void; modal: ReactNode } {
  const client = useWorkflowClient();
  const openInPanel = useCitationOpener();
  const [modalDoc, setModalDoc] = useState<Extract<ResolvedCitation, { kind: 'doc' }> | null>(null);

  const open = (resolved: ResolvedCitation): void => {
    if (resolved.kind === 'url') {
      window.open(resolved.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (resolved.kind === 'derived') {
      // A computed value has no single source — its evidence is the inputs. Open
      // each document as its own tab so they can be compared side by side, which
      // is the whole job when checking a calculation. Links are left for the
      // reader to click: firing several window.open calls would be popup-blocked.
      for (const input of resolved.inputs) {
        if (input.kind === 'doc') open(input);
      }
      return;
    }
    if (resolved.kind === 'value') {
      // Opens the producing step's recorded output at the cited path. Only the
      // panel can host this — there is no document to put in the modal fallback,
      // so on surfaces without a panel it stays inert rather than opening a
      // window with nothing useful in it.
      openInPanel?.(resolved);
      return;
    }
    if (openInPanel) openInPanel(resolved);
    else setModalDoc(resolved);
  };

  const modal = modalDoc ? (
    <AttachmentPreviewModal
      attachment={modalDoc.attachment}
      url={client.uploads.url(modalDoc.attachment)}
      anchor={modalDoc.anchor}
      onClose={() => { setModalDoc(null); }}
    />
  ) : null;

  return { open, modal };
}

// ── Single marker (markdown citations, where each token is its own source) ──────

export interface CitationArrowProps {
  /** The citation this marker opens. */
  citation: CitationRef;
  /** 1-based position, rendered as a superscript when a value has several. */
  index?: number | undefined;
  className?: string | undefined;
}

/** A single citation marker — clicking opens its source directly. */
export function CitationArrow({ citation, index, className }: CitationArrowProps): ReactNode {
  const ctx = useCitationOrigin();
  const { open, modal } = useCitationOpen();
  if (!ctx) return null;
  const resolved = resolveCitationRef(citation, ctx);

  return (
    <>
      <button
        type="button"
        onClick={() => { if (resolved) open(resolved); }}
        disabled={!resolved}
        title={`Source: ${labelOf(resolved, citation)}`}
        className={cn(
          'inline-flex shrink-0 items-center gap-px rounded-[var(--wui-radius-sm)] px-0.5 align-middle transition-colors',
          resolved
            ? 'text-[var(--wui-fg-muted)] hover:bg-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)] hover:text-[var(--wui-primary)]'
            : 'cursor-default text-[var(--wui-border-strong)]',
          className,
        )}
      >
        <ArrowGlyph />
        {index !== undefined && (
          <sup className="text-[8px] font-semibold leading-none">{index}</sup>
        )}
      </button>
      {modal}
    </>
  );
}

// ── Grouped marks + hover popover (a value's whole citation set) ────────────────

export interface CitationMarksProps {
  /** The citations for one data point. */
  refs: CitationRef[] | undefined;
  className?: string | undefined;
}

interface CiteItem {
  ref: CitationRef;
  resolved: ResolvedCitation | undefined;
}
interface CiteGroup {
  key: string;
  label: string;
  items: CiteItem[];
}

/** Collapse citations onto the same underlying document so a value cited three
 *  times from one file reads as one source with three passages, not three rows. */
function groupByDoc(items: CiteItem[]): CiteGroup[] {
  const order: CiteGroup[] = [];
  const byKey = new Map<string, CiteGroup>();
  for (const it of items) {
    const r = it.resolved;
    const key = r
      ? r.kind === 'url'
        ? `url:${r.url}`
        // A computed value is its own source — never merged with another, since
        // two derivations that happen to share an input are still separate claims.
        : r.kind === 'derived'
          ? `derived:${r.expression ?? ''}:${String(r.inputs.length)}`
          : r.kind === 'value'
            ? `value:${r.ref}`
            : `doc:${r.attachment.name}`
      : it.ref.kind === 'ref'
        ? `ref:${it.ref.ref}`
        : 'unresolved';
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: labelOf(it.resolved, it.ref), items: [] };
      byKey.set(key, g);
      order.push(g);
    }
    g.items.push(it);
  }
  return order;
}

type PopoverPos = { left: number; top?: number; bottom?: number };

const POPOVER_W = 320;

export function CitationMarks({ refs, className }: CitationMarksProps): ReactNode {
  const ctx = useCitationOrigin();
  const { open, modal } = useCitationOpen();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<PopoverPos | null>(null);

  // Reposition-on-scroll is fiddly; just close instead (the trigger is cheap to
  // re-hover). Only armed while the popover is open.
  useEffect(() => {
    if (!pos) return;
    const close = (): void => { setPos(null); };
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('scroll', close, true); };
  }, [pos]);

  if (!refs || refs.length === 0 || !ctx) return null;

  const items: CiteItem[] = refs.map((ref) => ({ ref, resolved: resolveCitationRef(ref, ctx) }));
  const groups = groupByDoc(items);
  const count = refs.length;
  const anyResolved = items.some((i) => i.resolved);
  // ƒ when the value was computed rather than read — the reader should be able to
  // tell "this was calculated" from the marker alone, before opening anything.
  const allDerived = items.every((i) => i.resolved?.kind === 'derived');
  // Data, not a document. Worth its own glyph: a reader who clicks ↗ expects a
  // file to open, and getting a step's output instead reads as a malfunction even
  // when it is exactly the right evidence.
  const allData = items.length > 0 && items.every((i) => i.resolved?.kind === 'value');

  const cancelClose = (): void => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openPopover = (): void => {
    cancelClose();
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_W - 8));
    const above = window.innerHeight - r.bottom < 240;
    setPos(above ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
  };
  const scheduleClose = (): void => {
    cancelClose();
    closeTimer.current = setTimeout(() => { setPos(null); }, 140);
  };

  return (
    <span
      className={cn('inline-flex shrink-0 items-center align-middle', className)}
      onMouseEnter={openPopover}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={triggerRef}
        type="button"
        onFocus={openPopover}
        onBlur={scheduleClose}
        onClick={() => {
          if (count === 1 && items[0]?.resolved) open(items[0].resolved);
          else openPopover();
        }}
        aria-label={
          allData
            ? `${String(count)} step output${count === 1 ? '' : 's'}`
            : allDerived
            ? `computed from ${String(count)} source${count === 1 ? '' : 's'}`
            : `${String(count)} source${count === 1 ? '' : 's'}`
        }
        className={cn(
          'ml-0.5 inline-flex h-[15px] shrink-0 items-center gap-0.5 rounded-full px-1 align-middle text-[10px] font-semibold leading-none tabular-nums transition-colors',
          anyResolved
            ? 'bg-[color-mix(in_srgb,var(--wui-primary)_13%,transparent)] text-[var(--wui-primary)] hover:bg-[color-mix(in_srgb,var(--wui-primary)_22%,transparent)]'
            : 'cursor-default bg-[var(--wui-bg-muted)] text-[var(--wui-fg-muted)]',
        )}
      >
        {allDerived ? <FunctionGlyph size={9} /> : allData ? <DataGlyph /> : <ArrowGlyph size={9} />}
        {count}
      </button>

      {pos &&
        createPortal(
          <div
            role="dialog"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, zIndex: 60, width: POPOVER_W }}
            className="max-h-[280px] overflow-auto rounded-lg border border-[var(--wui-border)] bg-[var(--wui-surface)] p-1 shadow-lg"
          >
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--wui-fg-muted)]">
              {count} source{count === 1 ? '' : 's'}
              {groups.length < count ? ` · ${String(groups.length)} document${groups.length === 1 ? '' : 's'}` : ''}
            </div>
            {groups.map((g) => (
              <CitationRow key={g.key} group={g} onOpen={open} />
            ))}
          </div>,
          // Portal INTO the [data-workflow-ui] scope so the app's theme mapping for
          // --wui-* applies (outside it they fall back to the package's indigo
          // defaults). No transformed ancestor, so position:fixed still works.
          triggerRef.current?.closest('[data-workflow-ui]') ?? document.body,
        )}
      {modal}
    </span>
  );
}

/**
 * The same sources as {@link CitationMarks}, but rendered as a persistent list
 * *below* the value instead of an inline chip + hover popover. For prose where
 * the citations are the point (e.g. a Business Overview paragraph) and shouldn't
 * hide behind a hover. Same rows (document · page · snippet), same grouping.
 */
export function CitationList({ refs, className }: CitationMarksProps): ReactNode {
  const ctx = useCitationOrigin();
  const { open, modal } = useCitationOpen();
  if (!refs || refs.length === 0 || !ctx) return null;

  const items: CiteItem[] = refs.map((ref) => ({ ref, resolved: resolveCitationRef(ref, ctx) }));
  const groups = groupByDoc(items);

  return (
    <div className={cn('mt-2 flex flex-col rounded-md border border-[var(--wui-border)] bg-[color-mix(in_srgb,var(--wui-fg)_2.5%,transparent)] p-1', className)}>
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--wui-fg-muted)]">
        {groups.length < refs.length
          ? `${String(refs.length)} sources · ${String(groups.length)} document${groups.length === 1 ? '' : 's'}`
          : `${String(refs.length)} source${refs.length === 1 ? '' : 's'}`}
      </div>
      {groups.map((g) => (
        <CitationRow key={g.key} group={g} onOpen={open} />
      ))}
      {modal}
    </div>
  );
}

/**
 * Sources as a compact, wrapping row of clickable chips (Google-search style) —
 * one chip per document, page(s) shown, click opens the source. Lighter than
 * {@link CitationList}: a quick reference strip rather than a detailed list.
 */
export function CitationChips({ refs, className }: CitationMarksProps): ReactNode {
  const ctx = useCitationOrigin();
  const { open, modal } = useCitationOpen();
  if (!refs || refs.length === 0 || !ctx) return null;

  const items: CiteItem[] = refs.map((ref) => ({ ref, resolved: resolveCitationRef(ref, ctx) }));
  const groups = groupByDoc(items);

  return (
    <div className={cn('mt-2 flex flex-wrap gap-1.5', className)}>
      {groups.map((g) => {
        const resolved = g.items.find((i) => i.resolved)?.resolved;
        const where = whereOf(g.items);
        return (
          <button
            key={g.key}
            type="button"
            disabled={!resolved}
            onClick={() => { if (resolved) open(resolved); }}
            title={where.length ? `${g.label} · ${where.join(', ')}` : g.label}
            className={cn(
              'inline-flex max-w-[260px] items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[12px] transition-colors',
              resolved
                ? 'border-[var(--wui-border)] bg-[var(--wui-bg-muted)] text-[var(--wui-fg)] hover:border-[color-mix(in_srgb,var(--wui-primary)_45%,var(--wui-border))] hover:bg-[color-mix(in_srgb,var(--wui-primary)_10%,transparent)]'
                : 'cursor-default border-[var(--wui-border)] bg-[var(--wui-bg-muted)] text-[var(--wui-fg-muted)]',
            )}
          >
            <ArrowGlyph size={11} className="shrink-0 text-[var(--wui-primary)]" />
            <span className="truncate">{g.label}</span>
            {where.length > 0 && (
              <span className="shrink-0 text-[11px] text-[var(--wui-fg-muted)]">{where.join(', ')}</span>
            )}
          </button>
        );
      })}
      {modal}
    </div>
  );
}

/** One source in the popover/list: document + page(s) + the cited passage. */
/**
 * A computed value's provenance: the arithmetic it used and the inputs it
 * combined, each opening its own source.
 *
 * Shown, not judged — the reader follows the calculation themselves. Recomputing
 * it to assert ✓/⚠ is deliberately out of scope for now, so nothing here claims
 * the number is right; it only makes plain how it was reached.
 */
function DerivedRow({
  derived,
  onOpen,
}: {
  derived: Extract<ResolvedCitation, { kind: 'derived' }>;
  onOpen: (r: ResolvedCitation) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1 rounded-md px-2 py-1.5">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--wui-fg)]">
        <FunctionGlyph />
        <span className="min-w-0 flex-1 truncate">{derived.label ?? 'Computed value'}</span>
        <span className="shrink-0 rounded bg-[var(--wui-bg-muted)] px-1 text-[10px] font-normal text-[var(--wui-fg-muted)]">
          calculated
        </span>
      </span>

      {derived.expression && (
        <code className="pl-[18px] font-mono text-[11px] text-[var(--wui-fg-muted)]">
          {derived.expression}
        </code>
      )}

      {/* Inputs are numbered to match the #1 / #2 positions in the expression.
          Each row leads with WHAT the term is (the cited text or value) and only
          then where it came from: a derivation over one document would otherwise
          render as N identical filenames, leaving the reader unable to tell which
          term is which — the expression alone says nothing about its operands. */}
      {derived.inputs.map((input, i) => (
        <button
          key={i}
          type="button"
          onClick={() => { onOpen(input); }}
          className="flex items-start gap-1.5 rounded px-0 pl-[18px] text-left text-[11px] text-[var(--wui-fg-muted)] transition-colors hover:text-[var(--wui-primary)]"
        >
          <span className="shrink-0 font-mono leading-[1.45]">#{i + 1}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="min-w-0 truncate text-[var(--wui-fg)]">{inputTerm(input)}</span>
            <span className="min-w-0 truncate text-[10px] opacity-75">{inputSource(input)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function CitationRow({ group, onOpen }: { group: CiteGroup; onOpen: (r: ResolvedCitation) => void }): ReactNode {
  const resolved = group.items.find((i) => i.resolved)?.resolved;
  if (resolved?.kind === 'derived') return <DerivedRow derived={resolved} onOpen={onOpen} />;
  const where = whereOf(group.items);
  const quote = group.items
    .map((i) => (i.resolved?.kind === 'doc' ? i.resolved.anchor?.quote : undefined))
    .find((q): q is string => Boolean(q));

  return (
    <button
      type="button"
      disabled={!resolved}
      onClick={() => { if (resolved) onOpen(resolved); }}
      className={cn(
        'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors',
        resolved
          ? 'hover:bg-[color-mix(in_srgb,var(--wui-primary)_10%,transparent)]'
          : 'cursor-default opacity-60',
      )}
    >
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--wui-fg)]">
        {/* Match the chip: a row that opens step data must not draw the same ↗ as
            one that opens a document, or the glyph stops meaning anything. */}
        {resolved?.kind === 'value' ? (
          <span aria-hidden="true" className="shrink-0 font-mono text-[10px] text-[var(--wui-fg-muted)]">
            {'{}'}
          </span>
        ) : (
          <ArrowGlyph className="shrink-0 text-[var(--wui-fg-muted)]" />
        )}
        <span className="min-w-0 flex-1 truncate">{group.label}</span>
        {where.length > 0 && (
          <span className="shrink-0 text-[11px] font-normal text-[var(--wui-fg-muted)]">
            {where.join(', ')}
          </span>
        )}
        {group.items.length > 1 && (
          <span className="shrink-0 rounded bg-[var(--wui-bg-muted)] px-1 text-[10px] text-[var(--wui-fg-muted)]">
            {group.items.length}×
          </span>
        )}
      </span>
      {quote && (
        <span className="line-clamp-2 pl-[18px] text-[11px] leading-snug text-[var(--wui-fg-muted)]">
          “{quote}”
        </span>
      )}
    </button>
  );
}
