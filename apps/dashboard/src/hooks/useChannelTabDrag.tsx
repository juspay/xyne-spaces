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
import {
  BAR_DRAG_CURSOR_CSS,
  BAR_DRAG_THRESHOLD,
  BAR_DROP_REACH,
  BAR_EASE_OUT,
  BAR_EASE_OUT_CURVE,
  BAR_HIDE_SCALE,
  BAR_ROW_LIFT,
} from '../constants/messageBar';
import {
  TAB_ABSORB_SCALE,
  TAB_HEIGHT,
  TAB_LIFT,
  TAB_LIFTED_SHADOW_CLASS,
  TAB_MAX_TILT,
  TAB_RADIUS,
  TAB_ROW_RADIUS,
} from '../constants/channelTabs';
import {
  contentOf,
  createValueStore,
  lerp,
  setTranslateX,
  socketOf,
  within,
  type ValueStore,
} from '../utils/messageBar';

type Origin = 'tab' | 'row';

type Intent =
  | { kind: 'none' }
  | { kind: 'strip'; index: number }
  | { kind: 'hide'; via: 'button' | 'panel' }
  | { kind: 'blocked' };

export type ChannelTabDrop =
  | { kind: 'move'; id: string; target: string }
  | { kind: 'add'; id: string; before: string | null }
  | { kind: 'remove'; id: string };

export interface ChannelTabDragSession {
  label: string;
  glyph: Node[];
  badge: Node[];
  slot: number | null;
}

interface DragValues {
  px: MotionValue<number>;
  py: MotionValue<number>;
  morph: MotionValue<number>;
  scale: MotionValue<number>;
  shadow: MotionValue<number>;
  opacity: MotionValue<number>;
  hint: MotionValue<number>;
  tabWidth: MotionValue<number>;
  rowWidth: MotionValue<number>;
  rowGrabX: MotionValue<number>;
  rowGrabY: MotionValue<number>;
  tabGrabX: MotionValue<number>;
  tabGrabY: MotionValue<number>;
  snapX: MotionValue<number>;
  snapY: MotionValue<number>;
  snapLeft: MotionValue<number>;
  snapTop: MotionValue<number>;
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
  sourceRect: DOMRect | null;
  stripRect: DOMRect | null;
  addRect: DOMRect | null;
  panelRect: DOMRect | null;
  originX: number;
  originY: number;
  tileTop: number;
  gapX: number;
  start: number;
  end: number;
  width: number;
  fromIndex: number;
  hideText: string | null;
  blockedText: string;
  slot: number | null;
  intent: Intent;
  sourceShift: number;
  addShift: number;
  gapLeft: number | null;
  morphTarget: number;
  scaleTarget: number;
  hintTarget: number;
  snapXTarget: number;
  snapYTarget: number;
}

const sameIntent = (a: Intent, b: Intent): boolean => {
  if (a.kind === 'strip' && b.kind === 'strip') return a.index === b.index;
  if (a.kind === 'hide' && b.kind === 'hide') return a.via === b.via;
  return a.kind === b.kind;
};

const cloneGlyph = (host: Element | null): Node[] =>
  host ? Array.from(host.childNodes).map(node => node.cloneNode(true)) : [];

const measureTab = (sample: HTMLElement, label: string, glyph: Node[]): number => {
  const face = sample.querySelector<HTMLElement>('[data-tab-face]');
  if (!face) return sample.getBoundingClientRect().width;
  const clone = face.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  const text = clone.querySelector('[data-tab-text]');
  if (text) text.textContent = label;
  clone
    .querySelector('[data-tab-glyph]')
    ?.replaceChildren(...glyph.map(node => node.cloneNode(true)));
  clone.style.position = 'absolute';
  clone.style.visibility = 'hidden';
  clone.style.left = '0';
  clone.style.top = '0';
  sample.parentElement?.appendChild(clone);
  const width = clone.getBoundingClientRect().width;
  clone.remove();
  return width;
};

