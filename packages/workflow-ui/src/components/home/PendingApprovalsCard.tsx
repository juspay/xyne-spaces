import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { PendingApprovalSummary } from '@xyne/workflow-sdk/client';
import { DashboardPanel, PanelSkeleton } from './DashboardPanel.js';
import { ApprovalRow } from './ApprovalRow.js';
import { cn } from '../shared/cn.js';
import type { ApprovalTone } from '../../utils/home-format.js';

const TONE_DOT: Record<ApprovalTone, string> = {
  danger: 'bg-[var(--wui-status-failed)]',
  warning: 'bg-[var(--wui-status-paused)]',
  neutral: 'bg-[var(--wui-status-pending)]',
};

/** The urgent sections are a summary, not a queue — the full set lives in All. */
const URGENT_CAP = 5;
/** Where All starts; it then tops itself up until the panel is full. */
const ALL_INITIAL = 10;
const ALL_STEP = 5;

/** One urgency section's data, fetched as its own bucket from the server. */
export interface ApprovalBucketData {
  /** Soonest deadline first. Only the first few are shown. */
  items: PendingApprovalSummary[];
  /** The bucket's real size, counted by the server. Undefined until known. */
  count?: number | undefined;
}

export interface PendingApprovalsCardProps {
  /** Every pending approval in hand, oldest first — the All section. */
  approvals: PendingApprovalSummary[];
  /**
   * The urgency sections, each its OWN request. They cannot be carved out of
   * `approvals`: that is one oldest-first page, and a gate due today was raised
   * recently — so it sits at the far end of the queue, past anything a first
   * page holds, and a Due today section built from it would read empty.
   */
  overdue: ApprovalBucketData;
  dueToday: ApprovalBucketData;
  isLoading: boolean;
  error: Error | null;
  /** More pages exist on the server. */
  hasMore: boolean;
  loadMore: () => void;
  onReview: (approvalId: string, nodePath: string) => void;
  /** Jumps to the full Approvals tab. */
  onViewAll: () => void;
  /**
   * How many gates are pending in total, counted by the server. `approvals`
   * holds only the pages fetched so far, so its length climbs as you scroll —
   * it can never be shown as a total. Undefined until the count arrives.
   */
  totalCount?: number | undefined;
}

/**
 * The centre column: what needs a human.
 *
 * Two capped sections at the top surface anything with a deadline attached —
 * Overdue first, then Due today. Beneath them, "All" is the whole queue in
 * raised order, revealed a few rows at a time.
 *
 * A gate with a deadline therefore appears twice: once as a callout above, once
 * in its natural place below. That repetition is the point — the top answers
 * "what is urgent", the bottom answers "what is outstanding".
 */
