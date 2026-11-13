import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Flag, HelpCircle, Lock } from 'lucide-react';
import type { PauseDisplaySection } from '@xyne/workflow-sdk';
import { cn } from '../shared/cn.js';
import { MarkdownView } from '../shared/MarkdownView.js';
import { DisplayValue, isAttachment, isAttachmentArray } from '../shared/AttachmentCard.js';

export type RowValue = {
  headline: string;
  confidence?: number;
  source?: string;
  tone?: 'ok' | 'review' | 'restricted';
  flag?: string;
  sourceNote?: string;
  sop?: string;
  sopRef?: string;
  restrictedLabel?: string;
  group?: string;
};

const toRow = (value: unknown): RowValue =>
  value !== null && typeof value === 'object'
    ? (value as RowValue)
    : { headline: value == null ? '—' : String(value) };

/** True when the workflow left a field empty (blank, or the placeholder dash). */
const isBlankValue = (s: string): boolean => !s || s.trim() === '' || s.trim() === '—';

// ── Pieces ───────────────────────────────────────────────────────────────────
function ConfidencePill({ value, tone }: { value: number; tone: 'ok' | 'review' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[13px] font-semibold tabular-nums',
        tone === 'ok'
          ? 'bg-[var(--wui-status-completed)]/10 text-[var(--wui-status-completed)]'
          : 'border border-[var(--wui-status-paused)]/40 bg-[var(--wui-bg)] text-[var(--wui-status-paused)]',
      )}
    >
      {value}%
    </span>
  );
}

function InfoRow({
  label,
  v,
  originChip,
}: {
  label: string;
  v: RowValue;
  originChip?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--wui-border)] bg-[var(--wui-bg)] px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <MarkdownView bare className="text-[12.5px] leading-tight text-[var(--wui-fg-muted)]">{label}</MarkdownView>
        {isBlankValue(v.headline) ? (
          <p className="mt-1 text-[13.5px] italic leading-tight text-[var(--wui-fg-muted)]">No value</p>
        ) : (
          <MarkdownView bare className="mt-1 text-[14px] text-[var(--wui-fg)] [&_p]:leading-snug">
            {v.headline}
          </MarkdownView>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {typeof v.confidence === 'number' && <ConfidencePill value={v.confidence} tone="ok" />}
        {v.source && (
          <span className="text-[13px] font-medium text-[var(--wui-fg-muted)]">{v.source}</span>
        )}
        {originChip}
      </div>
    </div>
  );
}

function RestrictedRow({
  label,
  v,
  originChip,
}: {
  label: string;
  v: RowValue;
  originChip?: ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-[var(--wui-border)] px-4 py-3.5"
      style={{
        backgroundImage:
          'repeating-linear-gradient(135deg, var(--wui-bg-muted) 0 8px, transparent 8px 16px)',
      }}
    >
      <div className="min-w-0 flex-1">
        <MarkdownView bare className="text-[12.5px] leading-tight text-[var(--wui-fg-muted)]">{label}</MarkdownView>
        <MarkdownView bare className="mt-1 text-[15px] font-semibold leading-tight tracking-[0.04em] text-[var(--wui-fg-muted)]">
          {v.headline}
        </MarkdownView>
      </div>
      <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium text-[var(--wui-fg-muted)]">
        <Lock className="size-3.5" />
        {v.restrictedLabel ?? 'restricted'}
        {originChip}
      </span>
    </div>
  );
}

function ReviewRow({
  label,
  v,
  originChip,
}: {
  label: string;
  v: RowValue;
  originChip?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--wui-status-paused)]/40 bg-[var(--wui-status-paused)]/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium leading-tight text-[var(--wui-status-paused)]">
            <span className="truncate">{label}</span>
            <span className="shrink-0">· needs review</span>
          </p>
          <MarkdownView bare className="mt-1 text-[16px] font-bold leading-tight tracking-[-0.01em] text-[var(--wui-fg)] tabular-nums">
            {v.headline}
          </MarkdownView>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {typeof v.confidence === 'number' && <ConfidencePill value={v.confidence} tone="review" />}
          {originChip}
        </div>
      </div>

      {(v.flag ?? v.sop) && (
        <div className="my-3 border-t border-dashed border-[var(--wui-status-paused)]/40" />
      )}

      {v.flag && (
        <p className="flex items-start gap-1.5 text-[13px] leading-snug text-[var(--wui-status-paused)]">
          <Flag className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {v.flag}.{' '}
            {v.sourceNote && (
              <>
                <span className="font-semibold text-[var(--wui-fg)]/80">Source:</span> {v.sourceNote}
              </>
            )}
          </span>
        </p>
      )}

      {v.sop && (
        <div className="mt-2.5 flex gap-2 rounded-lg bg-[var(--wui-primary)]/10 px-3.5 py-2.5 text-[13px] leading-snug text-[var(--wui-primary)]">
          <HelpCircle className="mt-0.5 size-4 shrink-0" />
          <p>
            <span className="font-semibold">From the SOP:</span> {v.sop}{' '}
            {v.sopRef && <span className="font-medium underline underline-offset-2">{v.sopRef}</span>}
          </p>
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  title,
  meta,
  alert,
  collapsible,
  collapsed,
  onToggle,
}: {
  title: string;
  meta?: string;
  alert?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const metaEl = meta ? (
    <span
      className={cn(
        'shrink-0 text-[12px] font-medium tabular-nums',
        alert ? 'text-[var(--wui-status-paused)]' : 'text-[var(--wui-fg-muted)]',
      )}
    >
      {meta}
    </span>
  ) : null;
  if (collapsible) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="group mb-2.5 flex w-full items-center justify-between gap-3"
      >
        <span className="flex items-center gap-1.5">
          <ChevronDown
            className={cn(
              'size-3.5 text-[var(--wui-fg-muted)] transition-transform duration-200',
              collapsed && '-rotate-90',
            )}
          />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--wui-fg-muted)] transition-colors group-hover:text-[var(--wui-fg)]">
            {title}
          </h2>
        </span>
        {metaEl}
      </button>
    );
  }
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--wui-fg-muted)]">
        {title}
      </h2>
      {metaEl}
    </div>
  );
}

