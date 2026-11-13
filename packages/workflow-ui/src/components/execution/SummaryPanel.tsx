import { MarkdownView } from '../shared/MarkdownView.js';
import { SidePanelShell } from './SidePanelShell.js';

export interface SummaryPanelProps {
  /** Workflow display name, shown as the panel title. */
  name?: string | undefined;
  /** Workflow summary markdown. */
  summary: string;
  onClose: () => void;
  /** Controlled panel width — shared with the step-detail panel so it persists across swaps. */
  width?: number | undefined;
  onWidthChange?: ((width: number) => void) | undefined;
  className?: string | undefined;
}

/**
 * Run-view side panel that renders the workflow summary (markdown). Uses the
 * shared {@link SidePanelShell} so it resizes/behaves identically to
 * {@link StepDetailPanel}; shown by default and dismissed via the close button
 * (reopened from the header's Summary toggle).
 */
export function SummaryPanel({ name, summary, onClose, width, onWidthChange, className }: SummaryPanelProps) {
  return (
    <SidePanelShell accentClassName="border-t-indigo-400" width={width} onWidthChange={onWidthChange} className={className}>
      <div data-testid="summary-panel" className="flex min-h-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>
              </svg>
            </span>
            <div className="min-w-0">
              {name && (
                <div className="text-[13px] font-semibold leading-tight text-slate-800 truncate">{name}</div>
              )}
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Summary</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close summary"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto border-t border-slate-100 px-4 py-4">
          {summary.trim() ? (
            <MarkdownView>{summary}</MarkdownView>
          ) : (
            <p className="text-[13px] italic text-slate-400">No summary for this workflow.</p>
          )}
        </div>
      </div>
    </SidePanelShell>
  );
}
