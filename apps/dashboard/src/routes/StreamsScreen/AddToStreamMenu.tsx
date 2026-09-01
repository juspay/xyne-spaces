import { ReactElement, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { LayoutGridTwoVertical, PlusDefault } from '@xyne/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Tooltip } from '../../components/ui/Tooltip/Tooltip';
import { cn } from '../../utils/classNames';
import type { ColumnSource } from './Streams.types';
import { useAddToStream, type StreamTarget } from './useAddToStream';

/**
 * The stream list, mounted only once the menu is open.
 *
 * Its own component purely so that `list()` runs on mount, and mount happens
 * when the menu opens. Reading in the parent instead would snapshot the streams
 * when the *page* rendered, and a stream created since — in this tab or the
 * Streams tab in another window — would be missing from a menu that looks
 * authoritative.
 */
const useStreamChoices = (
  source: ColumnSource,
  onChosen?: () => void,
): { streams: StreamTarget[]; choose: (streamId: string | null) => void } => {
  const { list, add, addToNew } = useAddToStream();
  const [streams] = useState(list);

  // `null` means "a new one". Both renderers below go through this, so the two
  // menus cannot drift into doing different things with the same click.
  const choose = (streamId: string | null): void => {
    if (streamId === null) addToNew(source);
    else add(source, streamId);
    onChosen?.();
  };

  return { streams, choose };
};

const StreamChoices = ({
  source,
  onChosen,
}: {
  source: ColumnSource;
  onChosen?: () => void;
}): ReactElement => {
  const { streams, choose } = useStreamChoices(source, onChosen);

  return (
    <>
      {streams.map(stream => (
        <DropdownMenuItem
          key={stream.id}
          className='gap-2'
          onClick={() => choose(stream.id)}
          data-track-category='Streams'
          data-track-name='AddToStreamFromPage'
        >
          <span className='truncate'>{stream.name}</span>
          {/* The open stream is marked, not sorted to the top. Reordering the
              list by which one happens to be open moves every other entry the
              moment you switch streams, and this menu is muscle memory — the
              third item down should stay the third item down. */}
          {stream.active && (
            <span className='ml-auto shrink-0 text-xs text-muted-foreground'>Open</span>
          )}
        </DropdownMenuItem>
      ))}
      {streams.length > 0 && <DropdownMenuSeparator />}
      <DropdownMenuItem
        className='gap-2'
        onClick={() => choose(null)}
        data-track-category='Streams'
        data-track-name='AddToNewStreamFromPage'
      >
        <PlusDefault size={16} />
        New stream
      </DropdownMenuItem>
    </>
  );
};

/**
 * "Add to Stream" as an item inside a menu that already exists.
 *
 * A submenu rather than a single item that adds to the open stream: which stream
 * a thing belongs in is the decision being made, and quietly picking one for you
 * is wrong more often than it is right — you are usually filing this *somewhere
 * else*, or you would already be looking at it.
 */
export const AddToStreamMenuItem = ({ source }: { source: ColumnSource }): ReactElement => (
  <DropdownMenuSub>
    <DropdownMenuSubTrigger className='gap-2'>
      <LayoutGridTwoVertical size={16} />
      Add to Stream
    </DropdownMenuSubTrigger>
    <DropdownMenuSubContent className='min-w-[180px]'>
      <StreamChoices source={source} />
    </DropdownMenuSubContent>
  </DropdownMenuSub>
);

/**
 * "Add to Stream" as a control of its own.
 *
 * For headers with no overflow menu to put it in. Same choices, same wording —
 * the only difference is that this one owns the menu it opens.
 */
export const AddToStreamButton = ({
  source,
  className,
}: {
  source: ColumnSource;
  className?: string;
}): ReactElement | null => {
  const [open, setOpen] = useState(false);
  const { has } = useAddToStream();
  // Checked once on mount and then latched, rather than read on every render:
  // the button is what does the adding, so it can retire itself the moment it
  // succeeds without asking storage again.
  const [added, setAdded] = useState(() => has(source));

  // Nothing to offer. A control that adds a thing already added is not a
  // disabled control, it is one that should not be on screen — and inside a
  // Streams ticket column this button would be offering to add the column you
  // are reading it in.
  if (added) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip content='Add to Stream' side='bottom' sideOffset={6} className='pointer-events-none'>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            aria-label='Add to Stream'
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              className,
            )}
            data-track-category='Streams'
            data-track-name='OpenAddToStreamMenu'
          >
            <LayoutGridTwoVertical size={16} />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align='end' className='min-w-[180px]'>
        <StreamChoices
          source={source}
          onChosen={() => {
            setOpen(false);
            setAdded(true);
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * "Add to Stream" for menus built on Base UI rather than Radix.
 *
 * Attachments use `@base-ui/react/menu`, not the `DropdownMenu` every other
 * overflow menu in the app is built from, and the two primitives do not compose
 * — a Radix `DropdownMenuSub` inside a Base UI `Menu.Popup` renders nothing.
 * Rather than convert that menu, this is the same choices rendered with the
 * other library. Both go through `useStreamChoices`, so the behaviour is shared
 * even though the markup cannot be.
 */
export const AddToStreamBaseUiMenuItem = ({
  source,
  onChosen,
}: {
  source: ColumnSource;
  onChosen?: () => void;
}): ReactElement => {
  const { streams, choose } = useStreamChoices(source, onChosen);
  const itemClass =
    'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground outline-none data-[highlighted]:bg-accent';

  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger className={itemClass}>
        <LayoutGridTwoVertical className='h-4 w-4 shrink-0' />
        <span className='flex-1 text-left'>Add to Stream</span>
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner
          side='right'
          align='start'
          sideOffset={4}
          className='z-50 min-w-[180px] rounded-lg border border-border bg-popover p-1 shadow-lg'
        >
          <Menu.Popup>
            <div className='flex flex-col gap-1'>
              {streams.map(stream => (
                <Menu.Item key={stream.id} className={itemClass} onClick={() => choose(stream.id)}>
                  <span className='truncate'>{stream.name}</span>
                  {stream.active && (
                    <span className='ml-auto shrink-0 text-xs text-muted-foreground'>Open</span>
                  )}
                </Menu.Item>
              ))}
              {streams.length > 0 && <Menu.Separator className='my-1 h-px bg-border' />}
              <Menu.Item className={itemClass} onClick={() => choose(null)}>
                <PlusDefault className='h-4 w-4 shrink-0' />
                New stream
              </Menu.Item>
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
};
