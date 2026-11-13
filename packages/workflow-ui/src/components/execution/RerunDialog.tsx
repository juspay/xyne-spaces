import { useCallback, useEffect, useMemo, useState } from 'react';
import { useExecutionRerun } from '../../hooks/use-execution-rerun.js';
import { cn } from '../shared/cn.js';
import { ValueEditor, deepEqual, validateValueTree } from './ValueEditor.js';

export interface RerunDialogProps {
  /** Source execution being rerun. */
  executionId: string;
  /** Step ID to start the rerun from. Read-only in the dialog. */
  fromStepId: string;
  /**
   * Optional display name for the step (e.g. its config type or label).
   * Falls back to `fromStepId` when omitted.
   */
  fromStepLabel?: string | undefined;
  /**
   * The step's input from the source execution. Used to pre-populate the
   * override editor and to validate that the user only changes existing
   * fields and preserves their original types.
   *
   * Pass `undefined` for control-flow steps that don't have a recorded input.
   */
  originalInput?: Record<string, unknown> | undefined;
  /** Close handler (called on cancel + after successful submit). */
  onClose: () => void;
  /** Called with the new execution ID after a successful rerun. */
  onSuccess?: ((newExecutionId: string) => void) | undefined;
  className?: string | undefined;
}

/** Build the per-key shallow diff between edited and original. */
function diffTopLevel(
  edited: Record<string, unknown>,
  original: Record<string, unknown>,
): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  for (const key of Object.keys(original)) {
    if (!deepEqual(edited[key], original[key])) {
      diff[key] = edited[key];
    }
  }
  return diff;
}

/**
 * Modal dialog for triggering a "rerun from step" operation.
 *
 * Renders the source step's input as a structured form (recursive ValueEditor).
 * Locks structure + types — users can only update existing fields. Only fields
 * whose values changed are sent as `configOverrides`; unchanged fields keep
 * their original raw config (preserving any `{{...}}` variable references).
 */
