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
import { messageActionsStore } from './barItems';
import { MAX_MESSAGE_BAR_ACTIONS } from '../constants/settings';
import {
  BAR_DRAG_CURSOR_CSS,
  BAR_DRAG_THRESHOLD,
  BAR_DROP_REACH,
  BAR_EASE_OUT,
  BAR_EASE_OUT_CURVE,
  BAR_HIDE_SCALE,
  BAR_MAX_TILT,
  BAR_ROW_LIFT,
  BAR_TILE_GLYPH_INSET,
  BAR_TILE_LIFT,
  BAR_TILE_SIZE,
} from '../constants/messageBar';
import {
  contentOf,
  createValueStore,
  isMessageBarActionId,
  lerp,
  sameIntent,
  setTranslateX,
  socketOf,
  within,
  type BarDragIntent as Intent,
  type ValueStore,
} from '../utils/messageBar';

type Origin = 'bar' | 'menu';

type Drop =
  | { kind: 'move'; id: string; target: string }
  | { kind: 'add'; id: string; before: string | null }
  | { kind: 'remove'; id: string };

interface DragSession {
  origin: Origin;
  label: string;
  labelX: number;
  glyph: Node[];
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
  rowHeight: MotionValue<number>;
  rowGrabX: MotionValue<number>;
  rowGrabY: MotionValue<number>;
  rowGlyphX: MotionValue<number>;
  rowGlyphY: MotionValue<number>;
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
  tiles: HTMLElement[];
  rects: DOMRect[];
  lead: HTMLElement | null;
  chrome: HTMLElement | null;
  gap: HTMLElement | null;
  more: HTMLElement | null;
  barRect: DOMRect | null;
  frameLeft: number;
  moreRect: DOMRect | null;
  panelRect: DOMRect | null;
  slot: HTMLElement | null;
  rowHeight: number;
  sourceRect: DOMRect | null;
  stride: number;
  fromIndex: number;
  canAdd: boolean;
  intent: Intent;
  sourceShift: number;
  morphTarget: number;
  scaleTarget: number;
  hintTarget: number;
}

const commitDrop = (drop: Drop): void => {
  const stored = messageActionsStore.get();
  if (drop.kind === 'move') {
    messageActionsStore.move(stored.indexOf(drop.id), stored.indexOf(drop.target));
    return;
  }
  if (drop.kind === 'add') {
    const at = drop.before ? stored.indexOf(drop.before) : -1;
    messageActionsStore.add(drop.id, at === -1 ? undefined : at);
    return;
  }
  messageActionsStore.remove(drop.id);
};

