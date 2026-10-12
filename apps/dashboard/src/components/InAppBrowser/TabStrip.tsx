import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Globe, Loader2, X } from 'lucide-react';
import { cn } from '../../utils/classNames';
import { useScrollFade } from '../../hooks/useScrollFade';

/** One tab as the strip shows it. */
export interface StripTab {
  key: string;
  name: string;
  /** On hover: more than the name, where there is more to say. */
  tooltip: string;
  icon: ReactNode;
  /** After the name: a playing page's speaker, say. */
  badge?: ReactNode;
}

/**
 * A tab that can be dragged along the strip to a new place. The whole tab is the
 * handle: a press has to travel a few pixels before it is a drag, so a click still
 * opens or closes it. Only the pointer drags; the arrow keys stay the strip's own.
 */
function SortableTab(props: {
  id: string;
  className: string;
  draggingClassName: string;
  children: ReactNode;
}): ReactElement {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: props.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-strip-tab={props.id}
      // Lifted while dragged: solid, so the tabs it passes over don't show through.
      className={cn(props.className, isDragging && props.draggingClassName)}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {props.children}
    </div>
  );
}

/**
 * A tab's name, as wide as it is in the open tab's medium weight whichever tab it's
 * on: opening a tab then never widens it and moves the ones after it.
 */
export function TabName(props: { name: string }): ReactElement {
  return (
    <span className='grid min-w-0 grid-cols-1'>
      <span className='col-start-1 row-start-1 truncate'>{props.name}</span>
      <span aria-hidden='true' className='invisible col-start-1 row-start-1 truncate font-medium'>
        {props.name}
      </span>
    </span>
  );
}

/** A page's icon: a spinner while it loads, the site's own once it says, a globe until then. */
export function PageFavicon(props: {
  favicon: string | undefined;
  loading: boolean;
}): ReactElement {
  const [broken, setBroken] = useState<string | null>(null);
  return props.loading ? (
    <Loader2 className='size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none' />
  ) : props.favicon && broken !== props.favicon ? (
    <img
      src={props.favicon}
      alt=''
      className='size-4 rounded-[3px] object-contain'
      onError={() => setBroken(props.favicon ?? null)}
    />
  ) : (
    <Globe className='size-4' />
  );
}

/**
 * How the tabs look.
 *
 * `pill`: a folder's tabs — each as wide as its name, the open one a raised pill,
 * a close button coming over the name's end on hover so no tab ever changes width.
 *
 * `chrome`: a browser's, as Chrome draws them — the tabs share the row and shrink
 * as more open, the open one joins the toolbar below it with curved feet, and its
 * close button is always there; the others' come on hover.
 */
export type TabStripVariant = 'pill' | 'chrome';

const TAB_CLASS: Record<
  TabStripVariant,
  { tab: string; active: string; idle: string; dragging: string }
> = {
  pill: {
    tab: 'group relative flex h-8 max-w-[220px] shrink-0 items-center rounded-lg border text-[13px] transition-colors',
    active: 'border-border bg-muted font-medium text-foreground shadow-sm',
    idle: 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground has-[:focus-visible]:bg-muted has-[:focus-visible]:text-foreground',
    dragging: 'z-10 border-border bg-muted text-foreground shadow-lg',
  },
  chrome: {
    tab: 'group relative flex h-[34px] min-w-[72px] flex-[0_1_232px] items-center rounded-t-[10px] text-[12.5px] transition-colors',
    // The curved feet: a corner either side, cut out of the strip in the toolbar's colour.
    active:
      "z-[1] bg-background text-foreground before:pointer-events-none before:absolute before:-left-2.5 before:bottom-0 before:size-2.5 before:rounded-br-[10px] before:shadow-[5px_5px_0_5px_hsl(var(--background))] before:content-[''] after:pointer-events-none after:absolute after:-right-2.5 after:bottom-0 after:size-2.5 after:rounded-bl-[10px] after:shadow-[-5px_5px_0_5px_hsl(var(--background))] after:content-['']",
    idle: 'text-muted-foreground hover:bg-background/50 hover:text-foreground has-[:focus-visible]:bg-background/50 has-[:focus-visible]:text-foreground',
    dragging: 'z-10 rounded-[10px] bg-background text-foreground shadow-lg',
  },
};

/**
 * A row of tabs, as a browser's: the open one raised, the rest quiet with a line
 * between them. It scrolls sideways — a wheel turns sideways over it — and fades at
 * an edge while there are more tabs past it. Tabs drag to a new place, and a middle
 * click closes one.
 *
 * The strip is one stop in the page's tab order, on the open tab: the arrows move
 * along it and Delete closes the tab you are on.
 */
