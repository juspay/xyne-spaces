import { useState } from 'react';
import { SummaryDialog } from './SummaryDialog.js';
import { cn } from '../../shared/cn.js';

export interface SummaryButtonProps {
  /** Current summary markdown (empty string when unset). */
  value: string;
  /** Called when the user applies edits in the dialog. Persists via the builder's Save. */
  onChange: (value: string) => void;
  className?: string | undefined;
}

/**
 * Trigger for the workflow-summary editor: a compact button that opens a modal
 * markdown editor ({@link SummaryDialog}). The summary is part of the builder's
 * save payload, so there is no separate save here.
 */
export function SummaryButton({ value, onChange, className }: SummaryButtonProps) {
  const [open, setOpen] = useState(false);
  const hasSummary = value.trim().length > 0;

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        data-testid="summary-button"
        onClick={() => setOpen(true)}
        title={hasSummary ? 'Edit workflow summary' : 'Add a summary describing this workflow'}
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] font-semibold shadow-sm transition-colors',
          'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
        )}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>
        </svg>
        Summary
        {!hasSummary && (
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="No summary yet" />
        )}
      </button>

      {open && (
        <SummaryDialog
          value={value}
          onApply={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
