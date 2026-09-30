import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { animate, motion, useMotionValue, useTransform, type Transition } from 'motion/react';
import {
  ChevronDown,
  MaximizeTwoArrow,
  MinimizeTwoArrow,
  MultipleCrossCancelDefault as X,
} from '@xyne/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/utils/classNames';
import { DRAFT_CHAT_EASE_OUT } from './draftChatMotion';
import './draft-chat.css';

const OVERLAY_HEIGHT = 540;
/** The composer on its own: idle, or with the card folded. */
const REST_WIDTH = 500;
const OVERLAY_WIDTH = 700;
const MAXIMIZED_WIDTH = 860;
const HEADER_HEIGHT = 36;
/** How far the card opens (0-1) before its messages start to show. */
const CONTENT_LEAD = 0.15;
/**
 * Granola's timing: the panel grows out of the bar and fades in within about
 * 200ms, and folds back faster than it opened. Quick ease-out, no spring.
 */
const OPEN_S = 0.22;
const FOLD_S = 0.16;
/** Maximizing, or the canvas changing size. */
const RESIZE_S = 0.3;
/** Over this much panel above the composer (px), the card's frame fades in or out. */
const FRAME_FADE_PX = 24;
const RADIUS = 20;
/** Matches bottom-6 on the dock. */
const DOCK_BOTTOM = 24;
/** Keeps the card below the canvas's Cancel / Save bar. */
const TOP_RESERVE = 64;
const DOCK_GUTTER = 16;
const ICON_BUTTON =
  'dc-pressable inline-flex size-6 items-center justify-center rounded-md p-1 text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground';

const isInsideOverlay = (target: EventTarget | null, host: HTMLElement | null): boolean => {
  if (!(target instanceof Element)) return false;
  if (host?.contains(target)) return true;
  // Menus and dialogs opened from the chat are portaled out of it.
  return Boolean(
    target.closest(
      '[data-radix-popper-content-wrapper], [data-radix-menu-content], [role="dialog"], .dc-menu-content',
    ),
  );
};

const isComposerControl = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('button, [role="button"], .dc-menu-content'));
};

export interface DraftChatThreadOption {
  id: string;
  title: string;
}

/**
 * The Digital Twin chat overlay, docked at the bottom of the create canvas.
 * Idle it is only the composer. The first send opens a card above it with the
 * thread; clicking away folds the card to its header, Escape folds then closes.
 */
