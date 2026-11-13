import { cn } from '../../shared/cn.js';

export interface IssueBarProps {
  /** Total number of validation issues. */
  total: number;
  /** 1-based position of the current target within the issue list, for display. */
  position: number;
  /** Number of navigable targets (trigger + steps with issues). */
  targetCount: number;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Floating summary of validation issues with Prev/Next to cycle through the
 * affected trigger/steps. Shown only when there are issues.
 */
export function IssueBar({ total, position, targetCount, onPrev, onNext }: IssueBarProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 shadow-sm',
        'text-[13px] text-red-700',
      )}
      data-testid="issue-bar"
    >
      <span className="flex items-center gap-1.5 font-medium">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" />
        </svg>
        {total} {total === 1 ? 'issue' : 'issues'}
      </span>
      {targetCount > 0 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrev}
            className="rounded-md px-1.5 py-0.5 hover:bg-red-100 transition-colors"
            aria-label="Previous issue"
            title="Previous issue"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <span className="tabular-nums text-[12px] text-red-600">{position}/{targetCount}</span>
          <button
            type="button"
            onClick={onNext}
            className="rounded-md px-1.5 py-0.5 hover:bg-red-100 transition-colors"
            aria-label="Next issue"
            title="Next issue"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
