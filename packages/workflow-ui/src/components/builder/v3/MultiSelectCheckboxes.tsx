import { useCallback, useMemo, useState } from 'react';
import { cn } from '../../shared/cn.js';

export interface MultiSelectCheckboxesProps {
  options: string[];
  value: string[] | undefined;
  onChange: (value: string[]) => void;
  disabled?: boolean | undefined;
}

export function MultiSelectCheckboxes({ options, value, onChange, disabled }: MultiSelectCheckboxesProps) {
  // Only values that are still options count as selected. A stored value the schema no longer
  // offers has no checkbox to clear it, so it is dropped on the next change rather than re-sent
  // with every toggle.
  const selected = useMemo(
    () => new Set((value ?? []).filter((option) => options.includes(option))),
    [value, options],
  );
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  const toggle = useCallback((option: string) => {
    const next = new Set(selected);
    if (next.has(option)) {
      next.delete(option);
    } else {
      next.add(option);
    }
    onChange([...next]);
  }, [selected, onChange]);

  const showSearch = options.length > 8;

  return (
    <div className={cn(
      'rounded-lg border border-[var(--wui-border)] bg-white overflow-hidden',
      disabled && 'opacity-60 cursor-not-allowed',
    )}>
      {showSearch && (
        <div className="border-b border-[var(--wui-border)] px-2.5 py-1.5">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter options..."
            disabled={disabled}
            className="w-full bg-transparent text-[12px] text-[var(--wui-fg)] outline-none placeholder:text-slate-400"
          />
        </div>
      )}
      <div className={cn('space-y-0.5 p-1.5', options.length > 8 && 'max-h-48 overflow-y-auto')}>
        {filtered.length === 0 && (
          <p className="px-2 py-1.5 text-[11px] text-slate-400">No matches</p>
        )}
        {filtered.map((option) => (
          <label
            key={option}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2 py-1.5 cursor-pointer transition-colors',
              'hover:bg-[var(--wui-bg-subtle)]',
              selected.has(option) && 'bg-[var(--wui-primary)]/5',
            )}
          >
            <div className="relative flex-shrink-0">
              <input
                type="checkbox"
                checked={selected.has(option)}
                onChange={() => toggle(option)}
                disabled={disabled}
                className="peer sr-only"
              />
              <div className={cn(
                'h-4 w-4 rounded border transition-all',
                selected.has(option)
                  ? 'border-[var(--wui-primary)] bg-[var(--wui-primary)]'
                  : 'border-slate-300 bg-white',
              )}>
                {selected.has(option) && (
                  <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
            </div>
            <span className="text-[12px] text-[var(--wui-fg)] font-mono">{option}</span>
          </label>
        ))}
      </div>
      {selected.size > 0 && (
        <div className="border-t border-[var(--wui-border)] px-2.5 py-1.5">
          <span className="text-[11px] text-slate-500">
            {selected.size} selected
          </span>
        </div>
      )}
    </div>
  );
}
