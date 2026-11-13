import { cn } from '../../shared/cn.js';
import { getCategoryTheme } from '../theme.js';
import { getStepIcon } from '../icons.js';

export type ExecutionStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'skipped';

export interface StepNodeProps {
  stepId: string;
  label: string;
  /** Secondary line under the label — the step type name, shown when an alias title is set. */
  subLabel?: string | undefined;
  /** Per-step alias description; surfaced as a one-line subtitle + hover tooltip. */
  description?: string | undefined;
  category?: string | undefined;
  icon?: string | undefined;
  isSelected: boolean;
  isDisabled: boolean;
  readOnly: boolean;
  /** When set, renders execution-mode styling (status borders, pulse, greyed pending). */
  executionStatus?: ExecutionStepStatus | undefined;
  liveActivity?: string | undefined;
  /** Number of validation issues on this step (builder mode) — shows a red badge + accent. */
  issueCount?: number | undefined;
  /** Tooltip text listing the issue messages. */
  issueTitle?: string | undefined;
  onClick: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onToggleDisabled?: () => void;
}

export function StepNode({
  stepId,
  label,
  subLabel,
  description,
  category,
  icon,
  isSelected,
  isDisabled,
  readOnly,
  executionStatus,
  liveActivity,
  issueCount,
  issueTitle,
  onClick,
  onDelete,
  onDuplicate,
  onToggleDisabled,
}: StepNodeProps) {
  const theme = getCategoryTheme(category);
  const isExecution = executionStatus !== undefined;
  const hasIssues = !isExecution && (issueCount ?? 0) > 0;

  // Execution-mode border + ring classes
  const execBorder = isExecution ? ({
    completed: 'border-l-emerald-500 border-emerald-200',
    running: 'border-l-blue-500 border-blue-200',
    failed: 'border-l-red-500 border-red-200',
    paused: 'border-l-amber-500 border-amber-200',
    pending: 'border-l-slate-300 border-slate-200',
    skipped: 'border-l-slate-300 border-slate-200',
  }[executionStatus]) : undefined;

  const execRing = isExecution ? ({
    completed: 'ring-2 ring-emerald-200/60',
    running: 'ring-2 ring-blue-300/50 animate-pulse',
    failed: 'ring-2 ring-red-200/60',
    paused: 'ring-2 ring-amber-200/60',
    pending: '',
    skipped: '',
  }[executionStatus]) : undefined;

  const isPending = isExecution && (executionStatus === 'pending' || executionStatus === 'skipped');

  return (
    <div
      data-step-id={stepId}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={hasIssues ? issueTitle : (description || undefined)}
      className={cn(
        'group relative flex w-48 cursor-pointer items-center gap-3 rounded-lg border bg-white px-3 py-3 transition-all',
        isExecution
          ? `border-l-[3px] ${execBorder} ${execRing} shadow-sm`
          : cn(
              `border-l-[3px] ${theme.accent}`,
              isSelected
                ? `ring-2 ${theme.ring} shadow-md`
                : 'border-slate-200 shadow-sm hover:shadow-md hover:-translate-y-px hover:border-slate-300',
            ),
        isSelected && isExecution && 'shadow-md',
        hasIssues && 'ring-2 ring-red-300 border-red-300',
        (isDisabled || isPending) && 'opacity-40 grayscale',
      )}
      style={{ animation: 'wui-scale-in 200ms ease-out' }}
    >
      {/* Issue badge */}
      {hasIssues && (
        <span
          className="absolute -left-2 -top-2 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow ring-2 ring-white"
          title={issueTitle}
        >
          {issueCount}
        </span>
      )}

      {/* Icon */}
      <div className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
        theme.iconBg, theme.iconText,
      )}>
        {getStepIcon(icon, { size: 16 })}
      </div>

      {/* Label + (sub-label / description / category) */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-slate-800 leading-tight">
          {label}
        </div>
        {subLabel && (
          <div className="truncate text-[11px] text-slate-500 leading-tight">
            {subLabel}
          </div>
        )}
        {description && (
          <div className="truncate text-[10px] text-slate-400 leading-tight">
            {description}
          </div>
        )}
        {liveActivity ? (
          <div className="mt-0.5 flex items-center gap-1 leading-tight">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400 animate-pulse" />
            <span className="truncate text-[10px] text-blue-500">{liveActivity}</span>
          </div>
        ) : category && (
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 rounded-full', theme.dot)} />
            <span className="text-[10px] text-slate-400 uppercase tracking-wide">
              {category}
            </span>
          </div>
        )}
      </div>

      {/* Hover action bar */}
      {!readOnly && (
        <div className={cn(
          'absolute -right-1 -top-3 flex gap-1 transition-all duration-150',
          'opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0',
        )}>
          {onDuplicate && (
            <button
              onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
              className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-slate-400 shadow-md ring-1 ring-slate-200/80 hover:text-slate-700 hover:ring-slate-300 transition-colors"
              title="Duplicate"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect width="13" height="13" x="9" y="9" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          )}
          {onToggleDisabled && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleDisabled(); }}
              className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-slate-400 shadow-md ring-1 ring-slate-200/80 hover:text-slate-700 hover:ring-slate-300 transition-colors"
              title={isDisabled ? 'Enable' : 'Disable'}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                {isDisabled
                  ? <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>
                  : <><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" /></>}
              </svg>
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-red-400 shadow-md ring-1 ring-red-200/60 hover:text-red-600 hover:bg-red-50 hover:ring-red-300 transition-colors"
              title="Delete"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
