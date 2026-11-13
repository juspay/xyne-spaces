import { useCallback } from 'react';
import type { Condition, WorkflowConfig, WorkflowStepConfig } from '@xyne/workflow-sdk/builder';
import { ConditionOperator } from '@xyne/workflow-sdk/builder';
import { ConditionEditorPanel } from './ConditionEditorPanel.js';
import { cn } from '../../shared/cn.js';

export interface SwitchCase {
  condition: Condition;
  label?: string | undefined;
  steps: WorkflowStepConfig[];
}

export interface SwitchCaseEditorProps {
  cases: SwitchCase[];
  onChange: (cases: SwitchCase[]) => void;
  config: WorkflowConfig;
  atStepId: string;
  readOnly?: boolean | undefined;
}

function defaultCondition(): Condition {
  return { variable: '', operator: ConditionOperator.EQ, value: '' };
}

export function SwitchCaseEditor({
  cases,
  onChange,
  config,
  atStepId,
  readOnly,
}: SwitchCaseEditorProps) {
  const updateCase = useCallback(
    (index: number, update: Partial<SwitchCase>) => {
      const next = cases.map((c, i) => (i === index ? { ...c, ...update } : c));
      onChange(next);
    },
    [cases, onChange],
  );

  const addCase = useCallback(() => {
    onChange([
      ...cases,
      { condition: defaultCondition(), label: `Case ${cases.length + 1}`, steps: [] },
    ]);
  }, [cases, onChange]);

  const removeCase = useCallback(
    (index: number) => {
      onChange(cases.filter((_, i) => i !== index));
    },
    [cases, onChange],
  );

  const moveCase = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= cases.length) return;
      const next = [...cases];
      [next[index], next[target]] = [next[target]!, next[index]!];
      onChange(next);
    },
    [cases, onChange],
  );

  return (
    <div className="space-y-3">
      {cases.map((switchCase, i) => (
        <div
          key={i}
          className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden"
        >
          {/* Case header */}
          <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/50 px-3 py-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-violet-100 text-[10px] font-bold text-violet-600">
              {i + 1}
            </div>

            <input
              type="text"
              value={switchCase.label ?? ''}
              onChange={(e) => updateCase(i, { label: e.target.value })}
              disabled={readOnly}
              placeholder={`Case ${i + 1}`}
              className={cn(
                'flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-xs font-medium text-slate-700',
                'hover:border-slate-200 focus:border-[var(--wui-primary)] focus:ring-1 focus:ring-[color-mix(in_srgb,var(--wui-primary)_22%,transparent)] outline-none transition-all',
                readOnly && 'cursor-not-allowed opacity-60',
              )}
              onKeyDown={(e) => e.stopPropagation()}
            />

            {!readOnly && (
              <div className="flex items-center gap-0.5">
                {/* Move up */}
                <button
                  onClick={() => moveCase(i, -1)}
                  disabled={i === 0}
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded transition-colors',
                    i === 0
                      ? 'text-slate-200 cursor-not-allowed'
                      : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100',
                  )}
                  title="Move up"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="m18 15-6-6-6 6" />
                  </svg>
                </button>
                {/* Move down */}
                <button
                  onClick={() => moveCase(i, 1)}
                  disabled={i === cases.length - 1}
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded transition-colors',
                    i === cases.length - 1
                      ? 'text-slate-200 cursor-not-allowed'
                      : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100',
                  )}
                  title="Move down"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {/* Remove */}
                <button
                  onClick={() => removeCase(i)}
                  className="flex h-5 w-5 items-center justify-center rounded text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors"
                  title="Remove case"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Case condition */}
          <div className="p-3">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              When
            </label>
            <ConditionEditorPanel
              condition={switchCase.condition}
              onChange={(c) => updateCase(i, { condition: c })}
              config={config}
              atStepId={atStepId}
              readOnly={readOnly}
            />
          </div>
        </div>
      ))}

      {/* Add case button */}
      {!readOnly && (
        <button
          onClick={addCase}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-violet-200 py-2.5 text-[11px] font-medium text-violet-400 hover:border-violet-300 hover:text-violet-500 hover:bg-violet-50/50 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          Add case
        </button>
      )}
    </div>
  );
}
