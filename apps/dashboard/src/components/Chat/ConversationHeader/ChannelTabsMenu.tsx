import {
  Fragment,
  // Disabled (Claw)
  // useMemo,
  useRef,
  // Disabled (Claw)
  // useState,
  type ReactElement,
} from 'react';
import {
  DragableSixDots,
  // Disabled (Claw)
  // Grid02,
  PlusDefault,
} from '@xyne/icons';
import { Popover } from '../../ui/Popover/Popover';
import {
  // Disabled (Claw)
  // AppPickerDialog,
  type AppPublishOptions,
  type BarBuiltIn,
} from '../../BarCustomize';
import {
  // Disabled (Claw)
  // appIdOf,
  // appItemId,
  // setAppSnapshot,
  // MAX_APPS_PER_BAR,
  type BarItemsStore,
} from '../../../hooks/barItems';
import { usePanelSlot, type ChannelTabDrag } from '../../../hooks/useChannelTabDrag';
import { TAB_ROW_SOCKET_CLASS } from '../../../constants/channelTabs';
import { cn } from '../../../utils/classNames';

interface ChannelTabsMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: BarItemsStore;
  hidden: readonly BarBuiltIn[];
  drag: ChannelTabDrag;
  onAdd: (id: string, row: HTMLElement) => void;
  publish?: AppPublishOptions;
  publishedAppIds: ReadonlySet<string>;
  onCustomize?: () => void;
}

const rowClass =
  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-popover-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground';

