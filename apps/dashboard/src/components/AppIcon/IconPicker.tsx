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

import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
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
  subject = 'app',
  hint = 'Shown in the sidebar and the app library.',
  placeholder,
  trackCategory = 'AskAI',
  trackPrefix = 'ArtifactApp',
  groups,
  open: openProp,
  onOpenChange,
}: {
  value: string | null;
  onChange: (name: string | null) => void;
  disabled?: boolean;
  size?: number;
  className?: string;
  /** What the icon belongs to, for the trigger's label: "app", "track". */
  subject?: string;
  /** The line under the dialog's title: where the icon will show. */
  hint?: string;
  /** What the trigger shows while no icon is chosen; the fallback mark by default. */
  placeholder?: ReactNode;
  trackCategory?: string;
  /** Prefixes the tracking names, e.g. `${prefix}IconPick`. */
  trackPrefix?: string;
  /**
   * A chosen set, shown under its headings, in place of the whole icon set — for
   * a caller whose icons should come from a few relevant themes. Search narrows
   * within it; names the set doesn't have are left out.
   */
  groups?: ReadonlyArray<{ label: string; names: readonly string[] }>;
  /**
   * Opened from elsewhere, such as a menu, rather than by its own button — which is
   * then left out. Leave unset for the button.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}): ReactElement => {
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : ownOpen;
  const setOpen = (next: boolean): void => {
    if (controlled) onOpenChange?.(next);
    else setOwnOpen(next);
  };
  const [query, setQuery] = useState('');

  const { sections, shown, hidden } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (groups) {
      const known = new Set(ICON_META.map(m => m.name));
      const found = groups
        .map(group => ({
          label: group.label as string | null,
          names: group.names.filter(
            name =>
              known.has(name) && (!q || name.includes(q) || group.label.toLowerCase().includes(q)),
          ),
        }))
        .filter(group => group.names.length > 0);
      return {
        sections: found,
        shown: found.reduce((total, group) => total + group.names.length, 0),
        hidden: 0,
      };
    }
    const all = q
      ? ICON_META.filter(m => m.name.includes(q) || m.section.toLowerCase().includes(q))
      : ICON_META;
    const names = all.slice(0, MAX_RESULTS).map(m => m.name);
    return {
      sections: [{ label: null as string | null, names }],
      shown: names.length,
      hidden: Math.max(0, all.length - MAX_RESULTS),
    };
  }, [query, groups]);

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
      {...(!controlled && {
        trigger: (
          <button
            type='button'
            disabled={disabled}
            aria-label={
              value
                ? `${subject.charAt(0).toUpperCase()}${subject.slice(1)} icon: ${value}. Change icon`
                : `Choose an icon for this ${subject}`
            }
            title={disabled ? undefined : 'Change icon'}
            className={cn(
              'flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors',
              !disabled && 'hover:bg-accent hover:text-foreground',
              disabled && 'cursor-default',
              className,
            )}
            data-track-category={trackCategory}
            data-track-name={`${trackPrefix}IconPickerOpen`}
          >
            {value === null && placeholder !== undefined ? (
              placeholder
            ) : (
              <AppIcon name={value} size={size} aria-hidden='true' />
            )}
          </button>
        ),
      })}
    >
      {/* The Dialog supplies no padding or chrome — each caller renders its own. */}
      <div className='flex flex-col'>
        <div className='flex items-start justify-between gap-4 border-b border-border px-6 py-4'>
          <div className='flex flex-col gap-0.5'>
            <h2 className='text-base font-semibold text-foreground'>Choose an icon</h2>
            <p className='text-xs text-muted-foreground'>{hint}</p>
          </div>
          <button
            type='button'
            onClick={() => setOpen(false)}
            aria-label='Close'
            className='-mr-1 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            data-track-category={trackCategory}
            data-track-name={`${trackPrefix}IconPickerClose`}
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
                data-track-category={trackCategory}
                data-track-name={`${trackPrefix}IconClear`}
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
            className='h-[min(58vh,28rem)] overflow-y-auto rounded-lg border border-border bg-muted/30 p-3'
          >
            {sections.map(section => (
              <div
                key={section.label ?? 'all'}
                role='group'
                {...(section.label && { 'aria-label': section.label })}
                className='mb-3 last:mb-0'
              >
                {section.label && (
                  <p className='px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                    {section.label}
                  </p>
                )}
                <div className='grid grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-1.5'>
                  {section.names.map(name => {
                    const selected = name === value;
                    return (
                      <button
                        key={name}
                        type='button'
                        role='option'
                        aria-selected={selected}
                        title={name}
                        onClick={() => pick(name)}
                        className={cn(
                          'flex aspect-square w-full items-center justify-center rounded-lg transition-colors',
                          selected
                            ? 'bg-primary/15 text-primary ring-1 ring-primary/40'
                            : 'text-muted-foreground hover:bg-card hover:text-foreground hover:shadow-sm',
                        )}
                        data-track-category={trackCategory}
                        data-track-name={`${trackPrefix}IconPick`}
                      >
                        <AppIcon name={name} size={20} aria-hidden='true' />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {shown === 0 && (
              <p className='py-12 text-center text-sm text-muted-foreground'>
                No icons match “{query}”.
              </p>
            )}
          </div>

          <p className='text-[11px] text-muted-foreground'>
            {hidden > 0
              ? `Showing ${shown} of ${shown + hidden} — keep typing to narrow it down.`
              : `${shown} ${shown === 1 ? 'icon' : 'icons'}`}
          </p>
        </div>
      </div>
    </Dialog>
  );
};
