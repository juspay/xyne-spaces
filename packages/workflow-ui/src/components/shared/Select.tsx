import { useEffect, useRef, useState } from 'react';
import { cn } from './cn.js';

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Fully custom dropdown — a styled trigger + a themed option menu. Replaces the
 * native <select> so the open popup is styled too (the native popup can't be).
 * Closes on outside-click / Escape; the chosen option is highlighted in brand.
 */
export function Select({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  compact,
  className,
  ariaLabel,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  compact?: boolean | undefined;
  className?: string | undefined;
  ariaLabel?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  const toggle = () => {
    if (!open) {
      // Flip the menu above the trigger when there isn't room below (e.g. the
      // last field, where the menu would otherwise clip under the action bar).
      const rect = ref.current?.getBoundingClientRect();
      setOpenUp(!!rect && rect.bottom > window.innerHeight - 290);
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={toggle}
        className={cn(
          'flex w-full items-center justify-between gap-1.5 rounded-[var(--wui-radius-sm)] border bg-[var(--wui-bg)] text-left text-[var(--wui-fg)] transition-colors',
          compact ? 'h-7 px-1.5 text-[11px]' : 'px-2.5 py-1.5 text-sm',
          'disabled:cursor-not-allowed disabled:opacity-50',
          open
            ? 'border-[var(--wui-primary)] ring-1 ring-[var(--wui-primary)]'
            : 'border-[var(--wui-border)] hover:border-[var(--wui-border-strong)]',
        )}
      >
        <span className={cn('min-w-0 truncate', !current && 'text-[var(--wui-fg-muted)]')}>
          {current?.label ?? placeholder ?? 'Select…'}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('shrink-0 text-[var(--wui-fg-muted)] transition-transform', compact ? 'h-3 w-3' : 'h-3.5 w-3.5', open && 'rotate-180')}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className={cn(
            'absolute left-0 z-50 max-h-56 w-max min-w-full max-w-[280px] overflow-y-auto rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[color-mix(in_srgb,var(--wui-bg-muted)_96%,var(--wui-fg)_4%)] py-1 shadow-lg',
            openUp ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {options.length === 0 ? (
            <div className="px-2.5 py-1.5 text-[13px] text-[var(--wui-fg-muted)]">No options</div>
          ) : (
            options.map((opt) => {
              const selected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 whitespace-nowrap px-2.5 py-1.5 text-left text-[13px] transition-colors',
                    selected
                      ? 'bg-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)] font-medium text-[var(--wui-primary)]'
                      : 'text-[var(--wui-fg)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_6%,transparent)]',
                  )}
                >
                  <span className="min-w-0 truncate">{opt.label}</span>
                  {selected && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
