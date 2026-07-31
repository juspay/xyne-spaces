import { type ReactElement, type ReactNode } from 'react';
import { cn } from '@/utils/classNames';

export type PillTone = 'success' | 'warning' | 'danger' | 'neutral';
export type PillSize = 'sm' | 'md';

interface ToneStyle {
  surface: string;
  border: string;
  text: string;
}

const TONE: Record<PillTone, ToneStyle> = {
  success: {
    surface: 'bg-[color-mix(in_srgb,var(--status-success)_12%,transparent)]',
    border: 'border-[0.8px] border-[color-mix(in_srgb,var(--status-success)_30%,transparent)]',
    text: 'text-status-success',
  },
  warning: {
    surface: 'bg-[color-mix(in_srgb,var(--status-pending)_12%,transparent)]',
    border: 'border-[0.8px] border-[color-mix(in_srgb,var(--status-pending)_30%,transparent)]',
    text: 'text-status-pending',
  },
  danger: {
    surface: 'bg-[color-mix(in_srgb,var(--status-failure)_12%,transparent)]',
    border: 'border-[0.8px] border-[color-mix(in_srgb,var(--status-failure)_30%,transparent)]',
    text: 'text-status-failure',
  },
  neutral: {
    surface: 'bg-muted',
    border: 'border-[0.8px] border-border',
    text: 'text-muted-foreground',
  },
};

const SIZE: Record<PillSize, string> = {
  sm: 'h-4 rounded-full px-1.5 text-[10px] font-medium leading-4 tracking-[0.02em]',
  md: 'h-5 rounded-md px-[5px] text-xs leading-4 tracking-[-0.24px]',
};

export function Pill({
  tone,
  size = 'md',
  children,
}: {
  tone: PillTone;
  size?: PillSize;
  children: ReactNode;
}): ReactElement {
  const style = TONE[tone];
  return (
    <span
      className={cn(
        'flex shrink-0 items-center',
        SIZE[size],
        style.surface,
        style.text,
        size === 'md' && style.border,
      )}
    >
      {children}
    </span>
  );
}
