import { ReactElement, useMemo, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ChevronRight, PlusDefault as Plus, SearchDefault as Search } from '@xyne/icons';
import { cn } from '../../../utils/classNames';
import type { FilterFieldDef } from './filterChips';

interface AddFilterChipProps {
  fields: FilterFieldDef[];
  inUse: Map<string, string>;
  onPick: (field: FilterFieldDef) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const AddFilterChip = ({
  fields,
  inUse,
  onPick,
  open,
  onOpenChange,
}: AddFilterChipProps): ReactElement => {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? fields.filter(f => f.label.toLowerCase().includes(q)) : fields;
  }, [fields, query]);

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={next => {
        onOpenChange(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type='button'
          className='group inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-[9px] border border-dashed border-border bg-background px-[10px] text-[12px] font-medium text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:bg-muted hover:text-foreground'
          data-testid='more-filters-btn'
          data-track-category='Tickets'
          data-track-name='OpenAddFilter'
        >
          <Plus className='size-3' />
          Filter
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side='bottom'
          align='start'
          sideOffset={6}
          onCloseAutoFocus={e => e.preventDefault()}
          className='z-[60] w-[262px] overflow-hidden rounded-[9px] border border-border bg-background shadow-[0_16px_44px_rgba(20,22,26,0.18)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1'
        >
          <div className='flex h-[42px] items-center gap-2.5 border-b border-border/60 px-[13px]'>
            <Search className='size-[17px] shrink-0 text-muted-foreground/80' />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='Filter by…'
              className='min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground/60'
              data-track-category='Tickets'
              data-track-name='SearchFilterFields'
            />
          </div>
          <div className='max-h-[306px] overflow-y-auto py-1'>
            {shown.length === 0 ? (
              <div className='px-[14px] py-3 text-[12px] text-muted-foreground'>
                No field matches
              </div>
            ) : (
              shown.map(field => {
                const Icon = field.icon;
                const summary = inUse.get(field.id);
                return (
                  <button
                    key={field.id}
                    type='button'
                    onClick={() => onPick(field)}
                    className={cn(
                      'flex h-[38px] w-full items-center gap-2.5 px-[14px] text-left text-[13.5px] text-foreground transition-colors hover:bg-muted/60',
                      summary !== undefined && 'opacity-55',
                    )}
                    data-track-category='Tickets'
                    data-track-name={field.trackName ?? 'OpenFilterSubmenu'}
                    data-track-metadata={JSON.stringify({
                      filterId: field.id,
                      filterLabel: field.label,
                    })}
                    data-testid={`filter-menu-${field.id}`}
                  >
                    <Icon className='size-[17px] shrink-0 text-muted-foreground' />
                    <span className='min-w-0 flex-1 truncate'>{field.label}</span>
                    {summary !== undefined && (
                      <span className='max-w-[110px] truncate text-[11px] text-muted-foreground/70'>
                        {summary}
                      </span>
                    )}
                    <ChevronRight className='size-3 shrink-0 text-muted-foreground/50' />
                  </button>
                );
              })
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
};
