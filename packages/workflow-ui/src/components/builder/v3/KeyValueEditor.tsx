import { useCallback, useState } from 'react';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import { VariableRefInput } from './VariableRefInput.js';
import { FieldSourceControl } from './field-source-control.js';
import { cn } from '../../shared/cn.js';

interface KeyValueRow {
  key: string;
  value: string;
}

export interface KeyValueEditorProps {
  value: Record<string, string> | undefined;
  onChange: (value: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  disabled?: boolean | undefined;
  config?: WorkflowConfig;
  atStepId?: string;
  /**
   * Path of this record field within the step config (e.g. `headers`). When set,
   * each entry shows a "+ source" control addressed by `${recordPath}.${key}`.
   */
  recordPath?: string | undefined;
}

function toRows(record: Record<string, string> | undefined): KeyValueRow[] {
  if (!record || typeof record !== 'object') return [];
  return Object.entries(record).map(([key, value]) => ({ key, value: String(value) }));
}

function toRecord(rows: KeyValueRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    const k = row.key.trim();
    if (k) result[k] = row.value;
  }
  return result;
}

export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  disabled,
  config,
  atStepId,
  recordPath,
}: KeyValueEditorProps) {
  const [rows, setRows] = useState<KeyValueRow[]>(() => {
    const initial = toRows(value);
    return initial.length > 0 ? initial : [];
  });

  const commit = useCallback((updated: KeyValueRow[]) => {
    setRows(updated);
    onChange(toRecord(updated));
  }, [onChange]);

  const handleKeyChange = useCallback((idx: number, newKey: string) => {
    const updated = rows.map((r, i) => (i === idx ? { ...r, key: newKey } : r));
    commit(updated);
  }, [rows, commit]);

  const handleValueChange = useCallback((idx: number, newValue: unknown) => {
    const updated = rows.map((r, i) => (i === idx ? { ...r, value: String(newValue ?? '') } : r));
    commit(updated);
  }, [rows, commit]);

  const handleRemove = useCallback((idx: number) => {
    commit(rows.filter((_, i) => i !== idx));
  }, [rows, commit]);

  const handleAdd = useCallback(() => {
    setRows((prev) => [...prev, { key: '', value: '' }]);
  }, []);

  const inputClasses = cn(
    'w-full rounded-md border px-2.5 py-1.5 text-xs',
    'bg-white outline-none transition-all',
    'border-slate-200 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100',
    disabled && 'opacity-60 cursor-not-allowed bg-slate-50',
  );

  return (
    <div className="space-y-1.5">
      {rows.map((row, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <input
            type="text"
            value={row.key}
            onChange={(e) => handleKeyChange(idx, e.target.value)}
            placeholder={keyPlaceholder}
            disabled={disabled}
            className={cn(inputClasses, 'w-[38%] font-medium')}
          />
          {config && atStepId ? (
            <div className="flex-1">
              <VariableRefInput
                value={row.value}
                onChange={(v) => handleValueChange(idx, v)}
                config={config}
                atStepId={atStepId}
                placeholder={valuePlaceholder}
                disabled={disabled}
                compact
                filterType="string"
              />
            </div>
          ) : (
            <input
              type="text"
              value={row.value}
              onChange={(e) => handleValueChange(idx, e.target.value)}
              placeholder={valuePlaceholder}
              disabled={disabled}
              className={cn(inputClasses, 'flex-1')}
            />
          )}
          {/* Per-entry source — addressed by `${recordPath}.${key}` (generic). A
              record key is its own stable identity, so an empty key has no path. */}
          {recordPath && row.key.trim().length > 0 && (
            <FieldSourceControl fieldPath={`${recordPath}.${row.key.trim()}`} />
          )}
          {!disabled && (
            <button
              onClick={() => handleRemove(idx)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-400 transition-colors"
              title="Remove"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          )}
        </div>
      ))}

      {!disabled && (
        <button
          onClick={handleAdd}
          className={cn(
            'flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-[11px] font-medium',
            'border-slate-200 text-slate-400',
            'hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50/50 transition-all',
          )}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14" /><path d="M5 12h14" />
          </svg>
          Add
        </button>
      )}
    </div>
  );
}