export const ChannelTabsMenu = ({
  open,
  onOpenChange,
  // Disabled (Claw)
  // store,
  hidden,
  drag,
  onAdd,
  // Disabled (Claw)
  // publish,
  // publishedAppIds,
  onCustomize,
}: ChannelTabsMenuProps): ReactElement => {
  // Disabled (Claw)
  // const ids = store.useItems();
  // const [pickerOpen, setPickerOpen] = useState(false);
  const slot = usePanelSlot(drag.session);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const anchorRect = useRef<DOMRect | null>(null);
  const anchor = useRef({
    getBoundingClientRect: (): DOMRect => {
      if (!anchorRect.current && buttonRef.current) {
        anchorRect.current = buttonRef.current.getBoundingClientRect();
      }
      return anchorRect.current ?? new DOMRect();
    },
  });

  // Disabled (Claw)
  // const addedAppIds = useMemo(
  //   () => new Set(ids.map(appIdOf).filter((id): id is string => id !== null)),
  //   [ids],
  // );
  // const appsFull =
  //   [...addedAppIds].filter(id => !publishedAppIds.has(id)).length >= MAX_APPS_PER_BAR;
  // const pickerBlocked = appsFull && !publish && !publishedAppIds.size;

  const slotRow = (
    <li
      data-tab-slot=''
      aria-hidden
      className='relative h-0 overflow-hidden transition-[height] duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]'
    >
      <span className='absolute inset-0 rounded-md border-[1.5px] border-dashed border-foreground/15 bg-foreground/[0.02]' />
    </li>
  );

  return (
    <>
      <span ref={drag.addRef} className='group/add inline-flex shrink-0'>
        <Popover
          open={open}
          onOpenChange={next => {
            if (next) anchorRect.current = null;
            onOpenChange(next);
          }}
          anchor={anchor}
          onInteractOutside={event => {
            const { target } = event;
            if (!(target instanceof Element) || !target.closest('[data-tab-tile]')) return;
            const original = event.detail.originalEvent;
            const primaryPress =
              original instanceof PointerEvent
                ? original.button === 0
                : !target.matches(':focus-visible');
            if (primaryPress) event.preventDefault();
          }}
          side='bottom'
          align='start'
          sideOffset={6}
          collisionPadding={12}
          className='w-60 rounded-xl p-1.5'
          trigger={
            <button
              ref={buttonRef}
              type='button'
              aria-label='Add a tab'
              data-testid='channel-tab-add'
              data-track-category='CHANNELS'
              data-track-name='OPEN_ADD_TAB_MENU'
              className={cn(
                'flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out hover:bg-muted/60 hover:text-foreground active:scale-[0.96] motion-reduce:transition-none',
                'group-data-[drop-target]/add:scale-105 group-data-[drop-target]/add:bg-muted group-data-[drop-target]/add:text-foreground',
                open && 'bg-muted text-foreground',
              )}
            >
              <PlusDefault
                size={14}
                className='transition-transform duration-200 motion-reduce:transition-none [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] group-data-[drop-target]/add:rotate-45'
              />
            </button>
          }
        >
          <div ref={drag.panelRef} className='flex flex-col'>
            <div className='flex items-baseline justify-between gap-3 px-2.5 pb-1 pt-1'>
              <p className='text-xs font-medium text-muted-foreground'>Hidden tabs</p>
              {hidden.length > 0 && (
                <span className='text-xs text-muted-foreground'>Drag to place</span>
              )}
            </div>
            <ul className='flex flex-col'>
              {hidden.map((tab, index) => (
                <Fragment key={tab.id}>
                  {slot === index && slotRow}
                  <li
                    data-tab-row=''
                    data-tab-label={tab.label}
                    onPointerDown={event => drag.startRowPress(tab.id, event)}
                    className='group/row relative'
                  >
                    <span data-bar-socket aria-hidden className={TAB_ROW_SOCKET_CLASS} />
                    <button
                      type='button'
                      onClick={event => {
                        const row = event.currentTarget.parentElement;
                        if (row) onAdd(tab.id, row);
                      }}
                      data-testid={`channel-tab-row-${tab.id}`}
                      data-track-category='CHANNELS'
                      data-track-name='AddBarItem'
                      data-track-metadata={JSON.stringify({ id: tab.id })}
                      className={rowClass}
                    >
                      <span
                        data-tab-glyph=''
                        className='flex shrink-0 items-center text-muted-foreground'
                      >
                        {tab.icon}
                      </span>
                      <span className='truncate'>{tab.label}</span>
                      <DragableSixDots
                        aria-hidden
                        className='ml-auto size-3.5 shrink-0 opacity-0 transition-opacity duration-150 ease-out [@media(hover:hover)_and_(pointer:fine)]:group-hover/row:opacity-40'
                      />
                    </button>
                  </li>
                </Fragment>
              ))}
              {slot !== null && slot >= hidden.length && slotRow}
              {hidden.length === 0 && (
                <li
                  data-tab-empty=''
                  className='flex h-8 items-center overflow-hidden px-2.5 text-sm text-muted-foreground'
                >
                  Drag a tab here to hide it
                </li>
              )}
            </ul>

            {/* Disabled (Claw) */}
            {/*
            <div className='my-1 border-t border-border' />

            <button
              type='button'
              disabled={pickerBlocked}
              onClick={() => {
                onOpenChange(false);
                setPickerOpen(true);
              }}
              title={pickerBlocked ? `Up to ${MAX_APPS_PER_BAR} apps per bar` : undefined}
              data-testid='channel-tab-add-app'
              data-track-category='CHANNELS'
              data-track-name='OpenAppPicker'
              className={cn(rowClass, pickerBlocked && 'cursor-not-allowed opacity-50')}
            >
              <span className='flex shrink-0 items-center text-muted-foreground'>
                <Grid02 size={14} />
              </span>
              Add app…
            </button>
            */}
            {onCustomize && (
              <button
                type='button'
                onClick={() => {
                  onOpenChange(false);
                  onCustomize();
                }}
                data-testid='channel-tabs-customize'
                data-track-category='CHANNELS'
                data-track-name='CUSTOMIZE_TABS'
                className='block w-full rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-[color:var(--mention-color)] transition-colors duration-100 hover:bg-accent'
              >
                Customize tabs
              </button>
            )}
          </div>
        </Popover>
      </span>

      {/* Disabled (Claw) */}
      {/*
      <AppPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        addedAppIds={addedAppIds}
        isFull={appsFull}
        publishedAppIds={publishedAppIds}
        onToggle={(app, next) => {
          if (!next) {
            store.remove(appItemId(app.id));
            return;
          }
          setAppSnapshot(app.id, { title: app.title, icon: app.icon });
          store.add(appItemId(app.id));
        }}
        trackCategory='CHANNELS'
        {...(publish ? { publish } : {})}
      />
      */}
    </>
  );
};
