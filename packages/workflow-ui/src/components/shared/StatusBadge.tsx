import { cn } from './cn.js';

export type StatusVariant =
  | 'pending'
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'skipped'
  | 'cancelled';

const variantStyles: Record<StatusVariant, string> = {
  pending:   'bg-[var(--wui-status-pending)]/15 text-[var(--wui-status-pending)]',
  scheduled: 'bg-[var(--wui-status-scheduled)]/15 text-[var(--wui-status-scheduled)]',
  running:   'bg-[var(--wui-status-running)]/15 text-[var(--wui-status-running)]',
  completed: 'bg-[var(--wui-status-completed)]/15 text-[var(--wui-status-completed)]',
  failed:    'bg-[var(--wui-status-failed)]/15 text-[var(--wui-status-failed)]',
  paused:    'bg-[var(--wui-status-paused)]/15 text-[var(--wui-status-paused)]',
  skipped:   'bg-[var(--wui-status-skipped)]/15 text-[var(--wui-status-skipped)]',
  cancelled: 'bg-[var(--wui-status-failed)]/15 text-[var(--wui-status-failed)]',
};

const dotStyles: Record<StatusVariant, string> = {
  pending:   'bg-[var(--wui-status-pending)]',
  scheduled: 'bg-[var(--wui-status-scheduled)]',
  running:   'bg-[var(--wui-status-running)] animate-[wui-pulse_var(--wui-pulse-duration)_ease-in-out_infinite]',
  completed: 'bg-[var(--wui-status-completed)]',
  failed:    'bg-[var(--wui-status-failed)]',
  paused:    'bg-[var(--wui-status-paused)] animate-[wui-pulse_var(--wui-pulse-duration)_ease-in-out_infinite]',
  skipped:   'bg-[var(--wui-status-skipped)]',
  cancelled: 'bg-[var(--wui-status-failed)]',
};

export interface StatusBadgeProps {
  status: StatusVariant;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const displayLabel = label ?? status;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize',
        variantStyles[status],
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dotStyles[status])} />
      {displayLabel}
    </span>
  );
}
