/**
 * A compact icon picker: the whole Xyne set in a small scrolling grid anchored
 * to its trigger, for forms where the icon is one field among several (the
 * Create app dialog). The full-screen `IconPicker` is the browse-first version
 * of the same choice, used where the icon is the thing being edited.
 */

import { useMemo, useState, type ReactElement } from 'react';
import { ICON_META } from '@xyne/icons';
import { Popover } from '../ui/Popover';
import { cn } from '../../utils/classNames';
import { AppIcon } from './AppIcon';

export const IconPopoverPicker = ({
  value,
  onChange,
  subject = 'app',
  trackCategory = 'Apps',
  trackPrefix = 'CreateApp',
}: {
  value: string | null;
  onChange: (name: string) => void;
  /** What the icon belongs to, for the trigger's label. */
  subject?: string;
  trackCategory?: string;
  trackPrefix?: string;
}): ReactElement => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const names = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (
      q
        ? ICON_META.filter(m => m.name.includes(q) || m.section.toLowerCase().includes(q))
        : ICON_META
    ).map(m => m.name);
  }, [query]);

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      modal
      side='bottom'
      align='start'
      sideOffset={6}
      className='w-[22rem] p-0'
      trigger={
        <button
          type='button'
          aria-label={value ? `Icon: ${value}. Change icon` : `Choose an icon for this ${subject}`}
          className='flex size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
          data-track-category={trackCategory}
          data-track-name={`${trackPrefix}IconPickerOpen`}
        >
          <AppIcon name={value} size={18} aria-hidden='true' />
        </button>
      }
    >
      <div className='flex flex-col gap-2 p-3'>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-xs font-medium text-muted-foreground'>Icons</span>
          <span className='text-[11px] text-muted-foreground/70'>{names.length}</span>
        </div>
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder='Search icons…'
          aria-label='Search icons'
          data-track-category={trackCategory}
          data-track-name={`${trackPrefix}IconSearch`}
          className='h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
        />
        {names.length === 0 ? (
          <p className='py-6 text-center text-xs text-muted-foreground'>No icons match.</p>
        ) : (
          <div className='grid max-h-56 grid-cols-8 gap-1 overflow-y-auto pr-1'>
            {names.map(name => (
              <button
                key={name}
                type='button'
                title={name}
                aria-label={name}
                aria-pressed={name === value}
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                  setQuery('');
                }}
                className={cn(
                  'flex aspect-square items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-accent hover:text-foreground',
                  name === value &&
                    'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
                )}
                data-track-category={trackCategory}
                data-track-name={`${trackPrefix}IconPick`}
              >
                <AppIcon name={name} size={16} aria-hidden='true' />
              </button>
            ))}
          </div>
        )}
      </div>
    </Popover>
  );
};