export function DraftChatOverlay({
  variant,
  open,
  sessionActive,
  maximized,
  reduceMotion,
  title,
  threads,
  activeThreadId,
  transcript,
  onNewChat,
  onSelectThread,
  onToggleMaximize,
  onCollapse,
  onExpand,
  onClose,
  onExited,
  showHeader = true,
  children,
}: {
  /** 'origin' until the first send, then 'session' until the closed card finishes leaving. */
  variant: 'origin' | 'session';
  open: boolean;
  sessionActive: boolean;
  maximized: boolean;
  reduceMotion: boolean | null;
  title: string;
  threads: DraftChatThreadOption[];
  activeThreadId: string;
  transcript: ReactNode;
  onNewChat: () => void;
  onSelectThread: (id: string) => void;
  onToggleMaximize: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  onClose: () => void;
  onExited: () => void;
  /**
   * The title / history, expand and close bar. Off on the create page, where a
   * test chat has no history: clicking away folds it, Escape closes it.
   */
  showHeader?: boolean;
  children: ReactNode;
}): ReactElement {
  const dockRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const exitedRef = useRef(false);
  const [available, setAvailable] = useState({ width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT });
  const [slideOpen, setSlideOpen] = useState(false);
  /** Messages scrolled up under the header: the top of the thread fades out. */
  const [scrolledUnder, setScrolledUnder] = useState(false);
  // Another thread starts at its own scroll position.
  useEffect(() => setScrolledUnder(false), [activeThreadId]);
  const closing = variant === 'session' && !sessionActive;
  const showSession = variant === 'session';
  const sessionCard = showSession && !closing;
  const instant = reduceMotion === true;
  /** Opening (toward 1) takes a little longer than folding (toward 0). */
  const toward = (target: number): Transition =>
    instant
      ? { duration: 0 }
      : { type: 'tween', ease: DRAFT_CHAT_EASE_OUT, duration: target > 0 ? OPEN_S : FOLD_S };
  const resize: Transition = instant
    ? { duration: 0 }
    : { type: 'tween', ease: DRAFT_CHAT_EASE_OUT, duration: RESIZE_S };

  const headerHeight = showHeader ? HEADER_HEIGHT : 0;
  const frameOn = sessionCard && (open || headerHeight > 0);
  // At rest the composer is a compact bar; opening the card widens it along
  // with the height, and maximizing widens it further.
  const restWidth = Math.min(REST_WIDTH, available.width);
  const frameWidth =
    open && !closing
      ? Math.min(maximized ? MAXIMIZED_WIDTH : OVERLAY_WIDTH, available.width)
      : restWidth;
  /** The open card, header to composer. Its height doesn't follow the composer. */
  const fittedHeight = maximized ? available.height : Math.min(OVERLAY_HEIGHT, available.height);

  // The thread's height, from four values. Opening, folding, closing and
  // resizing the card animate `shown`, `opened` and `fitted`; the composer's own
  // height is set as it changes, with no animation. So typing another line
  // takes that line from the thread (the card stays put) instead of setting
  // two height animations chasing each other.
  const composerMV = useMotionValue(36);
  const fittedMV = useMotionValue(fittedHeight);
  const openedMV = useMotionValue(open ? 1 : 0);
  const shownMV = useMotionValue(sessionCard ? 1 : 0);
  /** The whole panel above the composer when open: header and thread. */
  const panelHeightMV = useTransform(() =>
    Math.max(headerHeight, fittedMV.get() - composerMV.get()),
  );
  /** How much of it shows. */
  const underlayMV = useTransform(() => {
    const opened = openedMV.get();
    return shownMV.get() * ((1 - opened) * headerHeight + opened * panelHeightMV.get());
  });
  // The card's fill, edge and shadow: one layer behind the composer. It is
  // solid as soon as the panel stands a few px above the composer, so the
  // canvas never shows through while the card grows or folds; it only fades
  // over the last FRAME_FADE_PX, where the card merges into the composer (and
  // at rest there is no ring around it). A folded card with a header keeps it.
  const frameOpacityMV = useTransform(() => Math.min(1, underlayMV.get() / FRAME_FADE_PX));
  // The messages show once the card is partly open and are gone well before it
  // finishes folding, so text never gets squashed flat.
  const threadOpacityMV = useTransform(() =>
    Math.min(1, Math.max(0, (shownMV.get() * openedMV.get() - CONTENT_LEAD) / (1 - CONTENT_LEAD))),
  );

  // The canvas is the dock's parent: its size bounds the card.
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const canvas = dock?.parentElement;
    if (!dock || !canvas) return;
    const measure = (): void => {
      const width = Math.max(0, dock.clientWidth - DOCK_GUTTER * 2);
      const height = Math.max(0, canvas.clientHeight - DOCK_BOTTOM - TOP_RESERVE);
      setAvailable(current =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return (): void => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const sync = (): void => composerMV.set(Math.round(el.getBoundingClientRect().height));
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return (): void => observer.disconnect();
  }, [composerMV]);

  useEffect(() => {
    const controls = animate(fittedMV, fittedHeight, resize);
    return (): void => controls.stop();
    // The transition is rebuilt every render; only the target matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fittedMV, fittedHeight, instant]);

  useEffect(() => {
    // While the card appears or leaves, `shown` alone carries the height: moving
    // both at once multiplies two eased curves, which crawls then lurches.
    if (shownMV.get() === 0) {
      openedMV.set(open ? 1 : 0);
      return undefined;
    }
    if (closing) return undefined;
    const controls = animate(openedMV, open ? 1 : 0, toward(open ? 1 : 0));
    return (): void => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedMV, shownMV, open, closing, instant]);

  useLayoutEffect(() => {
    if (variant === 'session') {
      setSlideOpen(true);
      return;
    }
    const frame = window.requestAnimationFrame(() => setSlideOpen(true));
    return (): void => window.cancelAnimationFrame(frame);
  }, [variant]);

  useEffect(() => {
    if (!sessionActive) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Folded, the card only closes when Escape comes from inside it, so
      // Escape elsewhere on the canvas keeps its own meaning.
      if (!open && !hostRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      if (open) onCollapse();
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => window.removeEventListener('keydown', onKeyDown);
  }, [sessionActive, open, onCollapse, onClose]);

  useEffect(() => {
    if (!open || closing) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (isInsideOverlay(event.target, hostRef.current)) return;
      onCollapse();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return (): void => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, closing, onCollapse]);

  useEffect(() => {
    if (!closing) exitedRef.current = false;
  }, [closing]);

  const handleHistoryKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Escape') event.stopPropagation();
  };

  const expandFromComposer = (target: EventTarget | null): void => {
    if (!sessionActive || open || closing || isComposerControl(target)) return;
    onExpand();
  };

  const handleUnderlayComplete = (): void => {
    if (!closing || exitedRef.current) return;
    exitedRef.current = true;
    onExited();
  };
  const underlayCompleteRef = useRef(handleUnderlayComplete);
  underlayCompleteRef.current = handleUnderlayComplete;

  useEffect(() => {
    const controls = animate(shownMV, sessionCard ? 1 : 0, {
      ...toward(sessionCard ? 1 : 0),
      onComplete: () => underlayCompleteRef.current(),
    });
    return (): void => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownMV, sessionCard, instant]);

  return (
    <div
      ref={dockRef}
      className='dc-root pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center'
      style={{ paddingInline: DOCK_GUTTER }}
      data-component='DraftChatOverlay'
    >
      <motion.div
        ref={hostRef}
        initial={
          variant === 'session' && reduceMotion !== true
            ? { width: restWidth, borderRadius: RADIUS }
            : false
        }
        animate={{ width: frameWidth, borderRadius: RADIUS }}
        transition={resize}
        style={{ overflow: 'visible' }}
        className={cn(
          'dc-frame relative flex max-w-full flex-col justify-end overflow-visible',
          sessionCard && 'dc-overlay pointer-events-auto',
          variant === 'origin' && 'dc-slide',
        )}
        // The card's frame shows only while there is more than the composer to frame.
        data-frame={frameOn ? 'on' : 'off'}
        data-open={slideOpen ? 'true' : 'false'}
        data-session={sessionCard ? (open ? 'open' : 'folded') : 'idle'}
      >
        <motion.div
          aria-hidden
          className='dc-frame-bg pointer-events-none absolute inset-0'
          style={{ opacity: frameOpacityMV, borderRadius: 'inherit' }}
        />
        {showSession ? (
          <motion.div
            className='dc-overlay-clip relative flex min-h-0 w-full shrink-0 flex-col overflow-hidden'
            style={{ height: underlayMV }}
          >
            {/* The panel keeps its full height and only this window moves, so it
                slides up out from behind the composer, top first, and sinks
                back behind it the same way (instead of unrolling as it grows). */}
            <motion.div className='flex w-full shrink-0 flex-col' style={{ height: panelHeightMV }}>
              {showHeader ? (
                <header className='flex h-9 w-full shrink-0 items-center justify-between py-1.5 pl-3 pr-1.5'>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type='button'
                        onKeyDown={handleHistoryKeyDown}
                        className='dc-pressable flex h-5 max-w-[min(100%,280px)] items-center gap-0.5 rounded-md py-0.5 pl-1 pr-0.5 text-[13px] font-[450] leading-[1.2] tracking-[-0.1px] text-foreground'
                        aria-label='Chat history'
                        data-track-category='Claw Agents'
                        data-track-name='Create agent: draft chat history'
                      >
                        <span className='min-w-0 truncate'>{title}</span>
                        <ChevronDown className='dc-chevron size-4 shrink-0 text-foreground/50' />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align='start'
                      className='dc-menu-content max-h-80 w-64 overflow-y-auto'
                    >
                      <DropdownMenuItem
                        className='dc-menu-item'
                        onSelect={onNewChat}
                        data-track-category='Claw Agents'
                        data-track-name='Create agent: draft chat new chat'
                      >
                        New chat
                      </DropdownMenuItem>
                      {threads.length > 0 ? (
                        <DropdownMenuSeparator className='dc-menu-separator' />
                      ) : null}
                      {threads.map(thread => (
                        <DropdownMenuItem
                          key={thread.id}
                          className='dc-menu-item'
                          data-selected={thread.id === activeThreadId}
                          onSelect={() => onSelectThread(thread.id)}
                          data-track-category='Claw Agents'
                          data-track-name='Create agent: draft chat load chat'
                        >
                          <span className='min-w-0 truncate'>{thread.title}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className='flex items-center'>
                    <button
                      type='button'
                      className={ICON_BUTTON}
                      aria-label={maximized ? 'Shrink chat' : 'Expand chat'}
                      title={maximized ? 'Shrink chat' : 'Expand chat'}
                      onClick={onToggleMaximize}
                      data-track-category='Claw Agents'
                      data-track-name='Create agent: draft chat toggle size'
                    >
                      {maximized ? (
                        <MinimizeTwoArrow className='size-4' />
                      ) : (
                        <MaximizeTwoArrow className='size-4' />
                      )}
                    </button>
                    <button
                      type='button'
                      className={ICON_BUTTON}
                      aria-label='Close chat'
                      title='Close chat'
                      onClick={onClose}
                      data-track-category='Claw Agents'
                      data-track-name='Create agent: draft chat close'
                    >
                      <X className='size-4' />
                    </button>
                  </div>
                </header>
              ) : null}
              <motion.div
                style={{ opacity: threadOpacityMV }}
                className={cn(
                  'relative min-h-0 flex-1 overflow-hidden',
                  (!open || closing) && 'pointer-events-none',
                )}
                aria-hidden={!open || closing}
                inert={!open || closing}
                // Scroll doesn't bubble, but it can be caught on the way down.
                onScrollCapture={event => {
                  if (event.target instanceof HTMLElement) {
                    setScrolledUnder(event.target.scrollTop > 0);
                  }
                }}
              >
                {/* No divider under the header: messages scrolled under it fade out instead. */}
                <div
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-background to-transparent transition-opacity duration-200 ease-out',
                    scrolledUnder ? 'opacity-100' : 'opacity-0',
                  )}
                />
                {transcript}
              </motion.div>
            </motion.div>
          </motion.div>
        ) : null}
        <div
          ref={composerRef}
          // The same inset in every state, so the composer never moves when the
          // card's frame appears or goes.
          className='pointer-events-auto relative z-10 mt-auto shrink-0 overflow-visible px-0.5 pb-0.5'
          onPointerDown={event => expandFromComposer(event.target)}
          onFocusCapture={event => {
            if (event.target instanceof HTMLTextAreaElement) expandFromComposer(event.target);
          }}
        >
          {children}
        </div>
      </motion.div>
    </div>
  );
}
