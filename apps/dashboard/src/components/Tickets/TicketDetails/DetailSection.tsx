import React, { useState } from 'react';
import { ChevronRight, LockClose as Lock } from '@xyne/icons';
import { cn } from '../../../utils/classNames';

export const DetailSectionGate = ({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement => (
  <span className='inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-orange-500/30 bg-orange-500/[0.07] px-2 text-[10.5px] font-semibold text-orange-700 [[data-theme=midnight]_&]:text-orange-400'>
    <span className='h-[5px] w-[5px] shrink-0 rounded-full bg-orange-500' />
    {children}
  </span>
);

export const DetailRowGate = ({ children }: { children: React.ReactNode }): React.ReactElement => (
  <span className='inline-flex h-[19px] shrink-0 items-center rounded-[5px] border border-orange-500/30 bg-orange-500/[0.07] px-[7px] text-[10px] font-semibold text-orange-700 [[data-theme=midnight]_&]:text-orange-400'>
    {children}
  </span>
);

export const DetailToggle = ({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  title?: string;
}): React.ReactElement => (
  <button
    type='button'
    role='switch'
    aria-checked={checked}
    aria-label={label}
    title={title ?? label}
    onClick={() => onChange(!checked)}
    data-track-category='Tickets'
    data-track-name='ToggleDetailOption'
    data-track-metadata={JSON.stringify({ option: label })}
    className='flex h-[26px] shrink-0 items-center gap-2 rounded-lg px-1.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  >
    <span className='whitespace-nowrap'>{label}</span>
    <span
      className={cn(
        'relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150',
        checked ? 'bg-foreground' : 'bg-border',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-3 w-3 rounded-full bg-background shadow-[0_1px_2px_rgba(20,22,26,0.25)] transition-[left] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]',
          checked ? 'left-[14px]' : 'left-0.5',
        )}
      />
    </span>
  </button>
);

export const DetailSection = ({
  title,
  count,
  summary,
  badge,
  actions,
  defaultOpen = true,
  className,
  children,
}: {
  title: string;
  count?: number;
  summary?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn('pt-6', className)}>
      <div className='flex h-[34px] items-center gap-[9px]'>
        <button
          type='button'
          onClick={() => setOpen(prev => !prev)}
          className='flex min-w-0 items-center gap-[9px] rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          aria-expanded={open}
          data-track-category='Tickets'
          data-track-name='ToggleDetailSection'
          data-track-metadata={JSON.stringify({ section: title })}
        >
          <ChevronRight
            size={12}
            className={cn(
              'w-3 shrink-0 text-muted-foreground/70 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]',
              open && 'rotate-90',
            )}
          />
          <span className='text-[11px] font-semibold uppercase tracking-[0.45px] text-muted-foreground'>
            {title}
          </span>
          {count !== undefined && (
            <span className='font-mono text-[11px] tabular-nums text-muted-foreground/70'>
              {count}
            </span>
          )}
          {summary && (
            <span className='whitespace-nowrap text-[11px] text-muted-foreground/70'>
              {summary}
            </span>
          )}
        </button>
        {badge}
        <div className='h-px flex-1 bg-border/60' />
        {actions}
      </div>
      {open && children}
    </div>
  );
};

export const DetailFieldRow = ({
  label,
  locked = false,
  gate,
  note,
  children,
}: {
  label: string;
  locked?: boolean;
  gate?: React.ReactNode;
  note?: string;
  children: React.ReactNode;
}): React.ReactElement => (
  <div className='grid min-h-[36px] grid-cols-[186px_1fr] items-center gap-[14px] rounded-lg py-[5px] pr-[10px] transition-colors hover:bg-muted/40'>
    <div className='flex items-center gap-1.5 text-[13px] text-muted-foreground'>
      <span className='truncate' title={label}>
        {label}
      </span>
      {locked && <Lock size={11} className='shrink-0 text-muted-foreground/70' />}
    </div>
    <div className='flex min-w-0 items-center gap-2'>
      {children}
      {gate}
      {note && <span className='text-[11.5px] text-muted-foreground/70'>{note}</span>}
    </div>
  </div>
);
