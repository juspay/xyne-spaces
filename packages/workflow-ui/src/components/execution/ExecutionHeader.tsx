import { useCallback, useState } from 'react';
import { type StatusVariant } from '../shared/StatusBadge.js';
import { cn } from '../shared/cn.js';

export interface ExecutionHeaderProps {
  executionId: string;
  status: string;
  startedAt?: string | undefined;
  /** Workflow display name. */
  name?: string | undefined;
  /** Whether a summary exists — controls visibility of the Summary toggle. */
  hasSummary?: boolean | undefined;
  /** Whether the summary side panel is currently open (toggle highlight). */
  summaryOpen?: boolean | undefined;
  /** Toggle the summary side panel. */
  onToggleSummary?: (() => void) | undefined;
  /** Active view mode (sectioned tabs vs graph canvas). */
  viewMode?: 'graph' | 'tabs' | undefined;
  onViewModeChange?: ((mode: 'graph' | 'tabs') => void) | undefined;
  className?: string | undefined;
  onCancel?: (() => void) | undefined;
  /** Back affordance — returns to the list (replaces the host breadcrumb). */
  onBack?: (() => void) | undefined;
  /** Whether the Ask-AI side panel is open (toggle highlight). */
  aiOpen?: boolean | undefined;
  /** Toggle the Ask-AI side panel. When omitted, the button is hidden. */
  onToggleAi?: (() => void) | undefined;
}

function mapStatus(s: string): StatusVariant {
  switch (s) {
    case 'running': return 'running';
    case 'RUNNING': return 'running';
    case 'completed': return 'completed';
    case 'COMPLETED': return 'completed';
    case 'failed': return 'failed';
    case 'FAILED': return 'failed';
    case 'paused': return 'paused';
    case 'EXTERNAL_WAIT': return 'paused';
    case 'scheduled': return 'scheduled';
    case 'SCHEDULED': return 'scheduled';
    case 'skipped': return 'skipped';
    case 'SKIPPED': return 'skipped';
    case 'cancelled': return 'cancelled';
    case 'CANCELLED': return 'cancelled';
    default: return 'pending';
  }
}

/** Statuses a run can still be called off from — lower and upper case both reach here. */
const CANCELLABLE: ReadonlySet<string> = new Set([
  'running',
  'RUNNING',
  'paused',
  'EXTERNAL_WAIT',
  'scheduled',
  'SCHEDULED',
  'pending',
  'PENDING',
]);

const STATUS_COLOR: Record<StatusVariant, string> = {
  scheduled: 'var(--wui-status-scheduled)',
  completed: 'var(--wui-status-completed)',
  running: '#3b82f6',
  failed: 'var(--wui-status-failed)',
  paused: 'var(--wui-status-paused)',
  cancelled: 'var(--wui-status-failed)',
  skipped: 'var(--wui-fg-muted)',
  pending: 'var(--wui-border-strong)',
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy execution ID"
      className="grid h-5 w-5 place-items-center rounded text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]"
    >
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--wui-status-completed)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );
}

export function ExecutionHeader({
  executionId,
  status,
  name,
  hasSummary,
  summaryOpen,
  onToggleSummary,
  viewMode,
  onViewModeChange,
  className,
  onCancel,
  onBack,
  aiOpen,
  onToggleAi,
}: ExecutionHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-[var(--wui-border)] bg-[var(--wui-bg)] px-4 py-2.5',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            title="Back"
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
        )}
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: STATUS_COLOR[mapStatus(status)] }}
              title={mapStatus(status)}
            />
            {name && (
              <span className="truncate text-sm font-semibold text-[var(--wui-fg)]" data-testid="execution-name">{name}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 pl-[18px]">
            <span className="font-mono text-[11px] text-[var(--wui-fg-muted)]">{executionId}</span>
            <CopyButton text={executionId} />
          </div>
        </div>
      </div>

      <div className="flex-1" />

      {onViewModeChange && (
        <div className="flex items-center rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] p-0.5">
          <button
            type="button"
            onClick={() => onViewModeChange('tabs')}
            title="Tabs — sectioned detail per step"
            className={cn(
              'flex items-center gap-1.5 rounded-[calc(var(--wui-radius-sm)-2px)] px-2.5 py-1 text-[12px] font-medium transition-colors',
              viewMode === 'tabs'
                ? 'bg-[var(--wui-primary)] text-[var(--wui-primary-fg)]'
                : 'text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
            )}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /></svg>
            Tabs
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('graph')}
            title="Graph — flow canvas"
            className={cn(
              'flex items-center gap-1.5 rounded-[calc(var(--wui-radius-sm)-2px)] px-2.5 py-1 text-[12px] font-medium transition-colors',
              viewMode === 'graph'
                ? 'bg-[var(--wui-primary)] text-[var(--wui-primary-fg)]'
                : 'text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
            )}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
            Graph
          </button>
        </div>
      )}

      {hasSummary && onToggleSummary && (
        <button
          onClick={onToggleSummary}
          data-testid="summary-toggle"
          title={summaryOpen ? 'Hide summary' : 'Show summary'}
          className={cn(
            'flex items-center gap-1.5 rounded-[var(--wui-radius-sm)] border px-2.5 py-1 text-sm transition-colors',
            summaryOpen
              ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
              : 'border-[var(--wui-border)] text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)]',
          )}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>
          </svg>
          Summary
        </button>
      )}

      {onToggleAi && (
        <button
          type="button"
          onClick={onToggleAi}
          title="Ask AI about this run"
          className={cn(
            'flex items-center gap-1.5 rounded-[var(--wui-radius-sm)] border px-2.5 py-1 text-sm transition-colors',
            aiOpen
              ? 'border-[var(--wui-primary)] bg-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)] text-[var(--wui-primary)]'
              : 'border-[var(--wui-border)] text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)]',
          )}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Ask AI
        </button>
      )}

      {/* Anything that has not finished can be called off — including a run that
          is only waiting for its moment, which the server has always allowed. */}
      {onCancel && CANCELLABLE.has(status) && (
        <button
          onClick={onCancel}
          className={cn(
            'rounded-[var(--wui-radius-sm)] border border-[var(--wui-status-failed)]/30 px-3 py-1 text-sm',
            'text-[var(--wui-status-failed)] hover:bg-[var(--wui-status-failed)]/5',
          )}
        >
          Cancel
        </button>
      )}
    </div>
  );
}
