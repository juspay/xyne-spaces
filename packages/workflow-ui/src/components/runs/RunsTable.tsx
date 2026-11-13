import { useCallback, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ExecutionRecord } from '@xyne/workflow-sdk';
import { StatusBadge, type StatusVariant } from '../shared/StatusBadge.js';
import { cn } from '../shared/cn.js';

export interface RunsTableProps {
  executions: ExecutionRecord[];
  onSelectExecution: (executionId: string) => void;
  /** Map of workflowId -> display name, so rows show the name instead of the id. */
  workflowNameById?: Record<string, string>;
  /** Map of executionId -> error excerpt, shown for failed runs when provided. */
  errorByExecutionId?: Record<string, string>;
  /** Called when the last row scrolls into view — for infinite scroll. */
  onReachEnd?: () => void;
  className?: string | undefined;
}

function mapStatus(status: string): StatusVariant {
  switch (status) {
    case 'running':
    case 'RUNNING': return 'running';
    case 'completed':
    case 'COMPLETED': return 'completed';
    case 'failed':
    case 'FAILED': return 'failed';
    case 'paused':
    case 'EXTERNAL_WAIT': return 'paused';
    case 'scheduled':
    case 'SCHEDULED': return 'scheduled';
    case 'skipped':
    case 'SKIPPED': return 'skipped';
    case 'cancelled':
    case 'CANCELLED': return 'cancelled';
    default: return 'pending';
  }
}

function formatTimeAgo(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return `${String(diffSec)}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${String(diffMin)}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${String(diffHour)}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${String(diffDay)}d ago`;
}

function formatAbsoluteTime(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** "in 1h 42m" — how long a scheduled run still has to wait. */
function formatTimeUntil(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
  if (diffSec <= 0) return 'due now';

  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);

  if (days > 0) return `in ${String(days)}d ${String(hours)}h`;
  if (hours > 0) return `in ${String(hours)}h ${String(mins)}m`;
  if (mins > 0) return `in ${String(mins)}m`;
  return 'in under a minute';
}

