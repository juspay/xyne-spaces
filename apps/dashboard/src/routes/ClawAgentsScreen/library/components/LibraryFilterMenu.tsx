import { useState, type ReactElement } from 'react';
import { FilterLines } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Popover } from '@/components/ui/Popover';

export interface LibraryFilterOption {
  id: string;
  label: string;
  count: number;
}

export function LibraryFilterMenu({
  title,
  options,
  activeId,
  onSelect,
  trackName,
}: {
  title: string;
  options: LibraryFilterOption[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  trackName: string;
}): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align='end'
      sideOffset={6}
      trigger={
        <button
          type='button'
          aria-label={`Filter by ${title.toLowerCase()}`}
          className={cn(
            'flex size-7 items-center justify-center rounded-[10px] transition-colors hover:bg-muted',
            open || activeId ? 'bg-muted text-foreground' : 'text-muted-foreground',
          )}
          data-track-category='Claw Agents'
          data-track-name={trackName}
        >
          <FilterLines className='size-4' />
        </button>
      }
      className='w-56 rounded-lg border border-border bg-popover p-1 shadow-lg'
    >
      <div className='flex flex-col'>
        <span className='px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
          {title}
        </span>
        {options.map(option => {
          const isActive = option.id === activeId || (option.id === 'all' && !activeId);
          return (
            <button
              key={option.id}
              type='button'
              onClick={() => {
                onSelect(option.id === 'all' || isActive ? null : option.id);
                setOpen(false);
              }}
              data-track-category='Claw Agents'
              data-track-name={`${trackName}: ${option.label}`}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                isActive
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span className='truncate'>{option.label}</span>
              <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                {option.count}
              </span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
