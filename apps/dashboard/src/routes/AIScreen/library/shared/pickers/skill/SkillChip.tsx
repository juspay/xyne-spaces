import { type ReactElement } from 'react';
import { MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';

interface SkillChipProps {
  label: string;
  selected: boolean;
  onToggle: () => void;
}

export function SkillChip({ label, selected, onToggle }: SkillChipProps): ReactElement {
  return (
    <button
      type='button'
      onClick={onToggle}
      title={`${selected ? 'Remove' : 'Add'} ${label}`}
      aria-label={`${selected ? 'Remove' : 'Add'} ${label}`}
      aria-pressed={selected}
      data-track-category='Claw Agents'
      data-track-name='Create agent v2: toggle skill chip'
      className={cn(
        'flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-[10px] border-[0.8px] border-xyne-border px-2 transition-colors',
        selected
          ? 'border-solid bg-xyne-surface-sunken hover:bg-xyne-surface-subtle'
          : 'border-dashed bg-xyne-surface hover:bg-xyne-surface-subtle',
      )}
    >
      <span
        className={cn(
          'max-w-[200px] truncate text-sm font-medium leading-5',
          selected ? 'text-xyne-fg-primary' : 'text-xyne-fg-secondary',
        )}
      >
        {label}
      </span>
      {selected ? (
        <MultipleCrossCancelDefault className='size-3 shrink-0 text-xyne-fg-muted' aria-hidden />
      ) : (
        <PlusDefault className='size-3 shrink-0 text-xyne-fg-muted' aria-hidden />
      )}
    </button>
  );
}
