import { useMemo, useState } from 'react';
import { cn } from './cn.js';

export interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Known tags to suggest while typing (e.g. tags already used elsewhere). */
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean | undefined;
  className?: string;
}

/** Normalise a raw tag: trimmed, collapsed whitespace, lower-cased. */
function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * A chip-style tag editor: type + Enter (or comma) to add, click ✕ or Backspace
 * to remove, with suggestions from known tags. Tags are normalised + de-duped.
 * Generic — used in the create dialog, the browser tag editor, and anywhere else.
 */
export function TagInput({ value, onChange, suggestions = [], placeholder = 'Add a tag…', disabled, className }: TagInputProps) {
  const [draft, setDraft] = useState('');

  const addTag = (raw: string) => {
    const t = normalize(raw);
    if (!t) return;
    if (!value.includes(t)) onChange([...value, t]);
    setDraft('');
  };
  const removeTag = (t: string) => onChange(value.filter((x) => x !== t));

  const open = draft.trim().length > 0;
  const matches = useMemo(() => {
    if (!open) return [];
    const q = normalize(draft);
    return suggestions.filter((s) => s.includes(q) && !value.includes(s)).slice(0, 6);
  }, [open, draft, suggestions, value]);

  return (
    <div className={cn('relative', className)}>
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 rounded-[var(--wui-radius-sm)] border px-2 py-1.5',
          'border-[var(--wui-border)] bg-[var(--wui-bg)] focus-within:border-[var(--wui-primary)] focus-within:ring-1 focus-within:ring-[var(--wui-primary)]',
          disabled && 'opacity-60',
        )}
      >
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[var(--wui-primary)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--wui-primary)]">
            {t}
            {!disabled && (
              <button type="button" aria-label={`Remove ${t}`} onClick={() => removeTag(t)} className="text-[var(--wui-primary)]/60 hover:text-[var(--wui-primary)]">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            )}
          </span>
        ))}
        <input
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addTag(draft);
            } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
              removeTag(value[value.length - 1]!);
            }
          }}
          placeholder={value.length === 0 ? placeholder : ''}
          className="min-w-[80px] flex-1 bg-transparent text-[13px] text-[var(--wui-fg)] outline-none placeholder:text-[var(--wui-fg-muted)]/60"
        />
      </div>
      {matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] shadow-md">
          {matches.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addTag(s)}
              className="block w-full px-2.5 py-1.5 text-left text-[12px] text-[var(--wui-fg)] hover:bg-[var(--wui-bg-subtle)]"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
