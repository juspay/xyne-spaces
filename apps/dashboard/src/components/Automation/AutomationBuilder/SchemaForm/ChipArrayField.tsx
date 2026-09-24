import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../../../utils/classNames';

interface ChipArrayFieldProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  error?: boolean;
  mode?: 'token' | 'phrase';
}

export function ChipArrayField({
  value,
  onChange,
  placeholder,
  error,
  mode = 'phrase',
}: ChipArrayFieldProps): React.ReactElement {
  const [draft, setDraft] = useState('');

  const commit = (raw: string): void => {
    const parts = raw
      .split(mode === 'token' ? /[,\s]+/ : /[\r\n]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (parts.length === 0) return;
    const merged = [...value];
    for (const p of parts) {
      if (!merged.includes(p)) merged.push(p);
    }
    if (merged.length !== value.length) onChange(merged);
    setDraft('');
  };

  const removeAt = (index: number): void => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div
      className={cn(
        'flex w-full flex-wrap items-center gap-1.5 rounded-md border bg-background px-3 py-2 min-h-[40px] text-sm',
        'focus-within:border-ring focus-within:ring-1 focus-within:ring-ring',
        error ? 'border-destructive' : 'border-input',
      )}
    >
      {value.map((item, index) => (
        <span
          key={`${item}-${index}`}
          className={cn(
            'inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground',
            'transition-colors hover:bg-accent',
          )}
        >
          <span className='break-all'>{item}</span>
          <button
            type='button'
            onClick={e => {
              e.stopPropagation();
              removeAt(index);
            }}
            data-track-category='automation-builder'
            data-track-name='chip-array-remove'
            className={cn(
              'ml-0.5 rounded-full p-0.5 text-muted-foreground',
              'hover:bg-accent hover:text-foreground',
              'focus:outline-hidden focus:ring-2 focus:ring-ring',
            )}
            aria-label={`Remove ${item}`}
          >
            <X className='size-3' />
          </button>
        </span>
      ))}
      <input
        type='text'
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || (e.key === ',' && mode === 'token')) {
            e.preventDefault();
            commit(draft);
            return;
          }
          if (e.key === 'Backspace' && draft.length === 0 && value.length > 0) {
            e.preventDefault();
            removeAt(value.length - 1);
            return;
          }
        }}
        onBlur={() => {
          if (draft.length > 0) commit(draft);
        }}
        placeholder={value.length === 0 ? (placeholder ?? 'Type and press Enter') : ''}
        data-track-category='automation-builder'
        data-track-name='chip-array-input'
        className='flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground'
      />
    </div>
  );
}
