import { useEffect, useRef, useState } from 'react';
import { cn } from './cn.js';

export interface TagFilterProps {
  /** All selectable tags. */
  tags: string[];
  /** Currently selected tags (ANY-match handled by the caller). */
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
}

/**
 * Compact multi-select dropdown for filtering by tag. Shows a "Tags" button with
 * a selected-count badge; the popover lists each tag as a checkbox row. Generic —
 * used by the approvals screen and the workflow browser.
 */
export function TagFilter({ tags, selected, onChange, className }: TagFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (tags.length === 0) return null;

  const toggle = (t: string) =>
    onChange(selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] transition',
          selected.length > 0
            ? 'border-[var(--wui-status-paused)] bg-[var(--wui-status-paused)]/10 text-[var(--wui-status-paused)]'
            : 'border-[var(--wui-border)] bg-[var(--wui-bg)] text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]',
        )}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        Teams
        {selected.length > 0 && (
          <span className="rounded-full bg-[var(--wui-status-paused)] px-1.5 text-[10px] font-semibold text-white">{selected.length}</span>
        )}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={cn('transition-transform', open && 'rotate-180')}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 min-w-[180px] overflow-hidden rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] shadow-lg">
          <div className="max-h-64 overflow-y-auto py-1">
            {tags.map((t) => {
              const active = selected.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggle(t)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-[var(--wui-fg)] hover:bg-[var(--wui-bg-subtle)]"
                >
                  <span className={cn(
                    'grid h-3.5 w-3.5 shrink-0 place-items-center rounded border',
                    active ? 'border-[var(--wui-status-paused)] bg-[var(--wui-status-paused)] text-white' : 'border-[var(--wui-border)]',
                  )}>
                    {active && (
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    )}
                  </span>
                  <span className="truncate">{t}</span>
                </button>
              );
            })}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-[var(--wui-border)]">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full px-2.5 py-1.5 text-left text-[11px] font-medium text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
