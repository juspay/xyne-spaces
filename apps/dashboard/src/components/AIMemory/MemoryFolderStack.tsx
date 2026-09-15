import { useCallback, useEffect, useLayoutEffect, useRef, type ReactElement } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  DIGITAL_TWIN_EASE_OUT,
  DIGITAL_TWIN_MOTION,
} from '@/components/ClawAgents/digitalTwin/motion';
import type { MemoryFolderCopy } from './memoryFolderCopy';
import {
  folderFillPath,
  folderStrokePath,
  GLYPH_H,
  GLYPH_VIEW_H,
  GLYPH_VIEW_W,
  TAB_STEP,
} from './memoryFolderGlyph';

/**
 * Motion model from Figma pose sheet 1739:101951 + composed rest 1710:100902.
 *
 * `progress` is a float index in [0, n-1]. Wheel (deltaX or mapped deltaY),
 * trackpad, and arrow keys advance it. Each memory is one isomorphic Union
 * (890×1400). Notch Y slides 100px per slot; stack X/Y lerp the 1710 rest
 * poses. Layout scale stays paneH/1055 so coverage/peek match Figma; the
 * extra glyph height clips at the stage.
 *
 * `relativeSlot = memoryIndex - floatIndex` (covering −1 … back +3).
 * Past covering continues the 90→609 travel and is clipped — no folder fade.
 * Past back keeps x at 0 and continues tabY downward.
 */
const DESIGN_W = 890;
const DESIGN_H = 1055;
/** Figma pane 1408 − stack origin 704. Keeps the 95px covering peek. */
const STACK_FROM_RIGHT = 704;
const SLOT_MIN = -1;
const SLOT_MAX = 3;
const COVERING_TRAVEL = 1;
const POOL_SIZE = 9;

/** Rest poses in Figma stack-group coordinates: covering, open, +1, +2, +3. */
const POSES = [
  { x: 609, y: -58 },
  { x: 90, y: 0 },
  { x: 60, y: 0 },
  { x: 30, y: 0 },
  { x: 0, y: 0 },
] as const;

const WHEEL_PIXELS_PER_FOLDER = 260;
const SNAP_LAMBDA = 11;
const WHEEL_IDLE_MS = 140;
const PREFETCH_RADIUS = 8;
const FOCUS_HYSTERESIS = 0.2;
const BLUR_PAST_EXIT = 6;

interface Pose {
  x: number;
  y: number;
  tabY: number;
  blur: number;
}

interface WrittenStyle {
  transform: string;
  opacity: string;
  filter: string;
  zIndex: string;
  summary: string;
  tabY: number;
}