export function PendingApprovalsCard({
  approvals,
  isLoading,
  error,
  hasMore,
  loadMore,
  onReview,
  onViewAll,
  totalCount,
  overdue,
  dueToday,
}: PendingApprovalsCardProps) {
  // `total` drives the reveal logic, so it must stay the count in hand —
  // paging against a server-side number we have not fetched would stall.
  const total = approvals.length;
  // For display only: the size of the queue, not the size of the slice.
  const queueSize = totalCount ?? total;
  const [visible, setVisible] = useState(ALL_INITIAL);

  // Collapse back to one page when the queue itself changes size, so an
  // expanded list does not silently stay expanded across a refresh.
  useEffect(() => {
    setVisible((v) => Math.min(v, Math.max(ALL_INITIAL, total)));
  }, [total]);

  const urgent = [
    { key: 'overdue', label: 'Overdue', tone: 'danger' as const, bucket: overdue },
    { key: 'dueToday', label: 'Due today', tone: 'warning' as const, bucket: dueToday },
  ].filter((g) => g.bucket.items.length > 0);
  const shown = approvals.slice(0, visible);

  // Reveal locally first; only ask the server once the page in hand runs out.
  const revealMore = useCallback(() => {
    if (visible < total) setVisible((v) => v + ALL_STEP);
    else if (hasMore) loadMore();
  }, [visible, total, hasMore, loadMore]);

  const onScroll = (e: UIEvent<HTMLUListElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 80) return;
    revealMore();
  };

  // Fill All's own box. Overdue and Due today hold still at the top; All takes
  // the height that is left and scrolls inside it. When that box is taller
  // than its first rows, nothing overflows — and a list with nothing to scroll
  // never fires the scroll handler, so it would sit half-empty for good. Keep
  // revealing until it overflows or the queue runs out. Re-checked on resize,
  // since the leftover height moves with the window and the sections above.
  const listRef = useRef<HTMLUListElement>(null);
  const hasList = !isLoading && total > 0;
  const [listHeight, setListHeight] = useState(0);
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { setListHeight(el.clientHeight); });
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, [hasList]);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight) revealMore();
  }, [revealMore, hasList, listHeight]);

  return (
    <DashboardPanel
      fill
      title={
        <span className="flex items-center gap-2">
          Pending approvals
          {queueSize > 0 && (
            <span className="rounded-full bg-[var(--wui-bg-muted)] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--wui-fg-muted)]">
              {queueSize}
            </span>
          )}
        </span>
      }
    >
      {isLoading ? (
        <div className="flex flex-col gap-3 p-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <PanelSkeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error && total === 0 ? (
        <p className="px-4 py-10 text-center text-[12px] text-[var(--wui-fg-muted)]">
          Couldn’t load pending approvals.
        </p>
      ) : total === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
          <CheckCircle2
            className="h-6 w-6 text-[var(--wui-status-completed)]"
            strokeWidth={1.75}
          />
          <p className="text-[13px] font-medium text-[var(--wui-fg)]">All clear</p>
          <p className="text-[12px] text-[var(--wui-fg-muted)]">
            Nothing is waiting on an approval right now.
          </p>
        </div>
      ) : (
        <>
          {urgent.map((group) => (
            // Fixed: these never scroll away. Only All below them moves.
            <section key={group.key} className="shrink-0">
              <SectionHeader
                tone={group.tone}
                label={group.label}
                // The server's count, not the rows held: the section shows five.
                count={group.bucket.count ?? group.bucket.items.length}
                action={<ViewAllButton onClick={onViewAll} />}
              />
              <ul>
                {group.bucket.items.slice(0, URGENT_CAP).map((approval) => (
                  <ApprovalRow
                    // (execution, gate) — a parallel run has several gates on
                    // one id, and duplicate keys leak orphan rows on re-render.
                    key={`${approval.id}:${approval.pausedNodePath}`}
                    approval={approval}
                    tone={group.tone}
                    onReview={onReview}
                  />
                ))}
              </ul>
            </section>
          ))}

          {/* Takes the leftover height and scrolls within it. The floor keeps a
              usable window of rows when the sections above are tall and the
              screen is short — past that the panel body scrolls instead. */}
          <section className="flex min-h-[220px] flex-1 flex-col">
            <SectionHeader
              tone="neutral"
              label="All"
              count={queueSize}
              action={<ViewAllButton onClick={onViewAll} />}
            />
            <ul ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto wui-scroll">
              {shown.map((approval) => (
                <ApprovalRow
                  key={`${approval.id}:${approval.pausedNodePath}`}
                  approval={approval}
                  tone="neutral"
                  onReview={onReview}
                />
              ))}
            </ul>
          </section>
        </>
      )}
    </DashboardPanel>
  );
}

/** Every section links to the Approvals tab; it gains per-section filters later. */
function ViewAllButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] font-medium text-[var(--wui-primary)] transition-colors hover:text-[var(--wui-primary-hover)]"
    >
      View all →
    </button>
  );
}

function SectionHeader({
  tone,
  label,
  count,
  action,
}: {
  tone: ApprovalTone;
  label: string;
  count: number;
  action?: ReactNode;
}) {
  return (
    // Sticky so the section a row belongs to stays visible while scrolling.
    <header className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-5 py-2">
      <span className={cn('h-1.5 w-1.5 rounded-full', TONE_DOT[tone])} />
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--wui-fg-muted)]">
        {label}
      </span>
      <span className="rounded-full bg-[var(--wui-bg-muted)] px-1.5 text-[10px] font-semibold tabular-nums text-[var(--wui-fg-muted)]">
        {count}
      </span>
      {action && <span className="ml-auto">{action}</span>}
    </header>
  );
}
