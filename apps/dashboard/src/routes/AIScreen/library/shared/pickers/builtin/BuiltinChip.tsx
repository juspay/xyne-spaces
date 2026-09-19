import { type ReactElement } from 'react';
import { MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';

interface BuiltinChipProps {
  label: string;
  selected: boolean;
  onToggle: () => void;
}

export function BuiltinChip({ label, selected, onToggle }: BuiltinChipProps): ReactElement {
  return (
    <button
      type='button'
      onClick={onToggle}
      title={`${selected ? 'Remove' : 'Add'} ${label}`}
      aria-label={`${selected ? 'Remove' : 'Add'} ${label}`}
      aria-pressed={selected}
      data-track-category='Claw Agents'
      data-track-name='Create agent v2: toggle built-in chip'
      className={cn(
        'flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-[10px] border-[0.8px] border-border px-2 transition-colors',
        selected
          ? 'border-solid bg-muted hover:bg-muted/70'
          : 'border-dashed bg-card hover:bg-muted/50',
      )}
    >
      <span
        className={cn(
          'max-w-[200px] truncate text-sm font-medium leading-5',
          selected ? 'text-foreground' : 'text-foreground/80',
        )}
      >
        {label}
      </span>
      {selected ? (
        <MultipleCrossCancelDefault className='size-3 shrink-0 text-muted-foreground' aria-hidden />
      ) : (
        <PlusDefault className='size-3 shrink-0 text-muted-foreground' aria-hidden />
      )}
    </button>
  );
}
