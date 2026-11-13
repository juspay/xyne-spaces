import type { ValidationResult } from '@xyne/workflow-sdk';
import { groupIssues } from '../../../utils/issue-mapping.js';
import { cn } from '../../shared/cn.js';

export interface SaveValidationDialogProps {
  result: ValidationResult;
  /** Resolve a step id to a human label. */
  stepLabel: (stepId: string) => string;
  /** Jump to a target: a step id, or `'__trigger__'`. */
  onJump: (target: string) => void;
  onCancel: () => void;
  onSaveAnyway: () => void;
}

/**
 * Pre-save confirmation listing validation issues grouped by step/trigger.
 * Each group jumps to the offending node; the user can Cancel or Save anyway
 * (drafts are allowed).
 */
export function SaveValidationDialog({
  result,
  stepLabel,
  onJump,
  onCancel,
  onSaveAnyway,
}: SaveValidationDialogProps) {
  const grouped = groupIssues(result);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="save-validation-dialog">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />

      <div className={cn(
        'relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl',
        'animate-[wui-fade-in_150ms_ease-out]',
      )}>
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-slate-200/80 px-5 py-3.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-600">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" />
            </svg>
          </span>
          <h3 className="text-sm font-semibold text-slate-800">
            Save with {grouped.total} {grouped.total === 1 ? 'issue' : 'issues'}?
          </h3>
        </div>

        {/* Body — grouped issues */}
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {grouped.trigger.length > 0 && (
            <IssueGroup
              label="Trigger"
              issues={grouped.trigger}
              onJump={() => onJump('__trigger__')}
            />
          )}
          {grouped.orderedStepIds.map((stepId) => (
            <IssueGroup
              key={stepId}
              label={stepLabel(stepId)}
              issues={grouped.byStep.get(stepId) ?? []}
              onJump={() => onJump(stepId)}
            />
          ))}
          {grouped.unlocated.length > 0 && (
            <IssueGroup label="Other" issues={grouped.unlocated} />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200/80 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3.5 py-1.5 text-[13px] font-semibold text-slate-500 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="save-anyway"
            onClick={onSaveAnyway}
            className="rounded-md bg-indigo-500 px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-600"
          >
            Save anyway
          </button>
        </div>
      </div>
    </div>
  );
}

function IssueGroup({
  label,
  issues,
  onJump,
}: {
  label: string;
  issues: { message: string; location?: { field?: string } | undefined }[];
  onJump?: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={onJump}
        disabled={!onJump}
        className={cn(
          'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] font-semibold text-slate-700',
          onJump && 'hover:bg-slate-50',
        )}
      >
        <span className="truncate">{label}</span>
        {onJump && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-indigo-500">
            Jump
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </span>
        )}
      </button>
      <ul className="space-y-0.5 border-t border-slate-100 px-3 py-2 text-[12px] text-red-700">
        {issues.map((iss, i) => (
          <li key={i}>
            {iss.location?.field && <span className="font-mono text-[11px] text-red-500">{iss.location.field}: </span>}
            {iss.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
