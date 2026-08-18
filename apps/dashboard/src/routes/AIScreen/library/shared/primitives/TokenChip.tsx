import { type ReactElement, type ReactNode } from 'react';

export function ChipIconTile({ children }: { children: ReactNode }): ReactElement {
  return (
    <span
      className='flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card text-muted-foreground shadow-sm'
      aria-hidden
    >
      {children}
    </span>
  );
}

interface TokenChipProps {
  icon: ReactNode;
  label: string;
  secondary?: string;
}

export function TokenChip({ icon, label, secondary }: TokenChipProps): ReactElement {
  return (
    <span
      title={secondary ? `${label} · ${secondary}` : label}
      className='flex shrink-0 items-center gap-1.5 overflow-hidden rounded-[10px] border-[0.8px] border-border bg-muted py-1 pl-1 pr-2'
    >
      {icon}
      <span className='max-w-[220px] truncate text-sm font-semibold leading-5 text-foreground'>
        {label}
      </span>
      {secondary && (
        <span className='max-w-[200px] truncate text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
          {secondary}
        </span>
      )}
    </span>
  );
}