// ── Rich display renderer ──────────────────────────────────────────────────────
/**
 * Renders a WAIT step's read-only `display` rows as the polished reviewer cards:
 * grouped sections, confidence pills, and "needs review" + restricted rows. All
 * textual content (labels + values) renders through {@link MarkdownView}, and
 * attachment-typed values through the shared {@link DisplayValue} (download +
 * inline preview card). The "where did this come from" affordance is the generic
 * `renderOriginChip` (the same Source chip used everywhere) — no per-row citation
 * logic lives here.
 */
export function ReviewDisplay({
  rows,
  renderOriginChip,
}: {
  rows: PauseDisplaySection[];
  renderOriginChip?: (i: number) => ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((g: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }, []);

  // Bucket rows by `group`, preserving first-appearance order and each row's
  // ORIGINAL index (the origin chip resolves by original display index).
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, { row: PauseDisplaySection; i: number }[]>();
    rows.forEach((row, i) => {
      const g = isAttachment(row.value) || isAttachmentArray(row.value) ? '' : toRow(row.value).group ?? '';
      if (!map.has(g)) {
        map.set(g, []);
        order.push(g);
      }
      map.get(g)?.push({ row, i });
    });
    return order.map((g) => ({ group: g, items: map.get(g) ?? [] }));
  }, [rows]);
  const isGrouped = groups.some((g) => g.group !== '');

  const stats = useMemo(() => {
    const total = rows.length;
    const toReview = rows.filter((r) => toRow(r.value).tone === 'review').length;
    return { total, toReview };
  }, [rows]);

  const renderRow = (row: PauseDisplaySection, i: number) => {
    const originChip = renderOriginChip?.(i);
    if (isAttachment(row.value) || isAttachmentArray(row.value)) {
      return (
        <div className="rounded-xl border border-[var(--wui-border)] bg-[var(--wui-bg)] px-4 py-3.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <MarkdownView bare className="text-[12.5px] leading-tight text-[var(--wui-fg-muted)]">{row.label}</MarkdownView>
            {originChip}
          </div>
          <DisplayValue value={row.value} />
        </div>
      );
    }
    const v = toRow(row.value);
    if (v.tone === 'review') {
      return <ReviewRow label={row.label} v={v} originChip={originChip} />;
    }
    if (v.tone === 'restricted') {
      return <RestrictedRow label={row.label} v={v} originChip={originChip} />;
    }
    return <InfoRow label={row.label} v={v} originChip={originChip} />;
  };

  return (
    <>
      {!isGrouped && (
        <SectionHeader
          title="Fields"
          meta={`${String(stats.total)} total · ${String(stats.toReview)} to review`}
        />
      )}
      {(isGrouped ? groups : [{ group: '', items: rows.map((row, i) => ({ row, i })) }]).map(
        ({ group, items }) => {
          const toReview = items.filter(({ row }) => toRow(row.value).tone === 'review').length;
          return (
            <section key={group || '_flat'} className={isGrouped ? 'mt-6 first:mt-0' : ''}>
              {isGrouped && (
                <SectionHeader
                  title={group || 'Other'}
                  meta={
                    toReview > 0
                      ? `${String(items.length)} fields · ${String(toReview)} to review`
                      : `${String(items.length)} fields`
                  }
                  alert={toReview > 0}
                  collapsible
                  collapsed={collapsed.has(group)}
                  onToggle={() => { toggleGroup(group); }}
                />
              )}
              {!(isGrouped && collapsed.has(group)) && (
                <div className="space-y-2.5">
                  {items.map(({ row, i }) => (
                    <div key={`${row.label}-${String(i)}`}>{renderRow(row, i)}</div>
                  ))}
                </div>
              )}
            </section>
          );
        },
      )}
    </>
  );
}