export function RerunDialog({
  executionId,
  fromStepId,
  fromStepLabel,
  originalInput,
  onClose,
  onSuccess,
  className,
}: RerunDialogProps) {
  const { rerun, isSubmitting, error } = useExecutionRerun({
    executionId,
    onSuccess: (newId) => {
      onSuccess?.(newId);
      onClose();
    },
  });

  const hasOriginal = !!originalInput;

  // ─── Form mode (structured editor) ───
  const [edited, setEdited] = useState<Record<string, unknown>>(
    () => (originalInput ? structuredClone(originalInput) : {}),
  );
  useEffect(() => {
    setEdited(originalInput ? structuredClone(originalInput) : {});
  }, [originalInput]);

  const errors = useMemo(() => {
    if (!originalInput) return [];
    return validateValueTree(edited, originalInput);
  }, [edited, originalInput]);

  const diff = useMemo(() => {
    if (!originalInput) return {};
    return diffTopLevel(edited, originalInput);
  }, [edited, originalInput]);

  // ─── JSON fallback mode (for control-flow steps with no original input) ───
  const [rawJson, setRawJson] = useState('{}');
  const [rawJsonError, setRawJsonError] = useState<string | null>(null);

  const [inheritStepState, setInheritStepState] = useState(true);

  const handleResetAll = useCallback(() => {
    if (originalInput) setEdited(structuredClone(originalInput));
  }, [originalInput]);

  const handleSubmit = useCallback(async () => {
    let overrides: Record<string, unknown> = {};

    if (hasOriginal) {
      if (errors.length > 0) return;
      overrides = diff;
    } else {
      const trimmed = rawJson.trim();
      if (trimmed && trimmed !== '{}') {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            setRawJsonError('Must be a JSON object');
            return;
          }
          overrides = parsed as Record<string, unknown>;
        } catch (err) {
          setRawJsonError(err instanceof Error ? err.message : 'Invalid JSON');
          return;
        }
      }
      setRawJsonError(null);
    }

    const hasOverrides = Object.keys(overrides).length > 0;
    await rerun({
      fromStepId,
      ...(hasOverrides ? { configOverrides: overrides } : {}),
      inheritStepState,
    });
  }, [hasOriginal, errors, diff, rawJson, rerun, fromStepId, inheritStepState]);

  const changedTopLevelKeys = Object.keys(diff);
  const submitDisabled =
    isSubmitting || (hasOriginal ? errors.length > 0 : false);

  return (
    <div className={cn('fixed inset-0 z-50 flex items-center justify-center', className)}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div
        className={cn(
          'relative z-10 w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl',
          'animate-[wui-fade-in_150ms_ease-out]',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-800">Rerun from step</h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              Edit the step input and replay this execution.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[72vh] space-y-4 overflow-y-auto px-5 py-4">
          {/* Source */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.08em] text-slate-400">
                source.execution
              </label>
              <div className="truncate rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-700" title={executionId}>
                {executionId}
              </div>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.08em] text-slate-400">
                from.step
              </label>
              <div className="truncate rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12px] font-medium text-slate-700">
                {fromStepLabel ?? fromStepId}
              </div>
            </div>
          </div>

          {/* Input editor */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-400">
                <span>step.input</span>
                {hasOriginal && changedTopLevelKeys.length > 0 && (
                  <span className="rounded-sm bg-amber-100 px-1.5 py-px font-mono text-[10px] normal-case tracking-normal text-amber-700">
                    {changedTopLevelKeys.length} modified
                  </span>
                )}
              </label>
              {hasOriginal && changedTopLevelKeys.length > 0 && (
                <button
                  type="button"
                  onClick={handleResetAll}
                  className="text-[11px] font-medium text-indigo-500 hover:text-indigo-700"
                >
                  Reset all
                </button>
              )}
            </div>

            {hasOriginal ? (
              <div className="rounded-md border border-slate-200 bg-white">
                {Object.keys(originalInput!).length === 0 ? (
                  <p className="px-3 py-3 text-[12px] text-slate-500">
                    This step had no recorded input fields.
                  </p>
                ) : (
                  <div className="space-y-px px-1 py-1">
                    {Object.keys(originalInput!).map((key) => (
                      <ValueEditor
                        key={key}
                        value={edited[key]}
                        original={originalInput![key]}
                        label={key}
                        path={[key]}
                        depth={0}
                        onChange={(next) =>
                          setEdited((prev) => ({ ...prev, [key]: next }))
                        }
                      />
                    ))}
                  </div>
                )}
                {errors.length > 0 && (
                  <div className="border-t border-red-100 bg-red-50/60 px-3 py-2">
                    <ul className="space-y-0.5 font-mono text-[11px] text-red-700">
                      {errors.map((e, i) => (
                        <li key={i}>
                          <span className="text-red-500">{e.path || '<root>'}</span>: {e.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <textarea
                  value={rawJson}
                  onChange={(e) => {
                    setRawJson(e.target.value);
                    setRawJsonError(null);
                  }}
                  spellCheck={false}
                  rows={Math.min(14, Math.max(6, rawJson.split('\n').length))}
                  className={cn(
                    'w-full resize-y rounded-md border bg-white px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-700',
                    'focus:outline-none focus:ring-2 focus:ring-indigo-200',
                    rawJsonError ? 'border-red-300' : 'border-slate-200',
                  )}
                  placeholder={'{\n  "fieldName": "new value"\n}'}
                />
                {rawJsonError && (
                  <p className="mt-1 font-mono text-[11px] text-red-500">{rawJsonError}</p>
                )}
              </div>
            )}

            <p className="mt-1.5 text-[11px] text-slate-500">
              {hasOriginal
                ? 'Field types and structure are locked. Only fields you change are sent as overrides; unchanged fields use the workflow definition as-is.'
                : 'No recorded input — any JSON object you enter will be applied as overrides.'}
            </p>
          </div>

          {/* inheritStepState */}
          <div>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={inheritStepState}
                onChange={(e) => setInheritStepState(e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-500 focus:ring-indigo-200"
              />
              <span>
                <span className="block text-[13px] font-medium text-slate-700">
                  Inherit step state
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-500">
                  Pass the source run&apos;s data for this step as <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">ctx.priorState</code>.
                  Required for agent steps to continue prior conversations.
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200/80 px-5 py-3">
          {error && (
            <span className="mr-auto truncate text-xs text-red-500" title={error.message}>
              {error.message}
            </span>
          )}
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-md border border-slate-200 px-3.5 py-1.5 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={submitDisabled}
            className={cn(
              'rounded-md px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors',
              'bg-indigo-500 hover:bg-indigo-600',
              submitDisabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {isSubmitting ? 'Starting…' : 'Start Rerun'}
          </button>
        </div>
      </div>
    </div>
  );
}