interface MemoryFolderStackProps {
  copies: MemoryFolderCopy[];
  focusedIndex: number;
  onFocusedIndexChange: (index: number) => void;
  onNeedMore?: () => void;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const wrapIndex = (value: number, size: number): number => ((value % size) + size) % size;

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

const poseAt = (relativeSlot: number, sizeH: number, out: Pose): void => {
  const scale = sizeH / DESIGN_H;
  out.tabY = TAB_STEP * relativeSlot;
  out.blur = 0;

  if (relativeSlot <= SLOT_MIN) {
    const extra = SLOT_MIN - relativeSlot;
    const covering = POSES[0];
    const open = POSES[1];
    out.x = (covering.x + (covering.x - open.x) * extra) * scale;
    out.y = (covering.y + (covering.y - open.y) * extra) * scale;
    if (extra > 0) out.blur = BLUR_PAST_EXIT + extra * 4;
    return;
  }

  if (relativeSlot >= SLOT_MAX) {
    out.x = POSES[4].x * scale;
    out.y = POSES[4].y * scale;
    return;
  }

  const low = Math.floor(relativeSlot);
  const high = Math.ceil(relativeSlot);
  const t = relativeSlot - low;
  const from = POSES[low + 1] ?? POSES[0];
  const to = POSES[high + 1] ?? POSES[4];
  out.x = (from.x + (to.x - from.x) * t) * scale;
  out.y = (from.y + (to.y - from.y) * t) * scale;
};

const wheelDelta = (event: WheelEvent): number => {
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? WHEEL_PIXELS_PER_FOLDER : 1;
  const dx = event.deltaX * scale;
  const dy = event.deltaY * scale;
  return Math.abs(dx) >= Math.abs(dy) ? dx : dy;
};

const emptyWritten = (): WrittenStyle => ({
  transform: '',
  opacity: '',
  filter: '',
  zIndex: '',
  summary: '',
  tabY: Number.NaN,
});

const hideFolder = (el: HTMLDivElement, written: WrittenStyle): void => {
  if (written.opacity !== '0') {
    el.style.opacity = '0';
    written.opacity = '0';
  }
  if (written.filter !== 'none') {
    el.style.filter = 'none';
    written.filter = 'none';
  }
  el.style.pointerEvents = 'none';
};

const FolderShadowFilter = ({ id }: { id: string }): ReactElement => (
  <filter
    id={id}
    x='0'
    y='0'
    width={GLYPH_VIEW_W}
    height={GLYPH_VIEW_H}
    filterUnits='userSpaceOnUse'
    colorInterpolationFilters='sRGB'
  >
    <feFlood floodOpacity='0' result='BackgroundImageFix' />
    <feColorMatrix
      in='SourceAlpha'
      type='matrix'
      values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
      result='hardAlpha'
    />
    <feOffset dy='7' />
    <feGaussianBlur stdDeviation='7' />
    <feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.04 0' />
    <feBlend mode='normal' in2='BackgroundImageFix' result='effect1_dropShadow' />
    <feColorMatrix
      in='SourceAlpha'
      type='matrix'
      values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
      result='hardAlpha'
    />
    <feOffset dy='26' />
    <feGaussianBlur stdDeviation='13' />
    <feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.03 0' />
    <feBlend mode='normal' in2='effect1_dropShadow' result='effect2_dropShadow' />
    <feColorMatrix
      in='SourceAlpha'
      type='matrix'
      values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
      result='hardAlpha'
    />
    <feOffset dy='59' />
    <feGaussianBlur stdDeviation='17.5' />
    <feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.02 0' />
    <feBlend mode='normal' in2='effect2_dropShadow' result='effect3_dropShadow' />
    <feColorMatrix
      in='SourceAlpha'
      type='matrix'
      values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
      result='hardAlpha'
    />
    <feOffset dy='105' />
    <feGaussianBlur stdDeviation='21' />
    <feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.01 0' />
    <feBlend mode='normal' in2='effect3_dropShadow' result='effect4_dropShadow' />
    <feBlend mode='normal' in='SourceGraphic' in2='effect4_dropShadow' result='shape' />
  </filter>
);

export function MemoryFolderStack({
  copies,
  focusedIndex,
  onFocusedIndexChange,
  onNeedMore,
}: MemoryFolderStackProps): ReactElement {
  const reduceMotion = useReducedMotion() ?? false;
  const stageRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const folderRefs = useRef<Array<HTMLDivElement | null>>(
    Array.from({ length: POOL_SIZE }, () => null),
  );
  const fillRefs = useRef<Array<SVGPathElement | null>>(
    Array.from({ length: POOL_SIZE }, () => null),
  );
  const strokeRefs = useRef<Array<SVGPathElement | null>>(
    Array.from({ length: POOL_SIZE }, () => null),
  );
  const summaryRefs = useRef<Array<HTMLDivElement | null>>(
    Array.from({ length: POOL_SIZE }, () => null),
  );
  const titleRefs = useRef<Array<HTMLHeadingElement | null>>(
    Array.from({ length: POOL_SIZE }, () => null),
  );
  const hookRefs = useRef<Array<HTMLParagraphElement | null>>(
    Array.from({ length: POOL_SIZE }, () => null),
  );
  const metaRefs = useRef<Array<HTMLParagraphElement | null>>(
    Array.from({ length: POOL_SIZE }, () => null),
  );
  const copiesRef = useRef(copies);
  const focusedRef = useRef(focusedIndex);
  const onFocusedRef = useRef(onFocusedIndexChange);
  const onNeedMoreRef = useRef(onNeedMore);
  const reduceRef = useRef(reduceMotion);
  const floatIndexRef = useRef(focusedIndex);
  const targetIndexRef = useRef(focusedIndex);
  const wheelingRef = useRef(false);
  const rafRef = useRef(0);
  const idleTimerRef = useRef(0);
  const lastTimeRef = useRef(0);
  const ignoreFocusSyncRef = useRef(false);
  const sizeRef = useRef({ w: DESIGN_W, h: DESIGN_H });
  const poseRef = useRef<Pose>({ x: 0, y: 0, tabY: 0, blur: 0 });
  const assignedIdRef = useRef<Array<string | null>>(Array.from({ length: POOL_SIZE }, () => null));
  const writtenRef = useRef<WrittenStyle[]>(Array.from({ length: POOL_SIZE }, emptyWritten));

  copiesRef.current = copies;
  focusedRef.current = focusedIndex;
  onFocusedRef.current = onFocusedIndexChange;
  onNeedMoreRef.current = onNeedMore;
  reduceRef.current = reduceMotion;

  const measure = useCallback((): void => {
    const stage = stageRef.current;
    const stack = stackRef.current;
    if (!stage || !stack) return;
    const paneH = stage.clientHeight || DESIGN_H;
    const paneW = stage.clientWidth || DESIGN_W;
    const scale = paneH / DESIGN_H;
    const width = DESIGN_W * scale;
    const glyphH = GLYPH_H * scale;
    const stackLeft = paneW - STACK_FROM_RIGHT * scale;
    sizeRef.current = { w: width, h: paneH };
    stack.style.left = `${stackLeft}px`;
    stack.style.setProperty('--folder-w', `${width}px`);
    stack.style.setProperty('--folder-h', `${glyphH}px`);
    stage.style.setProperty('--stack-hit-left', `${Math.max(0, stackLeft)}px`);
  }, []);

  const renderFolders = useCallback((): void => {
    const items = copiesRef.current;
    const count = items.length;
    if (count === 0) return;

    const maxIndex = count - 1;
    const floatIndex = clamp(floatIndexRef.current, 0, maxIndex);
    const reduce = reduceRef.current;
    const pose = poseRef.current;
    const { h: sizeH } = sizeRef.current;
    const windowStart = Math.floor(floatIndex + SLOT_MIN - COVERING_TRAVEL);
    const windowEnd = Math.ceil(floatIndex + SLOT_MAX);

    for (let pool = 0; pool < POOL_SIZE; pool += 1) {
      const el = folderRefs.current[pool];
      const written = writtenRef.current[pool];
      if (!el || !written) continue;

      let memoryIndex = -1;
      for (let idx = windowStart; idx <= windowEnd; idx += 1) {
        if (idx < 0 || idx > maxIndex) continue;
        if (wrapIndex(idx, POOL_SIZE) === pool) {
          memoryIndex = idx;
          break;
        }
      }

      const copy = memoryIndex >= 0 ? items[memoryIndex] : undefined;
      if (!copy) {
        hideFolder(el, written);
        assignedIdRef.current[pool] = null;
        continue;
      }

      const relativeSlot = memoryIndex - floatIndex;
      poseAt(relativeSlot, sizeH, pose);

      const nextOpacity = '1';
      const nextTransform = `translate3d(${pose.x}px, ${pose.y}px, 0)`;
      const nextZ = String(Math.round(80 - relativeSlot * 10));
      const nextFilter =
        !reduce && relativeSlot < SLOT_MIN && pose.blur > 0.05
          ? `blur(${pose.blur.toFixed(2)}px)`
          : 'none';

      if (written.opacity !== nextOpacity) {
        el.style.opacity = nextOpacity;
        written.opacity = nextOpacity;
      }
      if (written.transform !== nextTransform) {
        el.style.transform = nextTransform;
        written.transform = nextTransform;
      }
      if (written.zIndex !== nextZ) {
        el.style.zIndex = nextZ;
        written.zIndex = nextZ;
      }
      if (written.filter !== nextFilter) {
        el.style.filter = nextFilter;
        written.filter = nextFilter;
      }
      el.style.pointerEvents = 'none';

      if (written.tabY !== pose.tabY) {
        written.tabY = pose.tabY;
        const fill = fillRefs.current[pool];
        const stroke = strokeRefs.current[pool];
        if (fill) fill.setAttribute('d', folderFillPath(pose.tabY));
        if (stroke) stroke.setAttribute('d', folderStrokePath(pose.tabY));
      }

      if (assignedIdRef.current[pool] !== copy.id) {
        assignedIdRef.current[pool] = copy.id;
        const title = titleRefs.current[pool];
        const hook = hookRefs.current[pool];
        const meta = metaRefs.current[pool];
        if (title) title.textContent = copy.title;
        if (hook) hook.textContent = copy.hook;
        if (meta) meta.textContent = copy.metaLine;
      }

      const summary = summaryRefs.current[pool];
      if (summary) {
        const absSlot = Math.abs(relativeSlot);
        const nextSummary = String(absSlot < 0.001 ? 1 : clamp(1 - absSlot * 2.4, 0, 1));
        if (written.summary !== nextSummary) {
          summary.style.opacity = nextSummary;
          written.summary = nextSummary;
        }
      }
    }

    const rounded = Math.round(floatIndex);
    const nearInteger = Math.abs(floatIndex - rounded) <= 0.5 - FOCUS_HYSTERESIS;
    if (rounded !== focusedRef.current && (nearInteger || !wheelingRef.current)) {
      ignoreFocusSyncRef.current = true;
      onFocusedRef.current(rounded);
    }
    if (rounded >= maxIndex - PREFETCH_RADIUS) onNeedMoreRef.current?.();
  }, []);

  const stopLoop = useCallback((): void => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    lastTimeRef.current = 0;
  }, []);

