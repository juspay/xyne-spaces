import type { ReactElement } from 'react';

/** label · value · note. Proportional figures: tabular-nums would space a big number loosely. */
export const StatTile = ({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}): ReactElement => (
  <div className='flex flex-col gap-1 rounded-2xl border border-border bg-background p-4'>
    <span className='text-xs text-muted-foreground'>{label}</span>
    <span className='text-2xl font-semibold leading-8 text-foreground'>{value}</span>
    <span className='truncate text-xs text-muted-foreground'>{note}</span>
  </div>
);
