import React from 'react';
import { cn } from '../../../utils/classNames';

const baseChipClass =
  'relative inline-flex h-[27px] shrink-0 items-center gap-2 rounded-full border text-[12.5px] font-medium whitespace-nowrap ' +
  'transition-[border-color,box-shadow,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]';

const chipToneClass = (dashed: boolean): string =>
  dashed
    ? 'border-dashed border-muted-foreground/40 bg-transparent text-muted-foreground'
    : 'border-border bg-background text-foreground';

const chipHoverClass =
  'cursor-pointer hover:border-muted-foreground/60 hover:shadow-[0_1px_3px_rgba(20,22,26,0.06)] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ' +
  'focus-visible:ring-offset-background active:scale-[0.97] motion-reduce:active:scale-100';

/** Non-interactive pill shell. Use when the chip wraps its own control (a selector, a menu trigger). */
export const DetailChip = ({
  children,
  className,
  dashed = false,
  hoverable = false,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  dashed?: boolean;
  hoverable?: boolean;
} & React.HTMLAttributes<HTMLDivElement>): React.ReactElement => (
  <div
    className={cn(
      baseChipClass,
      'px-[11px]',
      chipToneClass(dashed),
      hoverable && 'hover:border-muted-foreground/60 hover:shadow-[0_1px_3px_rgba(20,22,26,0.06)]',
      className,
    )}
    {...rest}
  >
    {children}
  </div>
);

/** Interactive pill. A real button: keyboard, focus ring, press feedback. */
export const DetailChipButton = ({
  children,
  className,
  dashed = false,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  dashed?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>): React.ReactElement => (
  <button
    type='button'
    className={cn(baseChipClass, 'px-[11px]', chipToneClass(dashed), chipHoverClass, className)}
    {...rest}
  >
    {children}
  </button>
);

export const DetailChipLabel = ({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement => (
  <span className='text-[11.5px] font-normal text-muted-foreground/80'>{children}</span>
);

export const DetailChipMarker = ({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'danger' | 'warning' | 'accent';
}): React.ReactElement => (
  <span
    className={cn(
      'inline-flex h-4 shrink-0 items-center rounded-[5px] border px-[5px] text-[9.5px] font-semibold tabular-nums',
      tone === 'danger' && 'border-destructive/25 bg-destructive/10 text-destructive',
      tone === 'warning' &&
        'border-amber-500/30 bg-amber-500/10 text-amber-700 [[data-theme=midnight]_&]:text-amber-400',
      tone === 'accent' && 'border-border bg-background text-foreground',
      tone === 'neutral' && 'border-border bg-muted text-muted-foreground',
    )}
  >
    {children}
  </span>
);
