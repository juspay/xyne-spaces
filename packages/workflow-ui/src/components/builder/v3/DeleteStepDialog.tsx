import { cn } from '../../shared/cn.js';

export interface DeleteStepDialogProps {
  /** Label of the step being deleted. */
  stepLabel: string;
  /** Labels of steps that reference the one being deleted. */
  referencingLabels: string[];
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Warns before deleting a step that other steps reference via `{{…}}`. After
 * deletion those steps' references break — they'll be flagged by validation.
 */
export function DeleteStepDialog({
  stepLabel,
  referencingLabels,
  onCancel,
  onConfirm,
}: DeleteStepDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="delete-step-dialog">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />

      <div className={cn(
        'relative z-10 w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl',
        'animate-[wui-fade-in_150ms_ease-out]',
      )}>
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-slate-200/80 px-5 py-3.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" />
            </svg>
          </span>
          <h3 className="text-sm font-semibold text-slate-800">Delete “{stepLabel}”?</h3>
        </div>

        {/* Body */}
        <div className="px-5 py-4 text-[13px] text-slate-600">
          <p className="mb-2">
            {referencingLabels.length} {referencingLabels.length === 1 ? 'step references' : 'steps reference'} this step's output.
            Deleting it will break {referencingLabels.length === 1 ? 'that reference' : 'those references'}:
          </p>
          <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            {referencingLabels.map((label, i) => (
              <li key={i} className="flex items-center gap-1.5 text-slate-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                {label}
              </li>
            ))}
          </ul>
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
            data-testid="delete-anyway"
            onClick={onConfirm}
            className="rounded-md bg-red-500 px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-red-600"
          >
            Delete anyway
          </button>
        </div>
      </div>
    </div>
  );
}