const LiftedTab: React.FC<{
  session: ChannelTabDragSession;
  values: DragValues;
  hintRef: React.RefObject<HTMLSpanElement | null>;
  reduceMotion: boolean;
}> = ({ session, values, hintRef, reduceMotion }) => {
  const velocity = useVelocity(values.px);
  const tiltTarget = useTransform(velocity, [-1600, 0, 1600], [-TAB_MAX_TILT, 0, TAB_MAX_TILT], {
    clamp: true,
  });
  const tilt = useSpring(tiltTarget, { stiffness: 320, damping: 24, mass: 0.6 });
  const grabX = useTransform(
    [values.morph, values.rowGrabX, values.tabGrabX],
    ([m = 0, row = 0, tab = 0]: number[]) => lerp(row, tab, m),
  );
  const grabY = useTransform(
    [values.morph, values.rowGrabY, values.tabGrabY],
    ([m = 0, row = 0, tab = 0]: number[]) => lerp(row, tab, m),
  );
  const left = useTransform(
    [values.px, grabX, values.snapX, values.snapLeft],
    ([p = 0, g = 0, s = 0, edge = 0]: number[]) => lerp(p - g, edge, s),
  );
  const top = useTransform(
    [values.py, grabY, values.snapY, values.snapTop],
    ([p = 0, g = 0, s = 0, edge = 0]: number[]) => lerp(p - g, edge, s),
  );
  const width = useTransform(
    [values.morph, values.rowWidth, values.tabWidth],
    ([m = 0, row = 0, tab = 0]: number[]) => lerp(row, tab, m),
  );
  const radius = useTransform(values.morph, m => lerp(TAB_ROW_RADIUS, TAB_RADIUS, m));
  const rowLabelOpacity = useTransform(values.morph, m => 1 - m);
  const hintY = useTransform(values.hint, [0, 1], [4, 0]);
  const transform = useMotionTemplate`translate3d(${left}px, ${top}px, 0) rotate(${
    reduceMotion ? '0' : tilt
  }deg) scale(${values.scale})`;
  const transformOrigin = useMotionTemplate`${grabX}px ${grabY}px`;
  const hintTransform = useMotionTemplate`translate3d(-50%, ${hintY}px, 0)`;
  const glyphRef = React.useRef<HTMLSpanElement>(null);
  const badgeRef = React.useRef<HTMLSpanElement>(null);

  React.useLayoutEffect(() => {
    glyphRef.current?.replaceChildren(...session.glyph);
    badgeRef.current?.replaceChildren(...session.badge);
  }, [session]);

  return (
    <motion.div
      className='absolute left-0 top-0 will-change-transform'
      style={{ transform, transformOrigin, width, height: TAB_HEIGHT, opacity: values.opacity }}
    >
      <motion.div
        className={`absolute inset-0 ${TAB_LIFTED_SHADOW_CLASS}`}
        style={{ opacity: values.shadow, borderRadius: radius }}
      />
      <motion.div
        className='absolute inset-0 border border-border bg-popover'
        style={{ borderRadius: radius }}
      />
      <motion.div
        className='absolute inset-0 flex items-center gap-2 overflow-hidden whitespace-nowrap px-2.5 text-sm text-foreground'
        style={{ borderRadius: radius }}
      >
        <span ref={glyphRef} className='flex shrink-0 items-center' />
        <span className='relative'>
          <motion.span className='font-medium tracking-[-0.28px]' style={{ opacity: values.morph }}>
            {session.label}
          </motion.span>
          <motion.span className='absolute left-0 top-0' style={{ opacity: rowLabelOpacity }}>
            {session.label}
          </motion.span>
        </span>
        {session.badge.length > 0 && (
          <span ref={badgeRef} className='flex shrink-0 items-center text-muted-foreground' />
        )}
      </motion.div>
      <motion.span
        ref={hintRef}
        className='absolute bottom-[calc(100%+8px)] left-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md'
        style={{ opacity: values.hint, transform: hintTransform }}
      />
    </motion.div>
  );
};

const ChannelTabDragLayer: React.FC<{
  store: ValueStore<ChannelTabDragSession>;
  values: DragValues;
  layerRef: React.RefObject<HTMLDivElement | null>;
  hintRef: React.RefObject<HTMLSpanElement | null>;
  reduceMotion: boolean;
}> = ({ store, values, layerRef, hintRef, reduceMotion }) => {
  const session = React.useSyncExternalStore(store.subscribe, store.get);
  if (!session) return null;
  return createPortal(
    <div ref={layerRef} aria-hidden className='pointer-events-none fixed left-0 top-0 z-[70]'>
      <LiftedTab session={session} values={values} hintRef={hintRef} reduceMotion={reduceMotion} />
    </div>,
    document.body,
  );
};