const LiftedChip: React.FC<{
  session: DragSession;
  values: DragValues;
  hintRef: React.RefObject<HTMLSpanElement | null>;
  reduceMotion: boolean;
}> = ({ session, values, hintRef, reduceMotion }) => {
  const velocity = useVelocity(values.px);
  const tiltTarget = useTransform(velocity, [-1600, 0, 1600], [-BAR_MAX_TILT, 0, BAR_MAX_TILT], {
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
    lerp(w, BAR_TILE_SIZE, m),
  );
  const height = useTransform([values.morph, values.rowHeight], ([m = 0, h = 0]: number[]) =>
    lerp(h, BAR_TILE_SIZE, m),
  );
  const glyphX = useTransform([values.morph, values.rowGlyphX], ([m = 0, g = 0]: number[]) =>
    lerp(g, BAR_TILE_GLYPH_INSET, m),
  );
  const glyphY = useTransform([values.morph, values.rowGlyphY], ([m = 0, g = 0]: number[]) =>
    lerp(g, BAR_TILE_GLYPH_INSET, m),
  );
  const labelOpacity = useTransform(values.morph, [0, 0.5], [1, 0]);
  const hintY = useTransform(values.hint, [0, 1], [4, 0]);
  const transform = useMotionTemplate`translate3d(${left}px, ${top}px, 0) rotate(${
    reduceMotion ? '0' : tilt
  }deg) scale(${values.scale})`;
  const transformOrigin = useMotionTemplate`${grabX}px ${grabY}px`;
  const glyphTransform = useMotionTemplate`translate3d(${glyphX}px, ${glyphY}px, 0)`;
  const hintTransform = useMotionTemplate`translate3d(0, ${hintY}px, 0)`;
  const glyphRef = React.useRef<HTMLSpanElement>(null);

  React.useLayoutEffect(() => {
    glyphRef.current?.replaceChildren(...session.glyph);
  }, [session]);

  return (
    <motion.div
      className='absolute left-0 top-0 will-change-transform'
      style={{ transform, transformOrigin, width, height, opacity: values.opacity }}
    >
      <motion.div
        className='absolute inset-0 rounded-md shadow-[0_0_0_1px_hsl(var(--foreground)/0.06),0_2px_4px_-1px_rgb(0_0_0/0.08),0_10px_20px_-6px_rgb(0_0_0/0.2),0_24px_48px_-12px_rgb(0_0_0/0.24)]'
        style={{ opacity: values.shadow }}
      />
      <div className='absolute inset-0 rounded-md border border-border bg-popover' />
      <div className='absolute inset-0 overflow-hidden rounded-md'>
        <motion.span
          className='absolute top-0 flex h-full items-center whitespace-nowrap text-sm text-popover-foreground'
          style={{ left: session.labelX, opacity: labelOpacity }}
        >
          {session.label}
        </motion.span>
      </div>
      <motion.span
        ref={glyphRef}
        className='absolute left-0 top-0 flex size-4 items-center justify-center text-muted-foreground'
        style={{ transform: glyphTransform }}
      />
      <motion.span
        ref={hintRef}
        className='absolute bottom-[calc(100%+8px)] right-0 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md'
        style={{ opacity: values.hint, transform: hintTransform }}
      />
    </motion.div>
  );
};

const MessageBarDragLayer: React.FC<{
  store: ValueStore<DragSession>;
  values: DragValues;
  layerRef: React.RefObject<HTMLDivElement | null>;
  hintRef: React.RefObject<HTMLSpanElement | null>;
  reduceMotion: boolean;
}> = ({ store, values, layerRef, hintRef, reduceMotion }) => {
  const session = React.useSyncExternalStore(store.subscribe, store.get);
  if (!session) return null;
  return createPortal(
    <div ref={layerRef} aria-hidden className='pointer-events-none fixed left-0 top-0 z-[70]'>
      <LiftedChip session={session} values={values} hintRef={hintRef} reduceMotion={reduceMotion} />
    </div>,
    document.body,
  );
};

export interface MessageBarDrag {
  barRef: React.RefObject<HTMLDivElement | null>;
  startBarPress: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  startMenuPress: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  layer: React.ReactNode;
}

export const useMessageBarDrag = ({
  onActiveChange,
}: {
  onActiveChange: (active: boolean) => void;
}): MessageBarDrag => {
  const reduceMotion = useReducedMotion() ?? false;
  const barRef = React.useRef<HTMLDivElement>(null);
  const layerRef = React.useRef<HTMLDivElement>(null);
  const hintRef = React.useRef<HTMLSpanElement>(null);
  const [store] = React.useState(() => createValueStore<DragSession>());
  const [values] = React.useState<DragValues>(() => ({
    px: motionValue(0),
    py: motionValue(0),
    morph: motionValue(1),
    scale: motionValue(1),
    shadow: motionValue(0),
    opacity: motionValue(1),
    hint: motionValue(0),
    rowWidth: motionValue(BAR_TILE_SIZE),
    rowHeight: motionValue(BAR_TILE_SIZE),
    rowGrabX: motionValue(0),
    rowGrabY: motionValue(0),
    rowGlyphX: motionValue(BAR_TILE_GLYPH_INSET),
    rowGlyphY: motionValue(BAR_TILE_GLYPH_INSET),
    tileGrabX: motionValue(0),
    tileGrabY: motionValue(0),
  }));
  const dragRef = React.useRef<PointerDrag | null>(null);
  const listenersRef = React.useRef<(() => void) | null>(null);
  const cursorRef = React.useRef<HTMLStyleElement | null>(null);
  const clickGuardRef = React.useRef<(() => void) | null>(null);
  const latest = React.useRef({ onActiveChange, reduceMotion });
  latest.current = { onActiveChange, reduceMotion };

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
    element.style.left = '';
    element.style.paddingTop = '';
    element.style.paddingBottom = '';
    element.style.backgroundColor = '';
  };

  const resetAll = (drag: PointerDrag): void => {
    [...drag.tiles, drag.handle].forEach(element => {
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
    [drag.lead, drag.chrome, drag.gap, drag.more, drag.slot].forEach(element => {
      if (element) clearStyle(element);
    });
    drag.more?.removeAttribute('data-drop-target');
  };

  const teardown = (): void => {
    const wasDragging = dragRef.current !== null && dragRef.current.phase !== 'press';
    listenersRef.current?.();
    listenersRef.current = null;
    dragRef.current = null;
    disarmClickGuard();
    cursorRef.current?.remove();
    cursorRef.current = null;
    if (layerRef.current) layerRef.current.style.display = 'none';
    store.set(null);
    if (wasDragging) latest.current.onActiveChange(false);
  };

  const shiftDuration = (): number => (latest.current.reduceMotion ? 120 : 250);

  const applyIntent = (drag: PointerDrag): void => {
    const { tiles, fromIndex: from, stride, intent } = drag;
    let grow = 0;

    if (drag.origin === 'bar') {
      const hiding = intent.kind === 'hide';
      const to = intent.kind === 'bar' ? intent.index : from;
      let sourceShift = 0;
      tiles.forEach((tile, index) => {
        if (index === from) return;
        let offset = 0;
        if (hiding) {
          if (index < from) offset = stride;
        } else if (from < to && index > from && index <= to) {
          offset = -stride;
          sourceShift += stride;
        } else if (to < from && index >= to && index < from) {
          offset = stride;
          sourceShift -= stride;
        }
        setTranslateX(tile, offset);
      });
      drag.sourceShift = sourceShift;
      const source = tiles[from];
      if (source) {
        setTranslateX(source, sourceShift);
        const socket = socketOf(source);
        if (socket) socket.style.opacity = hiding ? '0' : '1';
      }
      if (hiding) grow = -stride;
      if (intent.kind === 'hide' && intent.via === 'button') {
        drag.more?.setAttribute('data-drop-target', '');
      } else {
        drag.more?.removeAttribute('data-drop-target');
      }
      if (drag.slot) {
        drag.slot.style.height =
          intent.kind === 'hide' && intent.via === 'panel' ? `${drag.rowHeight}px` : '0px';
      }
    } else {
      const at = intent.kind === 'bar' ? intent.index : -1;
      tiles.forEach((tile, index) => setTranslateX(tile, at !== -1 && index < at ? -stride : 0));
      if (at !== -1) grow = stride;
      const gap = drag.gap;
      if (gap && at === -1) {
        gap.style.opacity = '0';
      } else if (gap) {
        const anchor = drag.rects[at] ?? drag.moreRect;
        const offset = `translate3d(${(anchor?.left ?? 0) - stride - drag.frameLeft}px, 0, 0)`;
        if (gap.style.opacity !== '1') {
          gap.style.transition = 'none';
          gap.style.transform = offset;
          void gap.offsetHeight;
          gap.style.transition = `transform ${shiftDuration()}ms ${BAR_EASE_OUT}, opacity 150ms ${BAR_EASE_OUT}`;
          gap.style.opacity = '1';
        } else {
          gap.style.transform = offset;
        }
      }
    }

    setTranslateX(drag.lead, -grow);
    if (drag.chrome) drag.chrome.style.left = grow ? `${-1 - grow}px` : '';
  };

  const retarget = (drag: PointerDrag): void => {
    const { intent } = drag;
    const reduce = latest.current.reduceMotion;
    const intoPanel = intent.kind === 'hide' && intent.via === 'panel';
    const overMore = intent.kind === 'hide' && intent.via === 'button';
    const morph =
      drag.origin === 'bar'
        ? intoPanel
          ? 0
          : 1
        : intent.kind === 'bar' || intent.kind === 'full'
          ? 1
          : 0;
    const scale = reduce
      ? 1
      : overMore || intent.kind === 'full'
        ? BAR_HIDE_SCALE
        : morph === 1
          ? BAR_TILE_LIFT
          : BAR_ROW_LIFT;
    const message = overMore ? 'Move to More' : intent.kind === 'full' ? 'Bar is full' : null;
    if (message && hintRef.current) hintRef.current.textContent = message;
    const hint = message ? 1 : 0;
    if (morph !== drag.morphTarget) {
      drag.morphTarget = morph;
      animate(
        values.morph,
        morph,
        reduce
          ? { duration: 0.12, ease: BAR_EASE_OUT_CURVE }
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
      animate(values.hint, hint, { duration: 0.15, ease: BAR_EASE_OUT_CURVE });
    }
  };

  const resolveIntent = (drag: PointerDrag): Intent => {
    const x = drag.lastX;
    const y = drag.lastY;
    const bar = drag.barRect;
    if (drag.origin === 'bar') {
      if (drag.panelRect && within(drag.panelRect, x, y, 0)) return { kind: 'hide', via: 'panel' };
      if (drag.moreRect && within(drag.moreRect, x, y, 6)) return { kind: 'hide', via: 'button' };
      if (!bar || y < bar.top - BAR_DROP_REACH || y > bar.bottom + BAR_DROP_REACH)
        return { kind: 'none' };
      const probe = x - values.tileGrabX.get() + BAR_TILE_SIZE / 2;
      let index = 0;
      drag.rects.forEach((rect, i) => {
        if (i !== drag.fromIndex && rect.left + rect.width / 2 < probe) index += 1;
      });
      return { kind: 'bar', index };
    }
    if (drag.panelRect && within(drag.panelRect, x, y, 0)) return { kind: 'none' };
    if (!bar || !within(bar, x, y, BAR_DROP_REACH)) return { kind: 'none' };
    if (!drag.canAdd) return { kind: 'full' };
    let index = 0;
    drag.rects.forEach(rect => {
      if (rect.left + rect.width / 2 < x) index += 1;
    });
    return { kind: 'bar', index };
  };

  const updateIntent = (drag: PointerDrag): void => {
    const next = resolveIntent(drag);
    if (sameIntent(next, drag.intent)) return;
    drag.intent = next;
    applyIntent(drag);
    retarget(drag);
  };

  const abandonPress = (): void => {
    listenersRef.current?.();
    listenersRef.current = null;
    dragRef.current = null;
  };

  const beginDrag = (drag: PointerDrag): void => {
    const bar = barRef.current;
    const more = bar?.querySelector<HTMLElement>('[data-bar-more]') ?? null;
    const tiles = bar
      ? Array.from(bar.querySelectorAll<HTMLElement>(':scope > [data-bar-tile]'))
      : [];
    const ids = tiles.map(tile => tile.dataset['barId'] ?? '');
    const fromIndex = drag.origin === 'bar' ? ids.indexOf(drag.id) : -1;
    if (!bar || !more || (drag.origin === 'bar' && fromIndex === -1)) {
      abandonPress();
      return;
    }
    const source = drag.handle;
    try {
      source.setPointerCapture(drag.pointerId);
    } catch {
      abandonPress();
      return;
    }

    const barStyle = getComputedStyle(bar);
    const barRect = bar.getBoundingClientRect();
    const moreRect = more.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const menuId = more.getAttribute('aria-controls');
    const panel =
      drag.origin === 'menu'
        ? source.closest<HTMLElement>('[role="menu"]')
        : menuId
          ? document.getElementById(menuId)
          : null;
    const sampleRow =
      drag.origin === 'bar'
        ? (panel?.querySelector('[data-bar-text]')?.closest<HTMLElement>('[role="menuitem"]') ??
          null)
        : source;
    const rowRect = sampleRow?.getBoundingClientRect() ?? null;
    const panelBox = panel?.getBoundingClientRect() ?? null;

    drag.phase = 'drag';
    drag.ids = ids;
    drag.tiles = tiles;
    drag.rects = tiles.map(tile => tile.getBoundingClientRect());
    drag.lead = bar.querySelector<HTMLElement>(':scope > [data-bar-lead]');
    drag.chrome = bar.querySelector<HTMLElement>(':scope > [data-bar-chrome]');
    drag.gap = bar.querySelector<HTMLElement>(':scope > [data-bar-gap]');
    drag.more = more;
    drag.barRect = barRect;
    drag.frameLeft = barRect.left + (parseFloat(barStyle.borderLeftWidth) || 0);
    drag.moreRect = moreRect;
    drag.rowHeight = rowRect?.height ?? BAR_TILE_SIZE;
    drag.slot =
      drag.origin === 'bar'
        ? (panel?.querySelector<HTMLElement>(`[data-bar-slot="${CSS.escape(drag.id)}"]`) ?? null)
        : null;
    drag.panelRect =
      panelBox && drag.slot
        ? new DOMRect(
            panelBox.x,
            panel?.dataset['side'] === 'top' ? panelBox.y - drag.rowHeight : panelBox.y,
            panelBox.width,
            panelBox.height + drag.rowHeight,
          )
        : drag.origin === 'menu'
          ? panelBox
          : null;
    drag.sourceRect = sourceRect;
    drag.stride = moreRect.width + (parseFloat(barStyle.columnGap) || 0);
    drag.fromIndex = fromIndex;
    drag.canAdd =
      messageActionsStore.get().filter(isMessageBarActionId).length < MAX_MESSAGE_BAR_ACTIONS;
    drag.intent = drag.origin === 'bar' ? { kind: 'bar', index: fromIndex } : { kind: 'none' };

    const glyphSource = source.querySelector('[data-bar-glyph]');
    const rowGlyph = sampleRow?.querySelector('[data-bar-glyph]')?.getBoundingClientRect();
    const rowText = sampleRow?.querySelector('[data-bar-text]')?.getBoundingClientRect();
    const rowGlyphX = rowGlyph && rowRect ? rowGlyph.left - rowRect.left : BAR_TILE_GLYPH_INSET;
    const rowGlyphY = rowGlyph && rowRect ? rowGlyph.top - rowRect.top : BAR_TILE_GLYPH_INSET;
    const grabX = drag.startX - sourceRect.left;
    const grabY = drag.startY - sourceRect.top;
    values.rowWidth.jump(rowRect?.width ?? BAR_TILE_SIZE);
    values.rowHeight.jump(drag.rowHeight);
    values.rowGlyphX.jump(rowGlyphX);
    values.rowGlyphY.jump(rowGlyphY);
    if (drag.origin === 'bar') {
      values.tileGrabX.jump(grabX);
      values.tileGrabY.jump(grabY);
      values.rowGrabX.jump(rowGlyphX + grabX - BAR_TILE_GLYPH_INSET);
      values.rowGrabY.jump(rowGlyphY + grabY - BAR_TILE_GLYPH_INSET);
      values.morph.jump(1);
    } else {
      values.tileGrabX.jump(BAR_TILE_SIZE / 2);
      values.tileGrabY.jump(BAR_TILE_SIZE / 2);
      values.rowGrabX.jump(grabX);
      values.rowGrabY.jump(grabY);
      values.morph.jump(0);
    }
    values.px.jump(drag.lastX);
    values.py.jump(drag.lastY);
    values.scale.jump(1);
    values.shadow.jump(0);
    values.opacity.jump(1);
    values.hint.jump(0);
    drag.morphTarget = values.morph.get();
    drag.scaleTarget = 1;
    drag.hintTarget = 0;

    flushSync(() =>
      store.set({
        origin: drag.origin,
        label: source.dataset['barLabel'] ?? '',
        labelX: rowText && rowRect ? rowText.left - rowRect.left : 0,
        glyph: glyphSource
          ? Array.from(glyphSource.childNodes).map(node => node.cloneNode(true))
          : [],
      }),
    );

    const transition = `transform ${shiftDuration()}ms ${BAR_EASE_OUT}`;
    tiles.forEach(tile => {
      tile.style.transition = transition;
    });
    if (drag.lead) drag.lead.style.transition = transition;
    if (drag.chrome) drag.chrome.style.transition = `left ${shiftDuration()}ms ${BAR_EASE_OUT}`;
    if (drag.slot) drag.slot.style.transition = `height 200ms ${BAR_EASE_OUT}`;
    if (drag.origin === 'menu') source.style.backgroundColor = 'transparent';
    contentOf(source).forEach(child => {
      child.style.opacity = '0';
    });
    const socket = socketOf(source);
    if (socket) {
      socket.style.transition = `opacity 150ms ${BAR_EASE_OUT}`;
      socket.style.opacity = '1';
    }

    const cursor = document.createElement('style');
    cursor.textContent = BAR_DRAG_CURSOR_CSS;
    document.head.appendChild(cursor);
    cursorRef.current = cursor;
    window.getSelection()?.removeAllRanges();
    armClickGuard();
    latest.current.onActiveChange(true);

    retarget(drag);
    animate(values.shadow, 1, { duration: 0.2, ease: BAR_EASE_OUT_CURVE });
    updateIntent(drag);
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
    disarmClickGuard();

    if (!commit || !barRef.current?.isConnected) {
      const resting: Intent =
        drag.origin === 'bar' ? { kind: 'bar', index: drag.fromIndex } : { kind: 'none' };
      if (!sameIntent(resting, drag.intent)) {
        drag.intent = resting;
        applyIntent(drag);
      }
    }

    const reduce = latest.current.reduceMotion;
    const { intent, sourceRect, moreRect, rects, stride } = drag;
    let drop: Drop | null = null;
    let target = {
      left: sourceRect?.left ?? 0,
      top: sourceRect?.top ?? 0,
      morph: drag.origin === 'bar' ? 1 : 0,
    };
    let absorb = false;

    if (intent.kind === 'hide') {
      drop = { kind: 'remove', id: drag.id };
      drag.more?.removeAttribute('data-drop-target');
      const slot = intent.via === 'panel' ? drag.slot?.getBoundingClientRect() : null;
      if (slot) {
        target = { left: slot.left, top: slot.top, morph: 0 };
      } else if (moreRect) {
        target = { left: moreRect.left, top: moreRect.top, morph: 1 };
        absorb = true;
      }
    } else if (intent.kind === 'bar' && drag.origin === 'menu') {
      drop = { kind: 'add', id: drag.id, before: drag.ids[intent.index] ?? null };
      const anchor = rects[intent.index] ?? moreRect;
      if (anchor && moreRect) target = { left: anchor.left - stride, top: moreRect.top, morph: 1 };
      const row = drag.handle;
      row.style.height = `${row.offsetHeight}px`;
      row.style.overflow = 'hidden';
      void row.offsetHeight;
      row.style.transition = `height 200ms ${BAR_EASE_OUT}, padding 200ms ${BAR_EASE_OUT}, opacity 150ms ${BAR_EASE_OUT}`;
      row.style.height = '0px';
      row.style.paddingTop = '0px';
      row.style.paddingBottom = '0px';
      row.style.opacity = '0';
    } else if (intent.kind === 'bar') {
      const to = drag.ids[intent.index];
      if (intent.index !== drag.fromIndex && to) drop = { kind: 'move', id: drag.id, target: to };
      const from = rects[drag.fromIndex];
      if (from) target = { left: from.left + drag.sourceShift, top: from.top, morph: 1 };
    }

    const grabX = target.morph === 1 ? values.tileGrabX.get() : values.rowGrabX.get();
    const grabY = target.morph === 1 ? values.tileGrabY.get() : values.rowGrabY.get();
    const landing = reduce
      ? { duration: 0.18, ease: BAR_EASE_OUT_CURVE }
      : ({ type: 'spring', duration: absorb ? 0.28 : 0.35, bounce: absorb ? 0 : 0.15 } as const);
    const shape = reduce
      ? { duration: 0.18, ease: BAR_EASE_OUT_CURVE }
      : ({ type: 'spring', duration: 0.3, bounce: 0 } as const);
    const animations = [
      animate(values.px, target.left + grabX, landing),
      animate(values.py, target.top + grabY, landing),
      animate(values.morph, target.morph, shape),
      animate(values.scale, absorb && !reduce ? 0.8 : 1, landing),
      animate(values.shadow, 0, { duration: 0.3, ease: BAR_EASE_OUT_CURVE }),
      animate(values.hint, 0, { duration: 0.12, ease: BAR_EASE_OUT_CURVE }),
    ];
    if (absorb)
      animations.push(animate(values.opacity, 0, { duration: 0.2, ease: BAR_EASE_OUT_CURVE }));

    void Promise.all(animations).then(() => {
      if (dragRef.current !== drag) return;
      if (drop) {
        const committed = drop;
        flushSync(() => commitDrop(committed));
      }
      resetAll(drag);
      teardown();
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
      tiles: [],
      rects: [],
      lead: null,
      chrome: null,
      gap: null,
      more: null,
      barRect: null,
      frameLeft: 0,
      moreRect: null,
      panelRect: null,
      slot: null,
      rowHeight: BAR_TILE_SIZE,
      sourceRect: null,
      stride: 0,
      fromIndex: -1,
      canAdd: false,
      intent: { kind: 'none' },
      sourceShift: 0,
      morphTarget: 1,
      scaleTarget: 1,
      hintTarget: 0,
    };
    dragRef.current = drag;

    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== drag.pointerId) return;
      drag.lastX = moveEvent.clientX;
      drag.lastY = moveEvent.clientY;
      if (drag.phase === 'press') {
        if (Math.hypot(drag.lastX - drag.startX, drag.lastY - drag.startY) >= BAR_DRAG_THRESHOLD) {
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

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKey, true);
    listenersRef.current = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKey, true);
    };
  };

  React.useEffect(
    () => (): void => {
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
    barRef,
    startBarPress: (id, event) => startPress('bar', id, event),
    startMenuPress: (id, event) => startPress('menu', id, event),
    layer: (
      <MessageBarDragLayer
        store={store}
        values={values}
        layerRef={layerRef}
        hintRef={hintRef}
        reduceMotion={reduceMotion}
      />
    ),
  };
};
