import type { ReactNode } from 'react';
import { cn } from '../shared/cn.js';

export interface DashboardPanelProps {
  title?: ReactNode;
  /**
   * Fill the parent's height instead of growing with the content.
   *
   * The body becomes a flex column, so a child can claim the leftover height
   * (`flex-1 min-h-0`) and scroll inside it while its siblings stay put. The
   * body itself scrolls only as a fallback, when the fixed parts alone are
   * taller than the panel.
   *
   * Only works if every flex ancestor also carries `min-h-0`; without it the
   * panel silently outgrows the viewport instead of scrolling.
   */
  fill?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * The framed box a Home dashboard panel sits in.
 *
 * Scoped to `home/` rather than `shared/` on purpose: nothing else uses it, and
 * living in `shared/` would imply it is the app-wide card primitive.
 */
export function DashboardPanel({
  title,
  fill,
  children,
  className,
}: DashboardPanelProps) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border border-[var(--wui-border)] bg-[var(--wui-bg)] shadow-[var(--wui-shadow)]',
        fill ? 'h-full min-h-0' : '',
        className,
      )}
    >
      {title !== undefined && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--wui-border)] px-4 py-3">
          <span className="truncate text-[13px] font-semibold text-[var(--wui-fg)]">
            {title}
          </span>
        </div>
      )}
      <div
        className={fill ? 'flex min-h-0 flex-1 flex-col overflow-y-auto wui-scroll' : undefined}
      >
        {children}
      </div>
    </div>
  );
}

/** Grey shimmer bar shown inside a panel while its data loads. */
export function PanelSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-[wui-pulse_var(--wui-pulse-duration)_ease-in-out_infinite] rounded bg-[var(--wui-bg-muted)]',
        className,
      )}
    />
  );
}