  const tick = useCallback(
    (now: number): void => {
      const maxIndex = Math.max(copiesRef.current.length - 1, 0);
      const last = lastTimeRef.current || now;
      const dt = Math.min(0.05, (now - last) / 1000);
      lastTimeRef.current = now;

      if (!wheelingRef.current) {
        const target = clamp(targetIndexRef.current, 0, maxIndex);
        const current = floatIndexRef.current;
        if (reduceRef.current) {
          floatIndexRef.current = target;
        } else {
          const next = current + (target - current) * (1 - Math.exp(-SNAP_LAMBDA * dt));
          floatIndexRef.current = Math.abs(target - next) < 0.0008 ? target : next;
        }
      }

      renderFolders();

      const snapped =
        !wheelingRef.current && Math.abs(floatIndexRef.current - targetIndexRef.current) < 0.0008;
      if (snapped) {
        stopLoop();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [renderFolders, stopLoop],
  );

  const startLoop = useCallback((): void => {
    if (rafRef.current) return;
    lastTimeRef.current = 0;
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const snapTo = useCallback(
    (index: number, instant: boolean): void => {
      const maxIndex = Math.max(copiesRef.current.length - 1, 0);
      const next = clamp(index, 0, maxIndex);
      targetIndexRef.current = next;
      wheelingRef.current = false;
      if (instant || reduceRef.current) {
        floatIndexRef.current = next;
        renderFolders();
        stopLoop();
        return;
      }
      startLoop();
    },
    [renderFolders, startLoop, stopLoop],
  );

  useLayoutEffect(() => {
    measure();
    const maxIndex = Math.max(copies.length - 1, 0);
    const next = clamp(focusedIndex, 0, maxIndex);
    copiesRef.current = copies;
    if (ignoreFocusSyncRef.current) {
      ignoreFocusSyncRef.current = false;
      renderFolders();
      return;
    }
    if (wheelingRef.current) {
      renderFolders();
      return;
    }
    if (Math.round(floatIndexRef.current) === next && Math.round(targetIndexRef.current) === next) {
      renderFolders();
      return;
    }
    snapTo(next, reduceMotion);
  }, [copies, focusedIndex, measure, reduceMotion, renderFolders, snapTo]);

  useEffect(() => {
    const stage = stageRef.current;
    const hit = hitRef.current;
    const stack = stackRef.current;
    measure();
    renderFolders();
    hit?.focus({ preventScroll: true });
    if (!stage) return undefined;

    const resize = new ResizeObserver(() => {
      measure();
      renderFolders();
    });
    if (stack) resize.observe(stack);
    resize.observe(stage);

    if (copies.length <= 1) {
      return (): void => {
        resize.disconnect();
        stopLoop();
      };
    }

    const beginIdleSnap = (): void => {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => {
        const maxIndex = Math.max(copiesRef.current.length - 1, 0);
        targetIndexRef.current = clamp(Math.round(floatIndexRef.current), 0, maxIndex);
        wheelingRef.current = false;
        startLoop();
      }, WHEEL_IDLE_MS);
    };

    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey) return;

      const dx = event.deltaX;
      const dy = event.deltaY;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const target = event.target;
      const detail = detailRef.current;
      if (!horizontal && detail && target instanceof Node && detail.contains(target)) {
        const canScroll = detail.scrollHeight - detail.clientHeight > 1;
        const atTop = detail.scrollTop <= 0;
        const atBottom = detail.scrollTop + detail.clientHeight >= detail.scrollHeight - 1;
        const scrollingDown = dy > 0;
        if (canScroll && !((scrollingDown && atBottom) || (!scrollingDown && atTop))) return;
      }

      event.preventDefault();
      const maxIndex = Math.max(copiesRef.current.length - 1, 0);
      const delta = wheelDelta(event);
      if (delta === 0) return;

      if (reduceRef.current) {
        if (Math.abs(delta) < 12) return;
        snapTo(targetIndexRef.current + (delta > 0 ? 1 : -1), true);
        return;
      }

      stopLoop();
      wheelingRef.current = true;
      floatIndexRef.current = clamp(
        floatIndexRef.current + delta / WHEEL_PIXELS_PER_FOLDER,
        0,
        maxIndex,
      );
      targetIndexRef.current = clamp(Math.round(floatIndexRef.current), 0, maxIndex);
      renderFolders();
      beginIdleSnap();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return;
      const maxIndex = Math.max(copiesRef.current.length - 1, 0);
      const nextKeys =
        event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown';
      const prevKeys =
        event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp';
      if (nextKeys) {
        event.preventDefault();
        snapTo(targetIndexRef.current + 1, reduceRef.current);
      } else if (prevKeys) {
        event.preventDefault();
        snapTo(targetIndexRef.current - 1, reduceRef.current);
      } else if (event.key === 'Home') {
        event.preventDefault();
        snapTo(0, reduceRef.current);
      } else if (event.key === 'End') {
        event.preventDefault();
        snapTo(maxIndex, reduceRef.current);
      }
    };

    stage.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);

    return (): void => {
      stage.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(idleTimerRef.current);
      resize.disconnect();
      stopLoop();
    };
  }, [copies.length, measure, renderFolders, snapTo, startLoop, stopLoop]);

