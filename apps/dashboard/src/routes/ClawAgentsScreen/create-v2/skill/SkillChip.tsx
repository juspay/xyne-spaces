import { type ReactElement } from 'react';
import { MultipleCrossCancelDefault, Notebook, PlusDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import type { SkillScope } from './skillCatalog';

interface SkillChipProps {
  label: string;
  scope: SkillScope;
  selected: boolean;
  onToggle: () => void;
}

export function SkillChip({ label, scope, selected, onToggle }: SkillChipProps): ReactElement {
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
        'flex shrink-0 items-center gap-1.5 overflow-hidden rounded-[10px] border-[0.8px] border-border py-1 pl-1 pr-2 transition-colors',
        selected
          ? 'border-solid bg-muted hover:bg-muted/70'
          : 'border-dashed bg-card hover:bg-muted/50',
      )}
    >
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-lg border',
          scope === 'global'
            ? 'border-border bg-muted text-muted-foreground'
            : 'border-primary/20 bg-primary/10 text-primary',
        )}
      >
        <Notebook className='size-4' aria-hidden />
      </span>
      <span
        className={cn(
          'max-w-[200px] truncate text-sm font-semibold leading-5',
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
