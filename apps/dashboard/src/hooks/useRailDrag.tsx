import React from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
  animate,
  motion,
  motionValue,
  useMotionTemplate,
  useReducedMotion,
  useSpring,
  useTransform,
  useVelocity,
  type MotionValue,
} from 'framer-motion';
import { cn } from '../utils/classNames';

const DRAG_THRESHOLD = 4;
const TILE = 32;
const ROW_HEIGHT = 36;
const ROW_GLYPH_X = 4;
const ROW_GLYPH_Y = 2;
const TILE_LIFT = 1.05;
const ROW_LIFT = 1.02;
const HIDE_SCALE = 0.94;
const MAX_TILT = 6;
const RAIL_REACH = 72;
const EDGE_ZONE = 40;
const EDGE_SPEED = 12;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_OUT_CURVE = [0.23, 1, 0.32, 1] as const;
const DRAG_CURSOR_CSS = '*{cursor:grabbing!important;user-select:none!important}';

type Origin = 'rail' | 'more';

type Intent =
  | { kind: 'none' }
  | { kind: 'rail'; index: number }
  | { kind: 'hide'; via: 'button' | 'panel' };

export type RailDrop =
  | { kind: 'move'; id: string; to: number }
  | { kind: 'add'; id: string; at: number }
  | { kind: 'remove'; id: string };

interface DragSession {
  origin: Origin;
  label: string;
  glyph: Node[];
  slot: number | null;
}

interface SessionStore {
  get: () => DragSession | null;
  set: (session: DragSession | null) => void;
  subscribe: (listener: () => void) => () => void;
}

interface DragValues {
  px: MotionValue<number>;
  py: MotionValue<number>;
  morph: MotionValue<number>;
  scale: MotionValue<number>;
  shadow: MotionValue<number>;
  opacity: MotionValue<number>;
  hint: MotionValue<number>;
  rowWidth: MotionValue<number>;
  rowGrabX: MotionValue<number>;
  rowGrabY: MotionValue<number>;
  tileGrabX: MotionValue<number>;
  tileGrabY: MotionValue<number>;
}

interface PointerDrag {
  phase: 'press' | 'drag' | 'settle';
  origin: Origin;
  id: string;
  pointerId: number;
  handle: HTMLElement;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  ids: string[];
  rects: DOMRect[];
  sourceRect: DOMRect | null;
  moreRect: DOMRect | null;
  railRect: DOMRect | null;
  panelRect: DOMRect | null;
  listTop: number;
  stride: number;
  fromIndex: number;
  intent: Intent;
  sourceShift: number;
  startScroll: number;
  canHide: boolean;
  morphTarget: number;
  scaleTarget: number;
  hintTarget: number;
  frame: number;
}

