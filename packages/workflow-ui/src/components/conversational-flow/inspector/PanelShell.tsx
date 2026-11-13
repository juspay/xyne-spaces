/**
 * The panel itself: the width you set, the handle that resizes it, the header
 * that names what is selected, and the scrolling body.
 *
 * A screen and a lookup are different things to configure, but they are the same
 * panel — so the chrome lives here once and each supplies its own body. The
 * width is shared too: drag it wider on a screen and a lookup opens just as wide.
 */
import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { CommitInput } from '../ui.js';
import { ResizeHandle, usePanelWidth } from '../panel.js';

export interface PanelShellProps {
  /** Announced as the panel's name, e.g. `Screen: Payments`. */
  label: string;
  /** Where the thing sits, as clickable steps. */
  trail: Array<{ id: string; title: string }>;
  /** Shown instead of the trail when there is nowhere above. */
  trailFallback: string;
  title: string;
  /** What the title is called, for people who can't see it. */
  titleLabel: string;
  onRename: (title: string) => void;
  /** A tag and the id, under the title. */
  badge: ReactNode;
  id: string;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  children: ReactNode;
}

export function PanelShell({
  label,
  trail,
  trailFallback,
  title,
  titleLabel,
  onRename,
  badge,
  id,
  readOnly,
  onSelect,
  onClose,
  children,
}: PanelShellProps) {
  const uid = useId();
  const panel = usePanelWidth('inspector', { initial: 392, min: 320, max: 720 });

  return (
    <aside
      aria-label={label}
      className="relative flex h-full shrink-0 flex-col border-l border-[var(--wui-border)] bg-[var(--wui-surface,var(--wui-bg))]"
      // The map always keeps at least 40% of the room, however wide the panel was left.
      style={{ width: panel.width, maxWidth: '60%' }}
    >
      <ResizeHandle panel={panel} edge="left" label="Resize the panel" />
      <header className="flex flex-col gap-2 border-b border-[var(--wui-border)] px-5 pb-4 pt-4">
        <div className="flex items-start gap-2">
          <nav aria-label="Where this sits" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 text-[12px] text-[var(--wui-fg-muted)]">
            {trail.length === 0 ? (
              <span>{trailFallback}</span>
            ) : (
              trail.map((s) => (
                <span key={s.id} className="flex items-center gap-1">
                  <button type="button" onClick={() => onSelect(s.id)} className="rounded hover:text-[var(--wui-primary)]">
                    {s.title}
                  </button>
                  <span aria-hidden>›</span>
                </span>
              ))
            )}
          </nav>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <label htmlFor={`${uid}-title`} className="sr-only">{titleLabel}</label>
        <CommitInput
          id={`${uid}-title`}
          value={title}
          disabled={readOnly}
          onCommit={onRename}
          className="border-transparent bg-transparent px-1.5 py-1 text-[19px] font-semibold tracking-[-0.01em] hover:border-[var(--wui-border)]"
        />
        <div className="flex items-center gap-2 px-1.5">
          {badge}
          <code className="truncate font-mono text-[11px] text-[var(--wui-fg-muted)]">{id}</code>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}
