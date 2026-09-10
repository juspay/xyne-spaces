import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../../../utils/classNames';

interface ChipArrayFieldProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  error?: boolean;
}

export function ChipArrayField({
  value,
  onChange,
  placeholder,
  error,
}: ChipArrayFieldProps): React.ReactElement {
  const [draft, setDraft] = useState('');

  const commit = (raw: string): void => {
    const parts = raw
      .split(/[,\s]+/)
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
        'flex flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 min-h-[36px]',
        'focus-within:ring-2 focus-within:ring-ring',
        error ? 'border-destructive' : 'border-border',
      )}
    >
      {value.map((item, index) => (
        <span
          key={`${item}-${index}`}
          className='inline-flex items-center gap-1 rounded-md bg-accent/40 px-2 py-0.5 text-xs text-foreground'
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
            className='rounded-sm p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent/60'
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
          if (e.key === 'Enter' || e.key === ',') {
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
