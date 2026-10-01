/**
 * Switching hubs by search, in the style of the app's ⌘K menu: type to narrow by hub
 * name, ↑/↓ to move, ↵ to open. Opened from the sidebar's hub title or
 * with ⌘J; global ⌘K search is left alone.
 */
import type { ReactElement } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command, defaultFilter } from 'cmdk';
import { Check, Hash, Lock, Plus, Search } from 'lucide-react';
import type { SdlcHubOption } from './SdlcHubSidebar';

const ITEM_CLASS =
  'flex h-10 cursor-pointer select-none items-center gap-3 rounded-lg px-3 text-foreground aria-selected:bg-accent';

function Key(props: { children: string }): ReactElement {
  return (
    <kbd className='rounded border border-border bg-muted px-1.5 py-px font-sans text-[11px] text-muted-foreground'>
      {props.children}
    </kbd>
  );
}

export function SdlcHubSwitcher(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hubs: SdlcHubOption[];
  currentHubId: string;
  onSelect: (hubId: string) => void;
  onNewHub: () => void;
}): ReactElement {
  // The hub you're in leads; the rest keep their order.
  const hubs = [
    ...props.hubs.filter(hub => hub.id === props.currentHubId),
    ...props.hubs.filter(hub => hub.id !== props.currentHubId),
  ];

  const choose = (hubId: string): void => {
    props.onOpenChange(false);
    if (hubId !== props.currentHubId) props.onSelect(hubId);
  };

  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className='fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0' />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className='fixed inset-x-0 top-[14vh] z-50 mx-auto w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl duration-100 focus:outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
        >
          <DialogPrimitive.Title className='sr-only'>Switch hub</DialogPrimitive.Title>
          {/* Scored on the hub's name alone: its value is its id, which is noise to search. */}
          <Command
            label='Switch hub'
            loop
            filter={(_value, search, keywords) => defaultFilter('', search, keywords)}
          >
            <div className='flex items-center gap-2.5 border-b border-border px-4'>
              <Search className='size-4 shrink-0 text-muted-foreground' />
              <Command.Input
                autoFocus
                placeholder='Search hubs…'
                className='h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground'
                data-track-category='SdlcHub'
                data-track-name='HubSwitcherSearched'
              />
              <button
                type='button'
                onClick={() => {
                  props.onOpenChange(false);
                  props.onNewHub();
                }}
                title='New hub'
                aria-label='New hub'
                className='flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                data-track-category='SdlcHub'
                data-track-name='NewHubOpened'
                data-track-metadata={JSON.stringify({ place: 'hub-switcher' })}
              >
                <Plus className='size-4' />
              </button>
              <Key>esc</Key>
            </div>
            {/* One fixed height: more hubs scroll here, and searching never resizes the dialog. */}
            <Command.List className='h-[320px] overflow-y-auto p-2'>
              <Command.Empty className='px-3 py-8 text-center text-sm text-muted-foreground'>
                No hubs match that.
              </Command.Empty>
              <Command.Group>
                {hubs.map(hub => {
                  const current = hub.id === props.currentHubId;
                  return (
                    <Command.Item
                      key={hub.id}
                      value={hub.id}
                      keywords={[hub.name]}
                      onSelect={() => choose(hub.id)}
                      className={ITEM_CLASS}
                      data-track-category='SdlcHub'
                      data-track-name='HubSwitched'
                      data-track-metadata={JSON.stringify({ current })}
                    >
                      <span className='flex size-4 shrink-0 items-center justify-center text-muted-foreground'>
                        {hub.visibility === 'PUBLIC' ? (
                          <Hash className='size-4' />
                        ) : (
                          <Lock className='size-4' />
                        )}
                      </span>
                      <span className='min-w-0 flex-1 truncate text-sm'>{hub.name}</span>
                      {current && (
                        <span className='flex shrink-0 items-center gap-1 text-xs text-muted-foreground'>
                          <Check className='size-3.5' />
                          Current
                        </span>
                      )}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            </Command.List>
            <div className='flex items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground'>
              <span className='flex items-center gap-1.5'>
                <Key>↑</Key>
                <Key>↓</Key>
                to move
              </span>
              <span className='flex items-center gap-1.5'>
                <Key>↵</Key>
                to open
              </span>
              <span className='ml-auto flex items-center gap-1.5'>
                <Key>⌘J</Key>
                anywhere in SDLC
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
