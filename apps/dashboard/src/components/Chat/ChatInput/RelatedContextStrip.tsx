/**
 * The row of "this looks related to…" chips inside the composer: threads, tickets,
 * canvases and calls where the draft is answered, was asked before, or was
 * discussed. Suggestions arrive uninvited while someone is mid-sentence, so the
 * motion is deliberately quiet — the row eases open, chips rise in one after
 * another, and leaving chips fade while the rest slide into place. Nothing jumps,
 * and with reduced motion it is a plain fade.
 *
 * Chips keep their natural width and the row scrolls sideways when the composer is
 * narrow, with a soft fade on whichever edge has more beyond it.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
} from 'react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type MotionProps,
  type Transition,
} from 'framer-motion';
import { useMeasure } from 'react-use';
import { Sparkles, X } from 'lucide-react';

import { HoverCard } from '../../ui/HoverCard';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { globalClickTracker } from '../../../services/Analytics/globalClickTracker';
import type { RelatedItem } from '../../../types/search';
import { KINDS, LABELS, snippetOf } from './relatedContextDisplay';
import { useWhereOf } from './useRelatedWhere';

/** Out-quint: quick to arrive, long soft landing. */
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
/** Width of the fade on an edge that has more chips beyond it. */
const EDGE_FADE_PX = 24;

/** What the chip points at, shown on hover — on the theme's popover surface. */
/** Where the chip's item lives; a DM by its people's display names. */
function ChipWhere({ item }: { item: RelatedItem }): ReactElement {
  // Capped and cut with an ellipsis, so a long canvas or ticket title can't stretch
  // the chip; the hover preview has the whole name.
  return <span className='min-w-0 max-w-[12rem] truncate'>{useWhereOf(item)}</span>;
}

