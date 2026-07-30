import { type ReactElement, type ReactNode } from 'react';
import { cn } from '@/utils/classNames';

export type PillTone = 'success' | 'warning' | 'danger' | 'neutral';

const TONE: Record<PillTone, string> = {
  success:
    'border-[color-mix(in_srgb,var(--status-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--status-success)_12%,transparent)] text-status-success',
  warning:
    'border-[color-mix(in_srgb,var(--status-pending)_30%,transparent)] bg-[color-mix(in_srgb,var(--status-pending)_12%,transparent)] text-status-pending',
  danger:
    'border-[color-mix(in_srgb,var(--status-failure)_30%,transparent)] bg-[color-mix(in_srgb,var(--status-failure)_12%,transparent)] text-status-failure',
  neutral: 'border-border bg-muted text-muted-foreground',
};

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }): ReactElement {
  return (
    <span
      className={cn(
        'flex h-5 shrink-0 items-center rounded-md border-[0.8px] px-[5px] text-xs leading-4 tracking-[-0.24px]',
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}
