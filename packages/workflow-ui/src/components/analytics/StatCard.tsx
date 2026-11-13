import { cn } from '../shared/cn.js';

export interface StatCardProps {
  label: string;
  value: number;
  percent?: boolean;
  total?: number;
  color?: string;
  className?: string;
  active?: boolean;
  onClick?: () => void;
}

export function StatCard({ label, value, percent, total, color, className, active, onClick }: StatCardProps) {
  const display = total !== undefined
    ? `${value}/${total}`
    : percent
    ? `${value}%`
    : String(value);

  return (
    <div
      onClick={onClick}
      className={cn(
        'flex min-w-[110px] flex-1 flex-col gap-1.5 rounded-lg border px-4 py-3.5 transition-all duration-150',
        onClick ? 'cursor-pointer' : '',
        active ? 'border-[var(--wui-primary)]' : 'border-[var(--wui-border)]',
        className,
      )}
      style={{
        background: active
          ? 'var(--wui-primary-light, #eef2ff)'
          : 'var(--wui-bg, #ffffff)',
      }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--wui-fg-muted)]">
        {label}
      </span>
      <span
        className="text-2xl font-bold tabular-nums leading-none"
        style={{ color: color ?? 'var(--wui-fg)' }}
      >
        {display}
      </span>
    </div>
  );
}
