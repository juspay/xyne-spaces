import { cn } from '../shared/cn.js';

export interface RunsFiltersProps {
  statusFilter: string;
  onStatusChange: (status: string) => void;
  className?: string | undefined;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function RunsFilters({
  statusFilter,
  onStatusChange,
  className,
}: RunsFiltersProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-[var(--wui-border)] px-4 py-2',
        className,
      )}
    >
      <label className="text-xs font-medium text-[var(--wui-fg-muted)]">Status</label>
      <select
        value={statusFilter}
        onChange={(e) => onStatusChange(e.target.value)}
        className={cn(
          'rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1 text-sm',
          'text-[var(--wui-fg)] outline-none',
          'focus:border-[var(--wui-primary)] focus:ring-1 focus:ring-[color-mix(in_srgb,var(--wui-primary)_22%,transparent)]',
        )}
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
