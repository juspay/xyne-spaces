import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRunsList } from '../../hooks/use-runs-list.js';
import { StatusBadge, type StatusVariant } from '../shared/StatusBadge.js';
import { LoadingSpinner } from '../shared/LoadingSpinner.js';

const ROW_HEIGHT = 48;
const PANEL_HEIGHT = 380;

function mapStatus(status: string): StatusVariant {
  switch (status) {
    case 'COMPLETED': return 'completed';
    case 'FAILED': return 'failed';
    case 'RUNNING': return 'running';
    case 'EXTERNAL_WAIT': return 'paused';
    case 'CANCELLED': return 'cancelled';
    default: return 'pending';
  }
}

function timeAgo(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export interface FilteredRunsPanelProps {
  label: string;
  status?: string | undefined;
  folderId?: string | undefined;
  onSelectExecution: (executionId: string, workflowId: string) => void;
  onClose: () => void;
}

export function FilteredRunsPanel({ label, status, folderId, onSelectExecution, onClose }: FilteredRunsPanelProps) {
  const { executions, isLoading, error, hasMore, loadMore } = useRunsList({
    ...(status !== undefined ? { status } : {}),
    ...(folderId !== undefined ? { folderId } : {}),
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: executions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  // Load more when scrolled near the bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (hasMore && el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_HEIGHT * 2) {
        loadMore();
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasMore, loadMore]);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom = virtualRows.length > 0 ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0) : 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--wui-border)] bg-[var(--wui-bg)] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--wui-fg-muted)]">
          {label} — Latest Runs
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]"
          aria-label="Close"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center" style={{ height: PANEL_HEIGHT }}>
          <LoadingSpinner size="sm" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center text-xs text-[var(--wui-status-failed)]" style={{ height: PANEL_HEIGHT }}>
          Failed to load runs
        </div>
      ) : executions.length === 0 ? (
        <div className="flex items-center justify-center text-xs text-[var(--wui-fg-muted)]" style={{ height: PANEL_HEIGHT }}>
          No runs found
        </div>
      ) : (
        <div
          ref={scrollRef}
          style={{ height: PANEL_HEIGHT, overflowY: 'auto' }}
          className="rounded-md border border-[var(--wui-border)]"
        >
          {/* Sticky header */}
          <div className="sticky top-0 z-10 grid grid-cols-[2fr_1fr_1fr_1fr] border-b border-[var(--wui-border)] bg-[var(--wui-bg)] px-3 py-2">
            {['Status', 'Execution ID', 'Workflow', 'Started'].map((col) => (
              <span key={col} className="text-[10px] font-semibold uppercase tracking-widest text-[var(--wui-fg-muted)]">{col}</span>
            ))}
          </div>

          <div style={{ height: totalSize, position: 'relative' }}>
            {paddingTop > 0 && <div style={{ height: paddingTop }} />}
            {virtualRows.map((vRow) => {
              const exec = executions[vRow.index]!;
              const variant = mapStatus(exec.status);
              return (
                <div
                  key={exec.id}
                  onClick={() => onSelectExecution(exec.id, exec.workflowId)}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_HEIGHT, transform: `translateY(${vRow.start}px)` }}
                  className="grid cursor-pointer grid-cols-[2fr_1fr_1fr_1fr] items-center border-b border-[var(--wui-border)] px-3 transition-colors hover:bg-[var(--wui-bg-subtle)]"
                >
                  <StatusBadge status={variant} />
                  <code className="font-mono text-[11px] text-[var(--wui-fg-muted)]">{exec.id.slice(0, 8)}</code>
                  <span className="truncate text-[12px] text-[var(--wui-fg)]">{exec.workflowId}</span>
                  <span className="text-[11px] text-[var(--wui-fg-muted)]">{timeAgo(exec.createdAt)}</span>
                </div>
              );
            })}
            {paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
          </div>

          {hasMore && (
            <div className="flex items-center justify-center py-2 text-[11px] text-[var(--wui-fg-muted)]">
              Loading more…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
