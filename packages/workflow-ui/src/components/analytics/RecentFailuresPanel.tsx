import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AnalyticsData } from '../../hooks/use-analytics.js';

type RecentFailure = AnalyticsData['recentFailures'][number];

export interface RecentFailuresPanelProps {
  failures: RecentFailure[];
  onSelect: (failure: RecentFailure) => void;
}

const ROW_HEIGHT = 46;
const MAX_VISIBLE_ROWS = 6;

export function RecentFailuresPanel({ failures, onSelect }: RecentFailuresPanelProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: failures.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
  });

  const containerHeight = Math.min(failures.length, MAX_VISIBLE_ROWS) * ROW_HEIGHT;

  return (
    <div ref={parentRef} style={{ height: containerHeight, overflowY: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const f = failures[vItem.index]!;
          return (
            <button
              key={f.executionId}
              type="button"
              onClick={() => onSelect(f)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: ROW_HEIGHT,
                transform: `translateY(${vItem.start}px)`,
              }}
              className="flex items-center gap-3 border-b border-[var(--wui-border)] px-1 text-left transition-colors hover:bg-[var(--wui-bg-subtle)]"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--wui-status-failed)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-[var(--wui-fg)]">{f.workflowName}</span>
                <span className="block font-mono text-[11px] text-[var(--wui-fg-muted)]">{f.executionId.slice(0, 8)}</span>
              </span>
              <span className="shrink-0 text-[11px] text-[var(--wui-fg-muted)]">
                {f.createdAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--wui-fg-muted)]">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}
