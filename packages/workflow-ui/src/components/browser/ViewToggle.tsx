import { LayoutGrid, List } from 'lucide-react';
import type { ViewMode } from './types.js';

type Props = {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
};

export function ViewToggle({ value, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex items-center rounded-[var(--wui-pill-radius)] border border-[var(--wui-control-border)] bg-[var(--wui-control-bg)] p-0.5"
    >
      <button
        type="button"
        aria-label="Grid view"
        aria-pressed={value === 'grid'}
        onClick={() => { onChange('grid'); }}
        className={
          value === 'grid'
            ? 'inline-flex h-7 w-7 items-center justify-center rounded-[var(--wui-pill-radius)] bg-[var(--wui-control-bg-hover)] text-[var(--wui-control-fg)]'
            : 'inline-flex h-7 w-7 items-center justify-center rounded-[var(--wui-pill-radius)] text-[var(--wui-fg-muted)] transition hover:text-[var(--wui-control-fg)]'
        }
      >
        <LayoutGrid className="h-3.5 w-3.5" aria-hidden strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label="List view"
        aria-pressed={value === 'list'}
        onClick={() => { onChange('list'); }}
        className={
          value === 'list'
            ? 'inline-flex h-7 w-7 items-center justify-center rounded-[var(--wui-pill-radius)] bg-[var(--wui-control-bg-hover)] text-[var(--wui-control-fg)]'
            : 'inline-flex h-7 w-7 items-center justify-center rounded-[var(--wui-pill-radius)] text-[var(--wui-fg-muted)] transition hover:text-[var(--wui-control-fg)]'
        }
      >
        <List className="h-3.5 w-3.5" aria-hidden strokeWidth={2} />
      </button>
    </div>
  );
}
