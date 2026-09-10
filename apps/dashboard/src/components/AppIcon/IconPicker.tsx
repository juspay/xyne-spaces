/**
 * Lets the owner choose an app's icon from the Xyne set.
 *
 * The trigger IS the current icon: clicking the mark you want to change is
 * more discoverable than a separate "edit icon" affordance, and it costs no
 * space in headers that are already full. Search filters on the id and on the
 * Figma section it came from, so "chart" finds every chart and "time" finds
 * the clocks and timers.
 *
 * A dialog rather than a popover: with ~980 icons, browsing is the normal case
 * and searching the exception, so the surface has to be big enough to scan. A
 * popover is anchored to its trigger and therefore capped by whatever space
 * happens to be beside it — in the pane header that is a narrow column. The
 * dialog is centred and sized to the viewport, which fits roughly ten times as
 * many icons per screen.
 */

import { useMemo, useState, type ReactElement } from 'react';
import { ICON_META } from '@xyne/icons';
import { X } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { cn } from '../../utils/classNames';
import { AppIcon } from './AppIcon';

/**
 * Cap on rendered results. Nearly a thousand SVGs mounted at once is sluggish,
 * so the list is capped and the footer says how many are hidden. Higher than a
 * popover would need: the dialog shows far more per screen, and stopping the
 * scroll early in a browse-first surface is worse than a slightly longer list.
 */
const MAX_RESULTS = 400;

export const IconPicker = ({
  value,
  onChange,
  disabled = false,
  size = 16,
  className,
}: {
  value: string | null;
  onChange: (name: string | null) => void;
  disabled?: boolean;
  size?: number;
  className?: string;
}): ReactElement => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const { results, hidden } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = q
      ? ICON_META.filter(m => m.name.includes(q) || m.section.toLowerCase().includes(q))
      : ICON_META;
    return { results: all.slice(0, MAX_RESULTS), hidden: Math.max(0, all.length - MAX_RESULTS) };
  }, [query]);

  const pick = (name: string | null): void => {
    onChange(name);
    setOpen(false);
    setQuery('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      // Accessibility only — the Dialog renders these `hidden`, so the visible
      // header below is not a duplicate.
      title='Choose an icon'
      description='Search the Xyne icon set by name or category, then pick one.'
      // `max-w-*` as well as width: the base content class sets `max-w-md`, and
      // a width alone loses to it.
      className='w-[min(92vw,48rem)] max-w-[48rem]'
      trigger={
        <button
          type='button'
          disabled={disabled}
          aria-label={value ? `App icon: ${value}. Change icon` : 'Choose an app icon'}
          title={disabled ? undefined : 'Change icon'}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors',
            !disabled && 'hover:bg-accent hover:text-foreground',
            disabled && 'cursor-default',
            className,
          )}
          data-track-category='AskAI'
          data-track-name='ArtifactAppIconPickerOpen'
        >
          <AppIcon name={value} size={size} aria-hidden='true' />
        </button>
      }
    >
      {/* The Dialog supplies no padding or chrome — each caller renders its own. */}
      <div className='flex flex-col'>
        <div className='flex items-start justify-between gap-4 border-b border-border px-6 py-4'>
          <div className='flex flex-col gap-0.5'>
            <h2 className='text-base font-semibold text-foreground'>Choose an icon</h2>
            <p className='text-xs text-muted-foreground'>
              Shown in the sidebar and the app library.
            </p>
          </div>
          <button
            type='button'
            onClick={() => setOpen(false)}
            aria-label='Close'
            className='-mr-1 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            data-track-category='AskAI'
            data-track-name='ArtifactAppIconPickerClose'
          >
            <X className='h-4 w-4' aria-hidden='true' />
          </button>
        </div>

        <div className='flex flex-col gap-3 px-6 py-4'>
          <div className='flex items-center gap-2'>
            <Input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='Search icons…'
              aria-label='Search icons'
              className='flex-1'
            />
            {value && (
              <button
                type='button'
                onClick={() => pick(null)}
                className='flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                data-track-category='AskAI'
                data-track-name='ArtifactAppIconClear'
              >
                <X className='h-3.5 w-3.5' aria-hidden='true' />
                Remove
              </button>
            )}
          </div>

          <div
            role='listbox'
            aria-label='Icons'
            // Fixed height, not max-height: the grid must not resize as you
            // type, or the page jumps under the pointer on every keystroke.
            className='grid h-[min(58vh,28rem)] grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] content-start gap-1.5 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3'
          >
            {results.map(m => {
              const selected = m.name === value;
              return (
                <button
                  key={m.name}
                  type='button'
                  role='option'
                  aria-selected={selected}
                  title={m.name}
                  onClick={() => pick(m.name)}
                  className={cn(
                    'flex aspect-square w-full items-center justify-center rounded-lg transition-colors',
                    selected
                      ? 'bg-primary/15 text-primary ring-1 ring-primary/40'
                      : 'text-muted-foreground hover:bg-card hover:text-foreground hover:shadow-sm',
                  )}
                  data-track-category='AskAI'
                  data-track-name='ArtifactAppIconPick'
                >
                  <AppIcon name={m.name} size={20} aria-hidden='true' />
                </button>
              );
            })}
            {results.length === 0 && (
              <p className='col-span-full py-12 text-center text-sm text-muted-foreground'>
                No icons match “{query}”.
              </p>
            )}
          </div>

          <p className='text-[11px] text-muted-foreground'>
            {hidden > 0
              ? `Showing ${results.length} of ${results.length + hidden} — keep typing to narrow it down.`
              : `${results.length} ${results.length === 1 ? 'icon' : 'icons'}`}
          </p>
        </div>
      </div>
    </Dialog>
  );
};