const createSessionStore = (): SessionStore => {
  let session: DragSession | null = null;
  const listeners = new Set<() => void>();
  return {
    get: (): DragSession | null => session,
    set: (next): void => {
      session = next;
      listeners.forEach(listener => listener());
    },
    subscribe: (listener): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
};

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

const within = (rect: DOMRect, x: number, y: number, pad: number): boolean =>
  x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;

const socketOf = (element: HTMLElement): HTMLElement | null =>
  element.querySelector<HTMLElement>(':scope > [data-rail-socket]');

const contentOf = (element: HTMLElement): HTMLElement[] =>
  Array.from(element.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && !child.hasAttribute('data-rail-socket'),
  );

const sameIntent = (a: Intent, b: Intent): boolean => {
  if (a.kind === 'rail' && b.kind === 'rail') return a.index === b.index;
  if (a.kind === 'hide' && b.kind === 'hide') return a.via === b.via;
  return a.kind === b.kind;
};

const orderAfter = (ids: string[], drop: RailDrop): string[] => {
  if (drop.kind === 'remove') return ids.filter(id => id !== drop.id);
  if (drop.kind === 'add') return [...ids.slice(0, drop.at), drop.id, ...ids.slice(drop.at)];
  const next = ids.filter(id => id !== drop.id);
  next.splice(drop.to, 0, drop.id);
  return next;
};

export const preventNativeDrag = (event: React.DragEvent): void => event.preventDefault();

const RailDragLayer: React.FC<{
  store: SessionStore;
  values: DragValues;
  layerRef: React.RefObject<HTMLDivElement | null>;
  reduceMotion: boolean;
}> = ({ store, values, layerRef, reduceMotion }) => {
  const session = React.useSyncExternalStore(store.subscribe, store.get);
  const velocity = useVelocity(values.px);
  const tiltTarget = useTransform(velocity, [-1600, 0, 1600], [-MAX_TILT, 0, MAX_TILT], {
    clamp: true,
  });
  const tilt = useSpring(tiltTarget, { stiffness: 320, damping: 24, mass: 0.6 });
  const grabX = useTransform(
    [values.morph, values.rowGrabX, values.tileGrabX],
    ([m = 0, row = 0, tile = 0]: number[]) => lerp(row, tile, m),
  );
  const grabY = useTransform(
    [values.morph, values.rowGrabY, values.tileGrabY],
    ([m = 0, row = 0, tile = 0]: number[]) => lerp(row, tile, m),
  );
  const left = useTransform([values.px, grabX], ([p = 0, g = 0]: number[]) => p - g);
  const top = useTransform([values.py, grabY], ([p = 0, g = 0]: number[]) => p - g);
  const width = useTransform([values.morph, values.rowWidth], ([m = 0, w = 0]: number[]) =>
    lerp(w, TILE, m),
  );
  const height = useTransform(values.morph, m => lerp(ROW_HEIGHT, TILE, m));
  const glyphX = useTransform(values.morph, m => lerp(ROW_GLYPH_X, 0, m));
  const glyphY = useTransform(values.morph, m => lerp(ROW_GLYPH_Y, 0, m));
  const rowOpacity = useTransform(values.morph, m => 1 - m);
  const labelOpacity = useTransform(values.morph, [0, 0.5], [1, 0]);
  const hintX = useTransform(values.hint, [0, 1], [-4, 0]);
  const transform = useMotionTemplate`translate3d(${left}px, ${top}px, 0) rotate(${
    reduceMotion ? '0' : tilt
  }deg) scale(${values.scale})`;
  const transformOrigin = useMotionTemplate`${grabX}px ${grabY}px`;
  const glyphTransform = useMotionTemplate`translate3d(${glyphX}px, ${glyphY}px, 0)`;
  const hintTransform = useMotionTemplate`translate3d(${hintX}px, -50%, 0)`;
  const glyphRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const host = glyphRef.current;
    if (!session || !host) return;
    host.replaceChildren(...session.glyph);
  }, [session]);

  if (!session) return null;

  return createPortal(
    <div ref={layerRef} aria-hidden className='pointer-events-none fixed left-0 top-0 z-[70]'>
      <motion.div
        className='absolute left-0 top-0 will-change-transform'
        style={{ transform, transformOrigin, width, height, opacity: values.opacity }}
      >
        <motion.div
          className='absolute inset-0 rounded-lg shadow-[0_0_0_1px_hsl(var(--foreground)/0.06),0_2px_4px_-1px_rgb(0_0_0/0.08),0_10px_20px_-6px_rgb(0_0_0/0.2),0_24px_48px_-12px_rgb(0_0_0/0.24)]'
          style={{ opacity: values.shadow }}
        />
        <motion.div
          className='absolute inset-0 rounded-lg border border-border bg-popover'
          style={{ opacity: rowOpacity }}
        />
        <motion.div
          className='absolute inset-0 rounded-lg border border-sidebar-border bg-sidebar-accent'
          style={{ opacity: values.morph }}
        />
        <div className='absolute inset-0 overflow-hidden rounded-lg'>
          <motion.span
            className='absolute left-[42px] top-0 flex h-9 items-center whitespace-nowrap text-sm text-popover-foreground'
            style={{ opacity: labelOpacity }}
          >
            {session.label}
          </motion.span>
        </div>
        <motion.div
          ref={glyphRef}
          className={cn(
            'absolute left-0 top-0 flex size-8 items-center justify-center text-[11px] font-semibold',
            session.origin === 'rail'
              ? 'text-sidebar-accent-foreground'
              : 'text-popover-foreground',
          )}
          style={{ transform: glyphTransform }}
        />
        <motion.span
          className='absolute left-[calc(100%+10px)] top-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md'
          style={{ opacity: values.hint, transform: hintTransform }}
        >
          Move to More
        </motion.span>
      </motion.div>
    </div>,
    document.body,
  );
};

