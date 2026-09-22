import { ReactElement, ReactNode, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Popover } from '../ui/Popover/Popover';
import { AppPickerDialog } from './AppPickerDialog';
import type { BarBuiltIn } from './useBarBuiltIns';
import {
  type BarItemsStore,
  setAppSnapshot,
  appItemId,
  appIdOf,
  MAX_APPS_PER_BAR,
} from '../../hooks/barItems';
import { cn } from '../../utils/classNames';

interface BarAddMenuProps {
  store: BarItemsStore;
  builtIns: readonly BarBuiltIn[];
  trackCategory: string;
  /** The "+" control. Defaults to a small ghost icon button. */
  trigger?: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

/**
 * The "+" at the end of a bar: built-ins not currently shown, then "Add app…".
 * Same store and same built-ins as the Preferences customizer, so the two
 * places can never disagree about what is available.
 */
export const BarAddMenu = ({
  store,
  builtIns,
  trackCategory,
  trigger,
  side = 'bottom',
  align = 'start',
}: BarAddMenuProps): ReactElement => {
  const ids = store.useItems();
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const available = useMemo(() => builtIns.filter(b => !ids.includes(b.id)), [builtIns, ids]);
  const addedAppIds = useMemo(
    () => new Set(ids.map(appIdOf).filter((id): id is string => id !== null)),
    [ids],
  );
  const appsFull = addedAppIds.size >= MAX_APPS_PER_BAR;

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        side={side}
        align={align}
        sideOffset={6}
        className='w-56 rounded-xl p-1.5'
        trigger={
          trigger ?? (
            <button
              type='button'
              aria-label='Add to this bar'
              className='flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              data-track-category={trackCategory}
              data-track-name='OpenBarAddMenu'
            >
              <Plus className='size-4' />
            </button>
          )
        }
      >
        <div className='flex flex-col gap-0.5'>
          {available.length === 0 ? (
            <p className='px-2 py-1.5 text-xs text-muted-foreground'>
              Everything is already shown.
            </p>
          ) : (
            available.map(item => (
              <button
                key={item.id}
                type='button'
                onClick={() => {
                  store.add(item.id);
                  setOpen(false);
                }}
                className='flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent'
                data-track-category={trackCategory}
                data-track-name='AddBarItem'
                data-track-metadata={JSON.stringify({ id: item.id })}
              >
                <span className='flex size-4 shrink-0 items-center justify-center text-muted-foreground'>
                  {item.icon}
                </span>
                <span className='truncate'>{item.label}</span>
              </button>
            ))
          )}
          <div className='my-1 border-t border-border' />
          <button
            type='button'
            disabled={appsFull}
            onClick={() => {
              setOpen(false);
              setPickerOpen(true);
            }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors',
              appsFull ? 'cursor-not-allowed opacity-50' : 'hover:bg-accent',
            )}
            title={appsFull ? `Up to ${MAX_APPS_PER_BAR} apps per bar` : undefined}
            data-track-category={trackCategory}
            data-track-name='OpenAppPicker'
          >
            <span className='flex size-4 shrink-0 items-center justify-center text-muted-foreground'>
              <Plus className='size-4' />
            </span>
            Add app…
          </button>
        </div>
      </Popover>

      <AppPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        addedAppIds={addedAppIds}
        isFull={appsFull}
        onPick={app => {
          setAppSnapshot(app.id, { title: app.title, icon: app.icon });
          store.add(appItemId(app.id));
        }}
        trackCategory={trackCategory}
      />
    </>
  );
};
