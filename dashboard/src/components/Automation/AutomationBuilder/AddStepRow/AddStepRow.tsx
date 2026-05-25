import { useEffect, useMemo, useRef, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import { Plus, Search, Zap, type LucideIcon } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { Popover } from '../../../ui/Popover/Popover';
import type { StepCatalogItem } from '../../Automation.types';
import type { AddStepRowProps } from './AddStepRow.types';

export function AddStepRow({
  catalog,
  onPick,
  variant = 'full',
}: AddStepRowProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const groups = useMemo(() => {
    const lower = query.trim().toLowerCase();
    const filtered = lower
      ? catalog.filter(
          item =>
            item.name.toLowerCase().includes(lower) ||
            item.description?.toLowerCase().includes(lower) ||
            item.type.toLowerCase().includes(lower),
        )
      : catalog;
    return groupByCategory(filtered);
  }, [catalog, query]);

  const totalAfterFilter = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <div
      data-slot='automation-add-step'
      className={cn('flex flex-col items-center', variant === 'full' ? 'py-1' : 'py-0.5')}
    >
      <div className={cn('w-px bg-border', variant === 'full' ? 'h-3' : 'h-2')} />
      <Popover
        open={open}
        onOpenChange={(o): void => {
          setOpen(o);
          if (!o) setQuery('');
        }}
        align='center'
        side='bottom'
        sideOffset={4}
        className='w-[340px] max-h-[440px] overflow-hidden rounded-xl p-0 flex flex-col'
        trigger={
          <button
            type='button'
            aria-label='Add step'
            aria-haspopup='listbox'
            aria-expanded={open}
            data-track-category='automation-builder'
            data-track-name='add-step-open'
            className={cn(
              'flex items-center justify-center rounded-full border border-border bg-background',
              'text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
              variant === 'full' ? 'size-8' : 'size-6',
            )}
          >
            <Plus className={variant === 'full' ? 'size-4' : 'size-3'} aria-hidden='true' />
          </button>
        }
      >
        <div className='flex items-center gap-2 border-b border-border px-3 py-2'>
          <Search className='size-4 flex-shrink-0 text-muted-foreground' aria-hidden='true' />
          <input
            ref={searchRef}
            type='search'
            aria-label='Search steps'
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder='Search steps…'
            data-track-category='automation-builder'
            data-track-name='add-step-search'
            className='flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
          />
        </div>
        <div className='flex-1 overflow-y-auto py-1'>
          {catalog.length === 0 ? (
            <div className='px-3 py-6 text-center text-xs text-muted-foreground'>
              No step types registered yet.
            </div>
          ) : totalAfterFilter === 0 ? (
            <div className='px-3 py-6 text-center text-xs text-muted-foreground'>
              No steps match your search.
            </div>
          ) : (
            groups.map(group => (
              <div key={group.category} className='py-0.5'>
                <div className='px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
                  {group.category}
                </div>
                {group.items.map(item => (
                  <button
                    key={item.type}
                    type='button'
                    data-track-category='automation-builder'
                    data-track-name={`add-step-pick-${item.type}`}
                    onClick={() => {
                      onPick(item.type);
                      setOpen(false);
                      setQuery('');
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
                      'hover:bg-accent/40',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-6 flex-shrink-0 items-center justify-center rounded-md',
                        'bg-accent/40 text-foreground',
                      )}
                    >
                      <ResolveIcon name={item.icon} className='size-3' />
                    </span>
                    <span className='flex flex-1 flex-col min-w-0'>
                      <span className='truncate text-sm text-foreground'>{item.name}</span>
                      {item.description && (
                        <span className='line-clamp-1 text-[11px] text-muted-foreground'>
                          {item.description}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </Popover>
      <div className={cn('w-px bg-border', variant === 'full' ? 'h-3' : 'h-2')} />
    </div>
  );
}

function groupByCategory(
  catalog: StepCatalogItem[],
): { category: string; items: StepCatalogItem[] }[] {
  const map = new Map<string, StepCatalogItem[]>();
  for (const item of catalog) {
    const list = map.get(item.category) ?? [];
    list.push(item);
    map.set(item.category, list);
  }
  return Array.from(map.entries())
    .map(([category, items]) => ({
      category,
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

function ResolveIcon({
  name,
  className,
}: {
  name: string | undefined;
  className?: string;
}): React.ReactElement {
  const Icon = name
    ? (LucideIcons as unknown as Record<string, LucideIcon | undefined>)[name]
    : undefined;
  const Component: LucideIcon = Icon ?? Zap;
  return <Component className={className} />;
}
