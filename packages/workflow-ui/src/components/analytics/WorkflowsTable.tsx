import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AnalyticsData } from '../../hooks/use-analytics.js';
import { StatusBadge, type StatusVariant } from '../shared/StatusBadge.js';
import { cn } from '../shared/cn.js';

type WorkflowRow = AnalyticsData['byWorkflow'][number];

export interface WorkflowsTableProps {
  data: WorkflowRow[];
  onSelectWorkflow?: (workflowId: string) => void;
  search?: string;
  className?: string;
}

const STATUS_VARIANTS: Record<string, StatusVariant> = {
  ACTIVE: 'completed',
  DRAFT: 'pending',
  DISABLED: 'paused',
  PENDING_APPROVAL: 'pending',
  REJECTED: 'failed',
  REVOKED: 'failed',
  AUTO_REVOKED: 'failed',
  ARCHIVED: 'skipped',
};

function statusVariant(status: string): StatusVariant {
  return STATUS_VARIANTS[status] ?? 'skipped';
}

function statusLabel(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}

function triggerLabel(type: string): string {
  return type.toUpperCase() === 'WEBHOOK_V2'
    ? 'Webhook V2'
    : type
      .toLowerCase()
      .split('_')
      .map((w) => w[0]?.toUpperCase() + w.slice(1))
      .join(' ');
}

function formatLastRun(date: Date | null): string {
  if (!date) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const ROW_HEIGHT = 36;
const VISIBLE_ROWS = 10;

export function WorkflowsTable({ data, onSelectWorkflow, search = '', className }: WorkflowsTableProps) {
  const statuses = useMemo(
    () => Array.from(new Set(data.map((r) => r.status))).sort(),
    [data],
  );
  const [activeTab, setActiveTab] = useState<string>('ALL');

  const rows = (activeTab === 'ALL' ? data : data.filter((r) => r.status === activeTab)).filter((r) =>
    r.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom = virtualRows.length > 0 ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0) : 0;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-1 border-b border-[var(--wui-border)]">
        <button
          onClick={() => setActiveTab('ALL')}
          className={cn(
            'px-3 py-1.5 text-xs font-medium transition-colors',
            activeTab === 'ALL'
              ? 'border-b-2 border-[var(--wui-primary)] text-[var(--wui-fg)]'
              : 'text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
          )}
        >
          All ({data.length})
        </button>
        {statuses.map((status) => {
          const count = data.filter((r) => r.status === status).length;
          return (
            <button
              key={status}
              onClick={() => setActiveTab(status)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                activeTab === status
                  ? 'border-b-2 border-[var(--wui-primary)] text-[var(--wui-fg)]'
                  : 'text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
              )}
            >
              {statusLabel(status)} ({count})
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-xs text-[var(--wui-fg-muted)]">
          No workflows
        </div>
      ) : (
        <div ref={scrollRef} style={{ height: VISIBLE_ROWS * ROW_HEIGHT, overflowY: 'auto' }}>
          <table className="w-full text-left text-xs" style={{ tableLayout: 'fixed', borderCollapse: 'collapse' }}>
            <colgroup>
              <col style={{ width: '30%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[var(--wui-bg)]">
              <tr className="text-[10px] uppercase tracking-wider text-[var(--wui-fg-muted)]">
                <th className="py-1.5 font-medium">Workflow</th>
                <th className="py-1.5 font-medium">Status</th>
                <th className="py-1.5 font-medium">Trigger</th>
                <th className="py-1.5 font-medium text-right">Total Runs</th>
                <th className="py-1.5 font-medium text-right">Failed</th>
                <th className="py-1.5 font-medium text-right">Failure Rate</th>
                <th className="py-1.5 font-medium text-right">Last Run</th>
              </tr>
            </thead>
            <tbody>
              {paddingTop > 0 && (
                <tr><td colSpan={7} style={{ height: paddingTop, padding: 0, border: 'none' }} /></tr>
              )}
              {virtualRows.map((vRow) => {
                const row = rows[vRow.index]!;
                return (
                  <tr
                    key={row.workflowId}
                    onClick={() => onSelectWorkflow?.(row.workflowId)}
                    style={{ height: ROW_HEIGHT }}
                    className={cn(
                      'border-t border-[var(--wui-border)]',
                      onSelectWorkflow && 'cursor-pointer hover:bg-[var(--wui-bg-subtle)]',
                    )}
                  >
                    <td className="overflow-hidden text-ellipsis whitespace-nowrap py-2 font-medium text-[var(--wui-fg)]">{row.name}</td>
                    <td className="py-2">
                      <StatusBadge status={statusVariant(row.status)} label={statusLabel(row.status)} />
                    </td>
                    <td className="overflow-hidden text-ellipsis whitespace-nowrap py-2 text-[var(--wui-fg-muted)]">{triggerLabel(row.eventType)}</td>
                    <td className="py-2 text-right tabular-nums text-[var(--wui-fg)]">{row.totalRuns}</td>
                    <td className="py-2 text-right tabular-nums text-[var(--wui-fg)]">{row.failedRuns}</td>
                    <td className="py-2 text-right tabular-nums">
                      <span
                        style={{
                          color:
                            row.failureRate > 20
                              ? 'var(--wui-status-failed)'
                              : row.failureRate > 5
                              ? 'var(--wui-status-paused)'
                              : 'var(--wui-status-completed)',
                        }}
                      >
                        {row.failureRate}%
                      </span>
                    </td>
                    <td className="py-2 text-right text-[var(--wui-fg-muted)]">{formatLastRun(row.lastRunAt)}</td>
                  </tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr><td colSpan={7} style={{ height: paddingBottom, padding: 0, border: 'none' }} /></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