function formatDuration(
  startedAt: Date | string,
  endedAt: Date | string | null | undefined,
): string {
  if (!endedAt) return '—';
  const start = startedAt instanceof Date ? startedAt.getTime() : new Date(startedAt).getTime();
  const end = endedAt instanceof Date ? endedAt.getTime() : new Date(endedAt).getTime();
  const diffMs = end - start;
  if (diffMs < 0) return '—';
  if (diffMs < 1000) return `${String(diffMs)}ms`;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${String(sec)}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${String(min)}m ${String(sec % 60)}s`;
  const hr = Math.floor(min / 60);
  return `${String(hr)}h ${String(min % 60)}m`;
}


// ── Copy ID button ──────────────────────────────────────────────────────────

function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [id]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'opacity-0 group-hover/row:opacity-100 ml-1 inline-flex items-center justify-center rounded p-0.5 transition-all',
        copied ? 'text-[var(--wui-status-completed)]' : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
      )}
      title="Copy full ID"
    >
      {copied ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

const ROW_HEIGHT = 48;

export function RunsTable({
  executions,
  onSelectExecution,
  workflowNameById,
  errorByExecutionId,
  onReachEnd,
  className,
}: RunsTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: executions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  // Infinite scroll: fire once the last row enters the virtual window.
  const lastVisibleIndex = (() => {
    const items = rowVirtualizer.getVirtualItems();
    return items.length > 0 ? (items[items.length - 1]?.index ?? -1) : -1;
  })();
  useEffect(() => {
    if (onReachEnd && executions.length > 0 && lastVisibleIndex >= executions.length - 1) {
      onReachEnd();
    }
  }, [lastVisibleIndex, executions.length, onReachEnd]);

  if (executions.length === 0) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center py-16 text-center', className)}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="mb-3 text-muted-foreground/50" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v20M2 12h20" />
        </svg>
        <p className="text-[13px] font-medium text-muted-foreground">No executions yet</p>
        <p className="mt-1 text-[11px] text-muted-foreground/70">Run this workflow to see executions here</p>
      </div>
    );
  }

  const colCount = errorByExecutionId ? 6 : 5;
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom = virtualRows.length > 0 ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0) : 0;

  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-elevated', className)}>
      <div ref={scrollRef} className="wui-scroll min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm" style={{ tableLayout: 'fixed', borderCollapse: 'collapse' }}>
        <colgroup>
          {errorByExecutionId ? (
            <>
              <col style={{ width: '12%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '22%' }} />
            </>
          ) : (
            <>
              <col style={{ width: '15%' }} />
              <col style={{ width: '27%' }} />
              <col style={{ width: '28%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '14%' }} />
            </>
          )}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-surface-muted">
          <tr className="border-b border-border">
            <th className="px-4 py-2.5 text-left text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
              Status
            </th>
            <th className="px-4 py-2.5 text-left text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
              Run Name
            </th>
            <th className="px-4 py-2.5 text-left text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
              Workflow
            </th>
            <th className="px-4 py-2.5 text-left text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
              Started
            </th>
            <th className="px-4 py-2.5 text-left text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
              Duration
            </th>
            {errorByExecutionId && (
              <th className="px-4 py-2.5 text-left text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
                Error
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr><td colSpan={colCount} style={{ height: paddingTop, padding: 0, border: 'none' }} /></tr>
          )}
          {virtualRows.map((vRow) => {
            const exec = executions[vRow.index]!;
            const variant = mapStatus(exec.status);

            return (
              <tr
                key={exec.id}
                onClick={() => onSelectExecution(exec.id)}
                style={{ height: ROW_HEIGHT }}
                className={cn(
                  'group/row cursor-pointer border-b border-border transition-colors',
                  'hover:bg-secondary/60',
                )}
              >
                <td className="px-4 py-3">
                  <StatusBadge status={variant} />
                </td>
                <td className="overflow-hidden px-4 py-3">
                  {/* The run's unique identifier. Only a store that predates run
                      names lacks one; the short id stands in there. */}
                  <div className="flex min-w-0 items-center">
                    {exec.name ? (
                      <span className="block truncate text-[13px] font-medium text-[var(--wui-fg)]" title={exec.name}>
                        {exec.name}
                      </span>
                    ) : (
                      <code className="font-mono text-[12px] text-[var(--wui-fg-muted)]" title={exec.id}>
                        {exec.id.slice(0, 8)}
                      </code>
                    )}
                    <CopyIdButton id={exec.id} />
                  </div>
                </td>
                <td className="overflow-hidden px-4 py-3">
                  <span
                    className="block truncate text-[13px] text-[var(--wui-fg)]"
                    title={exec.workflowName ?? workflowNameById?.[exec.workflowId] ?? exec.workflowId}
                  >
                    {exec.workflowName ?? workflowNameById?.[exec.workflowId] ?? exec.workflowId}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className="text-[12px] text-[var(--wui-fg-muted)]"
                    title={formatAbsoluteTime(exec.createdAt)}
                  >
                    {formatTimeAgo(exec.createdAt)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {/* A run that has not started has no duration to report — what it
                      has is a moment it is waiting for, or a reason it stopped. */}
                  {variant === 'scheduled' && exec.fireAt ? (
                    <span
                      className="text-[12px] text-[var(--wui-status-scheduled)]"
                      title={formatAbsoluteTime(exec.fireAt)}
                    >
                      {formatTimeUntil(exec.fireAt)}
                    </span>
                  ) : exec.endReason ? (
                    <span
                      className="block truncate text-[12px] text-[var(--wui-fg-muted)]"
                      title={exec.endReason}
                    >
                      {exec.endReason}
                    </span>
                  ) : (
                    <span className="font-mono text-[12px] text-[var(--wui-fg-muted)]">
                      {formatDuration(exec.createdAt, exec.updatedAt)}
                    </span>
                  )}
                </td>
                {errorByExecutionId && (
                  <td className="overflow-hidden px-4 py-3">
                    {errorByExecutionId[exec.id] && (
                      <span
                        className="block truncate text-[12px] text-[var(--wui-status-failed)]"
                        title={errorByExecutionId[exec.id]}
                      >
                        {errorByExecutionId[exec.id]}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr><td colSpan={colCount} style={{ height: paddingBottom, padding: 0, border: 'none' }} /></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