export function TabStrip(props: {
  tabs: readonly StripTab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  /** A tab dragged onto another's place. */
  onReorder: (from: string, to: string) => void;
  label: string;
  /** A pointer arriving over the strip: a host that must take the keyboard back from
   *  a page first, so the click that follows is the one that acts. */
  onPointerEnter?: () => void;
  trackCategory: string;
  trackNames: { select: string; close: string };
  variant?: TabStripVariant;
}): ReactElement {
  const { tabs, activeKey } = props;
  const variant = props.variant ?? 'pill';
  const look = TAB_CLASS[variant];
  const stripRef = useRef<HTMLDivElement | null>(null);
  const fade = useScrollFade<HTMLDivElement>('x');
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      stripRef.current = element;
      fade.ref(element);
    },
    [fade.ref],
  );
  const keys = useMemo(() => tabs.map(tab => tab.key), [tabs]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  /**
   * A dragged tab moves along the strip only, as the strip's own tabs shuffle aside,
   * and no further than the strip's ends inside its padding: there it stops, rather
   * than slide out of sight under the buttons beside the strip — or push the strip
   * into scrolling, which would carry the other tabs off with it.
   */
  const lockToStrip = useMemo<Modifier>(
    () =>
      ({ transform, draggingNodeRect }) => {
        const strip = stripRef.current;
        if (!draggingNodeRect || !strip) return { ...transform, y: 0 };
        const box = strip.getBoundingClientRect();
        const style = getComputedStyle(strip);
        const furthestLeft = box.left + parseFloat(style.paddingLeft) - draggingNodeRect.left;
        const furthestRight = box.right - parseFloat(style.paddingRight) - draggingNodeRect.right;
        return {
          ...transform,
          x: Math.min(Math.max(transform.x, furthestLeft), Math.max(furthestLeft, furthestRight)),
          y: 0,
        };
      },
    [],
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const activeInStrip = activeKey !== null && keys.includes(activeKey);

  // A tab can become the open one while scrolled out of sight — opened from
  // elsewhere, restored, or pushed along by newer tabs.
  useEffect(() => {
    if (!activeKey) return;
    const tab = Array.from(
      stripRef.current?.querySelectorAll<HTMLElement>('[data-strip-tab]') ?? [],
    ).find(element => element.dataset['stripTab'] === activeKey);
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeKey, tabs.length]);

  const onDragEnd = (event: DragEndEvent): void => {
    setDragging(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    props.onReorder(String(active.id), String(over.id));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    const index = buttons.findIndex(button => button === event.target);
    if (index < 0) return;
    const focusAt = (next: number): void => {
      event.preventDefault();
      buttons[(next + buttons.length) % buttons.length]?.focus();
    };
    if (event.key === 'ArrowRight') focusAt(index + 1);
    else if (event.key === 'ArrowLeft') focusAt(index - 1);
    else if (event.key === 'Home') focusAt(0);
    else if (event.key === 'End') focusAt(buttons.length - 1);
    else if (event.key === 'Delete' || event.key === 'Backspace') {
      const tab = tabs[index];
      if (!tab) return;
      event.preventDefault();
      props.onClose(tab.key);
      // Stay in the strip, on the tab that took its place.
      requestAnimationFrame(() => {
        const left = stripRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        if (left && left.length > 0) left[Math.min(index, left.length - 1)]?.focus();
      });
    }
  };

  return (
    <div
      ref={attach}
      role='tablist'
      aria-label={props.label}
      tabIndex={-1}
      onPointerEnter={props.onPointerEnter}
      onKeyDown={onKeyDown}
      // A wheel scrolls the strip sideways when its tabs run past the edge.
      onWheel={event => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          event.currentTarget.scrollLeft += event.deltaY;
        }
      }}
      onScroll={fade.onScroll}
      style={fade.style}
      className={cn(
        'scrollbar-none flex h-full min-w-0 overflow-x-auto outline-none',
        variant === 'chrome' ? 'items-end px-2.5 pt-1.5' : 'items-center gap-0.5 px-0.5',
      )}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[lockToStrip]}
        // The strip doesn't scroll under a drag: a tab moves among those in sight.
        autoScroll={false}
        onDragStart={event => setDragging(String(event.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <SortableContext items={keys} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab, index) => {
            const isActive = tab.key === activeKey;
            // The one stop in the page's tab order: the open tab, else the first.
            const isStop = activeInStrip ? isActive : index === 0;
            const afterActive = index > 0 && tabs[index - 1]?.key === activeKey;
            return (
              <Fragment key={tab.key}>
                {/* A quiet line between tabs; the open tab's own edge does it beside
                    that one. Hidden rather than dropped, so no tab shifts. */}
                {index > 0 && (
                  <span
                    aria-hidden='true'
                    className={cn(
                      'w-px shrink-0 bg-border',
                      variant === 'chrome' ? 'mb-2 h-[18px] self-end' : 'h-4',
                      // Tabs moving aside under a drag would leave them standing alone.
                      (isActive || afterActive || dragging !== null) && 'opacity-0',
                    )}
                  />
                )}
                <SortableTab
                  id={tab.key}
                  className={cn(look.tab, isActive ? look.active : look.idle)}
                  draggingClassName={look.dragging}
                >
                  <button
                    type='button'
                    role='tab'
                    aria-selected={isActive}
                    aria-keyshortcuts='Delete'
                    tabIndex={isStop ? 0 : -1}
                    title={tab.tooltip}
                    onClick={() => props.onSelect(tab.key)}
                    // A middle click closes it, as in a browser.
                    onMouseDown={event => {
                      if (event.button === 1) event.preventDefault();
                    }}
                    onAuxClick={event => {
                      if (event.button !== 1) return;
                      event.preventDefault();
                      props.onClose(tab.key);
                    }}
                    // No tab keeps room for its close button, the open one included:
                    // it comes over the end of the name on hover, so opening a tab
                    // never changes its width and moves the ones after it.
                    className={cn(
                      'flex h-full min-w-0 flex-1 items-center text-left outline-none',
                      variant === 'chrome'
                        ? 'gap-2 rounded-t-[10px] pl-3 pr-1'
                        : 'gap-1.5 rounded-[7px] pl-2 pr-2.5',
                    )}
                    data-track-category={props.trackCategory}
                    data-track-name={props.trackNames.select}
                  >
                    <span className='relative flex size-4 shrink-0 items-center justify-center'>
                      {tab.icon}
                    </span>
                    {variant === 'chrome' ? (
                      <span className='min-w-0 flex-1 truncate'>{tab.name}</span>
                    ) : (
                      <TabName name={tab.name} />
                    )}
                  </button>
                  {tab.badge}
                  {variant === 'chrome' ? (
                    // Its own room at the tab's end, as Chrome's: always on the open
                    // tab, on hover on the others.
                    <button
                      type='button'
                      tabIndex={-1}
                      onMouseDown={event => event.preventDefault()}
                      onClick={event => {
                        event.stopPropagation();
                        props.onClose(tab.key);
                      }}
                      title={`Close ${tab.name}`}
                      aria-label={`Close ${tab.name}`}
                      className={cn(
                        'mr-1.5 flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[opacity,background-color,color] duration-150 hover:bg-foreground/10 hover:text-foreground motion-reduce:transition-none',
                        isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      )}
                      data-track-category={props.trackCategory}
                      data-track-name={props.trackNames.close}
                    >
                      <X className='size-3.5' />
                    </button>
                  ) : (
                    <button
                      type='button'
                      tabIndex={-1}
                      // Keeps focus where it is: closing isn't a reason to move it.
                      onMouseDown={event => event.preventDefault()}
                      onClick={event => {
                        event.stopPropagation();
                        props.onClose(tab.key);
                      }}
                      title={`Close ${tab.name}`}
                      aria-label={`Close ${tab.name}`}
                      // A shade behind it, solid under the button and fading over the
                      // name's end: the name runs under it rather than stop short, and
                      // the button needs no backing of its own. It comes in with the
                      // hover, the shade fading up and the button easing out to its size.
                      // Only the × takes a click: the shade lies over the name, and a short
                      // tab's middle would otherwise close it rather than open it.
                      className='pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-[7px] bg-gradient-to-l from-muted from-45% via-muted/80 via-60% to-transparent pl-6 pr-1 text-muted-foreground opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100 motion-reduce:transition-none [&>svg]:scale-75 [&>svg]:transition-[transform,background-color,color] [&>svg]:duration-200 [&>svg]:ease-out group-hover:[&>svg]:scale-100 [&>svg]:hover:bg-foreground/10 [&>svg]:hover:text-foreground motion-reduce:[&>svg]:transition-none [&>svg]:pointer-events-auto'
                      data-track-category={props.trackCategory}
                      data-track-name={props.trackNames.close}
                    >
                      <X className='box-content size-3.5 rounded-md p-[3px]' />
                    </button>
                  )}
                </SortableTab>
              </Fragment>
            );
          })}
        </SortableContext>
      </DndContext>
    </div>
  );
}
