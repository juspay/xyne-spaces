import { type ReactElement, type ReactNode } from 'react';
import { MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';

interface CapabilityChipProps {
  label: string;
  selected: boolean;
  content?: ReactNode;
  onOpen?: () => void;
  onToggle: () => void;
  shellClassName?: string;
  trackName: string;
}

export function CapabilityChip({
  label,
  selected,
  content,
  onOpen,
  onToggle,
  shellClassName,
  trackName,
}: CapabilityChipProps): ReactElement {
  const shell = cn(
    'flex shrink-0 items-center gap-1.5 overflow-hidden rounded-[10px] border-[0.8px] border-border transition-colors',
    shellClassName ?? 'h-7 px-2',
    selected
      ? 'border-solid bg-muted hover:bg-muted/70'
      : 'border-dashed bg-card hover:bg-muted/50',
  );

  const body = content ?? (
    <span
      className={cn(
        'max-w-[200px] truncate text-sm font-medium leading-5',
        selected ? 'text-foreground' : 'text-foreground/80',
      )}
    >
      {label}
    </span>
  );

  if (!selected || !onOpen) {
    return (
      <button
        type='button'
        onClick={onToggle}
        title={`${selected ? 'Remove' : 'Add'} ${label}`}
        aria-label={`${selected ? 'Remove' : 'Add'} ${label}`}
        aria-pressed={selected}
        data-track-category='Claw Agents'
        data-track-name={trackName}
        className={shell}
      >
        {body}
        {selected ? (
          <MultipleCrossCancelDefault
            className='size-3 shrink-0 text-muted-foreground'
            aria-hidden
          />
        ) : (
          <PlusDefault className='size-3 shrink-0 text-muted-foreground' aria-hidden />
        )}
      </button>
    );
  }

  return (
    <span className={shell}>
      <button
        type='button'
        onClick={onOpen}
        title={`Open ${label}`}
        aria-label={`Open ${label}`}
        data-track-category='Claw Agents'
        data-track-name={`${trackName} (open)`}
        className='flex min-w-0 items-center rounded-md'
      >
        {body}
      </button>
      <button
        type='button'
        onClick={onToggle}
        title={`Remove ${label}`}
        aria-label={`Remove ${label}`}
        data-track-category='Claw Agents'
        data-track-name={`${trackName} (remove)`}
        className='flex shrink-0 items-center rounded-md text-muted-foreground transition-colors hover:text-foreground'
      >
        <MultipleCrossCancelDefault className='size-3 shrink-0' aria-hidden />
      </button>
    </span>
  );
}
