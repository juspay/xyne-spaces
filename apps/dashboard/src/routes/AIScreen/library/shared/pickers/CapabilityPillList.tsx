import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CANVAS_LAYOUT_SPRING,
  CHIP_EXIT,
  CHIP_FROM,
  PILL_STAGGER_S,
  chipIn,
  useCanvasEntrance,
  useEntranceDelays,
} from '@/components/flowUI/nodes/agent/create/createMotion';
import { cn } from '@/utils/classNames';

export interface CapabilityPill {
  /**
   * The same key for an item whether it is suggested or selected, so accepting a
   * suggestion restyles the pill in place instead of popping it out and back in.
   */
  key: string;
  node: ReactNode;
}

interface CapabilityPillListProps {
  pills: CapabilityPill[];
  /** The "+ Add" button. The same element whether the row is empty or not, always last. */
  add: ReactNode;
  className?: string;
}

/**
 * Viewing a saved agent: pills show but can't be opened or removed, and there
 * is no Add. "+N more" still opens the row.
 */
export const CapabilityPillsReadOnly = createContext(false);

/** Space between pills (gap-2). */
const GAP_PX = 8;
/** One line of pills (h-9). */
const ROW_PX = 36;
/** The row opening or closing: settles without overshoot. */
const HEIGHT_SPRING = { type: 'spring', visualDuration: 0.32, bounce: 0 } as const;
/** "+N more" before it has rendered once and can be measured. */
const MORE_ESTIMATE_PX = 84;

/** How many pills show on the one line, and how wide they are together. Null: all of them. */
interface Fit {
  count: number;
  width: number;
}

/** Pills in the row as laid out, skipping ones on their way out (popLayout lifts those). */
function laidOutPills(row: HTMLElement): HTMLElement[] {
  return Array.from(row.children).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      el.dataset['pillKey'] !== undefined &&
      getComputedStyle(el).position !== 'absolute',
  );
}

/**
 * The first pills that fit on one line next to "+N more" and Add, or null when
 * every pill fits. At least one pill always shows.
 */
export function fitPills(
  widths: number[],
  available: number,
  addWidth: number,
  moreWidth: number,
): Fit | null {
  const addSpace = addWidth > 0 ? addWidth + GAP_PX : 0;
  const total = widths.reduce((sum, width) => sum + width, 0) + GAP_PX * (widths.length - 1);
  if (widths.length === 0 || total + addSpace <= available) return null;
  const room = available - addSpace - moreWidth - GAP_PX;
  let width = 0;
  let count = 0;
  for (const pill of widths) {
    const next = width + (count > 0 ? GAP_PX : 0) + pill;
    if (next > room) break;
    width = next;
    count += 1;
  }
  if (count === 0) return { count: 1, width: Math.max(0, Math.min(widths[0] ?? 0, room)) };
  return { count, width };
}

const MORE_CHIP =
  'inline-flex h-9 shrink-0 items-center rounded-xl bg-[color-mix(in_srgb,hsl(var(--foreground))_4%,hsl(var(--background)))] px-2.5 text-sm font-[450] leading-[1.3] tracking-[-0.1px] text-muted-foreground outline-none transition-colors hover:bg-[color-mix(in_srgb,hsl(var(--foreground))_7%,hsl(var(--background)))] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring';

/**
 * Profile-layout pill row on the create canvas: one line. Pills that don't fit
 * fold into "+N more", which opens the row up to show them all. Pills the chat
 * (or the user) adds pop in one after another; the rest, and the trailing
 * "+ Add", slide to make room. In a row that is itself arriving, the pills
 * follow the row in, left to right. Pills already there when the canvas loads
 * stay put.
 */
