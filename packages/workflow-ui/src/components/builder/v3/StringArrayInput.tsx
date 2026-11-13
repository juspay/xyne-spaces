import { useCallback, useState } from 'react';
import { cn } from '../../shared/cn.js';

export interface StringArrayInputProps {
  value: string[] | undefined;
  onChange: (value: string[]) => void;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
}

export function StringArrayInput({ value, onChange, placeholder, disabled }: StringArrayInputProps) {
  const items = value ?? [];
  const [inputValue, setInputValue] = useState('');

  const addItem = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || items.includes(trimmed)) return;
    onChange([...items, trimmed]);
    setInputValue('');
  }, [inputValue, items, onChange]);

  const removeItem = useCallback((index: number) => {
    onChange(items.filter((_, i) => i !== index));
  }, [items, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem();
    }
    if (e.key === 'Backspace' && inputValue === '' && items.length > 0) {
      onChange(items.slice(0, -1));
    }
  }, [addItem, inputValue, items, onChange]);

  return (
    <div className={cn(
      'rounded-lg border bg-white transition-all',
      'border-[var(--wui-border)] focus-within:border-[var(--wui-primary)] focus-within:ring-2 focus-within:ring-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)]',
      disabled && 'opacity-60 cursor-not-allowed bg-[var(--wui-bg-subtle)]',
    )}>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2.5 pt-2">
          {items.map((item, i) => (
            <span
              key={`${item}-${i}`}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--wui-primary)]/8 px-2 py-0.5 text-[12px] font-medium text-[var(--wui-primary)]"
            >
              {item}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  className="ml-0.5 rounded-sm p-0.5 hover:bg-[var(--wui-primary)]/15 transition-colors"
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                  </svg>
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addItem}
        placeholder={items.length === 0 ? (placeholder ?? 'Type and press Enter to add') : 'Add another...'}
        disabled={disabled}
        className="w-full bg-transparent px-2.5 py-2 text-sm text-[var(--wui-fg)] outline-none placeholder:text-slate-400"
      />
    </div>
  );
}
