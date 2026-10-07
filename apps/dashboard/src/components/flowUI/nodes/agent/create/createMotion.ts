import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useReducedMotion, type TargetAndTransition, type Transition } from 'motion/react';

/**
 * Shared motion for what the chat drops onto the create canvas, so rows, pills
 * and the Schedule row all land the same way. The canvas root wraps everything
 * in `MotionConfig reducedMotion="user"`: under reduced motion the transforms
 * and layout moves are skipped and only the fades remain.
 *
 * A draft turn lands a whole plan at once, so entrances are staggered: rows come
 * in top to bottom, and each row's pills follow it left to right. Nothing waits
 * on the data; only the reveal is paced.
 */

/** How one row or pill arrives: a soft settle, no overshoot. */
export const CANVAS_ENTER_SPRING: Transition = {
  type: 'spring',
  visualDuration: 0.42,
  bounce: 0.1,
};

/** Siblings sliding to make room for a new row or pill. No bounce: nothing overshoots. */
export const CANVAS_LAYOUT_SPRING: Transition = { type: 'spring', duration: 0.3, bounce: 0 };

export const CANVAS_EXIT: Transition = { duration: 0.14, ease: 'easeOut' };

/** Between two rows that land together. */
export const ROW_STAGGER_S = 0.12;
/** Between a row and its first pill, and between pills. */
export const PILL_STAGGER_S = 0.06;
/** However much lands at once, nothing waits longer than this to start. */
const MAX_ENTRANCE_WAIT_S = 1.2;

/** A property row arriving in the list. */
export const ROW_FROM: TargetAndTransition = { opacity: 0, y: 8, filter: 'blur(6px)' };
export const ROW_EXIT: TargetAndTransition = { opacity: 0, transition: CANVAS_EXIT };

export function rowIn(delay: number): TargetAndTransition {
  return { opacity: 1, y: 0, filter: 'blur(0px)', transition: { ...CANVAS_ENTER_SPRING, delay } };
}

/** A capability pill popping into its row. */
export const CHIP_FROM: TargetAndTransition = {
  opacity: 0,
  scale: 0.94,
  y: 6,
  filter: 'blur(4px)',
};
export const CHIP_EXIT: TargetAndTransition = {
  opacity: 0,
  scale: 0.96,
  transition: CANVAS_EXIT,
};

export function chipIn(delay: number): TargetAndTransition {
  return {
    opacity: 1,
    scale: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { ...CANVAS_ENTER_SPRING, delay },
  };
}

const nowS = (): number => performance.now() / 1000;

/** When the next entrance may start, shared by every list on the canvas. */
let nextEntranceAt = 0;

/**
 * Seconds this entrance should wait so it starts `gap` after the one queued
 * before it. Zero when nothing is queued, so a single pill added by hand is
 * never held back.
 */
export function claimEntrance(gap: number, now = nowS()): number {
  const at = Math.min(Math.max(now, nextEntranceAt), now + MAX_ENTRANCE_WAIT_S);
  nextEntranceAt = at + gap;
  return at - now;
}

export interface CanvasEntrance {
  /** False while the canvas renders for the first time: what's there on load just shows. */
  live: () => boolean;
  /** The entrance delay of the row this list sits in, when that row is arriving. */
  rowDelay: number | null;
}

export const CanvasEntranceContext = createContext<CanvasEntrance>({
  live: () => false,
  rowDelay: null,
});

export function useCanvasEntrance(): CanvasEntrance {
  return useContext(CanvasEntranceContext);
}

/** Wraps an arriving row so the pill list inside it can follow it in. */
export function RowEntrance({
  delay,
  children,
}: {
  delay: number;
  children: ReactNode;
}): ReactElement {
  const { live } = useCanvasEntrance();
  return createElement(
    CanvasEntranceContext.Provider,
    { value: { live, rowDelay: delay } },
    children,
  );
}

/** `live()` for the canvas root: false during the first render, true after it commits. */
export function useLiveAfterMount(): () => boolean {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  return useRef(() => mounted.current).current;
}

/**
 * Entrance delays (seconds) for the keyed items one list renders. An item gets
 * its delay the first time it renders and keeps its start time, so re-renders
 * never restart it. Items present on the list's first render get none unless
 * `animateFirst`, and then `firstClaim` (when given) sets their wait. Items that
 * arrive later take a slot on the shared clock, `gap` after the last one.
 */
export function useEntranceDelays(
  animateFirst: boolean,
  gap: number,
): (key: string, firstClaim?: () => number) => number {
  const reduce = useReducedMotion();
  const starts = useRef(new Map<string, number>());
  const firstRender = useRef(true);
  const rendered = useRef(new Set<string>());
  rendered.current = new Set();

  useEffect(() => {
    firstRender.current = false;
    // Forget items that left, so one that comes back gets a fresh entrance.
    for (const key of starts.current.keys()) {
      if (!rendered.current.has(key)) starts.current.delete(key);
    }
  });

  return (key, firstClaim) => {
    rendered.current.add(key);
    const now = nowS();
    let at = starts.current.get(key);
    if (at === undefined) {
      if (reduce || (firstRender.current && !animateFirst)) at = 0;
      else if (firstRender.current && firstClaim) at = now + firstClaim();
      else at = now + claimEntrance(gap, now);
      starts.current.set(key, at);
    }
    return Math.max(0, at - now);
  };
}
