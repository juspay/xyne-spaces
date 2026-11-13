import { useMemo } from 'react';
import { Play } from 'lucide-react';
import { useApprovalsList } from '../../hooks/use-approvals-list.js';
import { useApprovalCount } from '../../hooks/use-approval-count.js';
import { PendingApprovalsCard } from './PendingApprovalsCard.js';
import { ApprovalTimelinessCard, PendingApprovalsRingCard } from './ApprovalStats.js';
import { useApprovalAnalytics } from '../../hooks/use-analytics.js';
import { cn } from '../shared/cn.js';
import { endOfToday, formatToday, greetingFor } from '../../utils/home-format.js';

export interface HomeDashboardProps {
  /** Signed-in user, supplied by the host. Without it the greeting drops the name. */
  user?: { name: string } | undefined;
  onReviewApproval: (approvalId: string, nodePath: string) => void;
  onViewApprovals: () => void;
  /** "Run workflow" — for now, opens the workflow browser. */
  onRunWorkflow: () => void;
  className?: string;
}

/**
 * Home: the landing surface for the workflows section.
 *
 * Three columns are reserved in the layout — analytics on the left, the
 * approvals queue in the centre, executions on the right — but only the queue
 * is filled today; the side panels land next.
 */
export function HomeDashboard({
  user,
  onReviewApproval,
  onViewApprovals,
  onRunWorkflow,
  className,
}: HomeDashboardProps) {
  // Oldest first: the longest-waiting request is the one that needs attention.
  const { approvals, isLoading, error, hasMore, loadMore } = useApprovalsList({
    sort: 'oldest',
  });
  // The true size of the queue. Shares a query key with the sidebar badge, so
  // mounting it here costs no extra request.
  const totalCount = useApprovalCount();

  // Overdue and Due today are asked for by bucket, never carved out of the
  // list above: that list is one oldest-first page, and today's deadlines
  // belong to recently raised gates at the far end of it. Fixed per mount —
  // it is part of the cache key, so recomputing it would refetch every render.
  const dayEnd = useMemo(() => endOfToday(), []);
  const overdue = useApprovalsList({ bucket: 'overdue', sort: 'due', dayEnd });
  const dueToday = useApprovalsList({ bucket: 'dueToday', sort: 'due', dayEnd });
  const overdueCount = useApprovalCount({ bucket: 'overdue', dayEnd });
  const dueTodayCount = useApprovalCount({ bucket: 'dueToday', dayEnd });
  const dueSoonCount = useApprovalCount({ bucket: 'dueSoon', dayEnd });
  // Fixed per mount, like dayEnd: it is part of the cache key.
  const since = useMemo(() => new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString(), []);
  const timeliness = useApprovalAnalytics(since);

  // Fixed per mount, not per render — a greeting that flips at 12:00 mid-session
  // is more distracting than a slightly stale one.
  const greeting = useMemo(() => greetingFor(), []);
  const today = useMemo(() => formatToday(), []);

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-[var(--wui-bg-subtle)]', className)}>
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-5">
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-bold leading-tight text-[var(--wui-fg)]">
            {greeting}
            {user?.name ? `, ${user.name}` : ''}
          </h1>
          <p className="mt-0.5 text-[12px] text-[var(--wui-fg-muted)]">{today}</p>
        </div>
        <button
          type="button"
          onClick={onRunWorkflow}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--wui-primary)] px-3.5 py-2 text-[13px] font-semibold text-[var(--wui-primary-fg)] transition-colors hover:bg-[var(--wui-primary-hover)]"
        >
          <Play className="h-3.5 w-3.5" strokeWidth={2.5} />
          Run workflow
        </button>
      </header>

      {/* min-h-0 on the scroller and the grid is what lets the tall panel scroll
          internally instead of stretching the page. */}
      <div className="min-h-0 flex-1 overflow-y-auto wui-scroll p-5 pt-4">
        <div className="wui-home-grid">
          <div className="wui-home-col-stats">
            <ApprovalTimelinessCard data={timeliness.data} isLoading={timeliness.isLoading} error={timeliness.error} />
            <PendingApprovalsRingCard
              total={totalCount}
              overdue={overdueCount}
              dueToday={dueTodayCount}
              dueSoon={dueSoonCount}
            />
          </div>

          <div className="wui-home-col-approvals">
            <PendingApprovalsCard
              approvals={approvals}
              isLoading={isLoading}
              error={error}
              hasMore={hasMore}
              loadMore={loadMore}
              onReview={onReviewApproval}
              onViewAll={onViewApprovals}
              totalCount={totalCount}
              overdue={{ items: overdue.approvals, count: overdueCount }}
              dueToday={{ items: dueToday.approvals, count: dueTodayCount }}
            />
          </div>

          <div className="wui-home-col-runs" />
        </div>
      </div>
    </div>
  );
}
