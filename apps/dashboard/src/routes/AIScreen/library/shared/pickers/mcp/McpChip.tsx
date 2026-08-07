import { type ReactElement } from 'react';
import { MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { McpIdentity } from './McpIdentity';

interface McpChipProps {
  label: string;
  iconType: string;
  selected: boolean;
  verified?: boolean;
  onToggle: () => void;
}

export function McpChip({
  label,
  iconType,
  selected,
  verified = false,
  onToggle,
}: McpChipProps): ReactElement {
  return (
    <button
      type='button'
      onClick={onToggle}
      title={`${selected ? 'Remove' : 'Add'} ${label}`}
      aria-label={`${selected ? 'Remove' : 'Add'} ${label}`}
      aria-pressed={selected}
      data-track-category='Claw Agents'
      data-track-name='Create agent v2: toggle MCP chip'
      className={cn(
        'flex shrink-0 items-center gap-1.5 overflow-hidden rounded-[10px] border-[0.8px] border-border py-1 pl-1 pr-2 transition-colors',
        selected
          ? 'border-solid bg-muted hover:bg-muted/70'
          : 'border-dashed bg-card hover:bg-muted/50',
      )}
    >
      <McpIdentity
        label={label}
        iconType={iconType}
        verified={verified}
        gap='tight'
        muted={!selected}
      />
      {selected ? (
        <MultipleCrossCancelDefault className='size-3 shrink-0 text-muted-foreground' aria-hidden />
      ) : (
        <PlusDefault className='size-3 shrink-0 text-muted-foreground' aria-hidden />
      )}
    </button>
  );
}
