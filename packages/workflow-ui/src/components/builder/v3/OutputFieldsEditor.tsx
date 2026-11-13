import { useCallback } from 'react';
import { cn } from '../../shared/cn.js';

interface OutputField {
  name: string;
  type: string;
}

interface OutputFieldsEditorProps {
  value: OutputField[] | undefined;
  onChange: (value: OutputField[]) => void;
  disabled?: boolean | undefined;
}

const TYPE_OPTIONS = ['string', 'number', 'boolean', 'object', 'array'] as const;

const inputClasses =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100';

export function OutputFieldsEditor({ value, onChange, disabled }: OutputFieldsEditorProps) {
  const fields = value ?? [];

  const handleAdd = useCallback(() => {
    onChange([...fields, { name: '', type: 'string' }]);
  }, [fields, onChange]);

  const handleRemove = useCallback((idx: number) => {
    onChange(fields.filter((_, i) => i !== idx));
  }, [fields, onChange]);

  const handleChange = useCallback((idx: number, key: 'name' | 'type', val: string) => {
    const updated = fields.map((f, i) => (i === idx ? { ...f, [key]: val } : f));
    onChange(updated);
  }, [fields, onChange]);

  return (
    <div className="space-y-2">
      {fields.map((field, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            type="text"
            value={field.name}
            onChange={(e) => handleChange(idx, 'name', e.target.value)}
            placeholder="Field name"
            disabled={disabled}
            className={cn(inputClasses, 'flex-1')}
          />
          <select
            value={field.type}
            onChange={(e) => handleChange(idx, 'type', e.target.value)}
            disabled={disabled}
            className={cn(inputClasses, 'w-28')}
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {!disabled && (
            <button
              onClick={() => handleRemove(idx)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:border-indigo-400 hover:text-indigo-500 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14" /><path d="M5 12h14" />
          </svg>
          Add output field
        </button>
      )}
    </div>
  );
}