function Preview({ item }: { item: RelatedItem }): ReactElement {
  const where = useWhereOf(item);
  const { name } = KINDS[item.kind];
  const label = LABELS[item.label];
  const snippet = snippetOf(item);
  return (
    <div className='space-y-1.5 text-left'>
      <p className={`flex items-center gap-1.5 text-[11px] font-medium ${label.tint}`}>
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${label.dot}`} />
        {label.hint}
      </p>
      <p className='text-xs font-medium leading-snug text-popover-foreground'>
        {name} · {where}
      </p>
      {snippet && (
        <p className='line-clamp-3 text-xs leading-snug text-muted-foreground'>{snippet}</p>
      )}
    </div>
  );
}

/** Fades the edges that have more chips beyond them; none when everything fits. */
function edgeMask(left: boolean, right: boolean): CSSProperties | undefined {
  if (!left && !right) {
    return undefined;
  }
  const start = left ? `transparent, #000 ${EDGE_FADE_PX}px` : '#000';
  const end = right ? `#000 calc(100% - ${EDGE_FADE_PX}px), transparent` : '#000';
  const mask = `linear-gradient(to right, ${start}, ${end})`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

interface RelatedContextStripProps {
  items: RelatedItem[];
  /** Keeps chip previews shut — while the popup is up they would float over it. */
  suppressPreviews?: boolean;
  onOpen: (item: RelatedItem, event: MouseEvent) => void;
  onDismiss: () => void;
}

export function RelatedContextStrip({
  items,
  suppressPreviews = false,
  onOpen,
  onDismiss,
}: RelatedContextStripProps): ReactElement {
  const reduceMotion = useReducedMotion();
  const [measureRef, bounds] = useMeasure<HTMLDivElement>();
  // Which chip's preview is open. Kept here, always controlled: a card that switched
  // between controlled and not would reopen by itself once the popup closed.
  const [previewId, setPreviewId] = useState<string | null>(null);
  useEffect(() => {
    if (suppressPreviews) {
      setPreviewId(null);
    }
  }, [suppressPreviews]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const hasItems = items.length > 0;
  const signature = useMemo(() => items.map(item => item.id).join('|'), [items]);

  const updateEdges = useCallback((): void => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const left = scroller.scrollLeft > 1;
    const right = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
    setEdges(prev => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  // Scroll position, size changes (composer resized, chips added or leaving) and a
  // mouse wheel all move the row. A vertical wheel is turned sideways only while the
  // row can still move that way, so it never swallows a page scroll.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!hasItems || !scroller) {
      return;
    }
    const onWheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }
      const max = scroller.scrollWidth - scroller.clientWidth;
      const next = Math.min(max, Math.max(0, scroller.scrollLeft + event.deltaY));
      if (max <= 0 || next === scroller.scrollLeft) {
        return;
      }
      event.preventDefault();
      scroller.scrollLeft = next;
    };
    const observer = new ResizeObserver(updateEdges);
    observer.observe(scroller);
    if (scroller.firstElementChild) {
      observer.observe(scroller.firstElementChild);
    }
    scroller.addEventListener('scroll', updateEdges, { passive: true });
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return (): void => {
      observer.disconnect();
      scroller.removeEventListener('scroll', updateEdges);
      scroller.removeEventListener('wheel', onWheel);
    };
  }, [hasItems, updateEdges]);

  // A new set of suggestions starts from the first chip.
  useEffect(() => {
    scrollerRef.current?.scrollTo({ left: 0 });
    updateEdges();
  }, [signature, updateEdges]);

  // Impression, so opens have a denominator. Labels and kinds only — never titles.
  useEffect(() => {
    if (!hasItems) {
      return;
    }
    globalClickTracker.trackManualEvent('RELATED_CONTEXT', 'SUGGESTIONS_SHOWN', undefined, {
      count: items.length,
      labels: items.map(item => item.label),
      kinds: items.map(item => item.kind),
    });
    // The signature is what changes when a new set is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const rowTransition: Transition = reduceMotion
    ? { duration: 0.12 }
    : {
        height: { type: 'spring', duration: 0.34, bounce: 0 },
        opacity: { duration: 0.2, ease: EASE_OUT },
      };

  const chipMotion = (index: number): MotionProps =>
    reduceMotion
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          exit: { opacity: 0 },
          transition: { duration: 0.12 },
        }
      : {
          layout: 'position',
          initial: { opacity: 0, y: 4, scale: 0.96, filter: 'blur(3px)' },
          animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
          exit: {
            opacity: 0,
            scale: 0.96,
            filter: 'blur(3px)',
            transition: { duration: 0.14, ease: EASE_OUT },
          },
          transition: {
            duration: 0.34,
            ease: EASE_OUT,
            delay: 0.06 + index * 0.05,
            layout: { type: 'spring', duration: 0.3, bounce: 0 },
          },
        };

  return (
    <AnimatePresence initial={false}>
      {hasItems && (
        <motion.div
          key='related-context'
          className='overflow-hidden'
          initial={{ height: 0, opacity: 0 }}
          animate={bounds.height ? { height: bounds.height, opacity: 1 } : { opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={rowTransition}
        >
          <div ref={measureRef}>
            <div
              role='region'
              aria-label='Related conversations'
              className='flex items-center gap-1.5 border-b border-chat-composer-border py-1 pl-2.5 pr-1.5'
            >
              <Sparkles
                aria-hidden
                className='size-3 shrink-0 text-muted-foreground/70'
                strokeWidth={2}
              />
              <span className='sr-only' aria-live='polite'>
                {items.length} related {items.length === 1 ? 'item' : 'items'}
              </span>

              {/* Padding inside the scroller keeps focus rings and shadows unclipped. */}
              <div
                ref={scrollerRef}
                className='no-scrollbar min-w-0 flex-1 overflow-x-auto overscroll-x-contain p-0.5'
                style={edgeMask(edges.left, edges.right)}
              >
                <div className='flex w-max items-center gap-1.5'>
                  <AnimatePresence mode='popLayout'>
                    {items.map((item, index) => {
                      const Icon = KINDS[item.kind].icon;
                      const label = LABELS[item.label];
                      return (
                        <motion.div key={item.id} className='shrink-0' {...chipMotion(index)}>
                          <HoverCard
                            open={!suppressPreviews && previewId === item.id}
                            onOpenChange={open =>
                              setPreviewId(current =>
                                open ? item.id : current === item.id ? null : current,
                              )
                            }
                            side='top'
                            align='start'
                            sideOffset={8}
                            openDelay={350}
                            closeDelay={80}
                            className='w-72 rounded-lg p-3'
                            trigger={
                              <button
                                type='button'
                                onClick={event => onOpen(item, event)}
                                className='group flex h-6 max-w-[20rem] items-center gap-1 rounded-[6px] bg-activity-chip px-1.5 text-xs leading-none text-muted-foreground transition-colors duration-150 hover:bg-activity-chip-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]'
                                data-track-category='CHAT_INPUT'
                                data-track-name='RELATED_CONTEXT_OPEN'
                                data-track-label={item.label}
                                data-track-metadata={JSON.stringify({
                                  kind: item.kind,
                                  rank: index + 1,
                                  confidence: Math.round(item.confidence * 100) / 100,
                                })}
                              >
                                <Icon
                                  aria-hidden
                                  className={`size-3 shrink-0 ${label.tint}`}
                                  strokeWidth={2.25}
                                />
                                <span className='shrink-0 font-medium text-foreground/90 group-hover:text-foreground'>
                                  {label.chip}
                                </span>
                                <span aria-hidden className='shrink-0 text-muted-foreground/50'>
                                  ·
                                </span>
                                <ChipWhere item={item} />
                              </button>
                            }
                          >
                            <Preview item={item} />
                          </HoverCard>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>

              <Tooltip content='Hide for this message' side='top' delayDuration={350}>
                <button
                  type='button'
                  onClick={onDismiss}
                  className='shrink-0 rounded-[6px] p-1 text-muted-foreground transition-colors duration-150 hover:bg-activity-chip-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  aria-label='Hide related conversations'
                  data-track-category='CHAT_INPUT'
                  data-track-name='RELATED_CONTEXT_DISMISS'
                  data-track-label='dismiss'
                >
                  <X className='size-3' strokeWidth={2.25} />
                </button>
              </Tooltip>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