export function CapabilityPillList({
  pills,
  add,
  className,
}: CapabilityPillListProps): ReactElement {
  const seen = new Set<string>();
  const unique = pills.filter(pill => {
    if (seen.has(pill.key)) return false;
    seen.add(pill.key);
    return true;
  });

  const entrance = useCanvasEntrance();
  // Read once: a list that mounts after the canvas has loaded (a row the chat just
  // filled) animates its first pills; one that loaded with the canvas doesn't.
  const [animateFirst] = useState(entrance.live);
  const delay = useEntranceDelays(animateFirst, PILL_STAGGER_S);
  const rowDelay = entrance.rowDelay;
  // Pills in an arriving row follow the row in, one step apart.
  const afterRow = (step: number): (() => number) | undefined =>
    rowDelay === null ? undefined : (): number => rowDelay + step * PILL_STAGGER_S;

  const readOnly = useContext(CapabilityPillsReadOnly);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  /** What the user asked for: the row's height follows this. */
  const [open, setOpen] = useState(false);
  /**
   * Pills wrap onto more lines. Turns on as the row opens and off only once it
   * has finished closing, so the lines fold away under the shrinking height
   * instead of snapping back first.
   */
  const [wrapped, setWrapped] = useState(false);
  const [resizing, setResizing] = useState(false);
  const keys = unique.map(pill => pill.key).join('\n');

  // Folded, every pill stays laid out on one line (the ones past the fold are
  // clipped), so their widths are always measurable and entrances still play.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const row = rowRef.current;
    if (wrapped || !container || !row) return undefined;
    const measure = (): void => {
      const next = fitPills(
        laidOutPills(row).map(el => el.offsetWidth),
        container.clientWidth,
        addRef.current?.offsetWidth ?? 0,
        moreRef.current?.offsetWidth || MORE_ESTIMATE_PX,
      );
      setFit(prev =>
        prev === next || (prev && next && prev.count === next.count && prev.width === next.width)
          ? prev
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const el of laidOutPills(row)) observer.observe(el);
    if (addRef.current) observer.observe(addRef.current);
    if (moreRef.current) observer.observe(moreRef.current);
    return (): void => observer.disconnect();
  }, [wrapped, keys, fit?.count]);

  const folded = !wrapped && fit !== null;
  const shown = fit?.count ?? unique.length;

  return (
    // One line tall until opened. Opening grows the height to fit every line
    // and fades the folded pills in; closing does the reverse.
    <motion.div
      initial={false}
      animate={{ height: open ? 'auto' : ROW_PX }}
      transition={HEIGHT_SPRING}
      onAnimationStart={() => setResizing(true)}
      onAnimationComplete={() => {
        setResizing(false);
        if (!open) setWrapped(false);
      }}
      className={cn('w-full min-w-0', resizing && 'overflow-hidden')}
    >
      <div
        ref={containerRef}
        className={cn(
          'relative flex w-full min-w-0 items-center gap-2',
          wrapped ? 'flex-wrap' : 'flex-nowrap',
          className,
        )}
      >
        <div
          ref={rowRef}
          className={cn(
            wrapped ? 'contents' : 'flex shrink-0 items-center gap-2',
            // Clip sideways only, so a pill's entrance (a small rise) isn't cut off.
            folded && 'overflow-x-clip',
          )}
          style={folded ? { width: fit.width } : undefined}
        >
          <AnimatePresence initial={animateFirst} mode='popLayout'>
            {unique.map((pill, index) => {
              const past = index >= shown && !open;
              return (
                <motion.span
                  key={pill.key}
                  data-pill-key={pill.key}
                  layout='position'
                  // Slide only when pills come and go, not when the row opens or
                  // closes: then everything re-flows at once and just the height moves.
                  layoutDependency={keys}
                  className='inline-flex shrink-0'
                  initial={CHIP_FROM}
                  animate={chipIn(delay(pill.key, afterRow(index + 1)))}
                  exit={CHIP_EXIT}
                  transition={{ layout: CANVAS_LAYOUT_SPRING }}
                  aria-hidden={past || undefined}
                >
                  <span
                    className={cn(
                      'inline-flex transition-opacity duration-200 ease-out',
                      past && 'opacity-0',
                    )}
                    // Past the fold, or viewing a saved agent: nothing to click.
                    inert={past || readOnly}
                  >
                    {pill.node}
                  </span>
                </motion.span>
              );
            })}
          </AnimatePresence>
        </div>
        {fit !== null || wrapped ? (
          <button
            ref={moreRef}
            type='button'
            onClick={() => {
              if (!open) setWrapped(true);
              setOpen(!open);
            }}
            aria-expanded={open}
            data-track-category='Claw Agents'
            data-track-name={open ? 'Capability row: show less' : 'Capability row: show more'}
            data-testid='capability-pills-more'
            className={MORE_CHIP}
          >
            {open ? 'Show less' : `+${unique.length - shown} more`}
          </button>
        ) : null}
        {readOnly ? null : (
          <motion.span
            ref={addRef}
            key='__add'
            layout='position'
            layoutDependency={keys}
            className='inline-flex shrink-0 self-center'
            initial={animateFirst ? CHIP_FROM : false}
            animate={chipIn(delay('__add', afterRow(unique.length + 1)))}
            transition={{ layout: CANVAS_LAYOUT_SPRING }}
          >
            {add}
          </motion.span>
        )}
      </div>
    </motion.div>
  );
}