  const activeCopy = copies[clamp(focusedIndex, 0, Math.max(copies.length - 1, 0))];

  return (
    <div
      ref={stageRef}
      className='memory-folders'
      data-testid='memory-folders'
      aria-label='Memories folder browser'
    >
      <header className='memory-folders__header'>
        <svg viewBox='0 0 16 16' fill='none' aria-hidden='true'>
          <path
            d='M2.5 4.5 8 1.75 13.5 4.5V7.25L8 10 2.5 7.25V4.5Z'
            stroke='currentColor'
            strokeWidth='1.2'
            strokeLinejoin='round'
          />
          <path
            d='M2.5 8.25 8 11 13.5 8.25'
            stroke='currentColor'
            strokeWidth='1.2'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
          <path
            d='M2.5 11.25 8 14 13.5 11.25'
            stroke='currentColor'
            strokeWidth='1.2'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
        <h1>Memories</h1>
      </header>

      <div ref={detailRef} className='memory-folders__detail' aria-live='polite'>
        <AnimatePresence mode='sync'>
          {activeCopy && (
            <motion.article
              key={activeCopy.id}
              className='memory-folders__detail-card'
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: reduceMotion ? 1 : 0 }}
              transition={{
                duration: reduceMotion ? 0 : DIGITAL_TWIN_MOTION.state,
                ease: DIGITAL_TWIN_EASE_OUT,
              }}
            >
              <p className='memory-folders__eyebrow'>{activeCopy.eyebrow}</p>
              <h2 className='memory-folders__title'>{activeCopy.title}</h2>
              <p className='memory-folders__body'>{activeCopy.body}</p>
              <div className='memory-folders__section'>
                <h3>Where</h3>
                <p>{activeCopy.sourcePlace}</p>
                {activeCopy.evidence && (
                  <p className='memory-folders__quote'>“{activeCopy.evidence}”</p>
                )}
              </div>
              <div className='memory-folders__section'>
                <h3>How</h3>
                <p>{activeCopy.how}</p>
              </div>
              <div className='memory-folders__section'>
                <h3>When</h3>
                <p>
                  {activeCopy.whenRelative}
                  {'\n'}
                  {activeCopy.whenAbsolute}
                </p>
              </div>
              {activeCopy.after && (
                <div className='memory-folders__section'>
                  <h3>After</h3>
                  <p>{activeCopy.after}</p>
                </div>
              )}
            </motion.article>
          )}
        </AnimatePresence>
      </div>

      <div ref={stackRef} className='memory-folders__stack' aria-hidden='true'>
        {Array.from({ length: POOL_SIZE }, (_, pool) => {
          const filterId = `memory-folder-shadow-${pool}`;
          return (
            <div
              key={pool}
              className='memory-folders__folder'
              ref={node => {
                folderRefs.current[pool] = node;
              }}
            >
              <div className='memory-folders__silhouette'>
                <svg viewBox={`0 0 ${GLYPH_VIEW_W} ${GLYPH_VIEW_H}`} fill='none'>
                  <defs>
                    <FolderShadowFilter id={filterId} />
                  </defs>
                  <g filter={`url(#${filterId})`}>
                    <path
                      fill='#fff'
                      d={folderFillPath(0)}
                      ref={node => {
                        fillRefs.current[pool] = node;
                      }}
                    />
                    <path
                      fill='none'
                      stroke='#232229'
                      strokeOpacity={0.1}
                      d={folderStrokePath(0)}
                      ref={node => {
                        strokeRefs.current[pool] = node;
                      }}
                    />
                  </g>
                </svg>
              </div>
              <div
                className='memory-folders__summary'
                ref={node => {
                  summaryRefs.current[pool] = node;
                }}
              >
                <h2
                  className='memory-folders__folder-title'
                  ref={node => {
                    titleRefs.current[pool] = node;
                  }}
                >
                  Memory
                </h2>
                <p
                  className='memory-folders__hook'
                  ref={node => {
                    hookRefs.current[pool] = node;
                  }}
                />
                <p
                  className='memory-folders__meta'
                  ref={node => {
                    metaRefs.current[pool] = node;
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div
        ref={hitRef}
        className='memory-folders__hit'
        tabIndex={0}
        role='slider'
        aria-label='Memory folder stack'
        aria-orientation='horizontal'
        aria-valuemin={1}
        aria-valuemax={Math.max(copies.length, 1)}
        aria-valuenow={clamp(focusedIndex, 0, Math.max(copies.length - 1, 0)) + 1}
        aria-valuetext={activeCopy?.title}
        data-track-category='XyneAI'
        data-track-name='MEMORY_FOLDER_STACK'
      />

      {copies.length > 1 && <div className='memory-folders__hint'>Scroll or use ← →</div>}
    </div>
  );
}

export default MemoryFolderStack;
