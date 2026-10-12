/**
 * Every open tab, in the style of the hub switcher (⌘J) and the app's ⌘K menu: type
 * to narrow by name or site, ↑/↓ to move, ↵ to open. Tabs can be grouped — a folder
 * keeps what is saved in it apart from pages only being browsed, which can be saved
 * from here. Opened with ⌘P, or the strip's own button.
 */
import type { ReactElement, ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { Check, Save, Search, X } from 'lucide-react';
import { cn } from '../../utils/classNames';

/** One open tab, as the switcher lists it. */
export interface TabSwitcherEntry {
  key: string;
  name: string;
  /** Under the name: the site a page is on, or what kind of item it is. */
  detail: string;
  icon: ReactNode;
  /** The heading it is listed under, in the order headings first appear; none for a
   *  plain list. */
  group?: string;
  current: boolean;
  /** A page that can be saved from here, and where it is. */
  saveUrl?: string;
}

const ITEM_CLASS =
  'group flex h-12 cursor-pointer select-none items-center gap-3 rounded-lg px-3 text-foreground aria-selected:bg-accent';

function Key(props: { children: string }): ReactElement {
  return (
    <kbd className='rounded border border-border bg-muted px-1.5 py-px font-sans text-[11px] text-muted-foreground'>
      {props.children}
    </kbd>
  );
}

/** A row's own action: shown on the row under the pointer or the keyboard, else hidden. */
function RowAction(props: {
  label: string;
  onClick: () => void;
  trackCategory: string;
  trackName: string;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type='button'
      title={props.label}
      aria-label={props.label}
      // A row's action, not the row: choosing it must not also open the tab.
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        props.onClick();
      }}
      className='hidden size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:bg-foreground/10 focus-visible:text-foreground group-hover:grid group-aria-selected:grid'
      data-track-category={props.trackCategory}
      data-track-name={props.trackName}
    >
      {props.children}
    </button>
  );
}

const GROUP_CLASS =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground';

export function TabSwitcher(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: readonly TabSwitcherEntry[];
  onOpen: (key: string) => void;
  onClose: (key: string) => void;
  onCloseAll: () => void;
  /** Saves a page; absent where nothing can be saved. */
  onSave?: (url: string, name: string) => void;
  /** Where else ⌘P opens it, for the footer: "anywhere in a folder". */
  where: string;
  trackCategory: string;
}): ReactElement {
  // Headings in the order they first appear, each with its own tabs.
  const groups: { heading: string | undefined; entries: TabSwitcherEntry[] }[] = [];
  for (const entry of props.entries) {
    const group = groups.find(candidate => candidate.heading === entry.group);
    if (group) group.entries.push(entry);
    else groups.push({ heading: entry.group, entries: [entry] });
  }

  const choose = (key: string): void => {
    props.onOpenChange(false);
    props.onOpen(key);
  };

  const row = (entry: TabSwitcherEntry): ReactElement => (
    <Command.Item
      key={entry.key}
      value={entry.key}
      keywords={[entry.name, entry.detail]}
      onSelect={() => choose(entry.key)}
      className={ITEM_CLASS}
      data-track-category={props.trackCategory}
      data-track-name='FolderTabListPicked'
    >
      <span className='flex size-4 shrink-0 items-center justify-center text-muted-foreground'>
        {entry.icon}
      </span>
      <span className='min-w-0 flex-1'>
        <span className={cn('block truncate text-sm', entry.current && 'font-medium')}>
          {entry.name}
        </span>
        <span className='block truncate text-xs text-muted-foreground'>{entry.detail}</span>
      </span>
      {entry.current && (
        <span className='flex shrink-0 items-center gap-1 text-xs text-muted-foreground group-hover:hidden group-aria-selected:hidden'>
          <Check className='size-3.5' />
          Open
        </span>
      )}
      {entry.saveUrl && props.onSave && (
        <RowAction
          label='Save to this folder'
          onClick={() => {
            props.onOpenChange(false);
            if (entry.saveUrl) props.onSave?.(entry.saveUrl, entry.name);
          }}
          trackCategory={props.trackCategory}
          trackName='FolderTabListSaved'
        >
          <Save className='size-4' />
        </RowAction>
      )}
      <RowAction
        label={`Close ${entry.name}`}
        onClick={() => props.onClose(entry.key)}
        trackCategory={props.trackCategory}
        trackName='FolderTabClosed'
      >
        <X className='size-4' />
      </RowAction>
    </Command.Item>
  );

  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className='fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0' />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className='fixed inset-x-0 top-[14vh] z-50 mx-auto w-[min(600px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl duration-100 focus:outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
        >
          <DialogPrimitive.Title className='sr-only'>Open tabs</DialogPrimitive.Title>
          <Command
            label='Open tabs'
            loop
            // By what a reader sees — the name, the site — never the tab's kind and
            // id, which would match "re" or "1" in a uuid.
            filter={(_value, search, keywords) =>
              (keywords ?? []).some(keyword =>
                keyword.toLowerCase().includes(search.trim().toLowerCase()),
              )
                ? 1
                : 0
            }
          >
            <div className='flex items-center gap-2.5 border-b border-border px-4'>
              <Search className='size-4 shrink-0 text-muted-foreground' />
              <Command.Input
                autoFocus
                placeholder='Search open tabs…'
                className='h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground'
                data-track-category={props.trackCategory}
                data-track-name='FolderTabListSearched'
              />
              <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                {props.entries.length} open
              </span>
              <Key>esc</Key>
            </div>
            {/* One fixed height: more tabs scroll here, and searching never resizes it. */}
            <Command.List className='h-[360px] overflow-y-auto p-2'>
              <Command.Empty className='px-3 py-8 text-center text-sm text-muted-foreground'>
                No open tab matches that.
              </Command.Empty>
              {groups.map(group => (
                <Command.Group
                  key={group.heading ?? ''}
                  {...(group.heading && { heading: group.heading })}
                  className={GROUP_CLASS}
                >
                  {group.entries.map(row)}
                </Command.Group>
              ))}
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
              <span className='flex items-center gap-1.5'>
                <Key>⌘P</Key>
                {props.where}
              </span>
              <button
                type='button'
                onClick={() => {
                  props.onOpenChange(false);
                  props.onCloseAll();
                }}
                className='ml-auto rounded-md px-2 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground'
                data-track-category={props.trackCategory}
                data-track-name='FolderTabsAllClosed'
              >
                Close all
              </button>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