export interface ChannelTabDrag {
  listRef: React.RefObject<HTMLDivElement | null>;
  addRef: React.RefObject<HTMLSpanElement | null>;
  gapRef: React.RefObject<HTMLSpanElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  startTabPress: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  startRowPress: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  flyIn: (id: string, row: HTMLElement, commit: () => void) => void;
  cancel: () => void;
  session: ValueStore<ChannelTabDragSession>;
  layer: React.ReactNode;
}

export const usePanelSlot = (session: ValueStore<ChannelTabDragSession>): number | null =>
  React.useSyncExternalStore(session.subscribe, () => session.get()?.slot ?? null);

export const useChannelTabDrag = ({
  hideHint,
  slotFor,
  onDrop,
}: {
  hideHint: (id: string) => string | null;
  slotFor: (id: string) => number | null;
  onDrop: (drop: ChannelTabDrop) => void;
}): ChannelTabDrag => {
  const reduceMotion = useReducedMotion() ?? false;
  const listRef = React.useRef<HTMLDivElement>(null);
  const addRef = React.useRef<HTMLSpanElement>(null);
  const gapRef = React.useRef<HTMLSpanElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const layerRef = React.useRef<HTMLDivElement>(null);
  const hintRef = React.useRef<HTMLSpanElement>(null);
  const [store] = React.useState(() => createValueStore<ChannelTabDragSession>());
  const [values] = React.useState<DragValues>(() => ({
    px: motionValue(0),
    py: motionValue(0),
    morph: motionValue(1),
    scale: motionValue(1),
    shadow: motionValue(0),
    opacity: motionValue(1),
    hint: motionValue(0),
    tabWidth: motionValue(0),
    rowWidth: motionValue(0),
    rowGrabX: motionValue(0),
    rowGrabY: motionValue(0),
    tabGrabX: motionValue(0),
    tabGrabY: motionValue(0),
    snapX: motionValue(0),
    snapY: motionValue(0),
    snapLeft: motionValue(0),
    snapTop: motionValue(0),
  }));
  const dragRef = React.useRef<PointerDrag | null>(null);
  const flightRef = React.useRef<object | null>(null);
  const listenersRef = React.useRef<(() => void) | null>(null);
  const cursorRef = React.useRef<HTMLStyleElement | null>(null);
  const clickGuardRef = React.useRef<(() => void) | null>(null);
  const latest = React.useRef({ hideHint, slotFor, onDrop, reduceMotion });
  latest.current = { hideHint, slotFor, onDrop, reduceMotion };

  const slotOf = (): HTMLElement | null =>
    panelRef.current?.querySelector<HTMLElement>('[data-tab-slot]') ?? null;
  const emptyOf = (): HTMLElement | null =>
    panelRef.current?.querySelector<HTMLElement>('[data-tab-empty]') ?? null;

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
    element.style.width = '';
    element.style.overflow = '';
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
    [addRef.current, gapRef.current, slotOf(), emptyOf()].forEach(element => {
      if (element) clearStyle(element);
    });
    addRef.current?.removeAttribute('data-drop-target');
  };

  const teardown = (): void => {
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

  const sequenceFor = (drag: PointerDrag): (string | null)[] => {
    const { ids, intent } = drag;
    if (drag.origin === 'tab') {
      const rest = ids.filter(id => id !== drag.id);
      if (intent.kind === 'hide') return rest;
      const at = intent.kind === 'strip' ? intent.index : drag.fromIndex;
      return [...rest.slice(0, at), drag.id, ...rest.slice(at)];
    }
    if (intent.kind !== 'strip') return ids;
    return [...ids.slice(0, intent.index), null, ...ids.slice(intent.index)];
  };

  const place = (drag: PointerDrag, moveAdd: boolean): void => {
    let x = drag.start;
    drag.gapLeft = null;
    drag.sourceShift = 0;
    const source = drag.tiles[drag.fromIndex];
    if (source) setTranslateX(source, 0);
    sequenceFor(drag).forEach(id => {
      if (id === null) {
        drag.gapLeft = x;
        x += drag.width + drag.gapX;
        return;
      }
      const index = drag.ids.indexOf(id);
      const rect = drag.rects[index];
      const tile = drag.tiles[index];
      if (!rect || !tile) return;
      const shift = x - rect.left;
      setTranslateX(tile, shift);
      if (id === drag.id) drag.sourceShift = shift;
      x += rect.width + drag.gapX;
    });
    drag.addShift = moveAdd ? x - drag.end : 0;
    setTranslateX(addRef.current, drag.addShift);
  };

  const intoSlot = (drag: PointerDrag): boolean =>
    drag.intent.kind === 'hide' && drag.intent.via === 'panel' && drag.slot !== null;

  const applyIntent = (drag: PointerDrag): void => {
    const { intent } = drag;
    place(drag, drag.origin === 'row');

    if (drag.origin === 'tab') {
      const source = drag.tiles[drag.fromIndex];
      const socket = source ? socketOf(source) : null;
      if (socket) socket.style.opacity = intent.kind === 'hide' ? '0' : '1';
      if (intent.kind === 'hide' && intent.via === 'button') {
        addRef.current?.setAttribute('data-drop-target', '');
      } else {
        addRef.current?.removeAttribute('data-drop-target');
      }
      const slotted = intoSlot(drag);
      const slot = slotOf();
      if (slot) slot.style.height = slotted ? `${TAB_HEIGHT}px` : '0px';
      const empty = emptyOf();
      if (empty) {
        empty.style.height = slotted ? '0px' : '';
        empty.style.opacity = slotted ? '0' : '';
      }
      return;
    }

    const gap = gapRef.current;
    if (!gap) return;
    if (drag.gapLeft === null) {
      gap.style.opacity = '0';
      return;
    }
    const offset = `translate3d(${drag.gapLeft - drag.originX}px, ${drag.tileTop - drag.originY}px, 0)`;
    if (gap.style.opacity !== '1') {
      gap.style.transition = 'none';
      gap.style.width = `${drag.width}px`;
      gap.style.transform = offset;
      void gap.offsetHeight;
      gap.style.transition = `transform ${shiftDuration()}ms ${BAR_EASE_OUT}, opacity 150ms ${BAR_EASE_OUT}`;
      gap.style.opacity = '1';
    } else {
      gap.style.transform = offset;
    }
  };

  const retarget = (drag: PointerDrag): void => {
    const { intent } = drag;
    const reduce = latest.current.reduceMotion;
    const slotted = intoSlot(drag);
    const morph = drag.origin === 'tab' ? (slotted ? 0 : 1) : intent.kind === 'strip' ? 1 : 0;
    const message =
      intent.kind === 'blocked'
        ? drag.blockedText
        : intent.kind === 'hide' && !slotted
          ? drag.hideText
          : null;
    const scale = reduce ? 1 : message ? BAR_HIDE_SCALE : morph === 1 ? TAB_LIFT : BAR_ROW_LIFT;
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
    const snapping = reduce
      ? { duration: 0.12, ease: BAR_EASE_OUT_CURVE }
      : ({ type: 'spring', duration: 0.35, bounce: 0 } as const);
    const snapX = slotted ? 1 : 0;
    const snapY = intent.kind === 'strip' ? 1 : 0;
    if (snapX !== drag.snapXTarget) {
      drag.snapXTarget = snapX;
      animate(values.snapX, snapX, snapping);
    }
    if (snapY !== drag.snapYTarget) {
      drag.snapYTarget = snapY;
      animate(values.snapY, snapY, snapping);
    }
  };

  const resolveIntent = (drag: PointerDrag): Intent => {
    const x = drag.lastX;
    const y = drag.lastY;
    const overPanel = !!drag.panelRect && within(drag.panelRect, x, y, 0);
    if (drag.origin === 'tab') {
      const overAdd = !!drag.addRect && within(drag.addRect, x, y, 2);
      if (overPanel || overAdd) {
        return drag.hideText === null
          ? { kind: 'blocked' }
          : { kind: 'hide', via: overPanel ? 'panel' : 'button' };
      }
    } else if (overPanel) {
      return { kind: 'none' };
    }
    const strip = drag.stripRect;
    if (!strip || y < strip.top - BAR_DROP_REACH || y > strip.bottom + BAR_DROP_REACH) {
      return { kind: 'none' };
    }
    const probe = x - values.tabGrabX.get() + drag.width / 2;
    let index = 0;
    drag.rects.forEach((rect, i) => {
      if (i !== drag.fromIndex && rect.left + rect.width / 2 < probe) index += 1;
    });
    return { kind: 'strip', index };
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
    const list = listRef.current;
    const add = addRef.current;
    const source = drag.handle;
    const tiles = list
      ? Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-tab-tile]'))
      : [];
    const ids = tiles.map(tile => tile.dataset['tabId'] ?? '');
    const fromIndex = drag.origin === 'tab' ? ids.indexOf(drag.id) : -1;
    const first = tiles[0];
    if (!list || !add || !first || (drag.origin === 'tab' && fromIndex === -1)) {
      abandonPress();
      return;
    }
    try {
      source.setPointerCapture(drag.pointerId);
    } catch {
      abandonPress();
      return;
    }

    const { hideHint: hintFor, slotFor: slotIndex } = latest.current;
    const rects = tiles.map(tile => tile.getBoundingClientRect());
    const listRect = list.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const gapX = parseFloat(getComputedStyle(list).columnGap) || 0;
    const panel = panelRef.current?.closest<HTMLElement>('[data-slot="popover-content"]') ?? null;
    const panelBox = panel?.getBoundingClientRect() ?? null;
    const label = source.dataset['tabLabel'] ?? '';
    const glyph = cloneGlyph(source.querySelector('[data-tab-glyph]'));
    const hideText = drag.origin === 'tab' ? hintFor(drag.id) : null;
    const slot = drag.origin === 'tab' && hideText !== null && panel ? slotIndex(drag.id) : null;
    const lastRect = rects[rects.length - 1] ?? rects[0];

    drag.phase = 'drag';
    drag.ids = ids;
    drag.tiles = tiles;
    drag.rects = rects;
    drag.sourceRect = sourceRect;
    drag.stripRect = listRect;
    drag.addRect = add.getBoundingClientRect();
    drag.panelRect =
      panelBox && slot !== null
        ? new DOMRect(panelBox.x, panelBox.y, panelBox.width, panelBox.height + TAB_HEIGHT)
        : panelBox;
    drag.originX = listRect.left - list.scrollLeft;
    drag.originY = listRect.top - list.scrollTop;
    drag.tileTop = rects[0]?.top ?? listRect.top;
    drag.gapX = gapX;
    drag.start = rects[0]?.left ?? listRect.left;
    drag.end = (lastRect?.right ?? listRect.left) + gapX;
    drag.width =
      drag.origin === 'tab'
        ? sourceRect.width
        : measureTab(
            tiles.find(tile => !tile.querySelector('[data-tab-badge]')) ?? first,
            label,
            glyph,
          );
    drag.fromIndex = fromIndex;
    drag.hideText = hideText;
    drag.blockedText = `${label} can’t be hidden`;
    drag.slot = slot;
    drag.intent = drag.origin === 'tab' ? { kind: 'strip', index: fromIndex } : { kind: 'none' };

    const grabX = drag.startX - sourceRect.left;
    const grabY = drag.startY - sourceRect.top;
    values.tabWidth.jump(drag.width);
    values.rowGrabX.jump(grabX);
    values.rowGrabY.jump(grabY);
    if (drag.origin === 'tab') {
      values.rowWidth.jump(panelRef.current?.getBoundingClientRect().width ?? sourceRect.width);
      values.tabGrabX.jump(grabX);
      values.tabGrabY.jump(grabY);
      values.morph.jump(1);
    } else {
      values.rowWidth.jump(sourceRect.width);
      values.tabGrabX.jump((grabX / sourceRect.width) * drag.width);
      values.tabGrabY.jump(grabY);
      values.morph.jump(0);
    }
    values.px.jump(drag.lastX);
    values.py.jump(drag.lastY);
    values.scale.jump(1);
    values.shadow.jump(0);
    values.opacity.jump(1);
    values.hint.jump(0);
    values.snapX.jump(0);
    values.snapY.jump(drag.origin === 'tab' ? 1 : 0);
    values.snapLeft.jump(panelRef.current?.getBoundingClientRect().left ?? 0);
    values.snapTop.jump(drag.tileTop);
    drag.morphTarget = values.morph.get();
    drag.scaleTarget = 1;
    drag.hintTarget = 0;
    drag.snapXTarget = 0;
    drag.snapYTarget = values.snapY.get();

    const badgeSource = source.querySelector('[data-tab-badge]');
    const badge = badgeSource ? [badgeSource.cloneNode(true)] : [];
    flushSync(() => store.set({ label, glyph, badge, slot }));

    const transition = `transform ${shiftDuration()}ms ${BAR_EASE_OUT}`;
    tiles.forEach(tile => {
      tile.style.transition = transition;
    });
    add.style.transition = transition;
    const slotElement = slotOf();
    if (slotElement) slotElement.style.transition = `height 200ms ${BAR_EASE_OUT}`;
    const empty = emptyOf();
    if (empty) {
      empty.style.transition = `height 200ms ${BAR_EASE_OUT}, opacity 150ms ${BAR_EASE_OUT}`;
    }
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

    if (!commit || drag.intent.kind === 'blocked') {
      drag.intent = { kind: 'none' };
      applyIntent(drag);
    }

    const reduce = latest.current.reduceMotion;
    const { intent, sourceRect } = drag;
    let drop: ChannelTabDrop | null = null;
    let target = {
      left: sourceRect?.left ?? 0,
      top: sourceRect?.top ?? 0,
      morph: drag.origin === 'tab' ? 1 : 0,
    };
    let absorb = false;

    if (intent.kind === 'hide') {
      drop = { kind: 'remove', id: drag.id };
      const slot = intoSlot(drag) ? slotOf()?.getBoundingClientRect() : null;
      addRef.current?.removeAttribute('data-drop-target');
      place(drag, true);
      if (slot) {
        target = { left: slot.left, top: slot.top, morph: 0 };
      } else if (intent.via === 'button' && drag.addRect) {
        absorb = true;
        target = {
          left: drag.addRect.left + drag.addShift + drag.addRect.width / 2 - drag.width / 2,
          top: drag.addRect.top + drag.addRect.height / 2 - TAB_HEIGHT / 2,
          morph: 1,
        };
      } else {
        absorb = true;
        target = {
          left: values.px.get() - values.tabGrabX.get(),
          top: values.py.get() - values.tabGrabY.get(),
          morph: 1,
        };
      }
    } else if (intent.kind === 'strip' && drag.origin === 'row') {
      drop = { kind: 'add', id: drag.id, before: drag.ids[intent.index] ?? null };
      target = { left: drag.gapLeft ?? drag.end, top: drag.tileTop, morph: 1 };
      const row = drag.handle;
      const lastRow =
        !row.previousElementSibling?.matches('[data-tab-row]') &&
        !row.nextElementSibling?.matches('[data-tab-row]');
      if (!lastRow) {
        row.style.height = `${row.offsetHeight}px`;
        row.style.overflow = 'hidden';
        void row.offsetHeight;
        row.style.transition = `height 200ms ${BAR_EASE_OUT}, opacity 150ms ${BAR_EASE_OUT}`;
        row.style.height = '0px';
        row.style.opacity = '0';
      }
    } else if (intent.kind === 'strip') {
      const to = drag.ids[intent.index];
      if (intent.index !== drag.fromIndex && to) drop = { kind: 'move', id: drag.id, target: to };
      target = {
        left: (sourceRect?.left ?? 0) + drag.sourceShift,
        top: sourceRect?.top ?? 0,
        morph: 1,
      };
    }

    const grabX = target.morph === 1 ? values.tabGrabX.get() : values.rowGrabX.get();
    const grabY = target.morph === 1 ? values.tabGrabY.get() : values.rowGrabY.get();
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
      animate(values.scale, absorb && !reduce ? TAB_ABSORB_SCALE : 1, landing),
      animate(values.shadow, 0, { duration: 0.3, ease: BAR_EASE_OUT_CURVE }),
      animate(values.hint, 0, { duration: 0.12, ease: BAR_EASE_OUT_CURVE }),
      animate(values.snapX, 0, landing),
      animate(values.snapY, 0, landing),
    ];
    if (absorb) {
      animations.push(animate(values.opacity, 0, { duration: 0.2, ease: BAR_EASE_OUT_CURVE }));
    }

    void Promise.all(animations).then(() => {
      if (dragRef.current !== drag) return;
      if (drop) {
        const slot = slotOf();
        if (slot) {
          slot.style.transition = 'none';
          slot.style.height = '0px';
        }
        const committed = drop;
        flushSync(() => latest.current.onDrop(committed));
      }
      resetAll(drag);
      teardown();
    });
  };

  const settleRef = React.useRef(settle);
  settleRef.current = settle;
  const cancel = React.useCallback((): void => settleRef.current(false), []);

  const startPress = (origin: Origin, id: string, event: React.PointerEvent<HTMLElement>): void => {
    if (
      event.button !== 0 ||
      event.pointerType === 'touch' ||
      dragRef.current ||
      flightRef.current
    ) {
      return;
    }
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
      sourceRect: null,
      stripRect: null,
      addRect: null,
      panelRect: null,
      originX: 0,
      originY: 0,
      tileTop: 0,
      gapX: 0,
      start: 0,
      end: 0,
      width: 0,
      fromIndex: -1,
      hideText: null,
      blockedText: '',
      slot: null,
      intent: { kind: 'none' },
      sourceShift: 0,
      addShift: 0,
      gapLeft: null,
      morphTarget: 1,
      scaleTarget: 1,
      hintTarget: 0,
      snapXTarget: 0,
      snapYTarget: 0,
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
      if (keyEvent.key !== 'Escape' || drag.phase === 'press') return;
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

  const flyIn = (id: string, row: HTMLElement, commit: () => void): void => {
    if (dragRef.current || flightRef.current || latest.current.reduceMotion) {
      flushSync(commit);
      return;
    }
    const rowRect = row.getBoundingClientRect();
    const glyph = cloneGlyph(row.querySelector('[data-tab-glyph]'));
    values.px.jump(rowRect.left);
    values.py.jump(rowRect.top);
    values.rowGrabX.jump(0);
    values.rowGrabY.jump(0);
    values.tabGrabX.jump(0);
    values.tabGrabY.jump(0);
    values.rowWidth.jump(rowRect.width);
    values.tabWidth.jump(rowRect.width);
    values.morph.jump(0);
    values.scale.jump(1);
    values.shadow.jump(0);
    values.opacity.jump(1);
    values.hint.jump(0);
    values.snapX.jump(0);
    values.snapY.jump(0);
    flushSync(() =>
      store.set({ label: row.dataset['tabLabel'] ?? '', glyph, badge: [], slot: null }),
    );
    flushSync(commit);

    const tile = listRef.current?.querySelector<HTMLElement>(
      `:scope > [data-tab-tile][data-tab-id="${CSS.escape(id)}"]`,
    );
    if (!tile) {
      store.set(null);
      return;
    }
    tile.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const tileRect = tile.getBoundingClientRect();
    const content = contentOf(tile);
    content.forEach(child => {
      child.style.opacity = '0';
    });
    values.tabWidth.jump(tileRect.width);

    const flight = {};
    flightRef.current = flight;
    const travel = { type: 'spring', duration: 0.35, bounce: 0.12 } as const;
    void Promise.all([
      animate(values.px, tileRect.left, travel),
      animate(values.py, tileRect.top, travel),
      animate(values.morph, 1, { type: 'spring', duration: 0.35, bounce: 0 }),
      animate(values.shadow, [0, 1, 0], { duration: 0.35, ease: BAR_EASE_OUT_CURVE }),
    ]).then(() => {
      if (flightRef.current !== flight) return;
      flightRef.current = null;
      content.forEach(child => {
        child.style.opacity = '';
      });
      if (layerRef.current) layerRef.current.style.display = 'none';
      store.set(null);
    });
  };

  React.useEffect(
    () => (): void => {
      dragRef.current = null;
      flightRef.current = null;
      listenersRef.current?.();
      listenersRef.current = null;
      clickGuardRef.current?.();
      cursorRef.current?.remove();
      store.set(null);
    },
    [store],
  );

  return {
    listRef,
    addRef,
    gapRef,
    panelRef,
    startTabPress: (id, event) => startPress('tab', id, event),
    startRowPress: (id, event) => startPress('row', id, event),
    cancel,
    flyIn,
    session: store,
    layer: (
      <ChannelTabDragLayer
        store={store}
        values={values}
        layerRef={layerRef}
        hintRef={hintRef}
        reduceMotion={reduceMotion}
      />
    ),
  };
};