export interface RailDrag {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  moreRef: React.RefObject<HTMLLIElement | null>;
  gapRef: React.RefObject<HTMLLIElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  tileRef: (id: string) => (node: HTMLLIElement | null) => void;
  rowRef: (id: string) => (node: HTMLLIElement | null) => void;
  startRailPress: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  startMorePress: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  session: SessionStore;
  layer: React.ReactNode;
}

export const useMoreSlot = (session: SessionStore): number | null =>
  React.useSyncExternalStore(session.subscribe, () => session.get()?.slot ?? null);

export const useRailDrag = ({
  ids,
  canHide,
  moreSlotFor,
  onDrop,
}: {
  ids: string[];
  canHide: (id: string) => boolean;
  moreSlotFor: (id: string) => number;
  onDrop: (drop: RailDrop) => void;
}): RailDrag => {
  const reduceMotion = useReducedMotion() ?? false;
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const moreRef = React.useRef<HTMLLIElement>(null);
  const gapRef = React.useRef<HTMLLIElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const layerRef = React.useRef<HTMLDivElement>(null);
  const tilesRef = React.useRef(new Map<string, HTMLLIElement>());
  const rowsRef = React.useRef(new Map<string, HTMLLIElement>());
  const refCallbacks = React.useRef(new Map<string, (node: HTMLLIElement | null) => void>());
  const [store] = React.useState(createSessionStore);
  const [values] = React.useState<DragValues>(() => ({
    px: motionValue(0),
    py: motionValue(0),
    morph: motionValue(1),
    scale: motionValue(1),
    shadow: motionValue(0),
    opacity: motionValue(1),
    hint: motionValue(0),
    rowWidth: motionValue(0),
    rowGrabX: motionValue(0),
    rowGrabY: motionValue(0),
    tileGrabX: motionValue(0),
    tileGrabY: motionValue(0),
  }));
  const dragRef = React.useRef<PointerDrag | null>(null);
  const pendingRef = React.useRef<string | null>(null);
  const listenersRef = React.useRef<(() => void) | null>(null);
  const cursorRef = React.useRef<HTMLStyleElement | null>(null);
  const clickGuardRef = React.useRef<(() => void) | null>(null);
  const latest = React.useRef({ ids, canHide, moreSlotFor, onDrop, reduceMotion });
  latest.current = { ids, canHide, moreSlotFor, onDrop, reduceMotion };

  const nodeRef = React.useCallback((kind: 'tile' | 'row', id: string) => {
    const key = `${kind}:${id}`;
    let callback = refCallbacks.current.get(key);
    if (!callback) {
      const map = kind === 'tile' ? tilesRef.current : rowsRef.current;
      callback = (node: HTMLLIElement | null): void => {
        if (node) map.set(id, node);
        else map.delete(id);
      };
      refCallbacks.current.set(key, callback);
    }
    return callback;
  }, []);
  const tileRef = React.useCallback((id: string) => nodeRef('tile', id), [nodeRef]);
  const rowRef = React.useCallback((id: string) => nodeRef('row', id), [nodeRef]);

  const slotOf = (): HTMLElement | null =>
    panelRef.current?.querySelector<HTMLElement>('[data-more-slot]') ?? null;

  const armClickGuard = (): void => {
    clickGuardRef.current?.();
    const swallow = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    const release = (): void => {
      document.removeEventListener('click', swallow, { capture: true });
      if (clickGuardRef.current === release) clickGuardRef.current = null;
    };
    document.addEventListener('click', swallow, { capture: true });
    clickGuardRef.current = release;
  };

  const disarmClickGuard = (): void => {
    const release = clickGuardRef.current;
    if (release) window.setTimeout(release, 60);
  };

  const clearStyle = (element: HTMLElement): void => {
    element.style.transition = '';
    element.style.transform = '';
    element.style.opacity = '';
    element.style.height = '';
    element.style.overflow = '';
  };

  const resetAll = (): void => {
    [...tilesRef.current.values(), ...rowsRef.current.values()].forEach(element => {
      clearStyle(element);
      contentOf(element).forEach(child => {
        child.style.opacity = '';
      });
      const socket = socketOf(element);
      if (socket) {
        socket.style.transition = '';
        socket.style.opacity = '';
      }
    });
    [moreRef.current, gapRef.current, slotOf()].forEach(element => {
      if (element) clearStyle(element);
    });
    moreRef.current?.removeAttribute('data-drop-target');
  };

  const teardown = (): void => {
    const drag = dragRef.current;
    if (drag) cancelAnimationFrame(drag.frame);
    listenersRef.current?.();
    listenersRef.current = null;
    dragRef.current = null;
    disarmClickGuard();
    cursorRef.current?.remove();
    cursorRef.current = null;
    if (layerRef.current) layerRef.current.style.display = 'none';
    store.set(null);
  };

  const shiftDuration = (): number => (latest.current.reduceMotion ? 120 : 250);

  const applyIntent = (drag: PointerDrag): void => {
    const { ids: order, rects, fromIndex: from, stride, intent } = drag;
    const tiles = tilesRef.current;
    const more = moreRef.current;
    const gap = gapRef.current;

    if (drag.origin === 'rail') {
      const hiding = intent.kind === 'hide';
      const to = intent.kind === 'rail' ? intent.index : from;
      let sourceShift = 0;
      order.forEach((id, index) => {
        if (index === from) return;
        let shift = 0;
        if (hiding) {
          if (index > from) shift = -stride;
        } else if (from < to && index > from && index <= to) {
          shift = -stride;
          sourceShift += stride;
        } else if (to < from && index >= to && index < from) {
          shift = stride;
          sourceShift -= stride;
        }
        const tile = tiles.get(id);
        if (tile) tile.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : '';
      });
      drag.sourceShift = sourceShift;
      const source = tiles.get(drag.id);
      if (source) {
        source.style.transform = sourceShift ? `translate3d(0, ${sourceShift}px, 0)` : '';
        const socket = socketOf(source);
        if (socket) socket.style.opacity = hiding ? '0' : '1';
      }
      if (more) {
        if (intent.kind === 'hide' && intent.via === 'button') {
          more.setAttribute('data-drop-target', '');
        } else {
          more.removeAttribute('data-drop-target');
        }
      }
      const slot = slotOf();
      if (slot) {
        slot.style.height =
          intent.kind === 'hide' && intent.via === 'panel' ? `${ROW_HEIGHT}px` : '0px';
      }
      return;
    }

    const at = intent.kind === 'rail' ? intent.index : -1;
    order.forEach((id, index) => {
      const tile = tiles.get(id);
      if (tile)
        tile.style.transform = at !== -1 && index >= at ? `translate3d(0, ${stride}px, 0)` : '';
    });
    if (more) more.style.transform = at !== -1 ? `translate3d(0, ${stride}px, 0)` : '';
    if (!gap) return;
    if (at === -1) {
      gap.style.opacity = '0';
      return;
    }
    const anchor = rects[at] ?? drag.moreRect;
    const offset = `translate3d(0, ${(anchor?.top ?? drag.listTop) - drag.listTop}px, 0)`;
    if (gap.style.opacity !== '1') {
      gap.style.transition = 'none';
      gap.style.transform = offset;
      void gap.offsetHeight;
      gap.style.transition = `transform ${shiftDuration()}ms ${EASE_OUT}, opacity 150ms ${EASE_OUT}`;
      gap.style.opacity = '1';
    } else {
      gap.style.transform = offset;
    }
  };

  const retarget = (drag: PointerDrag): void => {
    const { intent } = drag;
    const reduce = latest.current.reduceMotion;
    const morph =
      drag.origin === 'rail'
        ? intent.kind === 'hide' && intent.via === 'panel'
          ? 0
          : 1
        : intent.kind === 'rail'
          ? 1
          : 0;
    const overButton = intent.kind === 'hide' && intent.via === 'button';
    const scale = reduce ? 1 : overButton ? HIDE_SCALE : morph === 1 ? TILE_LIFT : ROW_LIFT;
    const hint = overButton ? 1 : 0;
    if (morph !== drag.morphTarget) {
      drag.morphTarget = morph;
      animate(
        values.morph,
        morph,
        reduce
          ? { duration: 0.12, ease: EASE_OUT_CURVE }
          : { type: 'spring', duration: 0.3, bounce: 0 },
      );
    }
    if (scale !== drag.scaleTarget) {
      drag.scaleTarget = scale;
      animate(
        values.scale,
        scale,
        reduce ? { duration: 0 } : { type: 'spring', duration: 0.3, bounce: 0.2 },
      );
    }
    if (hint !== drag.hintTarget) {
      drag.hintTarget = hint;
      animate(values.hint, hint, { duration: 0.15, ease: EASE_OUT_CURVE });
    }
  };

  const resolveIntent = (drag: PointerDrag): Intent => {
    const x = drag.lastX;
    const y = drag.lastY;
    if (drag.canHide) {
      if (drag.panelRect && within(drag.panelRect, x, y, 0)) return { kind: 'hide', via: 'panel' };
      if (drag.moreRect && within(drag.moreRect, x, y, 6)) return { kind: 'hide', via: 'button' };
    }
    if (drag.panelRect && within(drag.panelRect, x, y, 0)) return { kind: 'none' };
    const rail = drag.railRect;
    if (!rail || x > rail.right + RAIL_REACH || y < rail.top - TILE || y > rail.bottom + TILE) {
      return { kind: 'none' };
    }
    const scrolled = (scrollRef.current?.scrollTop ?? 0) - drag.startScroll;
    const probe =
      drag.origin === 'rail' ? y - values.tileGrabY.get() + TILE / 2 + scrolled : y + scrolled;
    let index = 0;
    drag.rects.forEach((rect, i) => {
      if (i !== drag.fromIndex && rect.top + rect.height / 2 < probe) index += 1;
    });
    return { kind: 'rail', index };
  };

  const updateIntent = (drag: PointerDrag): void => {
    const next = resolveIntent(drag);
    if (sameIntent(next, drag.intent)) return;
    drag.intent = next;
    applyIntent(drag);
    retarget(drag);
  };

  const autoScroll = (): void => {
    const drag = dragRef.current;
    const scroller = scrollRef.current;
    if (!drag || drag.phase !== 'drag') return;
    if (
      scroller &&
      drag.railRect &&
      drag.intent.kind === 'rail' &&
      scroller.scrollHeight > scroller.clientHeight
    ) {
      const speed = (distance: number): number =>
        EDGE_SPEED * Math.pow((EDGE_ZONE - Math.max(distance, 0)) / EDGE_ZONE, 2);
      const fromTop = drag.lastY - drag.railRect.top;
      const fromBottom = drag.railRect.bottom - drag.lastY;
      if (fromTop < EDGE_ZONE) scroller.scrollTop -= speed(fromTop);
      else if (fromBottom < EDGE_ZONE) scroller.scrollTop += speed(fromBottom);
    }
    drag.frame = requestAnimationFrame(autoScroll);
  };

  const abandonPress = (): void => {
    listenersRef.current?.();
    listenersRef.current = null;
    dragRef.current = null;
  };

  const beginDrag = (drag: PointerDrag): void => {
    const more = moreRef.current;
    const list = more?.parentElement;
    const source = drag.handle;
    const { ids: order, canHide: hideable, moreSlotFor: slotFor } = latest.current;
    const fromIndex = drag.origin === 'rail' ? order.indexOf(drag.id) : -1;
    if (!more || !list || (drag.origin === 'rail' && fromIndex === -1)) {
      abandonPress();
      return;
    }
    try {
      source.setPointerCapture(drag.pointerId);
    } catch {
      abandonPress();
      return;
    }

    const rects = order.map(
      id => tilesRef.current.get(id)?.getBoundingClientRect() ?? new DOMRect(),
    );
    const moreRect = more.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const [first, second] = rects;
    const panel =
      panelRef.current?.closest<HTMLElement>('[data-slot="popover-content"]') ?? panelRef.current;
    const panelBox = panel?.getBoundingClientRect() ?? null;
    const canHide = drag.origin === 'rail' && hideable(drag.id);

    drag.phase = 'drag';
    drag.ids = order;
    drag.rects = rects;
    drag.sourceRect = sourceRect;
    drag.moreRect = moreRect;
    drag.railRect = (scrollRef.current ?? list).getBoundingClientRect();
    drag.panelRect =
      panelBox && drag.origin === 'rail'
        ? new DOMRect(panelBox.x, panelBox.y, panelBox.width, panelBox.height + ROW_HEIGHT)
        : panelBox;
    drag.listTop = list.getBoundingClientRect().top;
    drag.stride = first ? (second ?? moreRect).top - first.top : moreRect.height + 16;
    drag.fromIndex = fromIndex;
    drag.intent = drag.origin === 'rail' ? { kind: 'rail', index: fromIndex } : { kind: 'none' };
    drag.startScroll = scrollRef.current?.scrollTop ?? 0;
    drag.canHide = canHide;

    if (drag.origin === 'rail') {
      const grabX = drag.startX - sourceRect.left;
      const grabY = drag.startY - sourceRect.top;
      values.tileGrabX.jump(grabX);
      values.tileGrabY.jump(grabY);
      values.rowGrabX.jump(ROW_GLYPH_X + grabX);
      values.rowGrabY.jump(ROW_GLYPH_Y + grabY);
      values.morph.jump(1);
    } else {
      values.rowGrabX.jump(drag.startX - sourceRect.left);
      values.rowGrabY.jump(drag.startY - sourceRect.top);
      values.tileGrabX.jump(TILE / 2);
      values.tileGrabY.jump(TILE / 2);
      values.morph.jump(0);
    }
    const row = panel?.querySelector<HTMLElement>('[data-more-row]');
    values.rowWidth.jump(
      drag.origin === 'more' ? sourceRect.width : (row?.getBoundingClientRect().width ?? 232),
    );
    values.px.jump(drag.lastX);
    values.py.jump(drag.lastY);
    values.scale.jump(1);
    values.shadow.jump(0);
    values.opacity.jump(1);
    values.hint.jump(0);
    drag.morphTarget = values.morph.get();
    drag.scaleTarget = 1;
    drag.hintTarget = 0;

    const glyphSource = source.querySelector('[data-rail-glyph]');
    const glyph = glyphSource
      ? Array.from(glyphSource.childNodes).map(node => node.cloneNode(true))
      : [];
    flushSync(() =>
      store.set({
        origin: drag.origin,
        label: source.dataset['railLabel'] ?? '',
        glyph,
        slot: canHide && panel ? slotFor(drag.id) : null,
      }),
    );

    const transition = `transform ${shiftDuration()}ms ${EASE_OUT}`;
    order.forEach(id => {
      const tile = tilesRef.current.get(id);
      if (tile) tile.style.transition = transition;
    });
    more.style.transition = transition;
    contentOf(source).forEach(child => {
      child.style.opacity = '0';
    });
    const socket = socketOf(source);
    if (socket) {
      socket.style.transition = `opacity 150ms ${EASE_OUT}`;
      socket.style.opacity = '1';
    }

    const cursor = document.createElement('style');
    cursor.textContent = DRAG_CURSOR_CSS;
    document.head.appendChild(cursor);
    cursorRef.current = cursor;
    window.getSelection()?.removeAllRanges();
    armClickGuard();

    retarget(drag);
    animate(values.shadow, 1, { duration: 0.2, ease: EASE_OUT_CURVE });
    updateIntent(drag);
    drag.frame = requestAnimationFrame(autoScroll);
  };

  const settle = (commit: boolean): void => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.phase === 'press') {
      abandonPress();
      return;
    }
    if (drag.phase !== 'drag') return;
    drag.phase = 'settle';
    cancelAnimationFrame(drag.frame);
    disarmClickGuard();

    if (!commit) {
      const resting: Intent =
        drag.origin === 'rail' ? { kind: 'rail', index: drag.fromIndex } : { kind: 'none' };
      if (!sameIntent(resting, drag.intent)) {
        drag.intent = resting;
        applyIntent(drag);
      }
    }

    const reduce = latest.current.reduceMotion;
    const scrolled = (scrollRef.current?.scrollTop ?? 0) - drag.startScroll;
    const { intent, sourceRect, moreRect } = drag;
    const more = moreRef.current;
    let drop: RailDrop | null = null;
    let target = { left: sourceRect?.left ?? 0, top: sourceRect?.top ?? 0, morph: 1 };
    let absorb = false;

    if (intent.kind === 'hide') {
      drop = { kind: 'remove', id: drag.id };
      if (more) {
        more.removeAttribute('data-drop-target');
        more.style.transform = `translate3d(0, ${-drag.stride}px, 0)`;
      }
      const slot = intent.via === 'panel' ? slotOf()?.getBoundingClientRect() : null;
      if (slot) {
        target = { left: slot.left, top: slot.top, morph: 0 };
      } else if (moreRect) {
        target = { left: moreRect.left, top: moreRect.top - drag.stride - scrolled, morph: 1 };
        absorb = true;
      }
    } else if (intent.kind === 'rail' && drag.origin === 'more') {
      drop = { kind: 'add', id: drag.id, at: intent.index };
      const anchor = drag.rects[intent.index] ?? moreRect;
      if (anchor) target = { left: anchor.left, top: anchor.top - scrolled, morph: 1 };
      const row = drag.handle;
      row.style.height = `${row.offsetHeight}px`;
      row.style.overflow = 'hidden';
      void row.offsetHeight;
      row.style.transition = `height 200ms ${EASE_OUT}, opacity 150ms ${EASE_OUT}`;
      row.style.height = '0px';
      row.style.opacity = '0';
    } else if (intent.kind === 'rail') {
      if (intent.index !== drag.fromIndex) drop = { kind: 'move', id: drag.id, to: intent.index };
      const from = drag.rects[drag.fromIndex];
      if (from) target = { left: from.left, top: from.top + drag.sourceShift - scrolled, morph: 1 };
    } else if (sourceRect) {
      const railScroll = drag.origin === 'rail' ? scrolled : 0;
      target = {
        left: sourceRect.left,
        top: sourceRect.top - railScroll,
        morph: drag.origin === 'rail' ? 1 : 0,
      };
    }

    const grabX = target.morph === 1 ? values.tileGrabX.get() : values.rowGrabX.get();
    const grabY = target.morph === 1 ? values.tileGrabY.get() : values.rowGrabY.get();
    const landing = reduce
      ? { duration: 0.18, ease: EASE_OUT_CURVE }
      : ({ type: 'spring', duration: absorb ? 0.28 : 0.35, bounce: absorb ? 0 : 0.15 } as const);
    const shape = reduce
      ? { duration: 0.18, ease: EASE_OUT_CURVE }
      : ({ type: 'spring', duration: 0.3, bounce: 0 } as const);
    const animations = [
      animate(values.px, target.left + grabX, landing),
      animate(values.py, target.top + grabY, landing),
      animate(values.morph, target.morph, shape),
      animate(values.scale, absorb && !reduce ? 0.8 : 1, landing),
      animate(values.shadow, 0, { duration: 0.3, ease: EASE_OUT_CURVE }),
      animate(values.hint, 0, { duration: 0.12, ease: EASE_OUT_CURVE }),
    ];
    if (absorb)
      animations.push(animate(values.opacity, 0, { duration: 0.2, ease: EASE_OUT_CURVE }));

    void Promise.all(animations).then(() => {
      if (dragRef.current !== drag) return;
      if (!drop) {
        resetAll();
        teardown();
        return;
      }
      const key = orderAfter(drag.ids, drop).join('|');
      pendingRef.current = key;
      const slot = slotOf();
      if (slot) {
        slot.style.transition = 'none';
        slot.style.height = '0px';
      }
      const committed = drop;
      flushSync(() => latest.current.onDrop(committed));
      requestAnimationFrame(() => {
        if (pendingRef.current !== key) return;
        pendingRef.current = null;
        resetAll();
        teardown();
      });
    });
  };

  const startPress = (origin: Origin, id: string, event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || event.pointerType === 'touch' || dragRef.current) return;
    const drag: PointerDrag = {
      phase: 'press',
      origin,
      id,
      pointerId: event.pointerId,
      handle: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      ids: [],
      rects: [],
      sourceRect: null,
      moreRect: null,
      railRect: null,
      panelRect: null,
      listTop: 0,
      stride: 0,
      fromIndex: -1,
      intent: { kind: 'none' },
      sourceShift: 0,
      startScroll: 0,
      canHide: false,
      morphTarget: 1,
      scaleTarget: 1,
      hintTarget: 0,
      frame: 0,
    };
    dragRef.current = drag;

    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== drag.pointerId) return;
      drag.lastX = moveEvent.clientX;
      drag.lastY = moveEvent.clientY;
      if (drag.phase === 'press') {
        if (Math.hypot(drag.lastX - drag.startX, drag.lastY - drag.startY) >= DRAG_THRESHOLD) {
          beginDrag(drag);
        }
        return;
      }
      if (drag.phase !== 'drag') return;
      values.px.set(drag.lastX);
      values.py.set(drag.lastY);
      updateIntent(drag);
    };
    const onUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId === drag.pointerId) settle(true);
    };
    const onCancel = (): void => settle(false);
    const onKey = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key !== 'Escape' || drag.phase !== 'drag') return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      settle(false);
    };
    const onScroll = (): void => {
      if (drag.phase === 'drag') updateIntent(drag);
    };
    const scroller = scrollRef.current;

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKey, true);
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    listenersRef.current = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKey, true);
      scroller?.removeEventListener('scroll', onScroll);
    };
  };

  const orderKey = ids.join('|');
  React.useLayoutEffect(() => {
    const pending = pendingRef.current;
    if (pending !== null) {
      if (pending !== orderKey) return;
      pendingRef.current = null;
      resetAll();
      teardown();
      return;
    }
    if (dragRef.current && dragRef.current.phase !== 'press') {
      resetAll();
      teardown();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on order changes only
  }, [orderKey]);

  React.useEffect(
    () => (): void => {
      if (dragRef.current) cancelAnimationFrame(dragRef.current.frame);
      dragRef.current = null;
      listenersRef.current?.();
      listenersRef.current = null;
      clickGuardRef.current?.();
      cursorRef.current?.remove();
      store.set(null);
    },
    [store],
  );

  return {
    scrollRef,
    moreRef,
    gapRef,
    panelRef,
    tileRef,
    rowRef,
    startRailPress: (id, event) => startPress('rail', id, event),
    startMorePress: (id, event) => startPress('more', id, event),
    session: store,
    layer: (
      <RailDragLayer
        store={store}
        values={values}
        layerRef={layerRef}
        reduceMotion={reduceMotion}
      />
    ),
  };
};
